export {};

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

describe("getProxiedFetch", () => {
  afterEach(() => {
    process.env = { ...BASE_ENV };
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("returns undefined when HTTPS_PROXY is not set", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    delete process.env.HTTPS_PROXY;

    jest.mock("undici", () => ({
      ProxyAgent: jest.fn(),
      fetch: jest.fn(),
    }));

    const { getProxiedFetch } = await import("../../src/config/proxy");
    expect(getProxiedFetch()).toBeUndefined();
  });

  it("returns a fetch function wrapping a ProxyAgent when HTTPS_PROXY is set", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    process.env.HTTPS_PROXY = "http://proxy.corp.example.com:3128";

    const mockUndiciFetch = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const MockProxyAgent = jest.fn().mockImplementation((url: string) => ({
      _url: url,
    }));
    jest.mock("undici", () => ({
      ProxyAgent: MockProxyAgent,
      fetch: mockUndiciFetch,
    }));

    const { getProxiedFetch } = await import("../../src/config/proxy");
    const proxiedFetch = getProxiedFetch();

    expect(proxiedFetch).toBeDefined();
    expect(MockProxyAgent).toHaveBeenCalledWith(
      "http://proxy.corp.example.com:3128",
    );

    if (!proxiedFetch) {
      throw new Error("Expected proxiedFetch to be defined");
    }

    await proxiedFetch("https://api.github.com/app", {
      method: "GET",
    });

    expect(mockUndiciFetch).toHaveBeenCalledWith(
      "https://api.github.com/app",
      expect.objectContaining({
        method: "GET",
        dispatcher: expect.objectContaining({
          _url: "http://proxy.corp.example.com:3128",
        }),
      }),
    );
  });

  it("returns the same ProxyAgent instance on repeated calls (singleton)", async () => {
    process.env = { ...BASE_ENV };
    applyRequiredBaseEnv();
    process.env.HTTPS_PROXY = "http://proxy.internal:8080";

    const MockProxyAgent = jest.fn().mockImplementation(() => ({}));
    jest.mock("undici", () => ({
      ProxyAgent: MockProxyAgent,
      fetch: jest.fn(),
    }));

    const { getProxiedFetch } = await import("../../src/config/proxy");
    getProxiedFetch();
    getProxiedFetch();

    expect(MockProxyAgent).toHaveBeenCalledTimes(1);
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
