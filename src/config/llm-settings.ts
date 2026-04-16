import { env } from "./env";

export type LlmAuthMode = "api_key" | "entra_client_credentials";

interface LlmSettingsCommon {
  baseUrl: string;
  model: string;
  authMode: LlmAuthMode;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

interface LlmApiKeySettings extends LlmSettingsCommon {
  authMode: "api_key";
  apiKey: string;
}

interface LlmEntraSettings extends LlmSettingsCommon {
  authMode: "entra_client_credentials";
  entraTenantId: string;
  entraClientId: string;
  entraClientSecret: string;
  entraScope: string;
  entraRefreshSkewMs: number;
}

export type LlmSettings = LlmApiKeySettings | LlmEntraSettings;

export function getLlmSettings(): LlmSettings {
  if (env.LLM_AUTH_MODE === "entra_client_credentials") {
    return {
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL,
      authMode: env.LLM_AUTH_MODE,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxInputTokens: env.LLM_MAX_INPUT_TOKENS,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      entraTenantId: env.LLM_ENTRA_TENANT_ID ?? "",
      entraClientId: env.LLM_ENTRA_CLIENT_ID ?? "",
      entraClientSecret: env.LLM_ENTRA_CLIENT_SECRET ?? "",
      entraScope: env.LLM_ENTRA_SCOPE ?? "",
      entraRefreshSkewMs: env.LLM_ENTRA_REFRESH_SKEW_SECONDS * 1000,
    };
  }

  return {
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    authMode: env.LLM_AUTH_MODE,
    apiKey: env.LLM_API_KEY ?? "",
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxInputTokens: env.LLM_MAX_INPUT_TOKENS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
  };
}
