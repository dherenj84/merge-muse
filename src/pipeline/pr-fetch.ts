import { Octokit } from "@octokit/rest";

export interface PrMetadata {
  number: number;
  title: string;
  body: string;
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
  const [prResponse, filesResponse, configContent] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: prNumber }),
    fetchAllFiles(octokit, owner, repo, prNumber),
    fetchRepoConfig(octokit, owner, repo),
  ]);

  const pr = prResponse.data;

  const metadata: PrMetadata = {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    mergeCommitSha: pr.merge_commit_sha ?? pr.head.sha,
    htmlUrl: pr.html_url,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
  };

  return { metadata, files: filesResponse, repoConfigContent: configContent };
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
    const response = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page,
    });

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
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path: ".mergemuse.yml",
    });

    const data = response.data;
    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return null;
  } catch (err: unknown) {
    // 404 is expected when the file doesn't exist — fall back to defaults
    if (isNotFoundError(err)) return null;
    throw err;
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
