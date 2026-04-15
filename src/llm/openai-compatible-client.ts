import { getLlmSettings } from "../config/llm-settings";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: LlmMessage[];
  temperature: number;
  max_tokens?: number;
  max_completion_tokens?: number;
}

async function sendCompletionRequest(
  url: string,
  apiKey: string,
  body: ChatCompletionRequest,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Sends a chat completion request to the configured OpenAI-compatible endpoint.
 * Works with OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio, and any provider
 * that implements the /v1/chat/completions interface.
 */
export async function chatCompletion(
  messages: LlmMessage[],
): Promise<LlmResponse> {
  const settings = getLlmSettings();

  // Normalise base URL — remove trailing slash if present
  const base = settings.baseUrl.replace(/\/$/, "");
  const url = `${base}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);

  let response: Response;
  try {
    const primaryBody: ChatCompletionRequest = {
      model: settings.model,
      messages,
      max_completion_tokens: settings.maxOutputTokens,
      temperature: 0.3,
    };

    response = await sendCompletionRequest(
      url,
      settings.apiKey,
      primaryBody,
      controller.signal,
    );

    // Some OpenAI-compatible providers still expect max_tokens.
    if (!response.ok && response.status === 400) {
      const firstBody = await response.text().catch(() => "");
      if (firstBody.includes("max_completion_tokens")) {
        const fallbackBody: ChatCompletionRequest = {
          model: settings.model,
          messages,
          max_tokens: settings.maxOutputTokens,
          temperature: 0.3,
        };
        response = await sendCompletionRequest(
          url,
          settings.apiKey,
          fallbackBody,
          controller.signal,
        );
      } else {
        // Re-create a response-like object by throwing now; handled below.
        throw new LlmResponseError(
          `LLM endpoint returned ${response.status}: ${firstBody.slice(0, 200)}`,
          response.status,
        );
      }
    }
  } catch (err) {
    if (err instanceof LlmResponseError) {
      throw err;
    }
    if ((err as Error).name === "AbortError") {
      throw new LlmTimeoutError(
        `LLM request timed out after ${settings.timeoutMs}ms`,
      );
    }
    throw new LlmNetworkError(`LLM request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LlmResponseError(
      `LLM endpoint returned ${response.status}: ${body.slice(0, 200)}`,
      response.status,
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new LlmResponseError("LLM returned empty content", response.status);
  }

  return {
    content: content.trim(),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? settings.model,
  };
}

// ── Typed errors ──────────────────────────────────────────────────────────────

export class LlmTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

export class LlmNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmNetworkError";
  }
}

export class LlmResponseError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "LlmResponseError";
    this.statusCode = statusCode;
  }
}
