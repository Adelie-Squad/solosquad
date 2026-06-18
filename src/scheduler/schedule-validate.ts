import cron from "node-cron";
import type { ScheduleDef } from "./schedule-def.js";

/**
 * v1.3.2 §8 — static validation of a user schedule definition. Pure (no fs):
 * the caller supplies `promptExists` + `reservedIds` so this stays testable.
 * Finding shape mirrors the other managers ({code, message, field}).
 */

export interface ScheduleFinding {
  code: string;
  message: string;
  id?: string;
  field?: string;
}

export interface ScheduleValidationResult {
  ok: boolean;
  errors: ScheduleFinding[];
  warnings: ScheduleFinding[];
}

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
  const errors: ScheduleFinding[] = [];
  const warnings: ScheduleFinding[] = [];
  const id = def.id;

  if (!id || !ID_RE.test(id)) {
    errors.push({ code: "SCHED_ID_MALFORMED", id, field: "id", message: `id "${id}" must be kebab-case` });
  }
  if (opts.reservedIds?.has(id)) {
    errors.push({ code: "SCHED_ID_COLLISION", id, field: "id", message: `id "${id}" collides with an existing routine` });
  }

  if (!def.cron || typeof def.cron !== "string") {
    errors.push({ code: "SCHED_CRON_MISSING", id, field: "cron", message: "cron expression is required" });
  } else if (!cron.validate(def.cron)) {
    errors.push({ code: "SCHED_CRON_INVALID", id, field: "cron", message: `cron "${def.cron}" is not a valid node-cron expression` });
  } else if (EVERY_MINUTE.test(def.cron.trim())) {
    warnings.push({ code: "SCHED_TOO_FREQUENT", id, field: "cron", message: "every-minute schedule — confirm this is intended (min-interval guard)" });
  }

  if (def.kind !== "user-brief" && def.kind !== "background") {
    errors.push({ code: "SCHED_KIND_UNKNOWN", id, field: "kind", message: `kind "${def.kind}" must be "user-brief" or "background"` });
  }

  if (!def.channel || def.channel.length === 0) {
    errors.push({ code: "SCHED_CHANNEL_MISSING", id, field: "channel", message: "channel is required" });
  }

  if (opts.promptExists && !opts.promptExists(id)) {
    errors.push({ code: "SCHED_PROMPT_MISSING", id, field: "prompt", message: `prompt file schedules/${id}.md not found` });
  }

  return { ok: errors.length === 0, errors, warnings };
}
