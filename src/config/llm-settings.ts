import { env } from "./env";

export interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export function getLlmSettings(): LlmSettings {
  return {
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxInputTokens: env.LLM_MAX_INPUT_TOKENS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
  };
}
