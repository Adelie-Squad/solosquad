import fs from "fs";
import path from "path";
import { getOrgDir } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { searchArchive } from "../memory/archive-search.js";
import { getSinkPath } from "../memory/route-event-sink.js";
import {
  parseSkillMd,
  emitSkillMd,
  type SkillSpec,
} from "../bot/skill-parser.js";
import { rebuildRoutes } from "../bot/agent-router.js";

/**
 * v0.6 §3.4 — Freq keyword miner (P1 #6).
 *
 * Nightly hook (pm-compaction cron) that extracts N-gram keywords
 * (N=1..3, stop-word filtered) from:
 *   - route_miss events (route fallback misses — §4.6)
 *   - author-draft.json clarification questions (PM-side ask history)
 *
 * Same keyword miss ≥3 times within 30 days *and* a semantically similar
 * existing SKILL is found → emit a `KeywordSuggestion`. The user confirms
 * via the messenger; `applyKeywordSuggestion()` patches the target SKILL's
 * frontmatter `triggers.keyword` *only* — body untouched (§3.4 partial-
 * application mode). v0.5's `skill-author.applyDraft()` is intentionally
 * not used here because:
 *   - it writes a full SKILL + workflow + goal triple
 *   - it rejects any change that doesn't round-trip the full body
 * A frontmatter-only patch is a strictly smaller operation and stays inside
 * the miner module per the v0.6 S5 DO-NOT scope (skill-author.ts is frozen).
 *
 * Safeguards:
 *   - No auto-registration — human gate (matches §3.2 trajectory pattern)
 *   - Rejected suggestions are persisted to
 *     <org>/memory/freq-rejections.jsonl with a 30-day cooldown
 *   - LLM clustering is OOS for v0.6 — only deterministic frequency +
 *     token-overlap heuristic (§3.4 안전장치)
 */

const KEYWORD_WINDOW_DAYS = 30;
const KEYWORD_MIN_COUNT = 3;
const OVERLAP_THRESHOLD = 2;
const REJECTIONS_FILE = "freq-rejections.jsonl";
const MAX_NGRAM = 3;

export interface KeywordSuggestion {
  /** Stable id derived from (keyword + target SKILL path). */
  suggestion_id: string;
  /** The N-gram that should be added as a trigger.keyword. */
  keyword: string;
  /** Absolute path to the SKILL.md whose frontmatter we'll patch. */
  target_skill_path: string;
  /** Display name of the target SKILL — for the user confirmation prompt. */
  target_skill_name: string;
  /** Number of route_miss observations of this keyword in window. */
  miss_count: number;
  /** Number of overlapping tokens between keyword and the target SKILL's existing
   * triggers/description. ≥ OVERLAP_THRESHOLD by construction. */
  overlap_score: number;
  /** First time the miss was seen (in window). */
  first_seen: string;
}

export interface MineOpts {
  workspace: string;
  orgSlug: string;
  /** Override "now" for deterministic tests. */
  now?: string;
  /** Override window — defaults to 30. */
  windowDays?: number;
  /** Override min observation count — defaults to 3. */
  minCount?: number;
  /** Directory roots to scan for existing SKILL.md candidates. Default = <org>/.agents. */
  skillRoots?: string[];
}

export interface SuggestionRejection {
  suggestion_id: string;
  ts: string;
  reason?: string;
}

export interface ApplyKeywordSuggestionInput {
  workspace: string;
  orgSlug: string;
  suggestion: KeywordSuggestion;
}

// ---------------------------------------------------------------------------
// Public entrypoint — mine
// ---------------------------------------------------------------------------

export async function mineFrequentKeywords(opts: MineOpts): Promise<KeywordSuggestion[]> {
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  const windowDays = opts.windowDays ?? KEYWORD_WINDOW_DAYS;
  const minCount = opts.minCount ?? KEYWORD_MIN_COUNT;
  const cutoffMs = nowMs - windowDays * 86_400_000;

  const missTexts = collectMissTexts(opts.workspace, opts.orgSlug, cutoffMs);
  const ngramCounts = extractNgrams(missTexts);
  const candidates = [...ngramCounts.entries()]
    .filter(([, c]) => c >= minCount)
    .map(([k, c]) => ({ keyword: k, count: c }));

  if (candidates.length === 0) return [];

  const skills = loadSkillCandidates(opts.workspace, opts.orgSlug, opts.skillRoots);
  const rejected = loadRejections(opts.workspace, opts.orgSlug, nowMs, windowDays);

  const out: KeywordSuggestion[] = [];
  const firstSeenByKeyword = computeFirstSeen(missTexts);
  for (const { keyword, count } of candidates) {
    const match = bestSkillMatch(keyword, skills);
    if (!match) continue;
    if (alreadyHasKeyword(match.spec, keyword)) continue;
    const id = makeSuggestionId(keyword, match.path);
    if (rejected.has(id)) continue;
    out.push({
      suggestion_id: id,
      keyword,
      target_skill_path: match.path,
      target_skill_name: match.spec.name,
      miss_count: count,
      overlap_score: match.overlap,
      first_seen: firstSeenByKeyword.get(keyword) ?? new Date(cutoffMs).toISOString(),
    });
  }
  // Highest miss_count first, then best overlap.
  out.sort((a, b) => {
    if (a.miss_count !== b.miss_count) return b.miss_count - a.miss_count;
    return b.overlap_score - a.overlap_score;
  });
  return out;
}

