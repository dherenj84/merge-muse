import type { App as GitHubApp } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { env } from "../config/env";
import { getProxiedFetch } from "../config/proxy";

let _app: GitHubApp | null = null;

async function importOctokitApp(): Promise<typeof import("@octokit/app")> {
  return Function(
    "specifier",
    "return import(specifier)",
  )("@octokit/app") as Promise<typeof import("@octokit/app")>;
}

async function getApp(): Promise<GitHubApp> {
  if (!_app) {
    const { App } = await importOctokitApp();
    const proxiedFetch = getProxiedFetch();
    const octokitOverrides = {
      ...(env.GITHUB_API_URL ? { baseUrl: env.GITHUB_API_URL } : {}),
      ...(proxiedFetch ? { request: { fetch: proxiedFetch } } : {}),
    };
    _app = new App({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_PRIVATE_KEY,
      webhooks: {
        secret: env.GITHUB_WEBHOOK_SECRET,
      },
      ...(Object.keys(octokitOverrides).length > 0
        ? { Octokit: Octokit.defaults(octokitOverrides) }
        : {}),
    });
  }
  return _app;
}

/**
 * Returns an Octokit client authenticated as the installation identified by
 * installationId. The token is automatically scoped to the repos the app is
 * installed on and expires after 1 hour.
 *
 * We extract the short-lived installation token from the App's Octokit and
 * construct a plain @octokit/rest Octokit with it. This avoids the REST
 * endpoint namespace mismatch between @octokit/app (methods under .rest.*)
 * and @octokit/rest (methods directly on the instance).
 */
export async function getInstallationOctokit(
  installationId: number,
): Promise<Octokit> {
  const app = await getApp();
  const appOctokit = await app.getInstallationOctokit(installationId);
  const { token } = (await appOctokit.auth({ type: "installation" })) as {
    token: string;
  };
  const proxiedFetch = getProxiedFetch();
  return new Octokit({
    auth: token,
    ...(env.GITHUB_API_URL ? { baseUrl: env.GITHUB_API_URL } : {}),
    ...(proxiedFetch ? { request: { fetch: proxiedFetch } } : {}),
  });
}

export { getApp };
