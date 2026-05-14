import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.5 — SKILL.md frontmatter parser + validator.
 *
 * Per docs/plan/v0.5-workflow-maker.md §4 (schema), §11.4 (external corpus
 * round-trip), §11.5 (slash conflict / freq cap / stateful=false / meta
 * scanner). Anthropic Agent Skills compatible: `name` + `description` are
 * the only required fields; SoloSquad extensions are all optional.
 *
 * Two design choices that the round-trip case (`anthropics/skills` corpus)
 * depends on:
 *   1. `raw_frontmatter` preserves the YAML text verbatim. `writeSkillMd()`
 *      re-emits it byte-for-byte. Re-serialization via `yaml.dump` is opt-in
 *      (`serializeFrontmatter()`) — migrations need it, ingest does not.
 *   2. `extra` collects unknown fields so forward-compat doesn't drop data.
 *
 * v0.5 forces `stateful: false` on every new SKILL — stateful actors are
 * out of scope until v0.6 trajectory extraction (§12).
 */

export const SKILL_SCHEMA_VERSION = 1;

/** PM mode slashes (v0.3) — reserved, cannot be registered as triggers.slash. */
export const RESERVED_SLASHES: ReadonlySet<string> = new Set([
  "/think",
  "/plan",
  "/build",
  "/review",
  "/ship",
  "/help",
]);

/** Per-workspace cap on freq-enabled SKILLs (v0.5 §13). */
export const FREQ_SKILL_CAP = 20;

export type SkillScope = "agent" | "workspace" | "org" | "repo";
export type LoopModeKind = "spec-gate";

export interface FreqTrigger {
  keywords: string[];
  window_turns: number;
  threshold: number;
  /** Default 6 — see v0.5 §7 hysteresis. */
  cooldown_turns?: number;
}

export interface SkillTriggers {
  slash?: string[];
  keyword?: string[];
  freq?: FreqTrigger;
  /** PM may call this SKILL explicitly even without trigger match. */
  explicit?: boolean;
}

export interface SkillInputs {
  required?: string[];
  optional?: string[];
}

export interface SkillLoopMode {
  kind: LoopModeKind;
  spec_path?: string;
  stop_when?: string;
}

export interface SkillBudget {
  per_call_usd?: number;
  daily_usd?: number;
}

/** v0.6 §2.4 — 핸드오프 협업 패턴. v0.5에서는 `extra` bag으로 forward-compat 처리됐고 v0.6 출시 시점에 정식 필드로 격상. */
export type CollabPattern = "hierarchical" | "graph" | "dynamic";

export interface SkillSpec {
  // ---- Anthropic required ----
  name: string;
  description: string;

  // ---- SoloSquad extensions (all optional) ----
  team?: string;
  stateful?: boolean;
  triggers?: SkillTriggers;
  inputs?: SkillInputs;
  outputs?: string[];
  handoff_to?: string[];
  scope?: SkillScope;
  confidence?: number;
  source?: string;
  loop_mode?: SkillLoopMode;
  budget?: SkillBudget;
  collab_pattern?: CollabPattern;

  // ---- Unknown frontmatter keys (forward compat) ----
  extra: Record<string, unknown>;

  // ---- Verbatim text for byte-identical round-trip ----
  raw_frontmatter: string;
  body: string;
}

export interface SkillValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface SkillValidationResult {
  ok: boolean;
  errors: SkillValidationError[];
  warnings: SkillValidationError[];
}

export interface WorkspaceValidationContext {
  /** Number of freq-enabled SKILLs already registered (this SKILL not counted). */
  freq_skill_count?: number;
  /** Override reserved slashes (mostly for tests). */
  reserved_slashes?: ReadonlySet<string>;
}

