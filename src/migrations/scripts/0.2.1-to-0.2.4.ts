import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  loadWorkspaceYaml,
  saveWorkspaceYaml,
} from "../../util/config.js";

const TARGET = "0.2.4";

/**
 * v0.2.1 → v0.2.4 — non-destructive workspace.yaml upgrade.
 *
 * Adds three new fields with defaults:
 *   - timezone               (default: Asia/Seoul)
 *   - briefings              (default: morning 08:00, evening 18:00)
 *   - background_routines    (default: signal-scan 12:00, experiment-check 16:00,
 *                              weekly-review sunday 20:00)
 *
 * No file moves. Existing JSONL memory and workflows are untouched. Messenger
 * channels are reduced from 6 to 2 (`owner-command`, `workflow`) but the bot
 * does not delete old channels — it just stops sending to them. Users are
 * advised in the migration output to archive old channels manually.
 *
 * v0.2.2 and v0.2.3 were planning-only releases; the actual code stream goes
 * v0.2.1 → v0.2.4 in a single jump.
 */
export const migration: Migration = {
  from: "0.2.1",
  to: TARGET,
  description:
    "Add timezone + briefings + background_routines to workspace.yaml. Channels reduced to 2.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return ws.version === "0.2.1";
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];

    if (ws && !ws.timezone) {
      steps.push({
        kind: "update",
        to: ".solosquad/workspace.yaml",
        description: `Add timezone="${DEFAULT_WORKSPACE_SETTINGS.timezone}"`,
      });
    }
    if (ws && !ws.briefings) {
      steps.push({
        kind: "update",
        to: ".solosquad/workspace.yaml",
        description: `Add briefings (morning ${DEFAULT_WORKSPACE_SETTINGS.briefings.morning.time}, evening ${DEFAULT_WORKSPACE_SETTINGS.briefings.evening.time})`,
      });
    }
    if (ws && !ws.background_routines) {
      steps.push({
        kind: "update",
        to: ".solosquad/workspace.yaml",
        description:
          "Add background_routines (signal-scan, experiment-check, weekly-review)",
      });
    }
    steps.push({
      kind: "note",
      description:
        "Messenger channels are reduced from 6 → 2 (owner-command + workflow). " +
        "On next `solosquad bot` start, the new #workflow channel is auto-created. " +
        "Old channels (daily-brief, signals, experiments, weekly-review, errors) remain in " +
        "your server/workspace — archive them manually if desired. JSONL memory is untouched.",
    });
    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: `Bump version: 0.2.1 → ${TARGET}`,
    });

    return {
      steps,
      warnings: [
        "After migration, restart `solosquad bot` and `solosquad cron start` so the new channel + threads are created.",
        "Slack users: add `channels:manage` to the bot token scopes and reinstall the app, otherwise the bot cannot create the #workflow channel.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string, _plan: MigrationPlan): Promise<void> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return;

    if (!ws.timezone) {
      ws.timezone = DEFAULT_WORKSPACE_SETTINGS.timezone;
    }
    if (!ws.briefings) {
      ws.briefings = {
        morning: { ...DEFAULT_WORKSPACE_SETTINGS.briefings.morning },
        evening: { ...DEFAULT_WORKSPACE_SETTINGS.briefings.evening },
      };
    }
    if (!ws.background_routines) {
      ws.background_routines = {
        signal_scan: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.signal_scan },
        experiment_check: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.experiment_check },
        weekly_review: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.weekly_review },
      };
    }

    ws.version = TARGET;
    ws.last_migrated_to = TARGET;
    saveWorkspaceYaml(ws, workspace);
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml version ${ws.version} != ${TARGET}` };
    }
    if (!ws.timezone) {
      return { ok: false, error: "workspace.yaml.timezone missing after migration" };
    }
    if (!ws.briefings?.morning?.time || !ws.briefings?.evening?.time) {
      return { ok: false, error: "workspace.yaml.briefings incomplete after migration" };
    }
    if (
      !ws.background_routines?.signal_scan?.time ||
      !ws.background_routines?.experiment_check?.time ||
      !ws.background_routines?.weekly_review?.time
    ) {
      return { ok: false, error: "workspace.yaml.background_routines incomplete after migration" };
    }
    return { ok: true };
  },
};
