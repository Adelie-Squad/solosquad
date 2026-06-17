/**
 * v0.6 S6.B §11 — Frontmatter diff extraction for PR review bot.
 *
 * Given a "before" and "after" SKILL.md text, produce a structured diff of
 * the YAML frontmatter only (the body diff is GitHub's responsibility). The
 * goal is to surface *changed schema fields* — keyword list edits, trigger
 * removals, scope shifts — that are easy to miss in a raw yaml diff.
 *
 * The parser is the v0.5 `parseSkillMd`. If either side lacks frontmatter
 * (new file → no `before`; deletion → no `after`), the diff is treated as
 * pure-add / pure-remove respectively.
 *
 * Output is a list of {field, before, after, kind} records. The
 * `comment-formatter` module turns those into a markdown table.
 */
import { parseSkillMd, type SkillSpec, SkillParseError } from "../../src/bot/skill-parser.js";

export type FieldChangeKind = "added" | "removed" | "modified";

export interface FieldChange {
  field: string;
  before?: unknown;
  after?: unknown;
  kind: FieldChangeKind;
}

export interface FrontmatterDiff {
  /** Source path the diff is attributed to (relative, e.g. agents/specialists/feature-planner/SKILL.md). */
  path: string;
  /** True when before === undefined (file added in this PR). */
  added: boolean;
  /** True when after === undefined (file removed in this PR). */
  removed: boolean;
  /** Parse errors encountered on either side — surfaced as a banner in the comment. */
  parseErrors: string[];
  /** Field-level changes. Empty when added/removed (whole frontmatter shown as block instead). */
  changes: FieldChange[];
  /** Full frontmatter snapshot used when added or removed (table form is useless then). */
  beforeRaw?: string;
  afterRaw?: string;
}

const TOP_LEVEL_FIELDS: ReadonlyArray<keyof SkillSpec> = [
  "name",
  "description",
  "team",
  "stateful",
  "triggers",
  "inputs",
  "outputs",
  "handoff_to",
  "scope",
  "confidence",
  "source",
  "loop_mode",
  "budget",
  "collab_pattern",
];

function tryParse(raw: string, path: string): { spec?: SkillSpec; error?: string } {
  try {
    return { spec: parseSkillMd(raw, path) };
  } catch (e) {
    if (e instanceof SkillParseError) {
      return { error: e.message };
    }
    return { error: (e as Error).message };
  }
}

/**
 * Stable JSON for deep equality — `JSON.stringify` with sorted keys.
 * Sufficient for SKILL frontmatter which is shallow and lacks `undefined`.
 */
function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function pickField(spec: SkillSpec, field: keyof SkillSpec): unknown {
  const v = spec[field];
  if (v === undefined) return undefined;
  return v;
}

export function diffFrontmatter(
  before: string | undefined,
  after: string | undefined,
  filePath: string,
): FrontmatterDiff {
  // Pure add (new file).
  if (before === undefined && after !== undefined) {
    const parsed = tryParse(after, filePath);
    return {
      path: filePath,
      added: true,
      removed: false,
      parseErrors: parsed.error ? [`(after) ${parsed.error}`] : [],
      changes: [],
      afterRaw: parsed.spec?.raw_frontmatter,
    };
  }

  // Pure remove.
  if (before !== undefined && after === undefined) {
    const parsed = tryParse(before, filePath);
    return {
      path: filePath,
      added: false,
      removed: true,
      parseErrors: parsed.error ? [`(before) ${parsed.error}`] : [],
      changes: [],
      beforeRaw: parsed.spec?.raw_frontmatter,
    };
  }

  if (before === undefined || after === undefined) {
    // Neither side present — shouldn't happen, return empty.
    return { path: filePath, added: false, removed: false, parseErrors: [], changes: [] };
  }

  const beforeParsed = tryParse(before, filePath);
  const afterParsed = tryParse(after, filePath);
  const errors: string[] = [];
  if (beforeParsed.error) errors.push(`(before) ${beforeParsed.error}`);
  if (afterParsed.error) errors.push(`(after) ${afterParsed.error}`);

  const changes: FieldChange[] = [];
  if (beforeParsed.spec && afterParsed.spec) {
    const seen = new Set<string>();

    for (const field of TOP_LEVEL_FIELDS) {
      seen.add(field);
      const bv = pickField(beforeParsed.spec, field);
      const av = pickField(afterParsed.spec, field);
      const bs = stableJson(bv);
      const as_ = stableJson(av);
      if (bs === as_) continue;
      if (bv === undefined) {
        changes.push({ field, after: av, kind: "added" });
      } else if (av === undefined) {
        changes.push({ field, before: bv, kind: "removed" });
      } else {
        changes.push({ field, before: bv, after: av, kind: "modified" });
      }
    }

    // Extra (unknown frontmatter) keys — union of both extras.
    const extraKeys = new Set<string>([
      ...Object.keys(beforeParsed.spec.extra),
      ...Object.keys(afterParsed.spec.extra),
    ]);
    for (const k of extraKeys) {
      if (seen.has(k)) continue;
      const bv = beforeParsed.spec.extra[k];
      const av = afterParsed.spec.extra[k];
      const bs = stableJson(bv);
      const as_ = stableJson(av);
      if (bs === as_) continue;
      if (bv === undefined) {
        changes.push({ field: k, after: av, kind: "added" });
      } else if (av === undefined) {
        changes.push({ field: k, before: bv, kind: "removed" });
      } else {
        changes.push({ field: k, before: bv, after: av, kind: "modified" });
      }
    }
  }

  return {
    path: filePath,
    added: false,
    removed: false,
    parseErrors: errors,
    changes,
    beforeRaw: beforeParsed.spec?.raw_frontmatter,
    afterRaw: afterParsed.spec?.raw_frontmatter,
  };
}
