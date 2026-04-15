import { Octokit } from "@octokit/rest";
import { RewriteResult } from "./rewrite-validator";
import { ActionMode } from "../config/repository-settings";
import { PrMetadata } from "./pr-fetch";
import {
  findMatchingLabel,
  inferPrTypeFromTitle,
  typeLabelForPrType,
} from "./pr-type";

export interface ApplyOutcome {
  mode: ActionMode;
  applied: boolean;
  commentUrl?: string;
  autoAssigned?: string;
  autoLabeled?: string;
}

function isStatusError(err: unknown, status: number): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: number }).status === status
  );
}

async function ensureLabelExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  labelName: string,
): Promise<void> {
  try {
    await octokit.issues.getLabel({
      owner,
      repo,
      name: labelName,
    });
    return;
  } catch (err) {
    if (!isStatusError(err, 404)) throw err;
  }

  const type = labelName.replace(/^type:/, "");
  const colorByType: Record<string, string> = {
    feat: "1d76db",
    fix: "d73a4a",
    refactor: "5319e7",
    docs: "0e8a16",
    chore: "6b778c",
    test: "fbca04",
    ci: "c2e0c6",
    perf: "ff9900",
  };

  try {
    await octokit.issues.createLabel({
      owner,
      repo,
      name: labelName,
      color: colorByType[type] ?? "6b778c",
      description: `PR type: ${type}`,
    });
  } catch (err) {
    // If another process created the label concurrently, continue.
    if (!isStatusError(err, 422)) throw err;
  }
}

async function applyMissingAssigneeAndLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  metadata: PrMetadata,
  rewrittenTitle: string,
  llmLabel: string | undefined,
): Promise<Pick<ApplyOutcome, "autoAssigned" | "autoLabeled">> {
  const updates: Pick<ApplyOutcome, "autoAssigned" | "autoLabeled"> = {};

  if (metadata.existingAssignees.length === 0 && metadata.authorLogin) {
    try {
      await octokit.issues.addAssignees({
        owner,
        repo,
        issue_number: prNumber,
        assignees: [metadata.authorLogin],
      });
      updates.autoAssigned = metadata.authorLogin;
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "assignee_auto_apply_failed",
          owner,
          repo,
          prNumber,
          assignee: metadata.authorLogin,
          error: String(err),
        }),
      );
    }
  }

  if (metadata.existingLabels.length === 0) {
    // 1. Use the label the LLM picked (already validated against repoLabels).
    // 2. Alias-match against the already-fetched repo label list.
    // 3. Fall back to creating a new type:<kind> label.
    const type =
      inferPrTypeFromTitle(rewrittenTitle) ??
      inferPrTypeFromTitle(metadata.title) ??
      "chore";

    const existingMatch =
      llmLabel ?? findMatchingLabel(type, metadata.repoLabels);
    const label = existingMatch ?? typeLabelForPrType(type);

    try {
      if (!existingMatch) {
        await ensureLabelExists(octokit, owner, repo, label);
      }
      await octokit.issues.addLabels({
        owner,
        repo,
        issue_number: prNumber,
        labels: [label],
      });
      updates.autoLabeled = label;
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "label_auto_apply_failed",
          owner,
          repo,
          prNumber,
          label,
          error: String(err),
        }),
      );
    }
  }

  return updates;
}

function formatCommentBody(result: RewriteResult): string {
  const lines = [
    "## MergeMuse Suggested Rewrite",
    "",
    "> This is a suggested update only. Apply it by editing the PR title and description.",
    "",
    "### Suggested Title",
    "```",
    result.title,
    "```",
    "",
    "### Suggested Body",
    "```markdown",
    result.body,
    "```",
  ];

  if (!result.usedLlm && result.rejectionReason) {
    lines.push(
      "",
      `_Note: AI rewrite was not used (${result.rejectionReason}). This is a fallback summary._`,
    );
  }

  return lines.join("\n");
}

export async function applyRewrite(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  metadata: PrMetadata,
  result: RewriteResult,
  mode: ActionMode,
): Promise<ApplyOutcome> {
  if (mode === "dry-run") {
    return { mode, applied: false };
  }

  if (mode === "patch") {
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      title: result.title,
      body: result.body,
    });

    const updates = await applyMissingAssigneeAndLabel(
      octokit,
      owner,
      repo,
      prNumber,
      metadata,
      result.title,
      result.label,
    );

    return { mode, applied: true, ...updates };
  }

  // mode === 'comment'
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: formatCommentBody(result),
  });

  const updates = await applyMissingAssigneeAndLabel(
    octokit,
    owner,
    repo,
    prNumber,
    metadata,
    result.title,
    result.label,
  );

  return { mode, applied: true, commentUrl: data.html_url, ...updates };
}
