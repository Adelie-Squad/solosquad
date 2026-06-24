import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";
import { isKebabCase, hasReservedWord, DEFAULT_NAME_MAX } from "../util/naming.js";

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

/** v1.3.2 §4 — Anthropic Agent Skills naming/description limits.
 *  The kebab id rule + length ceiling are the shared §9.5 convention
 *  (util/naming); SKILL_NAME_MAX is re-exported as the canonical alias. */
export const SKILL_NAME_MAX = DEFAULT_NAME_MAX;
export const SKILL_DESCRIPTION_MAX = 1024;

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

/**
 * v1.3.6 §3.4 — PM-mode conventions. Previously written under a `pm_conventions:`
 * block on ~28 SKILLs but never parsed (fell into `extra` = dead metadata). Now
 * surfaced + validator-enforced so the field is load-bearing (primitive-core.md §3.7 ⑵):
 *   - anti_sycophancy / post_labeling — global discipline (default true); a SKILL
 *     may set post_labeling:false for a documented exception.
 *   - hard_gate — gate exit on exit_criteria (skill-level mirror of the workflow
 *     stage hard_gate that workflow-validate already reads; §6.1).
 *   - minimum_approaches — require comparing ≥N approaches before recommending.
 */
export interface SkillPmConventions {
  anti_sycophancy?: boolean;
  post_labeling?: boolean;
  hard_gate?: boolean;
  minimum_approaches?: number;
}

/** v0.6 §2.4 — 핸드오프 협업 패턴. v0.5에서는 `extra` bag으로 forward-compat 처리됐고 v0.6 출시 시점에 정식 필드로 격상. */
export type CollabPattern = "hierarchical" | "graph" | "dynamic";

/**
 * v0.8.2 §3.1 — dev_permissions sub-tree. SKILLs with `dev_capability: true`
 * declare what bash binaries they're allowed to invoke, whether outbound
 * network is OK, and whether `git push` / `gh pr merge` require user
 * confirmation. Workspace-level denylist (workspace.yaml.dev_capability.
 * bash_denylist) is always merged on top — SKILLs cannot override it.
 */
export interface SkillDevBashPerms {
  allowed?: string[];
  denied?: string[];
}

export interface SkillDevPushTargets {
  requires_confirmation?: boolean;
}

export interface SkillDevMergePolicy {
  /** Auto-merge is permanently `false` per v0.8.2 §2 / §3.1. */
  auto?: boolean;
}

export interface SkillDevPermissions {
  bash?: SkillDevBashPerms;
  /** Outbound HTTP via curl/wget/etc. MCP servers are unaffected. */
  network?: boolean;
  push_targets?: SkillDevPushTargets;
  merge?: SkillDevMergePolicy;
}

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
  /** v1.3.6 §3.4 — discovery/grouping category (kebab-case; org owns the taxonomy). */
  category?: string;
  /** v1.3.6 §3.4 — PM-mode conventions (parsed + validated; formerly decorative). */
  pm_conventions?: SkillPmConventions;
  /** v0.8.2 — SKILL declares it can perform code-modifying dev actions. */
  dev_capability?: boolean;
  /** v0.8.2 — per-SKILL bash allowlist / push-confirm / merge policy. */
  dev_permissions?: SkillDevPermissions;

  /**
   * v0.8.1 — explicit SKILL frontmatter schema version. Per
   * docs/plan/v0.8.1-security-lifecycle-pair.md §6.1 / §6.3. When absent
   * the validator emits a deprecation warning; bundled SKILL.md files were
   * backfilled in v0.8.1 via `scripts/inject-skill-schema-version.ts`.
   */
  schema_version?: number;

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
  /** Expected directory name — when set, `name` must equal it (dir-match, §4). */
  dir_name?: string;
  /** Reserved skill names that may not be used (workspace pass supplies these). */
  reserved_names?: ReadonlySet<string>;
  /**
   * Enforce SoloSquad naming convention (kebab-case ≤64, reserved names) as
   * errors. Off by default so *external/adopted* skills (Anthropic corpus,
   * §10 adopted repos) aren't rejected for style — the SoloSquad CLI sets it.
   */
  strict_name?: boolean;
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
    "category",
    "pm_conventions",
    "schema_version",
    "dev_capability",
    "dev_permissions",
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
    category: typeof parsed.category === "string" ? parsed.category : undefined,
    pm_conventions: parsePmConventions(parsed.pm_conventions),
    schema_version: typeof parsed.schema_version === "number" ? parsed.schema_version : undefined,
    dev_capability:
      typeof parsed.dev_capability === "boolean" ? parsed.dev_capability : undefined,
    dev_permissions: parseDevPermissions(parsed.dev_permissions),
    extra,
    raw_frontmatter: fm.text,
    body: normalized.slice(fm.full_length),
  };

  return spec;
}

