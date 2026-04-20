import express from "express";
import * as fs from "fs";
import * as path from "path";
import { loadEnv } from "./config/env";
import { webhookRouter } from "./http/webhook-handler";
import { assertWebhookContractAvailable } from "./http/webhook-contract";

// Validate and load all required environment variables at startup.
// Throws with a descriptive message if any required var is missing.
loadEnv();
assertWebhookContractAvailable();

const app = express();

const OPENAPI_SPEC_PATH = path.resolve(
  process.cwd(),
  "openapi",
  "swagger.json",
);

function loadGeneratedOpenApiSpec(): unknown | null {
  try {
    const raw = fs.readFileSync(OPENAPI_SPEC_PATH, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

let generatedOpenApiSpec = loadGeneratedOpenApiSpec();

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "merge-muse" });
});

// ── OpenAPI spec ─────────────────────────────────────────────────────────────
app.get("/openapi.json", (_req, res) => {
  if (generatedOpenApiSpec === null) {
    generatedOpenApiSpec = loadGeneratedOpenApiSpec();
  }

  if (generatedOpenApiSpec === null) {
    res.status(503).json({
      error:
        "OpenAPI spec is not available yet. Run 'npm run openapi:gen' or 'npm run build'.",
    });
    return;
  }

  res.json(generatedOpenApiSpec);
});

// ── Webhook endpoint ──────────────────────────────────────────────────────────
app.use(webhookRouter);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

// ── Start server ──────────────────────────────────────────────────────────────
import { env } from "./config/env";

const { PORT, HOST, LLM_AUTH_MODE } = env;

app.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "server_started",
      host: HOST,
      port: PORT,
      llmAuthMode: LLM_AUTH_MODE,
    }),
  );
});

export default app;
