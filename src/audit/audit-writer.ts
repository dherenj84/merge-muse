import { ActionMode } from "../config/repository-settings";

export interface AuditRecord {
  event: "processed" | "skipped";
  owner: string;
  repo: string;
  prNumber: number;
  usedLlm: boolean;
  reason?: string;
  actionMode?: ActionMode;
  applied?: boolean;
  commentUrl?: string;
  rejectionReason?: string;
  llmError?: string;
  inputTokens?: number;
  outputTokens?: number;
  llmModel?: string;
}

export function writeAuditRecord(record: AuditRecord): void {
  console.log(
    JSON.stringify({
      level: "audit",
      timestamp: new Date().toISOString(),
      ...record,
    }),
  );
}
