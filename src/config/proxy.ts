import { ProxyAgent, fetch as undiciFetch } from "undici";
import { env } from "./env";

let _agent: ProxyAgent | null = null;

function getProxyAgent(): ProxyAgent | null {
  if (!env.HTTPS_PROXY) return null;
  if (!_agent) _agent = new ProxyAgent(env.HTTPS_PROXY);
  return _agent;
}

/**
 * Returns a fetch function that routes requests through the configured
 * HTTPS proxy, or undefined when HTTPS_PROXY is not set.
 *
 * Apply this to GitHub API calls (App auth + Octokit) and Entra OAuth token
 * requests. Do NOT apply to LLM endpoint calls — the LLM is assumed to be
 * reachable on the internal enterprise network without a proxy.
 */
export function getProxiedFetch(): typeof undiciFetch | undefined {
  const agent = getProxyAgent();
  if (!agent) return undefined;
  return (url, init) => undiciFetch(url, { ...init, dispatcher: agent });
}

/** Resets the cached proxy agent. Used in tests only. */
export function resetProxyAgentForTests(): void {
  _agent = null;
}