export class SkillParseError extends Error {
  constructor(
    message: string,
    public source_path?: string
  ) {
    super(source_path ? `${source_path}: ${message}` : message);
    this.name = "SkillParseError";
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a SKILL.md file. Frontmatter (`---\n...\n---`) is required by
 * v0.5 — Anthropic spec also requires it. Bodies without frontmatter
 * throw `SkillParseError`.
 */
export function parseSkillMd(raw: string, source_path?: string): SkillSpec {
  const normalized = normalizeLine(raw);
  const fm = matchFrontmatter(normalized);
  if (!fm) {
    throw new SkillParseError(
      "missing YAML frontmatter (--- … ---)",
      source_path
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(fm.text) ?? {}) as Record<string, unknown>;
  } catch (e) {
    throw new SkillParseError(
      `invalid YAML frontmatter: ${(e as Error).message}`,
      source_path
    );
  }

  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    throw new SkillParseError(
      "frontmatter is missing required `name` field",
      source_path
    );
  }
  if (typeof parsed.description !== "string" || parsed.description.trim() === "") {
    throw new SkillParseError(
      "frontmatter is missing required `description` field",
      source_path
    );
  }

  const known: ReadonlySet<string> = new Set([
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
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!known.has(k)) extra[k] = v;
  }

  const spec: SkillSpec = {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    team: typeof parsed.team === "string" ? parsed.team : undefined,
    stateful: typeof parsed.stateful === "boolean" ? parsed.stateful : undefined,
    triggers: parseTriggers(parsed.triggers),
    inputs: parseInputs(parsed.inputs),
    outputs: parseStringArray(parsed.outputs),
    handoff_to: parseStringArray(parsed.handoff_to),
    scope: parseScope(parsed.scope),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    collab_pattern: parseCollabPattern(parsed.collab_pattern),
    loop_mode: parseLoopMode(parsed.loop_mode),
    budget: parseBudget(parsed.budget),
    extra,
    raw_frontmatter: fm.text,
    body: normalized.slice(fm.full_length),
  };

  return spec;
}

function matchFrontmatter(
  text: string
): { text: string; full_length: number } | null {
  // Must start with --- on the first line.
  if (!text.startsWith("---\n")) return null;
  const closeIdx = text.indexOf("\n---", 4);
  if (closeIdx === -1) return null;
  // The closing fence is "\n---" optionally followed by \n or EOF.
  const after = closeIdx + 4;
  const tailNewline = text[after] === "\n" ? 1 : 0;
  // Text between fences, excluding leading "---\n" and trailing "\n---".
  return {
    text: text.slice(4, closeIdx),
    full_length: after + tailNewline,
  };
}

function parseTriggers(raw: unknown): SkillTriggers | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SkillTriggers = {};
  const slash = parseStringArray(r.slash);
  if (slash) out.slash = slash;
  const keyword = parseStringArray(r.keyword);
  if (keyword) out.keyword = keyword;
  if (typeof r.explicit === "boolean") out.explicit = r.explicit;
  const freq = parseFreq(r.freq);
  if (freq) out.freq = freq;
  if (
    out.slash === undefined &&
    out.keyword === undefined &&
    out.explicit === undefined &&
    out.freq === undefined
  ) {
    return undefined;
  }
  return out;
}

function parseFreq(raw: unknown): FreqTrigger | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const keywords = parseStringArray(r.keywords);
  if (!keywords || keywords.length === 0) return undefined;
  const window_turns = typeof r.window_turns === "number" ? r.window_turns : 10;
  const threshold = typeof r.threshold === "number" ? r.threshold : 3;
  const out: FreqTrigger = { keywords, window_turns, threshold };
  if (typeof r.cooldown_turns === "number") {
    out.cooldown_turns = r.cooldown_turns;
  }
  return out;
}

function parseInputs(raw: unknown): SkillInputs | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SkillInputs = {};
  const req = parseStringArray(r.required);
  if (req) out.required = req;
  const opt = parseStringArray(r.optional);
  if (opt) out.optional = opt;
  if (out.required === undefined && out.optional === undefined) return undefined;
  return out;
}

