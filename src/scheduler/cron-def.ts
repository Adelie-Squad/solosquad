import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";
import { getCronsDir } from "../util/paths.js";
import type { CronConfig, CronKind } from "./crons.js";

/**
 * v1.3.2 §8 — user-authored dynamic crons.
 *
 * The 4 built-in crons stay hardcoded in `CRONS[]` (their cron is
 * resolved from workspace.yaml). This adds an *additive* path: a user drops a
 * `crons/<id>.yaml` definition next to its `crons/<id>.md` prompt, and
 * the scheduler registers it on top of the built-ins. No built-in is removed
 * (backward-safe); the registry "dynamic-ization" of the built-ins themselves
 * is a follow-up.
 *
 * A CronDef is shaped to be a superset of CronConfig (+ cron + enabled)
 * so it flows straight into the existing `runCronForProduct`.
 */
export interface CronDef extends CronConfig {
  /** node-cron expression (5/6-field). Validated by `validateCronDef`. */
  cron: string;
  enabled: boolean;
}

export function coerceCronDef(raw: Record<string, unknown>, fallbackId: string): CronDef {
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : fallbackId;
  const kind: CronKind = raw.kind === "user-brief" ? "user-brief" : "background";
  return {
    id,
    name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : id,
    kind,
    cron: typeof raw.cron === "string" ? raw.cron : "",
    channel: typeof raw.channel === "string" && raw.channel.length > 0 ? raw.channel : "workflow",
    threadName: typeof raw.threadName === "string" ? raw.threadName : undefined,
    emoji: typeof raw.emoji === "string" ? raw.emoji : "⏰",
    memoryTargets: Array.isArray(raw.memoryTargets)
      ? raw.memoryTargets.filter((x): x is string => typeof x === "string")
      : [],
    enabled: raw.enabled !== false,
  };
}

/**
 * Load every `crons/<id>.yaml` user definition (best-effort: unparsable
 * files are skipped). Validation is a separate pass (`validateCronDef`).
 */
export function loadCronDefs(schedulesDir: string = getCronsDir()): CronDef[] {
  if (!fs.existsSync(schedulesDir)) return [];
  const out: CronDef[] = [];
  for (const file of fs.readdirSync(schedulesDir)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const full = path.join(schedulesDir, file);
    try {
      const parsed = yaml.load(normalizeLine(fs.readFileSync(full, "utf-8")));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(coerceCronDef(parsed as Record<string, unknown>, path.basename(file).replace(/\.ya?ml$/, "")));
      }
    } catch {
      // skip unparsable — validate pass reports the absence
    }
  }
  return out;
}
