const BASE_ENV = { ...process.env };

function applyRequiredBaseEnv(): void {
  process.env.GITHUB_APP_ID = "1";
  process.env.GITHUB_PRIVATE_KEY =
    "-----BEGIN RSA PRIVATE KEY-----\\nfake_private_key_for_tests\\n-----END RSA PRIVATE KEY-----";
  process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.LLM_BASE_URL = "https://example-llm.local";
  process.env.LLM_MODEL = "gpt-4o-mini";
  process.env.DEFAULT_BASE_BRANCH = "main";
  process.env.DEFAULT_ACTION_MODE = "patch";
}

describe("getLlmSettings", () => {
  afterEach(() => {
    process.env = { ...BASE_ENV };
    jest.resetModules();
  });

  it("returns api_key mode settings when LLM_AUTH_MODE is omitted", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    process.env.LLM_API_KEY = "test-api-key";
    delete process.env.LLM_AUTH_MODE;

    const { getLlmSettings } = await import("../../src/config/llm-settings");
    const settings = getLlmSettings();

    expect(settings.authMode).toBe("api_key");
    if (settings.authMode === "api_key") {
      expect(settings.apiKey).toBe("test-api-key");
    }
  });

  it("returns entra_client_credentials settings when configured", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    process.env.LLM_AUTH_MODE = "entra_client_credentials";
    process.env.LLM_ENTRA_TENANT_ID = "tenant-id";
    process.env.LLM_ENTRA_CLIENT_ID = "client-id";
    process.env.LLM_ENTRA_CLIENT_SECRET = "client-secret";
    process.env.LLM_ENTRA_SCOPE = "api://enterprise-llm/.default";
    delete process.env.LLM_API_KEY;

    const { getLlmSettings } = await import("../../src/config/llm-settings");
    const settings = getLlmSettings();

    expect(settings.authMode).toBe("entra_client_credentials");
    if (settings.authMode === "entra_client_credentials") {
      expect(settings.entraTenantId).toBe("tenant-id");
      expect(settings.entraClientId).toBe("client-id");
      expect(settings.entraScope).toBe("api://enterprise-llm/.default");
      expect(settings.entraRefreshSkewMs).toBe(120000);
    }
  });
});
