import type { App as GitHubApp } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { env } from "../config/env";

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
    _app = new App({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_PRIVATE_KEY,
      webhooks: {
        secret: env.GITHUB_WEBHOOK_SECRET,
      },
      ...(env.GITHUB_API_URL
        ? {
            Octokit: Octokit.defaults({
              baseUrl: env.GITHUB_API_URL,
            }),
          }
        : {}),
    });
  }
  return _app;
}

/**
 * Returns an Octokit client authenticated as the installation identified by
 * installationId. The token is automatically scoped to the repos the app is
 * installed on and expires after 1 hour.
 */
export async function getInstallationOctokit(
  installationId: number,
): Promise<Octokit> {
  const app = await getApp();
  const octokit = await app.getInstallationOctokit(installationId);
  return octokit as unknown as Octokit;
}

export { getApp };
