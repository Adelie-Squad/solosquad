import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";
import { getCronsWriteDir } from "../util/paths.js";
import type { CronConfig, CronKind } from "./crons.js";

export type CronRefResult =
  | { kind: "ok"; id: string }
  | { kind: "ambiguous"; matches: string[] }
  | { kind: "missing" };

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
export function loadCronDefs(schedulesDir: string = getCronsWriteDir()): CronDef[] {
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

/* -------------------------------------------------------------------------- */
/* v1.3.3 §C — file CRUD (create/edit/enable/disable/delete backing store)     */
/* -------------------------------------------------------------------------- */

export function cronYamlPath(id: string, dir: string = getCronsWriteDir()): string {
  return path.join(dir, `${id}.yaml`);
}
export function cronMdPath(id: string, dir: string = getCronsWriteDir()): string {
  return path.join(dir, `${id}.md`);
}

/** Deterministic, stable-field-order YAML for a cron definition. */
export function serializeCronDef(def: CronDef): string {
  const obj: Record<string, unknown> = {
    id: def.id,
    name: def.name,
    kind: def.kind,
    cron: def.cron,
    channel: def.channel,
    enabled: def.enabled,
  };
  if (def.threadName) obj.threadName = def.threadName;
  if (def.emoji && def.emoji !== "⏰") obj.emoji = def.emoji;
  if (def.memoryTargets && def.memoryTargets.length) obj.memoryTargets = def.memoryTargets;
  return yaml.dump(obj, { lineWidth: 100, quotingType: '"', forceQuotes: false });
}

/** Read a single def by id (null if its yaml is absent/unparsable). */
export function readCronDef(id: string, dir: string = getCronsWriteDir()): CronDef | null {
  const file = cronYamlPath(id, dir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = yaml.load(normalizeLine(fs.readFileSync(file, "utf-8")));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return coerceCronDef(parsed as Record<string, unknown>, id);
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Write a def's yaml (overwrites). Optionally scaffold the prompt md if absent. */
export function writeCronDef(def: CronDef, dir: string = getCronsWriteDir(), scaffoldPrompt = false): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cronYamlPath(def.id, dir), serializeCronDef(def), "utf-8");
  if (scaffoldPrompt && !fs.existsSync(cronMdPath(def.id, dir))) {
    fs.writeFileSync(
      cronMdPath(def.id, dir),
      `# ${def.name}\n\nTODO: describe what this scheduled run should do.\n`,
      "utf-8",
    );
  }
}

/** Patch selected fields of an existing def. Returns the new def, or null if absent. */
export function patchCronDef(id: string, patch: Partial<CronDef>, dir: string = getCronsWriteDir()): CronDef | null {
  const cur = readCronDef(id, dir);
  if (!cur) return null;
  const next: CronDef = { ...cur, ...patch, id: cur.id };
  writeCronDef(next, dir);
  return next;
}

/** Toggle the enabled flag (pause ≠ delete). Returns the new def, or null if absent. */
export function setCronEnabled(id: string, enabled: boolean, dir: string = getCronsWriteDir()): CronDef | null {
  return patchCronDef(id, { enabled }, dir);
}

/**
 * Delete a cron's backing files. By default archives them under
 * `<dir>/_archived/` (recoverable); pass `{ hard: true }` to remove outright.
 * Returns the list of removed/moved paths.
 */
export function deleteCronFiles(id: string, dir: string = getCronsWriteDir(), opts: { hard?: boolean } = {}): string[] {
  const touched: string[] = [];
  const targets = [cronYamlPath(id, dir), cronMdPath(id, dir)].filter((p) => fs.existsSync(p));
  if (targets.length === 0) return touched;
  if (opts.hard) {
    for (const p of targets) {
      fs.rmSync(p);
      touched.push(p);
    }
    return touched;
  }
  const archiveDir = path.join(dir, "_archived");
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "-");
  for (const p of targets) {
    const dest = path.join(archiveDir, `${path.basename(p)}.${stamp}`);
    fs.renameSync(p, dest);
    touched.push(dest);
  }
  return touched;
}

/**
 * Resolve a user-supplied reference (id OR case-insensitive name) to a single
 * user-cron id. Mirrors Hermes' "hex id or name, ambiguous refused" behavior.
 * Built-in crons are out of scope here (the CLI rejects edits to them).
 */
export function resolveCronRef(ref: string, dir: string = getCronsWriteDir()): CronRefResult {
  const defs = loadCronDefs(dir);
  const byId = defs.find((d) => d.id === ref);
  if (byId) return { kind: "ok", id: byId.id };
  const low = ref.toLowerCase();
  const byName = defs.filter((d) => d.name.toLowerCase() === low || d.id.toLowerCase() === low);
  if (byName.length === 1) return { kind: "ok", id: byName[0].id };
  if (byName.length > 1) return { kind: "ambiguous", matches: byName.map((d) => d.id) };
  return { kind: "missing" };
}
