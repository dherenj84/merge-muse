// Global Jest setup — sets required env vars before any test module is imported.
// All values are non-functional stubs used only for unit tests.
process.env.GITHUB_APP_ID = "1";
process.env.GITHUB_PRIVATE_KEY =
  "-----BEGIN RSA PRIVATE KEY-----\nfake_private_key_for_tests\n-----END RSA PRIVATE KEY-----";
process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
process.env.LLM_BASE_URL = "http://localhost:11434";
process.env.LLM_MODEL = "llama3";
process.env.LLM_API_KEY = "test-api-key";
process.env.DEFAULT_BASE_BRANCH = "main";
process.env.DEFAULT_ACTION_MODE = "patch";
