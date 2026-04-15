import { getLlmSettings } from "../config/llm-settings";

interface OAuthTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;
let inFlightTokenRequest: Promise<string> | null = null;

function getEntraTokenUrl(tenantId: string): string {
  const encodedTenant = encodeURIComponent(tenantId);
  return `https://login.microsoftonline.com/${encodedTenant}/oauth2/v2.0/token`;
}

function isTokenStillUsable(
  token: CachedToken,
  refreshSkewMs: number,
  nowMs: number,
): boolean {
  return token.expiresAtMs - refreshSkewMs > nowMs;
}

async function requestEntraToken(
  signal: AbortSignal,
  tenantId: string,
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<OAuthTokenResponse> {
  const tokenUrl = getEntraTokenUrl(tenantId);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OAuth token endpoint returned ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  return (await response.json()) as OAuthTokenResponse;
}

export async function getLlmBearerToken(options?: {
  signal?: AbortSignal;
  forceRefresh?: boolean;
}): Promise<string> {
  const settings = getLlmSettings();

  if (settings.authMode === "api_key") {
    return settings.apiKey;
  }

  const nowMs = Date.now();
  if (
    !options?.forceRefresh &&
    cachedToken !== null &&
    isTokenStillUsable(cachedToken, settings.entraRefreshSkewMs, nowMs)
  ) {
    return cachedToken.token;
  }

  if (inFlightTokenRequest !== null && !options?.forceRefresh) {
    return inFlightTokenRequest;
  }

  const signal = options?.signal ?? new AbortController().signal;

  inFlightTokenRequest = (async () => {
    const tokenResponse = await requestEntraToken(
      signal,
      settings.entraTenantId,
      settings.entraClientId,
      settings.entraClientSecret,
      settings.entraScope,
    );

    if (
      typeof tokenResponse.access_token !== "string" ||
      tokenResponse.access_token.trim().length === 0
    ) {
      throw new Error("OAuth token response did not include access_token");
    }

    const expiresInMs = (tokenResponse.expires_in ?? 3600) * 1000;
    cachedToken = {
      token: tokenResponse.access_token,
      expiresAtMs: Date.now() + expiresInMs,
    };

    return cachedToken.token;
  })();

  try {
    return await inFlightTokenRequest;
  } finally {
    inFlightTokenRequest = null;
  }
}

export function resetLlmAuthCacheForTests(): void {
  cachedToken = null;
  inFlightTokenRequest = null;
}
