const BASE_ENV = { ...process.env };

function applyRequiredBaseEnv(): void {
  process.env.GITHUB_APP_ID = "1";
  process.env.GITHUB_PRIVATE_KEY =
    "-----BEGIN RSA PRIVATE KEY-----\\nfake_private_key_for_tests\\n-----END RSA PRIVATE KEY-----";
  process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.LLM_BASE_URL = "https://example-llm.local";
  process.env.LLM_MODEL = "gpt-4o-mini";
  process.env.LLM_API_KEY = "test-api-key";
  process.env.DEFAULT_BASE_BRANCH = "main";
  process.env.DEFAULT_ACTION_MODE = "patch";
}

describe("configureProxy", () => {
  afterEach(() => {
    process.env = { ...BASE_ENV };
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("does not call setGlobalDispatcher when HTTPS_PROXY is not set", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    delete process.env.HTTPS_PROXY;

    const mockSetGlobalDispatcher = jest.fn();
    jest.mock("undici", () => ({
      ProxyAgent: jest.fn(),
      setGlobalDispatcher: mockSetGlobalDispatcher,
    }));

    const { configureProxy } = await import("../../src/config/proxy");
    configureProxy();

    expect(mockSetGlobalDispatcher).not.toHaveBeenCalled();
  });

  it("calls setGlobalDispatcher with a ProxyAgent when HTTPS_PROXY is set", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    process.env.HTTPS_PROXY = "http://proxy.corp.example.com:3128";

    const mockSetGlobalDispatcher = jest.fn();
    const MockProxyAgent = jest.fn().mockImplementation((url: string) => ({
      _url: url,
    }));
    jest.mock("undici", () => ({
      ProxyAgent: MockProxyAgent,
      setGlobalDispatcher: mockSetGlobalDispatcher,
    }));

    const { configureProxy } = await import("../../src/config/proxy");
    configureProxy();

    expect(MockProxyAgent).toHaveBeenCalledWith(
      "http://proxy.corp.example.com:3128",
    );
    expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(1);
    expect(mockSetGlobalDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({ _url: "http://proxy.corp.example.com:3128" }),
    );
  });

  it("parses HTTPS_PROXY from the env schema correctly", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    process.env.HTTPS_PROXY = "http://proxy.internal:8080";

    const { loadEnv } = await import("../../src/config/env");
    const result = loadEnv();

    expect(result.HTTPS_PROXY).toBe("http://proxy.internal:8080");
  });

  it("accepts an absent HTTPS_PROXY (optional field)", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    delete process.env.HTTPS_PROXY;

    const { loadEnv } = await import("../../src/config/env");
    const result = loadEnv();

    expect(result.HTTPS_PROXY).toBeUndefined();
  });

  it("rejects an invalid HTTPS_PROXY value", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    process.env.HTTPS_PROXY = "not-a-url";

    await expect(import("../../src/config/env")).rejects.toThrow(
      /MergeMuse configuration error|HTTPS_PROXY/,
    );
  });
});
