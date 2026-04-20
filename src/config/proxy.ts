import { ProxyAgent, setGlobalDispatcher } from "undici";
import { env } from "./env";

/**
 * Configures a global undici ProxyAgent when HTTPS_PROXY is set.
 *
 * Because Node.js's native fetch is powered by undici, setting the global
 * dispatcher routes all outbound fetch calls — including those made by Octokit
 * for GitHub API authentication and by the LLM client — through the proxy.
 *
 * This must be called once at startup, before any outbound connections are made.
 */
export function configureProxy(): void {
  if (!env.HTTPS_PROXY) {
    return;
  }

  const agent = new ProxyAgent(env.HTTPS_PROXY);
  setGlobalDispatcher(agent);
}
