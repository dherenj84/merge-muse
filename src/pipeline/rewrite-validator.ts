import { LlmResponse } from "../llm/openai-compatible-client";
import { NormalizedDiff, FileCategory } from "./diff-normalizer";
import { PrMetadata } from "./pr-fetch";

export interface RewriteResult {
  title: string;
  body: string;
  /** Label selected by the LLM from the repo's available labels, if any. */
  label?: string;
  /** true when the LLM output was used; false when deterministic fallback was applied */
  usedLlm: boolean;
  /** reason the LLM output was rejected, if applicable */
  rejectionReason?: string;
}

// Patterns matching common secret formats — used to block leakage into PR text
const SECRET_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{36}/, // GitHub PAT
  /ghs_[A-Za-z0-9]{36}/, // GitHub App token
  /AKIA[0-9A-Z]{16}/, // AWS Access Key
  /\b[A-Za-z0-9+/]{40}\b/, // 40-char base64-ish (e.g. Stripe keys)
  /-----BEGIN [A-Z ]+KEY-----/, // PEM headers
];

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

function parseLlmJson(
  raw: string,
): { title: string; body: string; label?: string } | null {
  // Strip markdown code fences if the model wrapped its output despite instructions
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.title === "string" &&
      typeof parsed.body === "string"
    ) {
      const label = typeof parsed.label === "string" ? parsed.label : undefined;
      return { title: parsed.title, body: parsed.body, label };
    }
    return null;
  } catch {
    return null;
  }
}

function validateTitle(title: string): string | null {
  if (!title || title.trim().length === 0) return "title is empty";
  if (title.length > 72)
    return `title too long (${title.length} chars, max 72)`;
  if (containsSecret(title)) return "title contains a potential secret";
  return null;
}

function validateBody(body: string): string | null {
  if (body.length > 4000)
    return `body too long (${body.length} chars, max 4000)`;
  if (containsSecret(body)) return "body contains a potential secret";
  return null;
}

// --- Deterministic fallback ---

function primaryScope(categories: FileCategory[]): string {
  if (categories.length === 0) return "chore";
  const counts = new Map<FileCategory, number>();
  for (const c of categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0][0];
  switch (dominant) {
    case "source":
      return "feat";
    case "test":
      return "test";
    case "docs":
      return "docs";
    case "config":
      return "chore";
    case "infra":
      return "ci";
    default:
      return "chore";
  }
}

function buildFallbackTitle(
  metadata: PrMetadata,
  diff: NormalizedDiff,
): string {
  const scope = primaryScope(diff.fileCategories);
  // Take the first 50 chars of the original title to keep context
  const base = metadata.title
    .replace(
      /^(feat|fix|refactor|docs|chore|test|ci|perf)(\([^)]+\))?:?\s*/i,
      "",
    )
    .trim();
  const truncated = base.length > 50 ? base.slice(0, 47) + "..." : base;
  const candidate = `${scope}: ${truncated}`;
  return candidate.slice(0, 72);
}

function buildFallbackBody(metadata: PrMetadata, diff: NormalizedDiff): string {
  const lines: string[] = [
    `_Auto-generated summary (LLM output could not be validated)_`,
    ``,
    `**Stats:** +${metadata.additions}/-${metadata.deletions} across ${metadata.changedFiles} file(s)`,
    ``,
    `**Changed files:**`,
  ];

  for (const f of diff.files.slice(0, 20)) {
    lines.push(
      `- \`${f.filename}\` (${f.status}, +${f.additions}/-${f.deletions})`,
    );
  }
  if (diff.skippedCount > 0) {
    lines.push(`- _...and ${diff.skippedCount} more_`);
  }

  return lines.join("\n");
}

/**
 * Returns the canonical repo label that matches `candidate` (case-insensitive),
 * or undefined if the candidate is absent or not in the repo label list.
 */
function resolveLabel(
  candidate: string | undefined,
  repoLabels: string[],
): string | undefined {
  if (!candidate || repoLabels.length === 0) return undefined;
  return repoLabels.find((l) => l.toLowerCase() === candidate.toLowerCase());
}

export function validateAndFallback(
  llmResponse: LlmResponse | null,
  metadata: PrMetadata,
  diff: NormalizedDiff,
): RewriteResult {
  if (llmResponse !== null) {
    const parsed = parseLlmJson(llmResponse.content);

    if (parsed === null) {
      return {
        title: buildFallbackTitle(metadata, diff),
        body: buildFallbackBody(metadata, diff),
        usedLlm: false,
        rejectionReason:
          "LLM output was not valid JSON with title and body fields",
      };
    }

    const titleError = validateTitle(parsed.title);
    if (titleError) {
      return {
        title: buildFallbackTitle(metadata, diff),
        body: buildFallbackBody(metadata, diff),
        usedLlm: false,
        rejectionReason: `title validation failed: ${titleError}`,
      };
    }

    const bodyError = validateBody(parsed.body);
    if (bodyError) {
      return {
        title: parsed.title,
        body: buildFallbackBody(metadata, diff),
        usedLlm: false,
        rejectionReason: `body validation failed: ${bodyError}`,
      };
    }

    return {
      title: parsed.title.trim(),
      body: parsed.body.trim(),
      // Only keep the label if it matches one of the repo's known labels
      // (case-insensitive). Preserve the original casing from the repo list.
      label: resolveLabel(parsed.label, metadata.repoLabels),
      usedLlm: true,
    };
  }

  // LLM call failed entirely — full fallback
  return {
    title: buildFallbackTitle(metadata, diff),
    body: buildFallbackBody(metadata, diff),
    usedLlm: false,
    rejectionReason: "LLM call failed",
  };
}