/**
 * v1.3.3 §4.3 — a one-line, suggest-only summary of pending keyword-routing
 * suggestions, for inlining into the morning brief. Returns null when there's
 * nothing to suggest (or the miner can't run). NEVER auto-applies — the user
 * acts via `solosquad cron freq [--apply <id>]`.
 */
export async function freqSuggestionLine(workspace: string, orgSlug: string): Promise<string | null> {
  let suggestions: KeywordSuggestion[];
  try {
    suggestions = await mineFrequentKeywords({ workspace, orgSlug });
  } catch {
    return null;
  }
  if (suggestions.length === 0) return null;
  const top = suggestions[0];
  const more = suggestions.length > 1 ? ` (+${suggestions.length - 1} more)` : "";
  return (
    `💡 Routing suggestion${suggestions.length > 1 ? "s" : ""}: "${top.keyword}" → ${top.target_skill_name}` +
    `${more}. Review/apply with \`solosquad cron freq\` (never auto-applied).`
  );
}

// ---------------------------------------------------------------------------
// Public entrypoint — apply
// ---------------------------------------------------------------------------

/**
 * Apply a confirmed keyword suggestion. Frontmatter-only patch (§3.4):
 *   - read SKILL.md, parse frontmatter
 *   - append keyword to triggers.keyword (dedup, sorted by insertion order)
 *   - re-emit the file; body untouched at the byte level
 *   - rebuildRoutes() so the new keyword is live
 */
export async function applyKeywordSuggestion(
  input: ApplyKeywordSuggestionInput,
): Promise<void> {
  const { suggestion } = input;
  const raw = fs.readFileSync(suggestion.target_skill_path, "utf-8");
  const spec = parseSkillMd(raw, suggestion.target_skill_path);
  const originalBody = spec.body;

  const existingKw = spec.triggers?.keyword ?? [];
  if (existingKw.includes(suggestion.keyword)) return;
  const nextKw = [...existingKw, suggestion.keyword];
  const triggers = spec.triggers ?? {};
  spec.triggers = { ...triggers, keyword: nextKw };

  // Body must stay byte-identical — the §3.4 contract says "본문은 한 글자도
  // 안 건드리고". emitSkillMd re-serializes the frontmatter and concatenates
  // the spec.body verbatim, so as long as we don't touch spec.body we're safe.
  if (spec.body !== originalBody) {
    throw new Error(
      "freq-keyword-miner internal — frontmatter-only patch must not modify body",
    );
  }
  const next = emitSkillMd(spec);
  atomicWrite(suggestion.target_skill_path, next);

  rebuildRoutes({ workspace_root: input.workspace, org: input.orgSlug });
}

/** Record a user rejection so the same (keyword, skill) pair stays out of the
 * proposal pipeline for the cooldown window. */
