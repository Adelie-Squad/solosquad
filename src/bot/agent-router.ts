import fs from "fs";
import path from "path";
import os from "os";
import { getAgentsDir, getWorkspaceRoot } from "../util/paths.js";
import {
  parseSkillMd,
  validateSkill,
  type SkillSpec,
  type FreqTrigger,
} from "./skill-parser.js";
import { searchArchive, type SearchResult } from "../memory/archive-search.js";

/**
 * v0.5 — frontmatter-driven agent router.
 *
 * Per docs/plan/v0.5-workflow-maker.md §7. The pre-v0.5 router shipped a
 * hardcoded 60+ keyword → 25 agent map. v0.5 replaces it with a 3-tier
 * filesystem scan + 4-channel resolver (slash > explicit > keyword > freq).
 * `AGENT_ROUTES` is gone — keyword routing lives in each SKILL.md's
 * `triggers.keyword` frontmatter.
 *
 * 3-tier search (lowest priority first; higher tier overrides):
 *   3. <workspace>/.solosquad/agents/{team}/{agent}/SKILL.md  (bundled, init)
 *   2. ~/.solosquad/agents/{team}/{agent}/SKILL.md            (user global)
 *   1. <workspace>/<org>/.agents/{team}/{agent}/SKILL.md      (org local — top)
 *
 * SKILL.md without frontmatter (pre-S5 migration state) is silently
 * skipped. Once S5 lands the 25 bundled SKILLs get auto-backfilled and
 * routing returns to coverage.
 *
 * Hot-reload contract: `buildRoutes()` is pure — call it from a wrapper
 * that swaps `routeIndexRef` atomically. While one call builds, a previous
 * index keeps serving. See `src/bot/index.ts` for the swap site.
 */

export type TriggerChannel = "slash" | "keyword" | "freq" | "explicit";

export interface AgentRef {
  team: string;
  name: string;
  source_path: string;
  /** Which tier resolved this — for diagnostics + duplicate-name reporting. */
  tier: "org" | "user" | "workspace";
  stateful: boolean;
}

export interface FreqRoute {
  ref: AgentRef;
  keywords: string[];
  window_turns: number;
  threshold: number;
  cooldown_turns: number;
}

export interface RouteIndex {
  slash: Record<string, AgentRef>;
  /** Keys lowercased. */
  keyword: Record<string, AgentRef>;
  freq: FreqRoute[];
  /** Keyed by SkillSpec.name — case-sensitive (matches PM Task tool naming). */
  explicit: Record<string, AgentRef>;
}

export interface BuildRoutesOpts {
  /** Override workspace agents dir (test fixtures). */
  agents_root?: string;
  /** Override user-global agents dir (test fixtures). */
  user_root?: string;
  /** Org slug — when set, scans `<workspace>/<org>/.agents/` as top-priority tier. */
  org?: string;
  /** Override workspace root — defaults to getWorkspaceRoot(). */
  workspace_root?: string;
  /**
   * v0.6 — when true, `resolveWithArchive()` falls back to FTS5 search on
   * router miss. Off by default to preserve v0.5 behavior; the message
   * dispatcher in `src/bot/index.ts` opts in.
   */
  archive_fallback?: boolean;
}

export function buildRoutes(opts: BuildRoutesOpts = {}): RouteIndex {
  const idx: RouteIndex = { slash: {}, keyword: {}, freq: [], explicit: {} };
  for (const tier of computeTiers(opts)) {
    if (!fs.existsSync(tier.path)) continue;
    for (const scanned of scanSkills(tier.path)) {
      const ref: AgentRef = {
        team: scanned.team,
        name: scanned.spec.name,
        source_path: scanned.skill_path,
        tier: tier.kind,
        stateful: scanned.spec.stateful ?? false,
      };
      registerChannels(idx, ref, scanned.spec);
    }
  }
  return idx;
}

function registerChannels(idx: RouteIndex, ref: AgentRef, spec: SkillSpec): void {
  const t = spec.triggers;
  if (!t) return;
  if (t.slash) {
    for (const s of t.slash) idx.slash[s] = ref;
  }
  if (t.keyword) {
    for (const k of t.keyword) idx.keyword[k.toLowerCase()] = ref;
  }
  if (t.explicit) {
    idx.explicit[ref.name] = ref;
  }
  if (t.freq) {
    idx.freq.push(freqRouteFrom(t.freq, ref));
  }
}

function freqRouteFrom(f: FreqTrigger, ref: AgentRef): FreqRoute {
  return {
    ref,
    keywords: f.keywords,
    window_turns: f.window_turns,
    threshold: f.threshold,
    cooldown_turns: f.cooldown_turns ?? 6,
  };
}

// ---------------------------------------------------------------------------
// resolve()
// ---------------------------------------------------------------------------

export interface ResolveCtx {
  /** Recent messages, oldest first. Used for freq scoring. */
  history?: { text: string }[];
  /** Map of skill name → turns remaining in cooldown (router checks ≥1). */
  freq_cooldowns?: Record<string, number>;
}