function parseScope(raw: unknown): SkillScope | undefined {
  if (raw === "agent" || raw === "workspace" || raw === "org" || raw === "repo") {
    return raw;
  }
  return undefined;
}

function parseCollabPattern(raw: unknown): CollabPattern | undefined {
  if (raw === "hierarchical" || raw === "graph" || raw === "dynamic") return raw;
  return undefined;
}

function parseLoopMode(raw: unknown): SkillLoopMode | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "spec-gate") return undefined;
  const out: SkillLoopMode = { kind: "spec-gate" };
  if (typeof r.spec_path === "string") out.spec_path = r.spec_path;
  if (typeof r.stop_when === "string") out.stop_when = r.stop_when;
  return out;
}

function parseBudget(raw: unknown): SkillBudget | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SkillBudget = {};
  if (typeof r.per_call_usd === "number") out.per_call_usd = r.per_call_usd;
  if (typeof r.daily_usd === "number") out.daily_usd = r.daily_usd;
  if (out.per_call_usd === undefined && out.daily_usd === undefined) {
    return undefined;
  }
  return out;
}

function parseStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate a parsed SKILL against v0.5 invariants. The parser itself is
 * tolerant (drops malformed sub-fields silently for round-trip safety);
 * this is where we *reject* policy violations.
 */
