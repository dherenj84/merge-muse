import { Octokit } from "@octokit/rest";
import { RewriteResult } from "./rewrite-validator";
import { ActionMode } from "../config/repository-settings";

export interface ApplyOutcome {
  mode: ActionMode;
  applied: boolean;
  commentUrl?: string;
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
    return { mode, applied: true };
  }

  // mode === 'comment'
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: formatCommentBody(result),
  });
  return { mode, applied: true, commentUrl: data.html_url };
}
