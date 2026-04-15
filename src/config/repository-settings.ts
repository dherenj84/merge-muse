import * as yaml from "js-yaml";
import { env } from "./env";

export type ActionMode = "patch" | "comment" | "dry-run";

export interface RepoSettings {
  enabled: boolean;
  baseBranch: string;
  actionMode: ActionMode;
}

interface RepoConfigFile {
  enabled?: boolean;
  base_branch?: string;
  action_mode?: ActionMode;
}

const ACTION_MODES: ReadonlySet<string> = new Set([
  "patch",
  "comment",
  "dry-run",
]);

function isActionMode(value: unknown): value is ActionMode {
  return typeof value === "string" && ACTION_MODES.has(value);
}

/**
 * Parse a raw .mergemuse.yml file content into RepoSettings, falling back to
 * environment variable defaults for any missing fields.
 */
export function parseRepoConfig(yamlContent: string | null): RepoSettings {
  const defaults: RepoSettings = {
    enabled: true,
    baseBranch: env.DEFAULT_BASE_BRANCH,
    actionMode: env.DEFAULT_ACTION_MODE,
  };

  if (!yamlContent || yamlContent.trim() === "") {
    return defaults;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlContent);
  } catch {
    // Malformed YAML — fall back to defaults rather than crashing
    return defaults;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return defaults;
  }

  const cfg = parsed as RepoConfigFile;

  return {
    enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : defaults.enabled,
    baseBranch:
      typeof cfg.base_branch === "string" && cfg.base_branch.trim() !== ""
        ? cfg.base_branch.trim()
        : defaults.baseBranch,
    actionMode: isActionMode(cfg.action_mode)
      ? cfg.action_mode
      : defaults.actionMode,
  };
}