export interface ResolveResult {
  ref: AgentRef;
  channel: TriggerChannel;
  /** What text token caused the match — for the "🧠 X auto-loaded" notice. */
  matched: string;
  /** Only set when channel === "freq" — score that crossed the threshold. */
  freq_score?: number;
  /**
   * When the caller should bump session-store cooldowns for this skill.
   * Only emitted on a freq match.
   */
  start_cooldown?: { skill_name: string; turns: number };
}

/**
 * Pure resolver: given a message + history + cooldown state, return the
 * highest-priority match. Side-effect free — the caller updates cooldowns.
 */
export function resolve(
  message: string,
  idx: RouteIndex,
  ctx: ResolveCtx = {}
): ResolveResult | null {
  // 1. slash
  const slashMatch = message.match(/^\s*(\/[A-Za-z][A-Za-z0-9_-]*)/);
  if (slashMatch) {
    const cmd = slashMatch[1];
    const ref = idx.slash[cmd];
    if (ref) return { ref, channel: "slash", matched: cmd };
  }

  // 2. explicit — marker `[explicit:<name>]` inside message text.
  const explicitMatch = message.match(/\[explicit:([^\]]+)\]/);
  if (explicitMatch) {
    const ref = idx.explicit[explicitMatch[1].trim()];
    if (ref) return { ref, channel: "explicit", matched: explicitMatch[1].trim() };
  }

  // 3. keyword (case-insensitive substring)
  const lower = message.toLowerCase();
  for (const [kw, ref] of Object.entries(idx.keyword)) {
    if (lower.includes(kw)) return { ref, channel: "keyword", matched: kw };
  }

  // 4. freq (cumulative keyword count over rolling window)
  if (ctx.history && ctx.history.length > 0 && idx.freq.length > 0) {
    for (const f of idx.freq) {
      const remaining = ctx.freq_cooldowns?.[f.ref.name];
      if (typeof remaining === "number" && remaining > 0) continue; // cooldown
      const score = scoreFreqRoute(f, ctx.history);
      if (score >= f.threshold) {
        return {
          ref: f.ref,
          channel: "freq",
          matched: f.keywords.join(","),
          freq_score: score,
          start_cooldown: { skill_name: f.ref.name, turns: f.cooldown_turns },
        };
      }
    }
  }

  return null;
}

function scoreFreqRoute(f: FreqRoute, history: { text: string }[]): number {
  const window = history.slice(-f.window_turns);
  const text = window.map((t) => t.text.toLowerCase()).join(" ");
  let score = 0;
  for (const kw of f.keywords) {
    const lower = kw.toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(lower, pos)) !== -1) {
      score++;
      pos += lower.length;
    }
  }
  return score;
}

// ---------------------------------------------------------------------------
// Back-compat: findAgent
// ---------------------------------------------------------------------------

/**
 * Single-shot keyword lookup. Builds the index per call — slow for hot
 * paths. The npm package surface (src/index.ts) re-exports this so existing
 * external callers keep working post-v0.5. Bot internals call `resolve()`
 * with a pre-built `RouteIndex`.
 */
export function findAgent(userInput: string): [string, string] | null {
  const idx = buildRoutes();
  const result = resolve(userInput, idx);
  if (!result) return null;
  return [result.ref.team, result.ref.name];
}

