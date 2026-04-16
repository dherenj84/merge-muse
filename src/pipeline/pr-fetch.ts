import { Octokit } from "@octokit/rest";

export interface PrMetadata {
  number: number;
  title: string;
  body: string;
  authorLogin: string;
  existingAssignees: string[];
  existingLabels: string[];
  /** All label names defined in the repository (not just those on this PR). */
  repoLabels: string[];
  headSha: string;
  baseSha: string;
  mergeCommitSha: string;
  htmlUrl: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface ChangedFile {
  filename: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  additions: number;
  deletions: number;
  patch: string | undefined;
  isBinary: boolean;
}

export interface PrData {
  metadata: PrMetadata;
  files: ChangedFile[];
  repoConfigContent: string | null;
}

const RETRY_DELAYS_MS = [250, 750];

function isRetryableGitHubReadError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const maybeStatus =
    "status" in err && typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;
  if (maybeStatus !== undefined) {
    // Retry transient server-side errors; avoid retrying client errors.
    return maybeStatus >= 500;
  }

  const maybeCode =
    "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;
  if (
    maybeCode === "ECONNRESET" ||
    maybeCode === "ETIMEDOUT" ||
    maybeCode === "ECONNABORTED" ||
    maybeCode === "EPIPE"
  ) {
    return true;
  }

  const message = String(err).toLowerCase();
  return (
    message.includes("other side closed") ||
    message.includes("socket hang up") ||
    message.includes("connection reset") ||
    message.includes("timed out")
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryGitHubRead<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        !isRetryableGitHubReadError(err) ||
        attempt >= RETRY_DELAYS_MS.length
      ) {
        throw err;
      }
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Fetches merged PR metadata, changed files, and the optional .mergemuse.yml
 * config from the repo's default branch.
 */
export async function fetchPrData(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrData> {
  const [prResponse, filesResponse, configContent, repoLabelsResponse] =
    await Promise.all([
      retryGitHubRead(() =>
        octokit.pulls.get({ owner, repo, pull_number: prNumber }),
      ),
      fetchAllFiles(octokit, owner, repo, prNumber),
      fetchRepoConfig(octokit, owner, repo),
      fetchRepoLabels(octokit, owner, repo),
    ]);

  const pr = prResponse.data;
  const existingLabels = pr.labels.flatMap((label) => {
    if (typeof label === "string") return [label];
    if (
      typeof label === "object" &&
      label !== null &&
      "name" in label &&
      typeof label.name === "string"
    ) {
      return [label.name];
    }
    return [];
  });

  const metadata: PrMetadata = {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    authorLogin: pr.user?.login ?? owner,
    existingAssignees: (pr.assignees ?? []).map((a) => a.login),
    existingLabels,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    mergeCommitSha: pr.merge_commit_sha ?? pr.head.sha,
    htmlUrl: pr.html_url,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    repoLabels: repoLabelsResponse,
  };

  return { metadata, files: filesResponse, repoConfigContent: configContent };
}

async function fetchRepoLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string[]> {
  if (!("issues" in octokit) || octokit.issues === undefined) {
    return [];
  }

  try {
    const response = await retryGitHubRead(() =>
      octokit.issues.listLabelsForRepo({
        owner,
        repo,
        per_page: 100,
      }),
    );
    return response.data.map((label) => label.name);
  } catch {
    return [];
  }
}

async function fetchAllFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const response = await retryGitHubRead(() =>
      octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: perPage,
        page,
      }),
    );

    for (const f of response.data) {
      files.push({
        filename: f.filename,
        status: f.status as ChangedFile["status"],
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
        isBinary: f.patch === undefined && (f.additions > 0 || f.deletions > 0),
      });
    }

    if (response.data.length < perPage) break;
    page++;
  }

  return files;
}

async function fetchRepoConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const response = await retryGitHubRead(() =>
      octokit.repos.getContent({
        owner,
        repo,
        path: ".mergemuse.yml",
      }),
    );

    const data = response.data;
    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return null;
  } catch (err: unknown) {
    // 404 is expected when the file doesn't exist — fall back to defaults
    if (isNotFoundError(err)) return null;
    // For transient/server errors (5xx, ECONNRESET, etc.), log a warning and
    // fall back to env defaults rather than aborting the pipeline for an
    // optional config file.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "repo_config_fetch_failed",
        owner,
        repo,
        error: String(err),
      }),
    );
    return null;
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: number }).status === 404
  );
}
