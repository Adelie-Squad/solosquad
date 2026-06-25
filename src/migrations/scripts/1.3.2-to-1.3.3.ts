import fs from "fs";
import path from "path";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml, listOrganizations } from "../../util/config.js";

/**
 * v1.3.2 → v1.3.3 — cron terminology unification (data path rename).
 *
 * v1.3.3 renames the two interchangeable concepts "routine" (built-in jobs)
 * and "schedule" (user-authored jobs) to a single noun: **cron**. The code,
 * CLI (`solosquad cron …`) and bundled asset dir (`crons/`) all moved; this
 * migration carries existing workspaces along by renaming their on-disk dirs:
 *
 *   - `<ws>/.solosquad/schedules/` → `<ws>/.solosquad/crons/` (v1.1 override)
 *   - `<ws>/.solosquad/routines/`  → `<ws>/.solosquad/crons/` (v1.0.x override)
 *   - `<org>/memory/routine-logs/` → `<org>/memory/cron-logs/`  (per-org logs)
 *
 * `getCronsDir()` still *reads* the legacy override dirs as a fallback, so a
 * workspace keeps working even if this migration is skipped — the rename is
 * about making the canonical name authoritative (and not orphaning the old
 * `routine-logs/`, which the archive ingester no longer scans under its old
 * name).
 *
 * Idempotent: a source dir whose target already exists is merged recursively;
 * leaf collisions keep the newer `dst` override (the superseded `src` duplicate
 * is dropped, preserved in the backup) so the legacy dir always empties even
 * when `schedules/` and `routines/` share entry names. Absent source = no-op.
 * detect() matches "1.3.2".
 */

const TARGET = "1.3.3";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.2" || version.startsWith("1.3.2.");
}

/** Move `src` → `dst`, folding into `dst` when it already exists. Recurses into
 *  same-named subdirectories so a dir-vs-dir collision merges instead of being
 *  orphaned. On a leaf collision (file-vs-file, or file/dir type mismatch) the
 *  `dst` copy wins — `dst` already holds the newer override (schedules folds in
 *  before the older routines), and the migration framework keeps a full backup —
 *  so the superseded `src` duplicate is dropped. Guarantees `src` ends up empty
 *  and is removed (so verify's "legacy dir gone" check passes even when both
 *  `schedules/` and `routines/` contain same-named entries). No-op when `src`
 *  is absent. */
function moveDir(src: string, dst: string): boolean {
  if (!fs.existsSync(src)) return false;
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return true;
  }
  let moved = false;
  for (const entry of fs.readdirSync(src)) {
    const from = path.join(src, entry);
    const to = path.join(dst, entry);
    if (!fs.existsSync(to)) {
      fs.renameSync(from, to);
      moved = true;
    } else if (
      fs.statSync(from).isDirectory() &&
      fs.statSync(to).isDirectory()
    ) {
      // Same-named subdir on both sides — merge recursively.
      if (moveDir(from, to)) moved = true;
    } else {
      // Leaf collision — dst (newer override) wins; drop the superseded src
      // duplicate (preserved in the migration backup).
      fs.rmSync(from, { recursive: true, force: true });
      moved = true;
    }
  }
  // src is now empty (every entry was moved, merged, or dropped) — remove it.
  if (fs.readdirSync(src).length === 0) fs.rmdirSync(src);
  return moved;
}

/** Pending dir renames across the workspace (for plan + idempotence checks). */
function pendingMoves(workspace: string): string[] {
  const out: string[] = [];
  const wsSchedules = path.join(workspace, ".solosquad", "schedules");
  const wsRoutines = path.join(workspace, ".solosquad", "routines");
  if (fs.existsSync(wsSchedules)) out.push(".solosquad/schedules → .solosquad/crons");
  if (fs.existsSync(wsRoutines)) out.push(".solosquad/routines → .solosquad/crons");
  for (const org of listOrganizations(workspace)) {
    if (fs.existsSync(path.join(org.path, "memory", "routine-logs"))) {
      out.push(`${org.slug}/memory/routine-logs → ${org.slug}/memory/cron-logs`);
    }
  }
  return out;
}

export const migration: Migration = {
  from: "1.3.2",
  to: TARGET,
  description:
    "v1.3.3 — cron terminology unification. Rename routine/schedule on-disk dirs (.solosquad/{schedules,routines} → .solosquad/crons; <org>/memory/routine-logs → cron-logs) to match the unified `cron` code/CLI/bundle surface.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return isFromVersion(typeof ws.version === "string" ? ws.version : "");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 1.3.3",
      });
    }
    for (const move of pendingMoves(workspace)) {
      steps.push({ kind: "move", from: move.split(" → ")[0], to: move.split(" → ")[1], description: `Rename ${move}` });
    }
    return {
      steps,
      warnings: [
        "v1.3.3 unifies the `routine`/`schedule` vocabulary to `cron`. The CLI is now `solosquad cron <start|run|list|new|show|validate>` (was `schedule` / `schedules` / `run-routine`). Update any scripts or systemd/pm2 units that called the old commands.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const solo = path.join(workspace, ".solosquad");
    // v1.1 override first (newer), then v1.0.x legacy — both fold into crons/.
    moveDir(path.join(solo, "schedules"), path.join(solo, "crons"));
    moveDir(path.join(solo, "routines"), path.join(solo, "crons"));
    for (const org of listOrganizations(workspace)) {
      moveDir(
        path.join(org.path, "memory", "routine-logs"),
        path.join(org.path, "memory", "cron-logs")
      );
    }
    const ws = loadWorkspaceYaml(workspace);
    if (ws) {
      ws.version = TARGET;
      ws.last_migrated_to = TARGET;
      saveWorkspaceYaml(ws, workspace);
    }
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing after apply" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}` };
    }
    // The legacy dirs must be gone (their contents folded into crons/cron-logs).
    const remaining = pendingMoves(workspace);
    if (remaining.length > 0) {
      return { ok: false, error: `legacy cron dirs still present: ${remaining.join("; ")}` };
    }
    return { ok: true };
  },
};
