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

webhookRouter.post(
  "/webhook",
  async (req: Request, res: Response): Promise<void> => {
    // ── 0. Contract validation (request shape from OpenAPI) ─────────────────
    const contractValidation = validateWebhookRequestAgainstContract(req);
    if (!contractValidation.ok) {
      sendWebhookContractResponse(res, contractValidation.reason.status, {
        error: normalizeContractError(contractValidation.reason.error),
      });
      return;
    }

    // ── 1. Signature verification ─────────────────────────────────────────────
    const sigHeader = req.headers["x-hub-signature-256"];
    if (typeof sigHeader !== "string") {
      sendWebhookContractResponse(res, 400, {
        error: normalizeContractError("Missing X-Hub-Signature-256"),
      });
      return;
    }

    const body = req.body as Buffer;
    const expected = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET)
      .update(body)
      .digest("hex")}`;

    let sigMatch = false;
    try {
      sigMatch = timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    } catch {
      // Length mismatch — timingSafeEqual throws; treat as invalid
    }

    if (!sigMatch) {
      sendWebhookContractResponse(res, 401, {
        error: normalizeContractError("Invalid signature"),
      });
      return;
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