export function validateSkill(
  spec: SkillSpec,
  ctx: WorkspaceValidationContext = {}
): SkillValidationResult {
  const errors: SkillValidationError[] = [];
  const warnings: SkillValidationError[] = [];

  // stateful: true is out-of-scope for v0.5 (§12)
  if (spec.stateful === true) {
    errors.push({
      code: "STATEFUL_NOT_ALLOWED",
      field: "stateful",
      message:
        "stateful: true is out of scope for v0.5 — set false (the v0.6 trajectory work will introduce the actor model)",
    });
  }

  // Slash trigger conflicts (v0.5 §11.5)
  const reserved = ctx.reserved_slashes ?? RESERVED_SLASHES;
  if (spec.triggers?.slash) {
    for (const s of spec.triggers.slash) {
      if (!s.startsWith("/")) {
        errors.push({
          code: "SLASH_MALFORMED",
          field: "triggers.slash",
          message: `slash trigger "${s}" must start with "/"`,
        });
        continue;
      }
      for (const r of reserved) {
        if (s === r) {
          errors.push({
            code: "SLASH_RESERVED",
            field: "triggers.slash",
            message: `"${s}" collides with the reserved PM-mode slash "${r}"`,
          });
        } else if (s.startsWith(r) || r.startsWith(s)) {
          errors.push({
            code: "SLASH_PREFIX_CONFLICT",
            field: "triggers.slash",
            message: `"${s}" has a prefix conflict with reserved "${r}" (typo-tolerance policy — v0.5 §7)`,
          });
        }
      }
    }
  }

  // Freq trigger sanity + workspace cap (v0.5 §7)
  if (spec.triggers?.freq) {
    const f = spec.triggers.freq;
    if (f.window_turns < 1) {
      errors.push({
        code: "FREQ_WINDOW_TOO_SMALL",
        field: "triggers.freq.window_turns",
        message: "window_turns must be ≥ 1",
      });
    }
    if (f.threshold < 1) {
      errors.push({
        code: "FREQ_THRESHOLD_TOO_SMALL",
        field: "triggers.freq.threshold",
        message: "threshold must be ≥ 1",
      });
    }
    if (f.cooldown_turns !== undefined && f.cooldown_turns < 0) {
      errors.push({
        code: "FREQ_COOLDOWN_NEGATIVE",
        field: "triggers.freq.cooldown_turns",
        message: "cooldown_turns must be ≥ 0",
      });
    }
    if (
      ctx.freq_skill_count !== undefined &&
      ctx.freq_skill_count >= FREQ_SKILL_CAP
    ) {
      errors.push({
        code: "FREQ_CAP_EXCEEDED",
        field: "triggers.freq",
        message: `workspace already has ${ctx.freq_skill_count} freq-enabled SKILLs (cap ${FREQ_SKILL_CAP}) — disable freq for an existing one before adding this`,
      });
    }
  }

  // loop_mode sanity
  if (spec.loop_mode) {
    if (spec.loop_mode.kind !== "spec-gate") {
      errors.push({
        code: "LOOP_MODE_UNKNOWN",
        field: "loop_mode.kind",
        message: `loop_mode.kind "${(spec.loop_mode as { kind: string }).kind}" is not supported in v0.5 (only "spec-gate")`,
      });
    } else if (!spec.loop_mode.stop_when) {
      warnings.push({
        code: "LOOP_MODE_NO_STOP",
        field: "loop_mode.stop_when",
        message:
          "spec-gate without stop_when relies entirely on goal-runner termination — set stop_when for clarity",
      });
    }
  }

  // Budget sanity
  if (spec.budget) {
    for (const k of ["per_call_usd", "daily_usd"] as const) {
      const v = spec.budget[k];
      if (v !== undefined && v < 0) {
        errors.push({
          code: "BUDGET_NEGATIVE",
          field: `budget.${k}`,
          message: `${k} must be ≥ 0`,
        });
      }
    }
  }

  // Confidence range
  if (spec.confidence !== undefined && (spec.confidence < 0 || spec.confidence > 1)) {
    errors.push({
      code: "CONFIDENCE_OUT_OF_RANGE",
      field: "confidence",
      message: "confidence must be in [0, 1]",
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Round-trip writers
// ---------------------------------------------------------------------------

/**
 * Re-emit a SkillSpec byte-for-byte using the captured raw frontmatter.
 * This is what `anthropics/skills` corpus round-trip tests use.
 */
export function writeSkillMd(spec: SkillSpec): string {
  return `---\n${spec.raw_frontmatter}\n---\n${spec.body}`;
}

/**
 * Serialize a (possibly modified) spec back to YAML frontmatter. Used by
 * migrations / author loop output where we *intentionally* update fields
 * and accept loss of original key order. Stable insertion order — Anthropic
 * required fields first, then SoloSquad extensions, then `extra`.
 */
export function serializeFrontmatter(spec: SkillSpec): string {
  const obj: Record<string, unknown> = {
    name: spec.name,
    description: spec.description,
  };
  if (spec.team !== undefined) obj.team = spec.team;
  if (spec.stateful !== undefined) obj.stateful = spec.stateful;
  if (spec.triggers !== undefined) obj.triggers = spec.triggers;
  if (spec.inputs !== undefined) obj.inputs = spec.inputs;
  if (spec.outputs !== undefined) obj.outputs = spec.outputs;
  if (spec.handoff_to !== undefined) obj.handoff_to = spec.handoff_to;
  if (spec.scope !== undefined) obj.scope = spec.scope;
  if (spec.confidence !== undefined) obj.confidence = spec.confidence;
  if (spec.source !== undefined) obj.source = spec.source;
  if (spec.collab_pattern !== undefined) obj.collab_pattern = spec.collab_pattern;
  if (spec.loop_mode !== undefined) obj.loop_mode = spec.loop_mode;
  if (spec.budget !== undefined) obj.budget = spec.budget;
  for (const [k, v] of Object.entries(spec.extra)) {
    obj[k] = v;
  }
  // yaml.dump appends a trailing newline; strip it so the caller can wrap
  // with --- fences cleanly.
  return yaml.dump(obj, { lineWidth: -1 }).replace(/\n$/, "");
}

/** Emit a fully serialized SKILL.md using `serializeFrontmatter()` + body. */
export function emitSkillMd(spec: SkillSpec): string {
  return `---\n${serializeFrontmatter(spec)}\n---\n${spec.body}`;
}
