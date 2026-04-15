import { ChangedFile } from "./pr-fetch";
import { env } from "../config/env";

// Filenames/patterns that are low-signal noise for LLM rewriting
const NOISE_PATTERNS: RegExp[] = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
  /\.min\.(js|css)$/,
  /dist\//,
  /build\//,
  /\.map$/,
  /\.snap$/,
];

export interface NormalizedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface NormalizedDiff {
  files: NormalizedFile[];
  skippedCount: number;
  totalAdditions: number;
  totalDeletions: number;
  fileCategories: FileCategory[];
}

export type FileCategory =
  | "source"
  | "test"
  | "config"
  | "docs"
  | "infra"
  | "other";

function categorizeFile(filename: string): FileCategory {
  if (/\.(test|spec)\.(ts|tsx|js|jsx|py|rb|go|java|cs)$/.test(filename))
    return "test";
  if (/__(tests|mocks)__/.test(filename)) return "test";
  if (/\.(md|mdx|rst|txt|adoc)$/i.test(filename)) return "docs";
  if (
    /(Dockerfile|docker-compose|\.github\/|terraform\/|\.k8s\/|helm\/)/i.test(
      filename,
    )
  )
    return "infra";
  if (/\.(yml|yaml|json|toml|ini|env|conf|config)$/i.test(filename))
    return "config";
  if (
    /\.(ts|tsx|js|jsx|py|rb|go|java|cs|cpp|c|rs|swift|kt|php)$/i.test(filename)
  )
    return "source";
  return "other";
}

function isNoise(filename: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(filename));
}

function truncatePatch(patch: string, maxBytes: number): string {
  if (Buffer.byteLength(patch, "utf8") <= maxBytes) return patch;
  const truncated = Buffer.from(patch, "utf8")
    .slice(0, maxBytes)
    .toString("utf8");
  // Avoid cutting mid-character by trimming to last newline
  const lastNewline = truncated.lastIndexOf("\n");
  return lastNewline > 0
    ? `${truncated.slice(0, lastNewline)}\n... [truncated]`
    : `${truncated}\n... [truncated]`;
}

/**
 * Reduces a list of raw changed files into a compact model suitable for LLM
 * prompt construction. Excludes binaries, noise files, and oversized patches.
 * Files are sorted by change size descending so the most significant changes
 * appear first; large-patch files are truncated to respect the per-file byte
 * limit rather than dropped so the LLM always sees at least a summary.
 */
export function normalizeDiff(files: ChangedFile[]): NormalizedDiff {
  const maxFileBytes = env.DIFF_MAX_FILE_BYTES;
  const maxFiles = env.DIFF_MAX_FILES;

  // Exclude binary files and noise patterns upfront
  const eligible = files.filter((f) => !f.isBinary && !isNoise(f.filename));

  // Sort by total change size descending — most significant first
  const sorted = [...eligible].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  );

  const retained = sorted.slice(0, maxFiles);
  const skippedCount = files.length - retained.length;

  const normalizedFiles: NormalizedFile[] = retained.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ? truncatePatch(f.patch, maxFileBytes) : "",
  }));

  const uniqueCategories = Array.from(
    new Set(retained.map((f) => categorizeFile(f.filename))),
  ) as FileCategory[];

  return {
    files: normalizedFiles,
    skippedCount,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    fileCategories: uniqueCategories,
  };
}
