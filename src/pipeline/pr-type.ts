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

export function inferPrTypeFromTitle(title: string): PrType | null {
  const match = PR_TYPE_RE.exec(title);
  if (!match) return null;
  return match[1].toLowerCase() as PrType;
}

export function typeLabelForPrType(type: PrType): string {
  return `type:${type}`;
}
