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

/**
 * v1.3.3 §C — parse a one-shot "when" into an absolute ISO timestamp.
 * Accepts an ISO 8601 timestamp or a relative delay `<n>s|m|h|d` (from now).
 * Rejects past times and unparseable input.
 */
export function parseWhen(input: string, now: number = Date.now()): { at?: string; error?: string } {
  const raw = (input ?? "").trim();
  if (!raw) return { error: "time is empty" };

  const rel = raw.match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const u = rel[2].toLowerCase()[0];
    const ms = u === "s" ? n * 1000 : u === "m" ? n * 60000 : u === "h" ? n * 3600000 : n * 86400000;
    if (ms <= 0) return { error: `invalid delay "${raw}"` };
    return { at: new Date(now + ms).toISOString() };
  }

  const t = Date.parse(raw);
  if (Number.isNaN(t)) return { error: `"${raw}" is not an ISO timestamp or a "<n>m|h|d" delay` };
  if (t <= now) return { error: `"${raw}" is in the past` };
  return { at: new Date(t).toISOString() };
}

/**
 * v1.3.4 §A — parse a `<n>s|m|h` jitter/delay string into seconds.
 * Returns null for empty/invalid input (treated as "no jitter").
 */
export function parseDelaySeconds(input: string | undefined | null): number | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 0) return null;
  const u = m[2].toLowerCase()[0];
  return u === "s" ? n : u === "m" ? n * 60 : n * 3600;
}

/** Parse one cron field into a matcher over its numeric domain [min,max].
 *  Supports `*`, `?`, `n`, `a-b`, `* /n`, `a-b/n`, and comma lists. dow/mon
 *  names are not expanded (generated crons are numeric); unknown → match-none. */
function fieldMatcher(field: string, lo: number, hi: number): (v: number) => boolean {
  const allowed = new Set<number>();
  for (const part of field.split(",")) {
    const p = part.trim();
    if (p === "*" || p === "?") {
      for (let i = lo; i <= hi; i++) allowed.add(i);
      continue;
    }
    const stepM = p.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    if (stepM) {
      const step = parseInt(stepM[2], 10);
      let rLo = lo;
      let rHi = hi;
      if (stepM[1] !== "*") {
        const rng = stepM[1].split("-").map((x) => parseInt(x, 10));
        rLo = rng[0];
        rHi = rng.length > 1 ? rng[1] : hi;
      }
      if (step > 0) for (let i = rLo; i <= rHi; i += step) allowed.add(i);
      continue;
    }
    const rngM = p.match(/^(\d+)-(\d+)$/);
    if (rngM) {
      for (let i = parseInt(rngM[1], 10); i <= parseInt(rngM[2], 10); i++) allowed.add(i);
      continue;
    }
    if (/^\d+$/.test(p)) allowed.add(parseInt(p, 10));
  }
  return (v: number) => allowed.has(v);
}

/** Timezone-aware local field extraction (min/hr/dom/mon[1-12]/dow[0-6]). */
function localParts(d: Date, timezone?: string): { mi: number; hr: number; dom: number; mon: number; dow: number } {
  if (!timezone) {
    return { mi: d.getMinutes(), hr: d.getHours(), dom: d.getDate(), mon: d.getMonth() + 1, dow: d.getDay() };
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    mi: parseInt(parts.minute, 10), hr: parseInt(parts.hour, 10) % 24,
    dom: parseInt(parts.day, 10), mon: parseInt(parts.month, 10), dow: DOW[parts.weekday] ?? 0,
  };
}

/**
 * v1.3.4 §B — the next N fire times for a recurring expression. Steps minute by
 * minute (tz/DST-aware) and collects matches. Empty array if invalid. For the
 * save-time preview; minute resolution (seconds field, if any, is ignored).
 */
export function nextRuns(expr: string, n = 5, timezone?: string, now: number = Date.now()): Date[] {
  if (!cron.validate(expr) || n <= 0) return [];
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return [];
  const [min, hr, dom, mon, dow] = parts.length === 6 ? parts.slice(1) : parts;
  const mMin = fieldMatcher(min, 0, 59);
  const mHr = fieldMatcher(hr, 0, 23);
  const mDom = fieldMatcher(dom, 1, 31);
  const mMon = fieldMatcher(mon, 1, 12);
  const mDow = fieldMatcher(dow, 0, 6);
  const domRestricted = dom.trim() !== "*" && dom.trim() !== "?";
  const dowRestricted = dow.trim() !== "*" && dow.trim() !== "?";

  const out: Date[] = [];
  // Start at the next whole minute.
  let t = Math.floor(now / 60000) * 60000 + 60000;
  const MAX = 367 * 24 * 60; // scan up to ~1 year of minutes
  for (let i = 0; i < MAX && out.length < n; i++, t += 60000) {
    const d = new Date(t);
    const p = localParts(d, timezone);
    if (!mMin(p.mi) || !mHr(p.hr) || !mMon(p.mon)) continue;
    // cron semantics: when both dom and dow are restricted, match EITHER.
    const domOk = mDom(p.dom);
    const dowOk = mDow(p.dow);
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) continue;
    out.push(d);
  }
  return out;
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

/**
 * Estimate a cron's cadence in minutes for the common shapes `normalizeSchedule`
 * produces (interval / daily / weekly / monthly). Returns null when the shape
 * isn't recognised — callers treat null as "can't judge overdue".
 */
export function estimatePeriodMinutes(expr: string): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return null;
  const [min, hr, dom, mon, dow] = parts.length === 6 ? parts.slice(1) : parts;
  const everyN = (f: string): number | null => {
    const m = f.match(/^\*\/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  };
  const minN = everyN(min);
  if (minN && hr === "*" && dom === "*" && mon === "*" && dow === "*") return minN;
  const hrN = everyN(hr);
  if (min === "0" && hrN && dom === "*" && mon === "*" && dow === "*") return hrN * 60;
  const domN = everyN(dom);
  if (min === "0" && hr === "0" && domN && mon === "*" && dow === "*") return domN * 1440;
  if (/^\d+$/.test(min) && /^\d+$/.test(hr)) {
    if (dom === "*" && mon === "*" && dow === "*") return 1440; // daily
    if (dom === "*" && mon === "*" && dow !== "*") return 10080; // weekly
    if (/^\d+$/.test(dom) && mon === "*" && dow === "*") return 43200; // monthly
  }
  return null;
}

/**
 * Dead-man's-switch: is a cron overdue? True when its last successful run is
 * older than `graceFactor` × its estimated period. Returns false when the
 * period can't be estimated or there's no prior run (nothing to compare).
 */
export function isOverdue(
  lastSuccessIso: string | null,
  expr: string,
  now: number = Date.now(),
  graceFactor = 2,
): boolean {
  if (!lastSuccessIso) return false;
  const period = estimatePeriodMinutes(expr);
  if (!period) return false;
  const ageMin = (now - new Date(lastSuccessIso).getTime()) / 60000;
  return ageMin > period * graceFactor;
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
