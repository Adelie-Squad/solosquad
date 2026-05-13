import fs from "fs";
import path from "path";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.4 — `<workspace>/AGENTS.md` loader.
 *
 * AGENTS.md is the **single** workspace persistent guide (v0.4 decision —
 * see docs/plan/v0.4-autonomous-engine.md §4.2). Human-edited only. Loaded
 * once at the start of each `solosquad goal run` and merged with goal.md
 * frontmatter to produce the final Input/Runtime/Output guards.
 *
 * The loader extracts well-known sections by name; everything else is
 * passed through as `raw_body` for the PM session's system prompt.
 *
 * Tolerance contract: if AGENTS.md is missing OR a section is missing, we
 * use safe defaults. Parse errors only thrown when a section IS present
 * but has malformed content (e.g. non-string list items).
 */

export interface PersistentGuide {
  /** True iff AGENTS.md existed at the loaded path. */
  exists: boolean;
  /** Absolute path that was inspected. */
  source_path: string;
  /** Raw file contents (CRLF-normalized). Empty string if missing. */
  raw_body: string;

  /** "SoloSquad v0.4 — Autonomous Goal Conventions" section. */
  immutable_paths: string[];
  modifiable_paths: string[];

  /** External side-effects policy. */
  forbidden_side_effects: string[];
  /** Domain whitelist for outbound HTTP. Empty array = block all external. */
  external_domain_whitelist: string[];

  /** Guardrail numeric thresholds. Defaults applied when missing. */
  stage_timeout_seconds: number;
  consecutive_discard_limit: number;
  cost_cap_warning_pct: number;
}

export const DEFAULT_GUIDE: Omit<PersistentGuide, "exists" | "source_path" | "raw_body"> = {
  immutable_paths: [
    "src/engine/**",
    "assets/templates/results.tsv",
    "assets/templates/goal.md",
    "AGENTS.md",
  ],
  modifiable_paths: ["<org>/workflows/<wf-id>/", "<org>/memory/"],
  forbidden_side_effects: [
    "messenger direct send",
    "email",
    "payment",
    "external API mutating call",
  ],
  external_domain_whitelist: [],
  stage_timeout_seconds: 600,
  consecutive_discard_limit: 5,
  cost_cap_warning_pct: 0.9,
};

export function agentsMdPath(workspace: string): string {
  return path.join(workspace, "AGENTS.md");
}

export function loadAgentsMd(workspace: string): PersistentGuide {
  const source_path = agentsMdPath(workspace);

  if (!fs.existsSync(source_path)) {
    return {
      exists: false,
      source_path,
      raw_body: "",
      ...DEFAULT_GUIDE,
    };
  }

  const raw_body = normalizeLine(fs.readFileSync(source_path, "utf-8"));

  // Find the "SoloSquad v0.4 — Autonomous Goal Conventions" section.
  // Tolerate slight title variations: starts with `##` and contains both
  // "SoloSquad" and "Autonomous Goal Conventions" (or "v0.4").
  const sections = splitH2Sections(raw_body);

  // Pull subsection contents from the SoloSquad block. We parse named
  // ### subsections: Immutable paths, Modifiable paths, External
  // side-effects, Guardrail thresholds.
  const slvBody = findSoloSquadBlock(sections) ?? "";
  const sub = splitH3Sections(slvBody);

  const immutable_paths = uniqueMerge(
    DEFAULT_GUIDE.immutable_paths,
    parseBulletList(sub.get("immutable_paths") ?? sub.get("immutable paths") ?? "")
  );
  const modifiable_paths = pickList(
    sub.get("modifiable_paths") ?? sub.get("modifiable paths"),
    DEFAULT_GUIDE.modifiable_paths
  );

  // External side-effects section — bullet items.
  const sideRaw = sub.get("external_side_effects") ?? sub.get("external side-effects") ?? "";
  const { forbidden, whitelist } = parseSideEffects(sideRaw);
  const forbidden_side_effects = forbidden.length > 0 ? forbidden : DEFAULT_GUIDE.forbidden_side_effects;
  const external_domain_whitelist = whitelist;

  // Numeric thresholds — `key: value` bullet form, tolerant.
  const thr = parseThresholds(sub.get("guardrail_thresholds") ?? sub.get("guardrail thresholds") ?? "");
  const stage_timeout_seconds = thr.stage_timeout_seconds ?? DEFAULT_GUIDE.stage_timeout_seconds;
  const consecutive_discard_limit =
    thr.consecutive_discard_limit ?? DEFAULT_GUIDE.consecutive_discard_limit;
  const cost_cap_warning_pct = thr.cost_cap_warning_pct ?? DEFAULT_GUIDE.cost_cap_warning_pct;

  return {
    exists: true,
    source_path,
    raw_body,
    immutable_paths,
    modifiable_paths,
    forbidden_side_effects,
    external_domain_whitelist,
    stage_timeout_seconds,
    consecutive_discard_limit,
    cost_cap_warning_pct,
  };
}

