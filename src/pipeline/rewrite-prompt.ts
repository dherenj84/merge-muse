import { PrMetadata } from "./pr-fetch";
import { NormalizedDiff, FileCategory } from "./diff-normalizer";
import { RepoSettings } from "../config/repository-settings";
import { LlmMessage } from "../llm/openai-compatible-client";
import { env } from "../config/env";

// Conservative estimate: 1 token ≈ 4 characters for English/code mix
const CHARS_PER_TOKEN = 4;

const SYSTEM_PROMPT = `You are MergeMuse, a code-review assistant that rewrites GitHub pull request titles and descriptions to accurately reflect the actual code changes.

Your task:
1. Read the current PR title and body, then read the code diff summary provided.
2. Produce a rewritten title and body that precisely describe what code was changed and why.

Rules for the title:
- Maximum 72 characters.
- Must start with a conventional-commit type prefix (e.g. feat, fix, refactor, docs, chore, test, ci, perf) if the scope is clear.
- Use imperative mood ("add", not "adds" or "added").
- No trailing period.

Rules for the body:
- Keep it concise: 1–4 short paragraphs or a bullet list, not both.
- Explain WHAT changed and WHY (if determinable from the diff).
- Do NOT invent motivation you cannot infer from the code.
- Maximum 4000 characters.

Output format:
Return ONLY a valid JSON object on a single line. Always include "title" and "body".
If a list of available labels is provided, also include a "label" key containing the single best-matching label name exactly as it appears in the list. Only choose from that list. Omit the "label" key entirely if no label clearly fits.
{"title":"<rewritten title>","body":"<rewritten body>","label":"<label name>"}

Do NOT include code fences, markdown, explanation, or any other text outside the JSON object.`;

function formatCategories(categories: FileCategory[]): string {
  const counts = new Map<FileCategory, number>();
  for (const cat of categories) {
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${n} ${cat}`)
    .join(", ");
}

function formatFileList(diff: NormalizedDiff): string {
  const lines: string[] = [];
  for (const f of diff.files) {
    const sign =
      f.additions > 0 || f.deletions > 0
        ? ` (+${f.additions}/-${f.deletions})`
        : "";
    lines.push(`  ${f.status.padEnd(9)} ${f.filename}${sign}`);
  }
  if (diff.skippedCount > 0) {
    lines.push(`  ... and ${diff.skippedCount} more files omitted`);
  }
  return lines.join("\n");
}

function formatDiffHunks(diff: NormalizedDiff, remainingChars: number): string {
  const blocks: string[] = [];
  let used = 0;

  for (const f of diff.files) {
    if (!f.patch) continue;
    const block = `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\`\n`;
    if (used + block.length > remainingChars) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.length > 0 ? blocks.join("\n") : "(no patch available)";
}

export function buildRewritePrompt(
  metadata: PrMetadata,
  diff: NormalizedDiff,
  settings: RepoSettings,
): LlmMessage[] {
  void settings;
  const maxInputChars = env.LLM_MAX_INPUT_TOKENS * CHARS_PER_TOKEN;

  const staticPart = [
    `## Pull Request #${metadata.number}`,
    ``,
    `### Current Title`,
    metadata.title,
    ``,
    `### Current Body`,
    metadata.body || "(no description provided)",
    ...(metadata.repoLabels.length > 0
      ? [``, `### Available Labels`, metadata.repoLabels.join(", ")]
      : []),
    ``,
    `### Diff Summary`,
    `Total: +${metadata.additions}/-${metadata.deletions} across ${metadata.changedFiles} file(s)`,
    `Categories: ${formatCategories(diff.fileCategories)}`,
    ``,
    `### Changed Files`,
    formatFileList(diff),
    ``,
    `### Diff Hunks`,
  ].join("\n");

  const staticChars = SYSTEM_PROMPT.length + staticPart.length;
  const remainingChars = Math.max(0, maxInputChars - staticChars - 200); // 200 char safety buffer

  const hunks = formatDiffHunks(diff, remainingChars);

  const userContent = `${staticPart}\n${hunks}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
