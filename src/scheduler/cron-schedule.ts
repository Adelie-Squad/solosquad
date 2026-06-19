import cron from "node-cron";

/**
 * v1.3.3 §C — friendly schedule input → node-cron expression.
 *
 * Referenced from OpenClaw (`--every "1h"`, `--cron`) and Hermes (`every 30m`,
 * `@daily`) cron UX: users shouldn't have to hand-write 5-field cron strings for
 * the common cases. `normalizeSchedule` accepts:
 *   - a raw cron expression (passthrough, validated)
 *   - `@hourly|@daily|@weekly|@monthly|@yearly` shortcuts
 *   - `every <n><unit>` / `<n><unit>` recurring intervals (m=minute, h=hour, d=day)
 * and returns the canonical cron string the rest of the system stores.
 *
 * One-shot schedules (a bare ISO timestamp / relative `20m` delay) are NOT
 * recurring crons and need a different execution path — deferred (see PRD §C
 * 비범위). They are rejected here with a clear message.
 */

export interface NormalizeResult {
  cron?: string;
  /** Human-readable readback of what was parsed (for preview). */
  describe?: string;
  error?: string;
}

const SHORTCUTS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

const EVERY_RE = /^(?:every\s+)?(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i;

function unitClass(u: string): "m" | "h" | "d" {
  const s = u.toLowerCase();
  if (s.startsWith("m")) return "m";
  if (s.startsWith("h")) return "h";
  return "d";
}

/** Normalize a friendly schedule string into a node-cron expression. */
export function normalizeSchedule(input: string): NormalizeResult {
  const raw = (input ?? "").trim();
  if (!raw) return { error: "schedule is empty" };

  // 1. shortcut
  const sc = SHORTCUTS[raw.toLowerCase()];
  if (sc) return { cron: sc, describe: describeSchedule(sc) };

  // 2. every <n><unit> / <n><unit>
  const m = raw.match(EVERY_RE);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) return { error: `invalid interval "${raw}"` };
    const u = unitClass(m[2]);
    let expr: string;
    if (u === "m") {
      if (n > 59) return { error: `minute interval ${n} too large — use hours (e.g. "every 2h")` };
      expr = `*/${n} * * * *`;
    } else if (u === "h") {
      if (n > 23) return { error: `hour interval ${n} too large — use days (e.g. "every 1d")` };
      expr = `0 */${n} * * *`;
    } else {
      if (n > 31) return { error: `day interval ${n} too large` };
      expr = `0 0 */${n} * *`;
    }
    return { cron: expr, describe: describeSchedule(expr) };
  }

  // 3. raw cron expression
  if (cron.validate(raw)) return { cron: raw, describe: describeSchedule(raw) };

  // 4. one-shot (ISO / bare delay) — not a recurring cron
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) || /^\d+\s*(s|sec|seconds?)$/i.test(raw)) {
    return { error: `one-shot schedules ("${raw}") are not supported yet — use a recurring cron, "@daily", or "every <n>m|h|d"` };
  }

  return { error: `"${raw}" is not a valid cron expression, "@shortcut", or "every <n>m|h|d"` };
}

/** Best-effort human description of a 5-field cron expression. Falls back to
 *  the raw expression when the pattern isn't one of the common shapes. */
export function describeSchedule(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return `cron: ${expr}`;
  const [min, hr, dom, mon, dow] = parts.length === 6 ? parts.slice(1) : parts;

  const everyN = (field: string): number | null => {
    const m = field.match(/^\*\/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  };
  const minN = everyN(min);
  const hrN = everyN(hr);

  if (minN && hr === "*" && dom === "*" && mon === "*" && dow === "*") return `every ${minN} minute(s)`;
  if (min === "0" && hrN && dom === "*" && mon === "*" && dow === "*") return `every ${hrN} hour(s)`;
  if (/^\d+$/.test(min) && /^\d+$/.test(hr)) {
    const at = `${hr.padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (dom === "*" && mon === "*" && dow === "*") return `daily at ${at}`;
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) return `weekly on ${DOW[+dow]} at ${at}`;
    if (dom === "*" && mon === "*" && dow !== "*") return `at ${at} on days-of-week ${dow}`;
    if (/^\d+$/.test(dom) && mon === "*" && dow === "*") return `monthly on day ${dom} at ${at}`;
  }
  return `cron: ${expr}`;
}

/** The next fire time for an expression (authoritative — uses node-cron's own
 *  scheduler). Returns null if the expression is invalid. */
export function nextRun(expr: string, timezone?: string): Date | null {
  if (!cron.validate(expr)) return null;
  try {
    // createTask doesn't compute getNextRun() until started; start, read, destroy.
    const task = cron.createTask(expr, () => {}, timezone ? { timezone } : {});
    void task.start();
    const next = task.getNextRun();
    void task.destroy();
    return next ?? null;
  } catch {
    return null;
  }
}
