import { Router, Request, Response, raw } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";
import { completeDelivery, failDelivery, startDelivery } from "./dedup-cache";
import { processMergedPr } from "../pipeline/pr-processor";
import {
  normalizeContractError,
  sendWebhookContractResponse,
  validateWebhookRequestAgainstContract,
} from "./webhook-contract";

export const webhookRouter = Router();

// Parse raw body so we can verify the HMAC signature before touching contents
webhookRouter.use(raw({ type: "application/json", limit: "25mb" }));

function hasHookshotUserAgent(req: Request): boolean {
  const userAgent = req.headers["user-agent"];
  return (
    typeof userAgent === "string" && userAgent.startsWith("GitHub-Hookshot/")
  );
}

function hasValidWebhookSignature(req: Request):
  | { ok: true }
  | {
      ok: false;
      status: 400 | 401;
      message: string;
    } {
  const sigHeader = req.headers["x-hub-signature-256"];
  if (typeof sigHeader !== "string") {
    return {
      ok: false,
      status: 400,
      message: "Missing X-Hub-Signature-256",
    };
  }

  if (!Buffer.isBuffer(req.body)) {
    return {
      ok: false,
      status: 400,
      message: "Invalid request body",
    };
  }

  const expected = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex")}`;

  try {
    if (timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
      return { ok: true };
    }
  } catch {
    // Length mismatch throws. Treat as invalid signature.
  }

  return {
    ok: false,
    status: 401,
    message: "Invalid signature",
  };
}

function isAdditionalPropertyContractError(error: string): boolean {
  return error.startsWith("Unexpected property body.");
}

function sendMethodNotAllowed(res: Response): void {
  res.setHeader("Allow", "POST");
  sendWebhookContractResponse(res, 405, {
    error: normalizeContractError("Method not allowed"),
  });
}

webhookRouter.post(
  "/webhook",
  async (req: Request, res: Response): Promise<void> => {
    // ── 0. Contract validation (strict by default) ──────────────────────────
    let signatureVerified = false;
    let contractValidation = validateWebhookRequestAgainstContract(req, {
      allowAdditionalRequestProperties: false,
    });

    // Allow additional payload fields only for real GitHub Hookshot traffic
    // that has already proven possession of the shared webhook secret.
    if (
      !contractValidation.ok &&
      isAdditionalPropertyContractError(contractValidation.reason.error) &&
      hasHookshotUserAgent(req)
    ) {
      const signatureCheck = hasValidWebhookSignature(req);
      if (!signatureCheck.ok) {
        sendWebhookContractResponse(res, signatureCheck.status, {
          error: normalizeContractError(signatureCheck.message),
        });
        return;
      }

      signatureVerified = true;
      contractValidation = validateWebhookRequestAgainstContract(req, {
        allowAdditionalRequestProperties: true,
      });
    }

    if (!contractValidation.ok) {
      sendWebhookContractResponse(res, contractValidation.reason.status, {
        error: normalizeContractError(contractValidation.reason.error),
      });
      return;
    }

    // ── 1. Signature verification ───────────────────────────────────────────
    if (!signatureVerified) {
      const signatureCheck = hasValidWebhookSignature(req);
      if (!signatureCheck.ok) {
        sendWebhookContractResponse(res, signatureCheck.status, {
          error: normalizeContractError(signatureCheck.message),
        });
        return;
      }
    }

    // ── 3. Parse payload ──────────────────────────────────────────────────────
    const payload = contractValidation.payload as unknown as PullRequestEvent;

    // ── 4. Merged PR check ────────────────────────────────────────────────────
    if (payload.action !== "closed" || !payload.pull_request.merged) {
      sendWebhookContractResponse(res, 200, {
        skipped: true,
        reason: "PR not merged",
      });
      return;
    }

    // ── 5. Idempotency check (for merged PR processing) ──────────────────────
    const deliveryId = req.headers["x-github-delivery"];
    if (typeof deliveryId === "string") {
      const startResult = startDelivery(deliveryId);
      if (startResult === "duplicate") {
        sendWebhookContractResponse(res, 200, {
          skipped: true,
          reason: "duplicate delivery",
        });
        return;
      }
    }

    // Acknowledge immediately — GitHub expects a timely 2xx response
    sendWebhookContractResponse(res, 202, { accepted: true });

    // ── 6. Async processing (non-blocking) ────────────────────────────────────
    processMergedPr(payload)
      .then(() => {
        if (typeof deliveryId === "string") {
          completeDelivery(deliveryId);
        }
      })
      .catch((err: unknown) => {
        if (typeof deliveryId === "string") {
          failDelivery(deliveryId);
        }
        console.error(
          JSON.stringify({
            level: "error",
            event: "processing_error",
            delivery: deliveryId,
            pr: payload.pull_request.number,
            repo: payload.repository.full_name,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
  },
);

webhookRouter.options("/webhook", (_req: Request, res: Response) => {
  sendMethodNotAllowed(res);
});

webhookRouter.all("/webhook", (_req: Request, res: Response) => {
  sendMethodNotAllowed(res);
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PullRequestEvent {
  action: string;
  number: number;
  installation: {
    id: number;
  };
  pull_request: {
    number: number;
    merged: boolean;
    title: string;
    body: string | null;
    base: {
      ref: string;
      sha: string;
    };
    head: {
      sha: string;
    };
    merge_commit_sha: string | null;
    html_url: string;
  };
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
    default_branch: string;
  };
}
