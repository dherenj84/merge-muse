import { buildRewritePrompt } from "../../src/pipeline/rewrite-prompt";
import type { PrMetadata } from "../../src/pipeline/pr-fetch";
import type { NormalizedDiff } from "../../src/pipeline/diff-normalizer";
import type { RepoSettings } from "../../src/config/repository-settings";

const metadata: PrMetadata = {
  number: 7,
  title: "Fix the bug",
  body: "Fixes #123. Also updates the migration guide.",
  authorLogin: "dev",
  existingAssignees: [],
  existingLabels: [],
  repoLabels: [],
  headSha: "aaa",
  baseSha: "bbb",
  mergeCommitSha: "ccc",
  htmlUrl: "https://github.com/example/repo/pull/7",
  additions: 5,
  deletions: 2,
  changedFiles: 1,
};

const diff: NormalizedDiff = {
  files: [
    {
      filename: "src/fix.ts",
      status: "modified",
      additions: 5,
      deletions: 2,
      patch: "@@ -1 +1 @@\n-old\n+new",
    },
  ],
  skippedCount: 0,
  totalAdditions: 5,
  totalDeletions: 2,
  fileCategories: ["source"],
};

const settings: RepoSettings = {
  enabled: true,
  baseBranch: "main",
  actionMode: "patch",
};

describe("buildRewritePrompt", () => {
  it("returns a system message and a user message", () => {
    const messages = buildRewritePrompt(metadata, diff, settings);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("system prompt instructs the model to evaluate the existing title and body for valuable details", () => {
    const messages = buildRewritePrompt(metadata, diff, settings);
    const system = messages[0].content;
    expect(system).toMatch(/valuable details/i);
    expect(system).toMatch(/retain/i);
  });

  it("system prompt instructs the model to preserve context consistent with the diff", () => {
    const messages = buildRewritePrompt(metadata, diff, settings);
    const system = messages[0].content;
    expect(system).toMatch(/consistent with the diff/i);
  });

  it("includes the existing PR title in the user message", () => {
    const messages = buildRewritePrompt(metadata, diff, settings);
    expect(messages[1].content).toContain(metadata.title);
  });

  it("includes the existing PR body in the user message", () => {
    const messages = buildRewritePrompt(metadata, diff, settings);
    expect(messages[1].content).toContain(metadata.body);
  });

  it("shows placeholder when PR body is empty", () => {
    const noBody: PrMetadata = { ...metadata, body: "" };
    const messages = buildRewritePrompt(noBody, diff, settings);
    expect(messages[1].content).toContain("(no description provided)");
  });

  it("includes available labels in the user message when present", () => {
    const withLabels: PrMetadata = {
      ...metadata,
      repoLabels: ["bug", "enhancement"],
    };
    const messages = buildRewritePrompt(withLabels, diff, settings);
    expect(messages[1].content).toContain("bug");
    expect(messages[1].content).toContain("enhancement");
  });

  it("omits labels section when repoLabels is empty", () => {
    const messages = buildRewritePrompt(metadata, diff, settings);
    expect(messages[1].content).not.toContain("### Available Labels");
  });
});