export function recordKeywordRejection(args: {
  workspace: string;
  orgSlug: string;
  suggestion_id: string;
  reason?: string;
  now?: string;
}): void {
  const file = path.join(
    getOrgDir(args.orgSlug, args.workspace),
    "memory",
    REJECTIONS_FILE,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row: SuggestionRejection = {
    suggestion_id: args.suggestion_id,
    ts: args.now ?? new Date().toISOString(),
    reason: args.reason,
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Internal — miss collection
// ---------------------------------------------------------------------------

interface MissText {
  text: string;
  timestamp: string;
}

function collectMissTexts(
  workspace: string,
  orgSlug: string,
  cutoffMs: number,
): MissText[] {
  const out: MissText[] = [];

  // (1) Hot tier — route-events.jsonl `route_miss`.
  const sinkFile = getSinkPath(workspace, orgSlug);
  if (fs.existsSync(sinkFile)) {
    const raw = normalizeLine(fs.readFileSync(sinkFile, "utf-8"));
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.event_type === "route_miss") {
        const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : "";
        const text = typeof parsed.message === "string" ? parsed.message : "";
        if (!ts || !text) continue;
        const ms = Date.parse(ts);
        if (!Number.isFinite(ms) || ms < cutoffMs) continue;
        out.push({ text, timestamp: ts });
      } else if (parsed.event_type === "author_turn") {
        // PM-side clarification questions count as missed keywords too —
        // the user *was asked* for terms that don't map to a SKILL trigger.
        const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : "";
        const question = typeof parsed.question === "string" ? parsed.question : "";
        if (!ts || !question) continue;
        const ms = Date.parse(ts);
        if (!Number.isFinite(ms) || ms < cutoffMs) continue;
        out.push({ text: question, timestamp: ts });
      }
    }
  }

  // (2) Cold tier — FTS5 archive, route_miss event type.
  const hits = searchArchive({
    workspace,
    orgSlug,
    query: "where which how what",
    limit: 50,
    eventType: "route_miss",
  });
  for (const h of hits) {
    const ms = Date.parse(h.timestamp);
    if (!Number.isFinite(ms) || ms < cutoffMs) continue;
    out.push({ text: h.snippet, timestamp: h.timestamp });
  }

  // (3) Cold tier — FTS5 archive, author_turn event type.
  const hits2 = searchArchive({
    workspace,
    orgSlug,
    query: "how which what where",
    limit: 50,
    eventType: "author_turn",
  });
  for (const h of hits2) {
    const ms = Date.parse(h.timestamp);
    if (!Number.isFinite(ms) || ms < cutoffMs) continue;
    out.push({ text: h.snippet, timestamp: h.timestamp });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Internal — N-gram extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "task",
  "a", "an", "of", "to", "in", "on", "at", "by", "is", "are", "was",
  "be", "or", "as", "it", "if", "we", "i", "you", "they", "but",
  "how", "what", "where", "when", "why", "which",
]);

function extractNgrams(misses: MissText[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of misses) {
    const tokens = tokenize(m.text);
    for (let n = 1; n <= MAX_NGRAM; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n).join(" ");
        if (!gram) continue;
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, " ");
  return lower
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function computeFirstSeen(misses: MissText[]): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = [...misses].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const m of sorted) {
    const tokens = tokenize(m.text);
    for (let n = 1; n <= MAX_NGRAM; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n).join(" ");
        if (!gram) continue;
        if (!out.has(gram)) out.set(gram, m.timestamp);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal — SKILL candidate scoring
// ---------------------------------------------------------------------------

interface SkillCandidate {
  spec: SkillSpec;
  path: string;
  /** Pre-computed token set from name + description + existing keywords. */
  tokens: Set<string>;
}

function loadSkillCandidates(
  workspace: string,
  orgSlug: string,
  roots?: string[],
): SkillCandidate[] {
  const searchRoots = roots ?? [path.join(getOrgDir(orgSlug, workspace), ".agents")];
  const out: SkillCandidate[] = [];
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    walkSkillMd(root, out);
  }
  return out;
}

function walkSkillMd(dir: string, out: SkillCandidate[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".agents") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSkillMd(full, out);
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      try {
        const raw = fs.readFileSync(full, "utf-8");
        const spec = parseSkillMd(raw, full);
        const tokens = collectSkillTokens(spec);
        out.push({ spec, path: full, tokens });
      } catch {
        // Skip malformed SKILL.md — the validator catches them elsewhere.
      }
    }
  }
}

function collectSkillTokens(spec: SkillSpec): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(spec.name)) tokens.add(t);
  for (const t of tokenize(spec.description)) tokens.add(t);
  if (spec.triggers?.keyword) {
    for (const kw of spec.triggers.keyword) {
      for (const t of tokenize(kw)) tokens.add(t);
    }
  }
  return tokens;
}

function bestSkillMatch(
  keyword: string,
  skills: SkillCandidate[],
): { spec: SkillSpec; path: string; overlap: number } | null {
  const kwTokens = new Set(tokenize(keyword));
  if (kwTokens.size === 0) return null;
  let best: { spec: SkillSpec; path: string; overlap: number } | null = null;
  for (const s of skills) {
    let overlap = 0;
    for (const t of kwTokens) if (s.tokens.has(t)) overlap++;
    if (overlap < OVERLAP_THRESHOLD) continue;
    if (!best || overlap > best.overlap) {
      best = { spec: s.spec, path: s.path, overlap };
    }
  }
  return best;
}

function alreadyHasKeyword(spec: SkillSpec, keyword: string): boolean {
  const existing = spec.triggers?.keyword ?? [];
  return existing.includes(keyword);
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

function atomicWrite(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, target);
}

function makeSuggestionId(keyword: string, skillPath: string): string {
  const kw = keyword.replace(/[^a-z0-9가-힣]/gi, "");
  const slug = path.basename(path.dirname(skillPath));
  return `freq-${slug}-${kw}`.slice(0, 80);
}

function loadRejections(
  workspace: string,
  orgSlug: string,
  nowMs: number,
  windowDays: number,
): Set<string> {
  const file = path.join(getOrgDir(orgSlug, workspace), "memory", REJECTIONS_FILE);
  if (!fs.existsSync(file)) return new Set();
  const cutoffMs = nowMs - windowDays * 86_400_000;
  const out = new Set<string>();
  const raw = normalizeLine(fs.readFileSync(file, "utf-8"));
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as SuggestionRejection;
      const ms = Date.parse(parsed.ts);
      if (Number.isFinite(ms) && ms >= cutoffMs) {
        out.add(parsed.suggestion_id);
      }
    } catch {
      // ignore
    }
  }
  return out;
}