function parseDevPermissions(raw: unknown): SkillDevPermissions | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SkillDevPermissions = {};

  if (r.bash && typeof r.bash === "object") {
    const b = r.bash as Record<string, unknown>;
    const bash: SkillDevBashPerms = {};
    const allowed = parseStringArray(b.allowed);
    const denied = parseStringArray(b.denied);
    if (allowed) bash.allowed = allowed;
    if (denied) bash.denied = denied;
    if (bash.allowed !== undefined || bash.denied !== undefined) out.bash = bash;
  }

  if (typeof r.network === "boolean") out.network = r.network;

  if (r.push_targets && typeof r.push_targets === "object") {
    const pt = r.push_targets as Record<string, unknown>;
    if (typeof pt.requires_confirmation === "boolean") {
      out.push_targets = { requires_confirmation: pt.requires_confirmation };
    }
  }

  if (r.merge && typeof r.merge === "object") {
    const m = r.merge as Record<string, unknown>;
    if (typeof m.auto === "boolean") {
      out.merge = { auto: m.auto };
    }
  }

  if (
    out.bash === undefined &&
    out.network === undefined &&
    out.push_targets === undefined &&
    out.merge === undefined
  ) {
    return undefined;
  }
  return out;
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

function parsePmConventions(raw: unknown): SkillPmConventions | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SkillPmConventions = {};
  if (typeof r.anti_sycophancy === "boolean") out.anti_sycophancy = r.anti_sycophancy;
  if (typeof r.post_labeling === "boolean") out.post_labeling = r.post_labeling;
  if (typeof r.hard_gate === "boolean") out.hard_gate = r.hard_gate;
  if (typeof r.minimum_approaches === "number") out.minimum_approaches = r.minimum_approaches;
  if (
    out.anti_sycophancy === undefined &&
    out.post_labeling === undefined &&
    out.hard_gate === undefined &&
    out.minimum_approaches === undefined
  ) {
    return undefined;
  }
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

  // v1.3.6 §3.4 — pm_conventions now load-bearing: enforce minimum_approaches.
  if (spec.pm_conventions?.minimum_approaches !== undefined) {
    const n = spec.pm_conventions.minimum_approaches;
    if (!Number.isInteger(n) || n < 1) {
      errors.push({
        code: "MIN_APPROACHES_INVALID",
        field: "pm_conventions.minimum_approaches",
        message: `minimum_approaches must be an integer ≥ 1 (got ${n})`,
      });
    }
  }

  // v1.3.6 §3.4 — category is parsed; enforce kebab-case so list grouping stays
  // stable. The taxonomy (enum) is owned by the org layer; we only lint format.
  if (spec.category !== undefined && !isKebabCase(spec.category)) {
    warnings.push({
      code: "CATEGORY_MALFORMED",
      field: "category",
      message: `category "${spec.category}" should be kebab-case for stable grouping`,
    });
  }

  // v0.8.1 §6.3 — SKILL frontmatter schema_version. Treated as a warning
  // for one minor (v0.8.x) and promoted to an error in v0.9. Run
  // `scripts/inject-skill-schema-version.ts` to backfill.
  if (spec.schema_version === undefined) {
    warnings.push({
      code: "SCHEMA_VERSION_MISSING",
      field: "schema_version",
      message:
        "schema_version missing — add `schema_version: 1` per docs/policy/schema-stability.md (idempotent backfill: `scripts/inject-skill-schema-version.ts`)",
    });
  } else if (spec.schema_version < 1) {
    errors.push({
      code: "SCHEMA_VERSION_INVALID",
      field: "schema_version",
      message: `schema_version=${spec.schema_version} is invalid (must be ≥ 1)`,
    });
  }

  // v0.8.2 §2 — auto-merge is permanently rejected.
  if (spec.dev_permissions?.merge?.auto === true) {
    errors.push({
      code: "MERGE_AUTO_FORBIDDEN",
      field: "dev_permissions.merge.auto",
      message:
        "merge.auto: true is permanently forbidden — auto-merge of PRs is out of scope (v0.8.2 §2)",
    });
  }

  // dev_permissions without dev_capability is meaningless — warn only.
  if (spec.dev_permissions && spec.dev_capability !== true) {
    warnings.push({
      code: "DEV_PERMS_WITHOUT_CAPABILITY",
      field: "dev_permissions",
      message:
        "dev_permissions declared but dev_capability is not true — permissions will be ignored at spawn time",
    });
  }

  // v1.3.2 §4 — name / description hygiene. Kebab-case + length + reserved are
  // SoloSquad conventions (strict_name); description length is the universal
  // Anthropic limit. dir-match fires whenever a dir_name is supplied.
  if (typeof spec.name === "string") {
    if (ctx.strict_name) {
      if (spec.name.length > SKILL_NAME_MAX) {
        errors.push({
          code: "NAME_TOO_LONG",
          field: "name",
          message: `name is ${spec.name.length} chars (max ${SKILL_NAME_MAX})`,
        });
      }
      if (!isKebabCase(spec.name)) {
        errors.push({
          code: "NAME_MALFORMED",
          field: "name",
          message: `name "${spec.name}" must be kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)`,
        });
      }
      if (ctx.reserved_names?.has(spec.name)) {
        errors.push({
          code: "NAME_RESERVED",
          field: "name",
          message: `name "${spec.name}" is reserved`,
        });
      }
      // v1.3.6 §3.2 — brand-reserved words (anthropic/claude) are forbidden.
      if (hasReservedWord(spec.name)) {
        errors.push({
          code: "NAME_RESERVED_WORD",
          field: "name",
          message: `name "${spec.name}" contains a reserved word (anthropic/claude)`,
        });
      }
    }
    if (ctx.dir_name !== undefined && spec.name !== ctx.dir_name) {
      errors.push({
        code: "NAME_DIR_MISMATCH",
        field: "name",
        message: `name "${spec.name}" does not match directory "${ctx.dir_name}"`,
      });
    }
  }
  if (typeof spec.description === "string") {
    if (spec.description.length > SKILL_DESCRIPTION_MAX) {
      errors.push({
        code: "DESCRIPTION_TOO_LONG",
        field: "description",
        message: `description is ${spec.description.length} chars (max ${SKILL_DESCRIPTION_MAX})`,
      });
    }
    if (/\bI\s+(?:will|can|am|have|need|do|use)\b/.test(spec.description)) {
      warnings.push({
        code: "DESCRIPTION_FIRST_PERSON",
        field: "description",
        message: `description reads first-person — prefer third-person ("Use when…", "Generates…")`,
      });
    }
    // v1.3.6 §3.2 — vague capability-only phrasing weakens auto-routing (warn).
    if (/\bhelps?\s+with\b/i.test(spec.description) || /도와줍?니다|돕는다|돕습니다/.test(spec.description)) {
      warnings.push({
        code: "DESCRIPTION_VAGUE",
        field: "description",
        message: `description uses a vague phrase ("helps with" / "도와줍니다") — name the concrete capability + trigger instead`,
      });
    }
    // v1.3.6 §3.2 — a good description says *when* to use it (advisory warn).
    if (
      !/use\s+(?:this\s+)?(?:skill\s+)?when|when\s+to\s+use|when\s+you|사용\s*시점|사용할\s*때|쓸\s*때|할\s*때/i.test(
        spec.description,
      )
    ) {
      warnings.push({
        code: "DESCRIPTION_NO_TRIGGER",
        field: "description",
        message: `description has no explicit "use when…" / "사용 시점 —" trigger clause — discovery/routing accuracy drops without it`,
      });
    }
  }

  // v1.3.6 §3.2 — body length lint (warn). Target <500 lines (~5000 tokens);
  // long bodies should push detail into references/ (progressive disclosure).
  if (typeof spec.body === "string" && spec.body.length > 0) {
    const bodyLines = normalizeLine(spec.body).split("\n").length;
    if (bodyLines > 500) {
      warnings.push({
        code: "BODY_TOO_LONG",
        field: "body",
        message: `SKILL.md body is ${bodyLines} lines (>500) — move detail into references/ (progressive disclosure)`,
      });
    }
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
  if (spec.schema_version !== undefined) obj.schema_version = spec.schema_version;
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
  if (spec.category !== undefined) obj.category = spec.category;
  if (spec.pm_conventions !== undefined) obj.pm_conventions = spec.pm_conventions;
  if (spec.dev_capability !== undefined) obj.dev_capability = spec.dev_capability;
  if (spec.dev_permissions !== undefined) obj.dev_permissions = spec.dev_permissions;
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
