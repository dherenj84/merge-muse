import { getInstallationOctokit } from "../github/app-client";
import { ChangedFile, fetchPrData, PrData } from "./pr-fetch";
import { normalizeDiff } from "./diff-normalizer";
import { ActionMode, parseRepoConfig } from "../config/repository-settings";
import { buildRewritePrompt } from "./rewrite-prompt";
import {
  chatCompletion,
  LlmTimeoutError,
  LlmNetworkError,
  LlmResponseError,
  LlmResponse,
} from "../llm/openai-compatible-client";
import { validateAndFallback } from "./rewrite-validator";
import { applyRewrite } from "./pr-apply";
import { writeAuditRecord } from "../audit/audit-writer";
import { PullRequestEvent } from "../http/webhook-handler";
import { env } from "../config/env";

function isLocalMockModeEnabled(): boolean {
  return env.LOCAL_MOCK_MODE === "true";
}

function buildLocalMockPrData(payload: PullRequestEvent): PrData {
  const files: ChangedFile[] = [
    {
      filename: "src/services/rewrite.ts",
      status: "modified",
      additions: 28,
      deletions: 11,
      patch:
        "@@ -10,8 +10,20 @@ export async function rewrite() {\n-  return oldResult;\n+  const prompt = buildPrompt(diff);\n+  const response = await llm.chat(prompt);\n+  return validateRewrite(response);\n }",
      isBinary: false,
    },
    {
      filename: "src/services/rewrite.test.ts",
      status: "added",
      additions: 35,
      deletions: 0,
      patch:
        "@@ -0,0 +1,35 @@\n+describe('rewrite', () => {\n+  it('falls back on invalid JSON', async () => {\n+    // test body\n+  });\n+});",
      isBinary: false,
    },
  ];

  const additions = files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return {
    metadata: {
      number: payload.pull_request.number,
      title: payload.pull_request.title,
      body: payload.pull_request.body ?? "",
      headSha: payload.pull_request.head.sha,
      baseSha: payload.pull_request.base.sha,
      mergeCommitSha:
        payload.pull_request.merge_commit_sha ?? payload.pull_request.head.sha,
      htmlUrl: payload.pull_request.html_url,
      additions,
      deletions,
      changedFiles: files.length,
    },
    files,
    // Keep mock path deterministic and non-destructive
    repoConfigContent: `enabled: true\nbase_branch: ${payload.pull_request.base.ref}\naction_mode: dry-run`,
  };
}

export async function processMergedPr(
  payload: PullRequestEvent,
): Promise<void> {
  const { pull_request: pr, repository, installation } = payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const prNumber = pr.number;
  const installationId = installation?.id;
  const localMockMode = isLocalMockModeEnabled();

  let octokit: Awaited<ReturnType<typeof getInstallationOctokit>> | null = null;

  // ── 1. Fetch PR data (metadata, files, repo config) ──────────────────────
  let prData: PrData;

  if (localMockMode) {
    prData = buildLocalMockPrData(payload);
  } else {
    if (!installationId) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "pr_processor_error",
          reason: "missing installation id",
          owner,
          repo,
          prNumber,
        }),
      );
      return;
    }

    octokit = await getInstallationOctokit(installationId);

    try {
      prData = await fetchPrData(octokit, owner, repo, prNumber);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "pr_fetch_failed",
          owner,
          repo,
          prNumber,
          error: String(err),
        }),
      );
      return;
    }
  }

  // ── 2. Parse per-repo config ──────────────────────────────────────────────
  let settings = parseRepoConfig(prData.repoConfigContent);

  if (localMockMode) {
    settings = { ...settings, actionMode: "dry-run" as ActionMode };
  }

  if (!settings.enabled) {
    writeAuditRecord({
      event: "skipped",
      reason: "disabled via .mergemuse.yml",
      owner,
      repo,
      prNumber,
      usedLlm: false,
    });
    return;
  }

  // Verify the merged branch matches the configured base branch
  if (pr.base.ref !== settings.baseBranch) {
    writeAuditRecord({
      event: "skipped",
      reason: `base branch mismatch (expected ${settings.baseBranch}, got ${pr.base.ref})`,
      owner,
      repo,
      prNumber,
      usedLlm: false,
    });
    return;
  }

  // ── 3. Normalize diff ─────────────────────────────────────────────────────
  const normalizedDiff = normalizeDiff(prData.files);

  // ── 4. Build prompt ───────────────────────────────────────────────────────
  const messages = buildRewritePrompt(
    prData.metadata,
    normalizedDiff,
    settings,
  );

  // ── 5. Call LLM ───────────────────────────────────────────────────────────
  let llmResponse: LlmResponse | null = null;
  let llmError: string | undefined;

  try {
    llmResponse = await chatCompletion(messages);
  } catch (err) {
    if (err instanceof LlmTimeoutError) {
      llmError = `LLM timeout: ${err.message}`;
    } else if (err instanceof LlmNetworkError) {
      llmError = `LLM network error: ${err.message}`;
    } else if (err instanceof LlmResponseError) {
      llmError = `LLM response error (status ${err.statusCode}): ${err.message}`;
    } else {
      llmError = `LLM unknown error: ${String(err)}`;
    }
    console.error(
      JSON.stringify({
        level: "warn",
        event: "llm_error",
        owner,
        repo,
        prNumber,
        error: llmError,
      }),
    );
  }

  // ── 6. Validate / fallback ────────────────────────────────────────────────
  const rewriteResult = validateAndFallback(
    llmResponse,
    prData.metadata,
    normalizedDiff,
  );

  // ── 7. Apply rewrite ──────────────────────────────────────────────────────
  let applyOutcome: { mode: ActionMode; applied: boolean; commentUrl?: string };
  if (localMockMode) {
    applyOutcome = { mode: "dry-run", applied: false };
  } else {
    try {
      applyOutcome = await applyRewrite(
        octokit!,
        owner,
        repo,
        prNumber,
        rewriteResult,
        settings.actionMode,
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "apply_failed",
          owner,
          repo,
          prNumber,
          error: String(err),
        }),
      );
      return;
    }
  }

  // ── 8. Audit log ──────────────────────────────────────────────────────────
  writeAuditRecord({
    event: "processed",
    owner,
    repo,
    prNumber,
    actionMode: settings.actionMode,
    applied: applyOutcome.applied,
    commentUrl: applyOutcome.commentUrl,
    usedLlm: rewriteResult.usedLlm,
    rejectionReason: rewriteResult.rejectionReason,
    llmError,
    inputTokens: llmResponse?.inputTokens,
    outputTokens: llmResponse?.outputTokens,
    llmModel: llmResponse?.model,
  });
}
