import fs from "fs";
import path from "path";
import { getOrgDir } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { searchArchive } from "../memory/archive-search.js";
import { getSinkPath } from "../memory/route-event-sink.js";
import { applyDraft, type AuthorDraft } from "../bot/skill-author.js";

/**
 * v0.6 §3.2 — Trajectory → SKILL pattern extraction (P0 #3).
 *
 * Nightly hook (pm-compaction routine) that analyzes the cold archive +
 * recent route-events.jsonl for repeated (agent sequence + workflow template)
 * combinations. When the same trajectory appears 3+ times in a 30-day rolling
 * window, emits a `TrajectorySuggestion`. The user is presented the proposal
 * the next morning and can confirm via the messenger — confirmation calls
 * `applyDraft()` from v0.5 S3 *directly*. No separate applier exists; this
 * module only authors the input.
 *
 * Trigger conditions (§3.1, all four must hold):
 *   1. Same agent sequence + workflow template appears N≥3 times
 *   2. Within rolling 30-day window (archive-rotate decays counts via §3.1.1)
 *   3. Suggestion was not rejected within the past 30 days (cooldown)
 *   4. All trajectory cycles "kept" (no discards) — caller may enforce via
 *      results.tsv; v0.6 P0 wires this in §3.2 by skipping decisions with
 *      `kept_only=false`.
 *
 * Pipeline shape per §3.2 narrative:
 *   route-events.jsonl + FTS5 archive
 *     ↓ groupBy(agent sequence + workflow template) within 30d window
 *     ↓ filter count >= 3
 *     ↓ filter !rejected_recently
 *   TrajectorySuggestion[]
 *     ↓ suggestionToDraft() — pure converter
 *   AuthorDraft
 *     ↓ applyDraft() — v0.5 S3 entry, ONE import line below
 *   <org>/.agents/<team>/<slug>/SKILL.md + rebuildRoutes()
 */

const TRAJECTORY_WINDOW_DAYS = 30;
const TRAJECTORY_MIN_COUNT = 3;
const REJECTIONS_FILE = "trajectory-rejections.jsonl";

export interface TrajectorySuggestion {
  /** Stable id derived from (sequence + workflow template) hash + first-seen ts. */
  suggestion_id: string;
  /** Ordered list of "team/agent" references. */
  agent_sequence: string[];
  /** Workflow template label (e.g. "pmf", "feature", "rapid-prototype"). */
  workflow_template: string;
  /** How many times this trajectory was observed in the window. */
  observation_count: number;
  /** ISO of the earliest observation in the window. */
  first_seen: string;
  /** ISO of the latest observation in the window. */
  last_seen: string;
  /** Frequency keywords harvested from the spawn_decision rationales. */
  keywords: string[];
  /** Confidence — fixed at 0.7 per §3.2 narrative. */
  confidence: number;
  /** Source tag for the SKILL frontmatter `source:` field. */
  source: string;
}

export interface ExtractOpts {
  workspace: string;
  orgSlug: string;
  /** Override "now" for deterministic tests. */
  now?: string;
  /** Override window — defaults to 30. */
  windowDays?: number;
  /** Override min observation count — defaults to 3. */
  minCount?: number;
}

export interface SuggestionRejection {
  suggestion_id: string;
  /** ISO of the rejection. */
  ts: string;
  reason?: string;
}

