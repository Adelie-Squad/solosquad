export type MigrationStepKind = "move" | "rename" | "generate" | "remove" | "update" | "note";

export interface MigrationStep {
  kind: MigrationStepKind;
  from?: string;
  to?: string;
  description: string;
  payload?: unknown;
}

export interface MigrationPlan {
  steps: MigrationStep[];
  warnings: string[];
  irreversible_changes: string[];
  estimated_disk_delta_mb: number;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

export interface Migration {
  /** Source version spec (e.g. "1.1.x" matches 1.1.0–1.1.*). */
  from: string;
  /** Target version (e.g. "1.2.2"). */
  to: string;
  description: string;
  detect(workspace: string): Promise<boolean>;
  plan(workspace: string): Promise<MigrationPlan>;
  apply(workspace: string, plan: MigrationPlan): Promise<void>;
  verify(workspace: string): Promise<VerifyResult>;
}

export interface BackupMeta {
  workspace: string;
  source_version: string;
  target_version: string;
  created_at: string;
  migration_chain: string[];
}
