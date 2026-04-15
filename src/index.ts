import express from "express";
import { loadEnv } from "./config/env";
import { webhookRouter } from "./http/webhook-handler";

// Validate and load all required environment variables at startup.
// Throws with a descriptive message if any required var is missing.
loadEnv();

const app = express();

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "merge-muse" });
});

// ── Webhook endpoint ──────────────────────────────────────────────────────────
app.use(webhookRouter);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

// ── Start server ──────────────────────────────────────────────────────────────
import { env } from "./config/env";

const { PORT, HOST } = env;

app.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "server_started",
      host: HOST,
      port: PORT,
    }),
  );
});

export default app;
