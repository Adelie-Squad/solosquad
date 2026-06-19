/**
 * v1.3.2 §9.5 — unified id / naming rules.
 *
 * Every first-class asset (skill · agent · workflow · cron) shares one id
 * convention: lowercase kebab-case, bounded length, no reserved words, no
 * collision with an existing id. Before this module each validator re-declared
 * the same `^[a-z0-9]+(?:-[a-z0-9]+)*$` regex and length/reserved checks. This
 * is the single source of truth; validators keep emitting their own domain
 * codes (CRON_ID_MALFORMED / WF_ID_MALFORMED / NAME_MALFORMED …) but derive
 * the verdict here.
 *
 * Pure — no fs, no domain types.
 */

/** kebab-case: lowercase alphanumeric segments joined by single hyphens. */
export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Default id length ceiling (matches the skill name limit). */
export const DEFAULT_NAME_MAX = 64;

export function isKebabCase(s: string): boolean {
  return KEBAB_RE.test(s);
}

export function isReserved(id: string, reserved?: ReadonlySet<string>): boolean {
  return !!reserved?.has(id);
}

/** Does `id` collide with an already-taken id? */
export function collides(id: string, taken: ReadonlySet<string>): boolean {
  return taken.has(id);
}

/**
 * Slugify arbitrary text into a kebab-case id — for scaffolding/create paths.
 * Lowercases, replaces runs of non-alphanumerics with a single hyphen, trims
 * leading/trailing hyphens, and clamps to `maxLen` (without leaving a trailing
 * hyphen). Returns `fallback` when nothing usable remains.
 */
export function normalizeToKebab(input: string, maxLen = DEFAULT_NAME_MAX, fallback = "untitled"): string {
  let s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/g, "");
  return s || fallback;
}

export type IdProblem = "empty" | "malformed" | "too_long" | "reserved";

export interface IdRule {
  /** Max length (default {@link DEFAULT_NAME_MAX}). */
  maxLen?: number;
  /** Reserved ids that may not be used. */
  reserved?: ReadonlySet<string>;
}

/**
 * Evaluate an id against the shared convention. Returns the problems found (in
 * a stable order) so a caller can map each to its own domain code, e.g.:
 *
 *   for (const p of checkId(def.id, { reserved }))
 *     if (p === "malformed") f.error({ code: "CRON_ID_MALFORMED", ... });
 *
 * `empty` and `malformed` are mutually exclusive; `too_long`/`reserved` may
 * accompany `malformed` (a long reserved non-kebab id reports all three).
 */
export function checkId(id: string | undefined, rule: IdRule = {}): IdProblem[] {
  const problems: IdProblem[] = [];
  if (!id) return ["empty"];
  if (!isKebabCase(id)) problems.push("malformed");
  if (id.length > (rule.maxLen ?? DEFAULT_NAME_MAX)) problems.push("too_long");
  if (isReserved(id, rule.reserved)) problems.push("reserved");
  return problems;
}