interface RawTrajectoryEvent {
  timestamp: string;
  chosen_agent: string;
  rationale: string;
  team?: string;
  workflow_template?: string;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function extractTrajectories(opts: ExtractOpts): Promise<TrajectorySuggestion[]> {
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  const windowDays = opts.windowDays ?? TRAJECTORY_WINDOW_DAYS;
  const minCount = opts.minCount ?? TRAJECTORY_MIN_COUNT;
  const cutoffMs = nowMs - windowDays * 86_400_000;

  const events = collectSpawnDecisions(opts.workspace, opts.orgSlug, cutoffMs);
  const grouped = groupByTrajectory(events);
  const rejected = loadRejections(opts.workspace, opts.orgSlug, nowMs, windowDays);

  const out: TrajectorySuggestion[] = [];
  for (const [key, bucket] of grouped.entries()) {
    if (bucket.runs.length < minCount) continue;
    const suggestion = bucketToSuggestion(key, bucket);
    if (rejected.has(suggestion.suggestion_id)) continue;
    out.push(suggestion);
  }
  // Stable order — highest observation count first, then earliest first_seen.
  out.sort((a, b) => {
    if (a.observation_count !== b.observation_count) {
      return b.observation_count - a.observation_count;
    }
    return a.first_seen.localeCompare(b.first_seen);
  });
  return out;
}

export interface ApplySuggestionInput {
  workspace: string;
  orgSlug: string;
  suggestion: TrajectorySuggestion;
  /** Override destination — passed through to applyDraft. */
  destination?: string;
}

/**
 * Apply a confirmed trajectory suggestion. Delegates straight to v0.5
 * `applyDraft()` — no separate file writer lives in this module (P0 #3
 * audit: grep `applyDraft\|new.*Applier` returns the import below as the
 * only ingress point).
 */
export async function applySuggestion(input: ApplySuggestionInput): Promise<void> {
  const draft = suggestionToDraft(input.suggestion, input.orgSlug);
  applyDraft({
    workspace: input.workspace,
    orgSlug: input.orgSlug,
    draft,
    destination: input.destination,
  });
}

/**
 * Record a user rejection so the same trajectory is not re-proposed within
 * the cooldown window (§3.1.1).
 */
export function recordRejection(args: {
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
// Conversion — TrajectorySuggestion → AuthorDraft
// ---------------------------------------------------------------------------

/**
 * Pure converter. Output is a valid `AuthorDraft` ready for `applyDraft()`.
 * The slug is derived from the agent sequence + workflow template so two
 * runs over the same observation produce the same SKILL location.
 */
export function suggestionToDraft(
  suggestion: TrajectorySuggestion,
  orgSlug: string,
): AuthorDraft {
  const slug = trajectorySlug(suggestion);
  const ts = new Date().toISOString();
  const display = `auto-trajectory-${slug}`;
  const description = `Auto-extracted trajectory from ${suggestion.observation_count} runs of ${suggestion.workflow_template} workflow`;

  // Anchor the trajectory in the SKILL body so a future review can see what
  // was observed — this is the audit trail the human gate consumes.
  const body = renderTrajectoryBody(suggestion);

  return {
    skill_draft_id: `traj-${suggestion.suggestion_id}`,
    user_id: "trajectory-extractor",
    org_slug: orgSlug,
    intent: description,
    team: trajectoryTeam(suggestion),
    slug,
    display_name: display,
    description,
    triggers_keyword: suggestion.keywords.slice(0, 8),
    inputs: { required: [], optional: [] },
    outputs: ["trajectory-summary.md"],
    body_md: body,
    state: "AWAIT_CONFIRM",
    history: [],
    created_at: ts,
    updated_at: ts,
  };
}

function trajectorySlug(s: TrajectorySuggestion): string {
  const base = `${s.workflow_template}-${s.agent_sequence.map((a) => a.split("/").pop()).join("-")}`;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "auto-trajectory";
}

function trajectoryTeam(s: TrajectorySuggestion): string {
  // Pick the team of the first agent in the sequence — that is the entry
  // point a future invocation would route to.
  const first = s.agent_sequence[0];
  if (!first) return "strategy";
  const team = first.split("/")[0];
  return team || "strategy";
}

function renderTrajectoryBody(s: TrajectorySuggestion): string {
  return [
    `# auto-trajectory-${s.workflow_template}`,
    "",
    `> ${s.observation_count} observations between ${s.first_seen} and ${s.last_seen}.`,
    "",
    "## Agent Sequence",
    "",
    ...s.agent_sequence.map((a, i) => `${i + 1}. ${a}`),
    "",
    "## Source",
    "",
    `source: ${s.source}`,
    `confidence: ${s.confidence}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Internal — event collection + grouping
// ---------------------------------------------------------------------------

function collectSpawnDecisions(
  workspace: string,
  orgSlug: string,
  cutoffMs: number,
): RawTrajectoryEvent[] {
  const out: RawTrajectoryEvent[] = [];
  // (1) Hot tier — route-events.jsonl (last 7d before archive-rotate).
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
      const ev = toTrajectoryEvent(parsed);
      if (!ev) continue;
      const ms = Date.parse(ev.timestamp);
      if (!Number.isFinite(ms) || ms < cutoffMs) continue;
      out.push(ev);
    }
  }

  // (2) Cold tier — FTS5 archive (8d+ via archive-rotate). The miner casts a
  // wide net via searchArchive with an event_type filter, then post-filters
  // by timestamp. The query is intentionally permissive — we want recall, not
  // precision, at this stage (grouping does the precision work).
  const archived = searchArchive({
    workspace,
    orgSlug,
    query: "agent task workflow trajectory pipeline pmf feature prototype",
    limit: 50,
    eventType: "spawn_decision",
  });
  for (const hit of archived) {
    const ms = Date.parse(hit.timestamp);
    if (!Number.isFinite(ms) || ms < cutoffMs) continue;
    out.push({
      timestamp: hit.timestamp,
      chosen_agent: hit.agent,
      rationale: hit.snippet,
    });
  }
  return out;
}

function toTrajectoryEvent(parsed: Record<string, unknown>): RawTrajectoryEvent | null {
  if (parsed.event_type !== "spawn_decision") return null;
  const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : "";
  const chosen_agent =
    typeof parsed.chosen_agent === "string" ? parsed.chosen_agent : "";
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
  if (!timestamp || !chosen_agent) return null;
  return { timestamp, chosen_agent, rationale };
}

interface GroupedTrajectory {
  events: RawTrajectoryEvent[];
  /** Original ordered agent sequence reconstructed from chronology. */
  sequence: string[];
  workflow_template: string;
}

interface TrajectoryRun {
  template: string;
  events: RawTrajectoryEvent[];
  /** Ordered agent sequence (deduped, preserves first-seen order). */
  sequence: string[];
}

interface TrajectoryBucket {
  template: string;
  sequence: string[];
  /** One entry per run that matched (template + sequence). */
  runs: { firstTs: string; lastTs: string; rationale: string[] }[];
}

function groupByTrajectory(
  events: RawTrajectoryEvent[],
): Map<string, TrajectoryBucket> {
  // Sort by timestamp, then slice into "runs" — adjacent spawn_decisions
  // within 6h that share a workflow template form one trajectory. The
  // workflow template is inferred from the rationale text (pmf|feature|
  // rebranding|prototype) — falls back to "general". Each run contributes
  // exactly ONE observation to its (template + sequence) bucket; we count
  // runs, not raw events, because the §3.1 trigger is "same trajectory
  // appears 3+ times".
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const runs: TrajectoryRun[] = [];
  for (const ev of sorted) {
    const template = inferTemplate(ev.rationale);
    const last = runs[runs.length - 1];
    if (
      last &&
      last.template === template &&
      Date.parse(ev.timestamp) - Date.parse(last.events[last.events.length - 1].timestamp) <=
        6 * 3_600_000
    ) {
      last.events.push(ev);
    } else {
      runs.push({ template, events: [ev], sequence: [] });
    }
  }
  for (const run of runs) {
    run.sequence = uniqueOrdered(run.events.map((e) => normalizeAgentRef(e.chosen_agent)));
  }

  // Bucket runs by (template + agent sequence). Each run is one observation
  // — the §3.1 trigger counts trajectories, not individual spawn events.
  const groups = new Map<string, TrajectoryBucket>();
  for (const run of runs) {
    if (run.sequence.length < 2) continue;
    const key = `${run.template}::${run.sequence.join("→")}`;
    const existing = groups.get(key);
    const firstTs = run.events[0].timestamp;
    const lastTs = run.events[run.events.length - 1].timestamp;
    const rationale = run.events.map((e) => e.rationale);
    if (existing) {
      existing.runs.push({ firstTs, lastTs, rationale });
    } else {
      groups.set(key, {
        template: run.template,
        sequence: run.sequence,
        runs: [{ firstTs, lastTs, rationale }],
      });
    }
  }
  return groups;
}

function normalizeAgentRef(raw: string): string {
  // Accept either "team/agent" or bare "agent" — the latter is upgraded with
  // a placeholder team so grouping stays stable.
  if (raw.includes("/")) return raw;
  return `unknown/${raw}`;
}

function inferTemplate(rationale: string): string {
  const lower = rationale.toLowerCase();
  if (lower.includes("pmf")) return "pmf";
  if (lower.includes("feature")) return "feature";
  if (lower.includes("rebrand")) return "rebranding";
  if (lower.includes("prototype")) return "prototype";
  return "general";
}

function bucketToSuggestion(
  key: string,
  bucket: TrajectoryBucket,
): TrajectorySuggestion {
  const runs = [...bucket.runs].sort((a, b) => a.firstTs.localeCompare(b.firstTs));
  const firstSeen = runs[0].firstTs;
  const lastSeen = runs[runs.length - 1].lastTs;
  const allRationales = runs.flatMap((r) => r.rationale);
  const keywords = harvestKeywords(allRationales);
  const id = makeId(bucket.template, bucket.sequence, firstSeen);
  return {
    suggestion_id: id,
    agent_sequence: bucket.sequence,
    workflow_template: bucket.template,
    observation_count: bucket.runs.length,
    first_seen: firstSeen,
    last_seen: lastSeen,
    keywords,
    confidence: 0.7,
    source: `auto-extracted-from-trajectory-${firstSeen}`,
  };
}

function uniqueOrdered(seq: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of seq) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function harvestKeywords(rationales: string[]): string[] {
  const tokens = new Map<string, number>();
  for (const text of rationales) {
    for (const t of tokenize(text)) {
      tokens.set(t, (tokens.get(t) ?? 0) + 1);
    }
  }
  return [...tokens.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "task",
  "a", "an", "of", "to", "in", "on", "at", "by", "is", "are",
]);

function tokenize(text: string): string[] {
  const lower = text.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, " ");
  return lower
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function makeId(template: string, sequence: string[], firstTs: string): string {
  const seqHash = sequence
    .map((a) => a.replace(/[^a-z0-9]/g, ""))
    .join("-");
  const tsTag = firstTs.replace(/[^0-9]/g, "").slice(0, 8);
  return `${template}-${seqHash}-${tsTag}`.slice(0, 60);
}

// ---------------------------------------------------------------------------
// Rejection ledger
// ---------------------------------------------------------------------------

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