/** Read a SKILL.md from the workspace agents dir (unchanged from pre-v0.5). */
export function loadAgentSkill(team: string, agent: string): string {
  const skillFile = path.join(getAgentsDir(), team, agent, "SKILL.md");
  if (fs.existsSync(skillFile)) {
    return fs.readFileSync(skillFile, "utf-8");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface TierSpec {
  kind: "org" | "user" | "workspace";
  path: string;
}

function computeTiers(opts: BuildRoutesOpts): TierSpec[] {
  const tiers: TierSpec[] = [];

  // Lowest priority first.
  const workspaceRoot = opts.agents_root ?? getAgentsDir();
  tiers.push({ kind: "workspace", path: workspaceRoot });

  const userRoot =
    opts.user_root ?? path.join(os.homedir(), ".solosquad", "agents");
  tiers.push({ kind: "user", path: userRoot });

  if (opts.org) {
    const wsRoot = opts.workspace_root ?? getWorkspaceRoot();
    tiers.push({ kind: "org", path: path.join(wsRoot, opts.org, ".agents") });
  }

  return tiers;
}

interface ScannedSkill {
  team: string;
  skill_path: string;
  spec: SkillSpec;
}

function scanSkills(root: string): ScannedSkill[] {
  const out: ScannedSkill[] = [];
  for (const teamEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!teamEntry.isDirectory()) continue;
    // _meta/_teams handled by separate scanners (meta-skill-scanner.ts /
    // agents-builder.ts respectively).
    if (teamEntry.name.startsWith("_")) continue;
    const teamPath = path.join(root, teamEntry.name);
    for (const agentEntry of fs.readdirSync(teamPath, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const skillPath = path.join(teamPath, agentEntry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;
      let raw: string;
      try {
        raw = fs.readFileSync(skillPath, "utf-8");
      } catch {
        continue;
      }
      let spec: SkillSpec;
      try {
        spec = parseSkillMd(raw, skillPath);
      } catch {
        // No frontmatter (pre-S5) or malformed — silently skip. S5 migration
        // fixes the bundled 25; user-authored SKILLs failing here are a
        // validate-time error reported by `solosquad agent validate`.
        continue;
      }
      if (!validateSkill(spec).ok) continue;
      out.push({ team: teamEntry.name, skill_path: skillPath, spec });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cooldown helpers (for session-store callers)
// ---------------------------------------------------------------------------

/**
 * Apply one turn's worth of decay to a freq_cooldowns map. Returns a new
 * map with zero-or-negative entries removed. Pure — no mutation.
 */
export function tickCooldowns(
  cooldowns: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, n] of Object.entries(cooldowns)) {
    const next = n - 1;
    if (next > 0) out[name] = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hot-reload (atomic swap) — v0.5 §7
// ---------------------------------------------------------------------------
//
// Node is single-threaded, so the "atomicity" we need is just: never expose
// a half-built RouteIndex. `buildRoutes()` constructs the new index in a
// local before any caller can observe it, then `installRoutes()` swaps the
// module-private ref. Concurrent message handlers either see the old index
// or the new one, never a mixed state.
//
// S3 (author loop) calls `rebuildRoutes()` after saving a new SKILL.md.
// bot/index.ts seeds the initial index at boot.

let routeIndexRef: RouteIndex | null = null;

/**
 * Build a fresh RouteIndex and atomically install it as the current one.
 * Returns the installed index for diagnostics.
 */
export function rebuildRoutes(opts: BuildRoutesOpts = {}): RouteIndex {
  const next = buildRoutes(opts);
  installRoutes(next);
  return next;
}

/** Swap the module-private ref. Exposed for tests that build offline. */
export function installRoutes(idx: RouteIndex): void {
  routeIndexRef = idx;
}

/**
 * Read the currently installed index. Returns null until `rebuildRoutes()`
 * (or `installRoutes()`) is called at least once.
 */
export function getCurrentRoutes(): RouteIndex | null {
  return routeIndexRef;
}

// ---------------------------------------------------------------------------
// v0.6 — FTS5 archive fallback (§4.3 + §4.4)
// ---------------------------------------------------------------------------

export interface ArchiveRecallNotice {
  /** Short, prompt-cache-safe inline string for the user message. */
  inline: string;
  /** PM notification: "🧠 과거 N건 회상 (날짜: ...)" — printed once per miss. */
  notice: string;
  /** Raw FTS5 hits — for diagnostics / tests. */
  hits: SearchResult[];
}

export interface ResolveWithArchiveOpts extends ResolveCtx {
  workspace: string;
  orgSlug: string;
  /** Default 3 — matches §4.3 (`ORDER BY rank LIMIT 3`). */
  recall_limit?: number;
  /** Max characters in the inline recall payload. §4.4: ≤ 500. */
  inline_char_cap?: number;
}

export interface ResolveWithArchiveResult {
  /** Non-null when the 4-channel router matched. */
  resolved: ResolveResult | null;
  /** Set only on miss when `archive_fallback` recalled anything. */
  recall: ArchiveRecallNotice | null;
}

/**
 * v0.6 router fallback. The normal `resolve()` runs first; on miss the
 * caller can opt into an FTS5 recall to surface past similar messages.
 * Pure with respect to side effects — the caller decides what to do with
 * the recall (inline into the next prompt + send notice).
 */
export function resolveWithArchive(
  message: string,
  idx: RouteIndex,
  opts: ResolveWithArchiveOpts
): ResolveWithArchiveResult {
  const resolved = resolve(message, idx, opts);
  if (resolved) {
    return { resolved, recall: null };
  }

  const limit = opts.recall_limit ?? 3;
  const cap = opts.inline_char_cap ?? 500;
  const hits = searchArchive({
    workspace: opts.workspace,
    orgSlug: opts.orgSlug,
    query: message,
    limit,
  });

  if (!hits.length) {
    return { resolved: null, recall: null };
  }

  return {
    resolved: null,
    recall: buildRecallNotice(hits, cap),
  };
}

function buildRecallNotice(hits: SearchResult[], cap: number): ArchiveRecallNotice {
  const dates = hits.map((h) => h.timestamp.slice(0, 10)).join(", ");
  const notice = `🧠 과거 ${hits.length}건 회상 (날짜: ${dates})`;
  let acc = "";
  for (const h of hits) {
    const piece = `- [${h.timestamp.slice(0, 10)}] ${h.snippet}`;
    if (acc.length + piece.length + 1 > cap) break;
    acc += (acc ? "\n" : "") + piece;
  }
  return { inline: acc, notice, hits };
}
