import cron from "node-cron";
import type { CronDef } from "./cron-def.js";
import { Findings, type BaseFinding, type ValidationResult } from "../util/validation.js";
import { isKebabCase } from "../util/naming.js";
import { isValidIanaTimezone, suggestTimezone } from "../util/timezone.js";
import { estimatePeriodMinutes, parseDelaySeconds } from "./cron-schedule.js";

/**
 * v1.3.2 §8 — static validation of a user cron definition. Pure (no fs):
 * the caller supplies `promptExists` + `reservedIds` so this stays testable.
 * Finding shape mirrors the other managers ({code, message, field}); the
 * accumulation is the shared §9.1 `Findings` collector.
 */

export interface CronFinding extends BaseFinding {
  id?: string;
}

export type ScheduleValidationResult = ValidationResult<CronFinding>;

export interface ValidateScheduleOptions {
  /** Does the backing `crons/<id>.md` prompt exist? */
  promptExists?: (id: string) => boolean;
  /** Ids already taken (built-in crons + other defs) — collision = error. */
  reservedIds?: ReadonlySet<string>;
}

const EVERY_MINUTE = /^(\*|\*\/1)(\s+\*){4}$/;

export function validateCronDef(
  def: CronDef,
  opts: ValidateScheduleOptions = {},
): ScheduleValidationResult {
  const f = new Findings<CronFinding>();
  const id = def.id;

  f.errorIf(!id || !isKebabCase(id), { code: "CRON_ID_MALFORMED", id, field: "id", message: `id "${id}" must be kebab-case` });
  f.errorIf(!!opts.reservedIds?.has(id), { code: "CRON_ID_COLLISION", id, field: "id", message: `id "${id}" collides with an existing cron` });

  // v1.3.3 §C — a def is either recurring (`cron`) or one-shot (`at`).
  if (def.at) {
    const t = Date.parse(def.at);
    if (Number.isNaN(t)) {
      f.error({ code: "CRON_AT_INVALID", id, field: "at", message: `at "${def.at}" is not an ISO timestamp` });
    } else if (t <= Date.now()) {
      f.warn({ code: "CRON_AT_PAST", id, field: "at", message: `one-shot time "${def.at}" is in the past — it will be cleaned up, not run` });
    }
  } else if (!def.cron || typeof def.cron !== "string") {
    f.error({ code: "CRON_CRON_MISSING", id, field: "cron", message: "a recurring `cron` expression or a one-shot `at` time is required" });
  } else if (!cron.validate(def.cron)) {
    f.error({ code: "CRON_CRON_INVALID", id, field: "cron", message: `cron "${def.cron}" is not a valid node-cron expression` });
  } else {
    const expr = def.cron.trim();
    // v1.3.4 §D — min-interval guard extended from every-minute to <5 minutes.
    const period = estimatePeriodMinutes(expr);
    if (EVERY_MINUTE.test(expr) || (period !== null && period < 5)) {
      f.warn({ code: "CRON_TOO_FREQUENT", id, field: "cron", message: "cron fires more often than every 5 minutes — confirm this is intended (min-interval guard)" });
    }
    // v1.3.4 §D — DST risk window: a fixed daily-ish fire at 00:00–02:59 local
    // can be skipped or doubled on a DST transition.
    const fields = expr.split(/\s+/);
    const hrField = (fields.length === 6 ? fields.slice(1) : fields)[1];
    if (/^\d+$/.test(hrField) && +hrField <= 2) {
      f.warn({ code: "CRON_DST_WINDOW", id, field: "cron", message: `fires at ~0${hrField}:xx local — DST transitions can skip or double this run; consider a time outside 00:00–03:00` });
    }
    // v1.3.4 §A — jitter must not exceed half the cadence.
    const jitterSec = parseDelaySeconds(def.maxRandomDelay);
    if (jitterSec && period !== null && jitterSec > (period * 60) / 2) {
      f.warn({ code: "CRON_JITTER_TOO_LARGE", id, field: "maxRandomDelay", message: `maxRandomDelay (${def.maxRandomDelay}) exceeds half the cadence — fires may bunch unpredictably` });
    }
  }

  // v1.3.4 §A — jitter string must be parseable even for one-shot defs.
  if (def.maxRandomDelay && parseDelaySeconds(def.maxRandomDelay) === null) {
    f.error({ code: "CRON_JITTER_INVALID", id, field: "maxRandomDelay", message: `maxRandomDelay "${def.maxRandomDelay}" must be like "90s" or "5m"` });
  }

  // v1.3.4 §C — timezone, when set, must be a valid IANA name.
  if (def.timezone) {
    if (!isValidIanaTimezone(def.timezone)) {
      const hint = suggestTimezone(def.timezone);
      f.error({ code: "CRON_TZ_INVALID", id, field: "timezone", message: `timezone "${def.timezone}" is not a valid IANA name${hint ? ` — did you mean "${hint}"?` : ""}` });
    }
  }

  f.errorIf(def.kind !== "user-brief" && def.kind !== "background", { code: "CRON_KIND_UNKNOWN", id, field: "kind", message: `kind "${def.kind}" must be "user-brief" or "background"` });
  // v1.3.4 §F2 — channel is auto-resolved to works-<handle> at runtime; an
  // empty channel is valid (no longer CRON_CHANNEL_MISSING).
  f.errorIf(!!opts.promptExists && !opts.promptExists(id), { code: "CRON_PROMPT_MISSING", id, field: "prompt", message: `prompt file crons/${id}.md not found` });

  return f.result();
}
