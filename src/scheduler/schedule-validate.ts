import cron from "node-cron";
import type { ScheduleDef } from "./schedule-def.js";
import { Findings, type BaseFinding, type ValidationResult } from "../util/validation.js";

/**
 * v1.3.2 §8 — static validation of a user schedule definition. Pure (no fs):
 * the caller supplies `promptExists` + `reservedIds` so this stays testable.
 * Finding shape mirrors the other managers ({code, message, field}); the
 * accumulation is the shared §9.1 `Findings` collector.
 */

export interface ScheduleFinding extends BaseFinding {
  id?: string;
}

export type ScheduleValidationResult = ValidationResult<ScheduleFinding>;

export interface ValidateScheduleOptions {
  /** Does the backing `schedules/<id>.md` prompt exist? */
  promptExists?: (id: string) => boolean;
  /** Ids already taken (built-in routines + other defs) — collision = error. */
  reservedIds?: ReadonlySet<string>;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVERY_MINUTE = /^(\*|\*\/1)(\s+\*){4}$/;

export function validateScheduleDef(
  def: ScheduleDef,
  opts: ValidateScheduleOptions = {},
): ScheduleValidationResult {
  const f = new Findings<ScheduleFinding>();
  const id = def.id;

  f.errorIf(!id || !ID_RE.test(id), { code: "SCHED_ID_MALFORMED", id, field: "id", message: `id "${id}" must be kebab-case` });
  f.errorIf(!!opts.reservedIds?.has(id), { code: "SCHED_ID_COLLISION", id, field: "id", message: `id "${id}" collides with an existing routine` });

  if (!def.cron || typeof def.cron !== "string") {
    f.error({ code: "SCHED_CRON_MISSING", id, field: "cron", message: "cron expression is required" });
  } else if (!cron.validate(def.cron)) {
    f.error({ code: "SCHED_CRON_INVALID", id, field: "cron", message: `cron "${def.cron}" is not a valid node-cron expression` });
  } else if (EVERY_MINUTE.test(def.cron.trim())) {
    f.warn({ code: "SCHED_TOO_FREQUENT", id, field: "cron", message: "every-minute schedule — confirm this is intended (min-interval guard)" });
  }

  f.errorIf(def.kind !== "user-brief" && def.kind !== "background", { code: "SCHED_KIND_UNKNOWN", id, field: "kind", message: `kind "${def.kind}" must be "user-brief" or "background"` });
  f.errorIf(!def.channel || def.channel.length === 0, { code: "SCHED_CHANNEL_MISSING", id, field: "channel", message: "channel is required" });
  f.errorIf(!!opts.promptExists && !opts.promptExists(id), { code: "SCHED_PROMPT_MISSING", id, field: "prompt", message: `prompt file schedules/${id}.md not found` });

  return f.result();
}
