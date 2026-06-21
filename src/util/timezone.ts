/**
 * v1.3.4 §C — shared IANA timezone helpers.
 *
 * Extracted from `cli/init.ts` (which had a local `TIMEZONE_PRESETS` +
 * `isValidIanaTimezone`) so cron CLI, per-user personalization, and the
 * conversational cron-manager all validate timezones the same way and offer
 * the same "pick from a list, never typo" UX.
 *
 * `suggestTimezone` powers the "did you mean …?" fallback against the full
 * IANA set (`Intl.supportedValuesOf("timeZone")` — ~418 zones on Node 18+).
 */

export interface TimezonePreset {
  name: string;
  value: string;
}

/** Curated shortlist for the inquirer picker (CLI) + numbered list (chat). */
export const TIMEZONE_PRESETS: TimezonePreset[] = [
  { name: "Asia/Seoul (UTC+09) — recommended", value: "Asia/Seoul" },
  { name: "America/Los_Angeles (UTC-08/-07)", value: "America/Los_Angeles" },
  { name: "America/New_York (UTC-05/-04)", value: "America/New_York" },
  { name: "Europe/London (UTC+00/+01)", value: "Europe/London" },
  { name: "UTC", value: "UTC" },
  { name: "Other — type IANA string", value: "__other__" },
];

/** Sentinel for the "Other — type it" picker choice. */
export const TIMEZONE_OTHER = "__other__";

/** True when `tz` is a valid IANA timezone name (Intl throws RangeError if not). */
export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The full IANA timezone list (best-effort; empty array if unsupported). */
export function allTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return typeof fn === "function" ? fn("timeZone") : [];
  } catch {
    return [];
  }
}

function normalizeTz(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

/** Levenshtein distance (small inputs — IANA names are short). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Suggest the closest valid IANA timezone for a typo'd input, or null when the
 * input is empty / nothing is close enough. Case/space/dash-insensitive; ranks
 * by edit distance over the normalized full IANA set.
 */
export function suggestTimezone(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const zones = allTimezones();
  if (zones.length === 0) return null;

  const target = normalizeTz(raw);
  // Exact (normalized) match → canonical casing.
  const exact = zones.find((z) => normalizeTz(z) === target);
  if (exact) return exact;

  // Substring match on the city segment (e.g. "seoul" → "Asia/Seoul").
  const city = target.split("/").pop() ?? target;
  const byCity = zones.find((z) => normalizeTz(z.split("/").pop() ?? z) === city);
  if (byCity) return byCity;

  // Nearest by edit distance, with a sane cap so we don't suggest nonsense.
  let best: string | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const d = levenshtein(target, normalizeTz(z));
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  const cap = Math.max(2, Math.floor(target.length / 3));
  return best && bestDist <= cap ? best : null;
}