// ---------- internal parsers ----------

function splitH2Sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^##\s+(.+)$/gm;
  const hits: Array<{ name: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    hits.push({ name: m[1].trim(), start: m.index, bodyStart: m.index + m[0].length });
  }
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : body.length;
    out.set(hits[i].name, body.slice(hits[i].bodyStart, end).trim());
  }
  return out;
}

function splitH3Sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^###\s+(.+)$/gm;
  const hits: Array<{ name: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    hits.push({ name: m[1].trim().toLowerCase(), start: m.index, bodyStart: m.index + m[0].length });
  }
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : body.length;
    out.set(hits[i].name.replace(/[\s-]+/g, "_"), body.slice(hits[i].bodyStart, end).trim());
  }
  return out;
}

function findSoloSquadBlock(sections: Map<string, string>): string | null {
  for (const [name, body] of sections) {
    const low = name.toLowerCase();
    if (low.includes("autonomous goal conventions") || (low.includes("solosquad") && low.includes("v0.4"))) {
      return body;
    }
  }
  return null;
}

function parseBulletList(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^[-*]\s+(.+?)(?:\s+#.*)?$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function pickList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  const parsed = parseBulletList(raw);
  return parsed.length > 0 ? parsed : fallback;
}

function parseSideEffects(body: string): {
  forbidden: string[];
  whitelist: string[];
} {
  const forbidden: string[] = [];
  const whitelist: string[] = [];
  for (const raw of body.split("\n")) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const bullet = t.match(/^[-*]\s+(.+)$/);
    if (!bullet) continue;
    const content = bullet[1].trim();
    // Whitelist marker: line that starts with "외부 HTTP" or "external HTTP"
    // followed by a colon-separated list, OR `whitelist:` prefix.
    const wlMatch = content.match(
      /^(?:외부 HTTP 호출 화이트리스트|external HTTP whitelist|whitelist)\s*[:：]\s*(.+)$/i
    );
    if (wlMatch) {
      const list = wlMatch[1].split(/[, \t]+/).map((s) => s.trim()).filter(Boolean);
      whitelist.push(...list);
      continue;
    }
    forbidden.push(content);
  }
  return { forbidden, whitelist };
}

function parseThresholds(body: string): {
  stage_timeout_seconds?: number;
  consecutive_discard_limit?: number;
  cost_cap_warning_pct?: number;
} {
  const out: Record<string, number> = {};
  for (const raw of body.split("\n")) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^[-*]\s+([^:]+):\s*([0-9.]+)\s*(s|seconds|cycles|%)?\s*(?:#.*)?$/i);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    let n = Number(m[2]);
    if (!Number.isFinite(n)) continue;
    if (m[3] && m[3].toLowerCase().startsWith("%")) n = n / 100;
    // Heuristics for common phrasings
    if (/timeout/.test(key)) out.stage_timeout_seconds = n;
    else if (/discard/.test(key)) out.consecutive_discard_limit = n;
    else if (/cap|warning|cost/.test(key)) out.cost_cap_warning_pct = n;
  }
  return out as {
    stage_timeout_seconds?: number;
    consecutive_discard_limit?: number;
    cost_cap_warning_pct?: number;
  };
}

function uniqueMerge(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}
