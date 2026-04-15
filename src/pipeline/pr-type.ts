export type PrType =
  | "feat"
  | "fix"
  | "refactor"
  | "docs"
  | "chore"
  | "test"
  | "ci"
  | "perf";

const PR_TYPE_RE =
  /^\s*(feat|fix|refactor|docs|chore|test|ci|perf)(?:\([^)]+\))?:/i;

/**
 * Per-type aliases checked against existing repo labels (case-insensitive).
 * Listed in preference order; `type:<kind>` entries allow matching labels
 * that were already created by a previous run.
 */
const LABEL_ALIASES: Record<PrType, string[]> = {
  feat: ["enhancement", "feature", "new feature", "type:feat"],
  fix: ["bug", "bugfix", "hotfix", "type:fix"],
  refactor: ["refactor", "refactoring", "type:refactor"],
  docs: ["documentation", "docs", "type:docs"],
  chore: ["chore", "maintenance", "type:chore"],
  test: ["test", "tests", "testing", "type:test"],
  ci: ["ci", "build", "pipeline", "type:ci"],
  perf: ["performance", "perf", "optimization", "type:perf"],
};

export function inferPrTypeFromTitle(title: string): PrType | null {
  const match = PR_TYPE_RE.exec(title);
  if (!match) return null;
  return match[1].toLowerCase() as PrType;
}

export function typeLabelForPrType(type: PrType): string {
  return `type:${type}`;
}

/**
 * Returns the first label from `repoLabels` that is an alias for `type`,
 * or `null` if none match. Comparison is case-insensitive; the original
 * casing from the repository is preserved in the return value.
 */
export function findMatchingLabel(
  type: PrType,
  repoLabels: string[],
): string | null {
  const aliases = LABEL_ALIASES[type];
  for (const alias of aliases) {
    const match = repoLabels.find(
      (l) => l.toLowerCase() === alias.toLowerCase(),
    );
    if (match !== undefined) return match;
  }
  return null;
}
