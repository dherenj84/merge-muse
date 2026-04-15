import { z } from "zod";
import * as fs from "fs";

const envSchema = z.object({
  // GitHub App credentials
  GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required"),
  GITHUB_PRIVATE_KEY: z
    .string()
    .min(
      1,
      "GITHUB_PRIVATE_KEY is required (PEM string or file path prefixed with @)",
    ),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),

  // LLM provider
  LLM_BASE_URL: z.string().url("LLM_BASE_URL must be a valid URL"),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  LLM_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(512),

  // Default per-repo behaviour (overridable via .mergemuse.yml)
  DEFAULT_BASE_BRANCH: z.string().default("main"),
  DEFAULT_ACTION_MODE: z.enum(["patch", "comment", "dry-run"]).default("patch"),

  // HTTP server
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),

  // Dedup cache
  DEDUP_CACHE_MAX: z.coerce.number().int().positive().default(1000),
  DEDUP_CACHE_TTL_MS: z.coerce.number().int().positive().default(3600000), // 1 hour

  // Diff normaliser limits
  DIFF_MAX_FILE_BYTES: z.coerce.number().int().positive().default(50000),
  DIFF_MAX_FILES: z.coerce.number().int().positive().default(100),

  // Optional: GitHub API base URL (for GHES)
  GITHUB_API_URL: z.string().url().optional(),

  // Optional: local development mode for webhook->LLM pipeline without GitHub API fetch/apply
  LOCAL_MOCK_MODE: z.enum(["true", "false"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

function resolvePrivateKey(raw: string): string {
  if (raw.startsWith("@")) {
    // Support file path: GITHUB_PRIVATE_KEY=@/run/secrets/private-key.pem
    const path = raw.slice(1);
    return fs.readFileSync(path, "utf8");
  }
  // Inline PEM — replace literal \n with actual newlines (common in env var usage)
  return raw.replace(/\\n/g, "\n");
}

export function loadEnv(): Env & { GITHUB_PRIVATE_KEY: string } {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `MergeMuse configuration error — missing or invalid env vars:\n${messages}`,
    );
  }
  const env = parsed.data;
  return {
    ...env,
    GITHUB_PRIVATE_KEY: resolvePrivateKey(env.GITHUB_PRIVATE_KEY),
  };
}

export const env: Env & { GITHUB_PRIVATE_KEY: string } = loadEnv();
