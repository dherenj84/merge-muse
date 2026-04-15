import type { PullRequestEvent } from "../../src/http/webhook-handler";

export const prMergedPayload: PullRequestEvent = {
  action: "closed",
  number: 42,
  installation: { id: 12345 },
  pull_request: {
    number: 42,
    merged: true,
    title: "Update stuff",
    body: "Various changes",
    base: { ref: "main", sha: "abc123" },
    head: { sha: "def456" },
    merge_commit_sha: "ghi789",
    html_url: "https://github.com/example/repo/pull/42",
  },
  repository: {
    name: "repo",
    full_name: "example/repo",
    owner: { login: "example" },
    default_branch: "main",
  },
};

export const prClosedNotMergedPayload: PullRequestEvent = {
  ...prMergedPayload,
  pull_request: {
    ...prMergedPayload.pull_request,
    merged: false,
  },
};
