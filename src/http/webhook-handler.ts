import { Router, Request, Response, raw } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";
import { isDuplicate } from "./dedup-cache";
import { processMergedPr } from "../pipeline/pr-processor";

export const webhookRouter = Router();

// Parse raw body so we can verify the HMAC signature before touching contents
webhookRouter.use(raw({ type: "application/json", limit: "25mb" }));

webhookRouter.post(
  "/webhook",
  async (req: Request, res: Response): Promise<void> => {
    // ── 1. Signature verification ─────────────────────────────────────────────
    const sigHeader = req.headers["x-hub-signature-256"];
    if (typeof sigHeader !== "string") {
      res.status(400).json({ error: "Missing X-Hub-Signature-256" });
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
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // ── 2. Event type filtering ───────────────────────────────────────────────
    const eventType = req.headers["x-github-event"];
    if (eventType !== "pull_request") {
      res
        .status(200)
        .json({ skipped: true, reason: "not a pull_request event" });
      return;
    }

    // ── 3. Idempotency check ──────────────────────────────────────────────────
    const deliveryId = req.headers["x-github-delivery"];
    if (typeof deliveryId === "string" && isDuplicate(deliveryId)) {
      res.status(200).json({ skipped: true, reason: "duplicate delivery" });
      return;
    }

    // ── 4. Parse payload ──────────────────────────────────────────────────────
    let payload: PullRequestEvent;
    try {
      payload = JSON.parse(body.toString("utf8")) as PullRequestEvent;
    } catch {
      res.status(400).json({ error: "Invalid JSON payload" });
      return;
    }

    // ── 5. Merged PR check ────────────────────────────────────────────────────
    if (payload.action !== "closed" || !payload.pull_request.merged) {
      res.status(200).json({ skipped: true, reason: "PR not merged" });
      return;
    }

    // Acknowledge immediately — GitHub expects a timely 2xx response
    res.status(202).json({ accepted: true });

    // ── 6. Async processing (non-blocking) ────────────────────────────────────
    processMergedPr(payload).catch((err: unknown) => {
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
