import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  getAgentsDir,
  getKnowledgeDir,
  getOrgDir,
  getRepoDir,
} from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import {
  DEFAULT_SPAWN_MAX_CONTEXT_TOKENS,
  resolveDevCapabilityConfig,
  type DevCapabilityConfig,
  type WorkspaceYaml,
} from "../util/config.js";
import { loadAgentProfile, type AgentProfileMerged } from "../util/agent-profile.js";
import {
  listUserYamls,
  userYamlPath,
  loadUserYaml,
  type UserYaml,
} from "./user-registry.js";
import type { SkillSpec } from "./skill-parser.js";

/**
 * v0.6 §2.2 — Spawn-time 8-layer JIT context assembler.
 *
 * Pure aggregator: returns an ordered list of Layer records. Building the
 * actual Task prompt string (concatenation order, header decorations,
 * tool/system-prompt placement) is the caller's job — `pm-runner.ts`. The
 * split exists because spawn callers have different needs (Task tool prompt,
 * `--append-system-prompt`, cwd-adjacent file injection) and the assembler
 * has no business hard-coding one.
 *
 * Drop policy (P1 #4) — `workspace.yaml.spawn.max_context_tokens` (default
 * 80,000). When the running total exceeds the cap, layers are dropped in
 * ascending priority:
 *
 *   priority 1 (REQUIRED): [3] agent SKILL.md           — never drop
 *   priority 2 (REQUIRED): [4] org core, [5] agent-profile — never drop
 *   priority 3: [7] handoff slice — oldest first
 *   priority 4: [2] team KNOWLEDGE — keyword match low
 *   priority 5: [6] org domain    — keyword match low
 *   priority 6: [1] workspace knowledge — keyword match 0
 *   priority 7: [8] target repo   — biggest files first
 *
 * Drops are recorded to `<org>/memory/spawn-decisions.jsonl` (event_type:
 * `spawn_decision`) — input to the §4.6 FTS5 archive.
 */

export type LayerKind =
  | "workspace-knowledge" // [1]
  | "team-knowledge" //      [2]
  | "agent-skill" //         [3]
  | "org-core" //            [4]
  | "agent-profile" //       [5]
  | "org-domain" //          [6]
  | "handoff" //             [7]
  | "repo-context"; //       [8]

export interface Layer {
  /** Stable index per §2.2 (1-based). */
  index: number;
  kind: LayerKind;
  /** Human-readable label for diagnostics + JSONL records. */
  label: string;
  /** Concatenated markdown content for this layer (may be empty). */
  content: string;
  /** File paths that contributed (for debugging + telemetry). */
  sources: string[];
  /** Estimated token count. */
  tokens: number;
}

export interface AssembledContext {
  layers: Layer[];
  /** Labels of layers that were dropped (in drop order). */
  truncated: string[];
  /** Total tokens after drops. */
  totalTokens: number;
  /** Effective cap used. */
  maxTokens: number;
}

export interface AssembleSpawnContextInput {
  workspace: string;
  orgSlug: string;
  /** Either `{ team, name }` or a `team/name` slug. */
  agentRef: { team: string; name: string };
  /** Optional target repo slug — only present when PM hands one off. */
  repoSlug?: string;
  /** Optional workflow id for the handoff slice. */
  workflowId?: string;
  /** Free-form user text (or task description) used for keyword matching. */
  query?: string;
  /** Pre-loaded workspace.yaml — saves a parse on the hot path. */
  workspaceYaml?: WorkspaceYaml | null;
  /** Pre-loaded agent-profile (already 3-tier merged). */
  agentProfile?: AgentProfileMerged;
  /**
   * v0.8 §3.3 — Owning user handle for this spawn. When set, the assembler
   * injects the corresponding `<org>/.solosquad/users/<handle>.yaml` into
   * Layer 5 so the specialist sees who issued the command. When omitted, the
   * assembler falls back to the org's first user yaml (solo-mode default) —
   * matches v0.6 behavior for callers that have not yet wired the user id.
   */
  userHandle?: string;
  /** Override max_context_tokens (for tests). */
  maxContextTokens?: number;
  /** Override the per-token char heuristic (for tests). */
  charsPerToken?: number;
  /** Stable "now" for tests. */
  now?: Date;
  /** Disable JSONL writes (for tests). */
  dryRun?: boolean;
}

/**
 * Rough token estimate (chars / 4). The cap is a safety rail, not a billing
 * boundary — the actual tokenizer lives inside Claude. Off by ±15% in
 * practice for English/Korean mixed prose.
 */
const DEFAULT_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string, charsPerToken: number): number {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerToken);
}

function safeReadFile(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null;
    return normalizeLine(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    out.push(path.join(dir, entry.name));
  }
  return out.sort();
}

function tokenizeQuery(query: string | undefined): Set<string> {
  if (!query) return new Set();
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "for",
    "to",
    "in",
    "on",
    "is",
    "are",
    "with",
    "this",
    "that",
  ]);
  const out = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9가-힣]+/u)) {
    const tok = raw.trim();
    if (!tok || tok.length < 2) continue;
    if (stop.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function countKeywordHits(content: string, keywords: Set<string>): number {
  if (keywords.size === 0) return 0;
  const lower = content.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) hits++;
  }
  return hits;
}

interface KeywordScoredFile {
  file: string;
  content: string;
  hits: number;
}

function readDirWithKeywordScore(
  dir: string,
  keywords: Set<string>,
): KeywordScoredFile[] {
  const out: KeywordScoredFile[] = [];
  for (const file of listMarkdownFiles(dir)) {
    const content = safeReadFile(file);
    if (content === null) continue;
    out.push({ file, content, hits: countKeywordHits(content, keywords) });
  }
  // Highest hit count first, ties broken by filename for determinism.
  out.sort((a, b) => b.hits - a.hits || a.file.localeCompare(b.file));
  return out;
}

function summarizeAgentProfile(
  profile: AgentProfileMerged,
  agentName: string,
  userYaml?: UserYaml | null,
): { content: string; sources: string[] } {
  const lines: string[] = [];
  const defaults = profile.defaults;
  const agentSection = profile.agents[agentName];

  if (defaults && Object.keys(defaults).length > 0) {
    lines.push("## defaults");
    lines.push("```yaml");
    lines.push(yaml.dump(defaults, { lineWidth: 100 }).trimEnd());
    lines.push("```");
  }
  if (agentSection && Object.keys(agentSection).length > 0) {
    lines.push(`## ${agentName}`);
    lines.push("```yaml");
    lines.push(yaml.dump(agentSection, { lineWidth: 100 }).trimEnd());
    lines.push("```");
  }

  // v0.8 §3.3 — Identity of the user who triggered this spawn. Trimmed to the
  // fields a specialist actually needs (handle, display_name, messenger,
  // channels). bot_user_id / tokens are intentionally omitted.
  if (userYaml) {
    lines.push("## user (v0.8 multi-user context)");
    lines.push("```yaml");
    lines.push(
      yaml
        .dump(
          {
            handle: userYaml.handle,
            display_name: userYaml.display_name,
            messenger: userYaml.messenger,
            channels: userYaml.channels,
          },
          { lineWidth: 100 },
        )
        .trimEnd(),
    );
    lines.push("```");
  }

  if (profile.warnings.length > 0) {
    lines.push("\n<!-- agent-profile warnings: -->");
    for (const w of profile.warnings) lines.push(`<!-- ${w} -->`);
  }

  return { content: lines.join("\n"), sources: [] };
}

/**
 * v0.8 §3.3 — Pick the user yaml the specialist should know about. Strict
 * match when `handle` is provided; otherwise return the first registered user
 * (solo-mode default). Returns `null` when no yaml exists yet (fresh org).
 */
function resolveUserYamlForSpawn(
  workspace: string,
  orgSlug: string,
  handle: string | undefined,
): UserYaml | null {
  if (handle) {
    const doc = loadUserYaml(userYamlPath(orgSlug, handle, workspace));
    if (doc) return doc;
    // Fall through to "first user" — covers stale handles during transitions.
  }
  const all = listUserYamls(orgSlug, workspace);
  return all[0] ?? null;
}

function readHandoffSlice(
  workspace: string,
  orgSlug: string,
  workflowId: string | undefined,
): { content: string; sources: string[] } {
  if (!workflowId) return { content: "", sources: [] };
  const handoff = path.join(
    getOrgDir(orgSlug, workspace),
    "workflows",
    workflowId,
    "_handoff.md",
  );
  const content = safeReadFile(handoff);
  if (content === null) return { content: "", sources: [] };
  return { content, sources: [handoff] };
}

function readRepoContext(
  workspace: string,
  orgSlug: string,
  repoSlug: string | undefined,
): { content: string; sources: string[] } {
  if (!repoSlug) return { content: "", sources: [] };
  const repoDir = getRepoDir(orgSlug, repoSlug, workspace);
  const out: string[] = [];
  const sources: string[] = [];

  for (const file of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    const fpath = path.join(repoDir, file);
    const content = safeReadFile(fpath);
    if (content !== null) {
      out.push(`<!-- ${file} -->\n${content}`);
      sources.push(fpath);
    }
  }

  return { content: out.join("\n\n"), sources };
}

interface SpawnDecision {
  ts: string;
  event_type: "spawn_decision";
  agent: string;
  org: string;
  truncated: string[];
  total_tokens: number;
  max_tokens: number;
}

function appendDecision(
  workspace: string,
  orgSlug: string,
  decision: SpawnDecision,
  dryRun: boolean,
): void {
  if (dryRun) return;
  if (decision.truncated.length === 0) return;
  const file = path.join(
    getOrgDir(orgSlug, workspace),
    "memory",
    "spawn-decisions.jsonl",
  );
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(decision) + "\n", "utf-8");
  } catch {
    // Decision logging is best-effort — never abort a spawn because the log
    // could not be written.
  }
}

/**
 * Drop layers until total tokens fits within the cap.
 *
 * Drop order — *ascending priority* — follows the §2.2 table:
 *   1. repo-context
 *   2. workspace-knowledge   (low keyword hits / 0 only)
 *   3. org-domain            (low keyword hits)
 *   4. team-knowledge        (low keyword hits)
 *   5. handoff               (oldest, but we only carry 1 slice)
 * Required (never dropped):
 *   - agent-skill, org-core, agent-profile
 */
function applyDropPolicy(
  layers: Layer[],
  maxTokens: number,
  keywords: Set<string>,
): { kept: Layer[]; truncated: string[] } {
  const dropOrder: LayerKind[] = [
    "repo-context",
    "workspace-knowledge",
    "org-domain",
    "team-knowledge",
    "handoff",
  ];
  const required: ReadonlySet<LayerKind> = new Set([
    "agent-skill",
    "org-core",
    "agent-profile",
  ]);

  let total = layers.reduce((acc, l) => acc + l.tokens, 0);
  const truncated: string[] = [];
  const kept = [...layers];

  for (const kind of dropOrder) {
    if (total <= maxTokens) break;
    // Find candidates of this kind, lowest keyword match first.
    const candidates = kept
      .map((l, idx) => ({ idx, layer: l }))
      .filter(({ layer }) => layer.kind === kind);

    // For workspace/team/org-domain, prefer the one with the *fewest* hits.
    candidates.sort((a, b) => {
      const ah = countKeywordHits(a.layer.content, keywords);
      const bh = countKeywordHits(b.layer.content, keywords);
      return ah - bh;
    });

    for (const { idx, layer } of candidates) {
      if (total <= maxTokens) break;
      if (required.has(layer.kind)) continue;
      kept[idx] = { ...layer, content: "", sources: [], tokens: 0 };
      total -= layer.tokens;
      truncated.push(layer.label);
    }
  }

  return {
    kept: kept.filter((l) => l.tokens > 0 || required.has(l.kind)),
    truncated,
  };
}

export function assembleSpawnContext(
  input: AssembleSpawnContextInput,
): AssembledContext {
  const charsPerToken = input.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const maxTokens =
    input.maxContextTokens ??
    input.workspaceYaml?.spawn?.max_context_tokens ??
    DEFAULT_SPAWN_MAX_CONTEXT_TOKENS;

  const keywords = tokenizeQuery(input.query);

  const layers: Layer[] = [];

  // [1] Workspace knowledge — selective by keyword.
  const knowledgeDir = getKnowledgeDir(input.workspace);
  const knowledgeFiles = readDirWithKeywordScore(knowledgeDir, keywords);
  // If we have any query keywords, drop zero-hit files at *gather* time so
  // they don't even enter the cap calculation. If query is empty, keep them
  // all — assembler caller may have no task description yet.
  const knowledgeKept =
    keywords.size > 0
      ? knowledgeFiles.filter((f) => f.hits > 0)
      : knowledgeFiles;
  const knowledgeContent = knowledgeKept
    .map((f) => `<!-- ${path.basename(f.file)} -->\n${f.content}`)
    .join("\n\n");
  layers.push({
    index: 1,
    kind: "workspace-knowledge",
    label: "[1] workspace knowledge",
    content: knowledgeContent,
    sources: knowledgeKept.map((f) => f.file),
    tokens: estimateTokens(knowledgeContent, charsPerToken),
  });

  // [2] Team KNOWLEDGE.md — only when the agent's own team has one.
  const agentsRoot = getAgentsDir();
  const teamKnowledgePath = path.join(
    agentsRoot,
    input.agentRef.team,
    "KNOWLEDGE.md",
  );
  const teamKnowledgeContent = safeReadFile(teamKnowledgePath) ?? "";
  layers.push({
    index: 2,
    kind: "team-knowledge",
    label: `[2] team knowledge (${input.agentRef.team})`,
    content: teamKnowledgeContent,
    sources: teamKnowledgeContent ? [teamKnowledgePath] : [],
    tokens: estimateTokens(teamKnowledgeContent, charsPerToken),
  });

  // [3] Agent SKILL — identity, REQUIRED.
  const skillPath = path.join(
    agentsRoot,
    input.agentRef.team,
    input.agentRef.name,
    "SKILL.md",
  );
  const skillContent = safeReadFile(skillPath) ?? "";
  layers.push({
    index: 3,
    kind: "agent-skill",
    label: `[3] agent SKILL (${input.agentRef.name})`,
    content: skillContent,
    sources: skillContent ? [skillPath] : [],
    tokens: estimateTokens(skillContent, charsPerToken),
  });

  // [4] Org core — PRINCIPLES + VOICE.
  const orgDir = getOrgDir(input.orgSlug, input.workspace);
  const corePieces: string[] = [];
  const coreSources: string[] = [];
  for (const fname of ["PRINCIPLES.md", "VOICE.md"]) {
    const fpath = path.join(orgDir, "core", fname);
    const content = safeReadFile(fpath);
    if (content !== null && content.trim().length > 0) {
      corePieces.push(`<!-- ${fname} -->\n${content}`);
      coreSources.push(fpath);
    }
  }
  const coreContent = corePieces.join("\n\n");
  layers.push({
    index: 4,
    kind: "org-core",
    label: "[4] org core (PRINCIPLES + VOICE)",
    content: coreContent,
    sources: coreSources,
    tokens: estimateTokens(coreContent, charsPerToken),
  });

  // [5] agent-profile.yaml — defaults + this agent's section + (v0.8) the
  // requesting user's yaml so specialists know whose command they're running.
  const profile =
    input.agentProfile ??
    loadAgentProfile({
      workspace: input.workspace,
      orgSlug: input.orgSlug,
    });
  const userYaml = resolveUserYamlForSpawn(
    input.workspace,
    input.orgSlug,
    input.userHandle,
  );
  const profileSummary = summarizeAgentProfile(
    profile,
    input.agentRef.name,
    userYaml,
  );
  const profileSources: string[] = [];
  const profileFile = path.join(orgDir, "agent-profile.yaml");
  if (fs.existsSync(profileFile)) profileSources.push(profileFile);
  if (userYaml) {
    profileSources.push(userYamlPath(input.orgSlug, userYaml.handle, input.workspace));
  }
  layers.push({
    index: 5,
    kind: "agent-profile",
    label: "[5] agent-profile",
    content: profileSummary.content,
    sources: profileSources,
    tokens: estimateTokens(profileSummary.content, charsPerToken),
  });

  // [6] Org domain — selective by keyword.
  const domainDir = path.join(orgDir, "domain");
  const domainFiles = readDirWithKeywordScore(domainDir, keywords);
  const domainKept =
    keywords.size > 0
      ? domainFiles.filter((f) => f.hits > 0)
      : domainFiles;
  const domainContent = domainKept
    .map((f) => `<!-- ${path.basename(f.file)} -->\n${f.content}`)
    .join("\n\n");
  layers.push({
    index: 6,
    kind: "org-domain",
    label: "[6] org domain",
    content: domainContent,
    sources: domainKept.map((f) => f.file),
    tokens: estimateTokens(domainContent, charsPerToken),
  });

  // [7] Handoff slice + memory snapshot.
  const handoff = readHandoffSlice(input.workspace, input.orgSlug, input.workflowId);
  layers.push({
    index: 7,
    kind: "handoff",
    label: "[7] handoff slice",
    content: handoff.content,
    sources: handoff.sources,
    tokens: estimateTokens(handoff.content, charsPerToken),
  });

  // [8] Target repo context.
  const repoCtx = readRepoContext(input.workspace, input.orgSlug, input.repoSlug);
  layers.push({
    index: 8,
    kind: "repo-context",
    label: "[8] target repo context",
    content: repoCtx.content,
    sources: repoCtx.sources,
    tokens: estimateTokens(repoCtx.content, charsPerToken),
  });

  // Apply drop policy until total ≤ max.
  const { kept, truncated } = applyDropPolicy(layers, maxTokens, keywords);
  const totalTokens = kept.reduce((acc, l) => acc + l.tokens, 0);

  if (truncated.length > 0) {
    const decision: SpawnDecision = {
      ts: (input.now ?? new Date()).toISOString(),
      event_type: "spawn_decision",
      agent: input.agentRef.name,
      org: input.orgSlug,
      truncated,
      total_tokens: totalTokens,
      max_tokens: maxTokens,
    };
    appendDecision(input.workspace, input.orgSlug, decision, input.dryRun ?? false);
  }

  return {
    layers: kept,
    truncated,
    totalTokens,
    maxTokens,
  };
}

/* -------------------------------------------------------------------------- */
/* v0.8.2 — Dev-capability permission resolution                              */
/* -------------------------------------------------------------------------- */

/**
 * v0.8.2 §4.1 — runtime tool / bash policy attached to a spawn.
 *
 * The factory contract in `claude-process.ts` is intentionally permissive:
 * we resolve a policy here, the claude-process layer enforces it (allow-list
 * for `--allowed-tools`, then a pre-check wrap around any Bash invocation).
 *
 * Fields:
 *   - `allowedTools` / `disallowedTools` → fed to Claude Code's
 *     `--allowed-tools` / `--disallowed-tools` flags.
 *   - `bashAllowlist` — array of *leading-token* matches (e.g. `"git"`,
 *     `"gh pr create"`, `"npm test"`). A bash command is permitted iff at
 *     least one entry is a prefix of it.
 *   - `bashDenylist` — workspace-strict denylist. Merged on top of the SKILL's
 *     own denied list. A bash command is *always* rejected if any entry is a
 *     substring of it.
 *   - `requirePushConfirmation` — true means `git push` / `gh pr merge` /
 *     `gh pr close` must funnel through `dev-confirm.ts`.
 *   - `networkAllowed` — when false, the bash pre-check rejects `curl`/`wget`
 *     unless the call is to an explicit MCP-server target. v0.8.2 1차에서는
 *     단순히 `curl http*` / `wget http*` 패턴을 denylist에 추가하는 식으로 구현.
 */
export interface SpawnDevPolicy {
  allowedTools: string[];
  disallowedTools: string[];
  bashAllowlist: string[];
  bashDenylist: string[];
  requirePushConfirmation: boolean;
  networkAllowed: boolean;
  /** Why the spawn ended up in this mode — useful for logging + tests. */
  reason: "read-only" | "dev-enabled" | "workspace-disabled";
}

export const READ_ONLY_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
];
export const READ_ONLY_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "Edit",
  "Write",
];
export const DEV_ENABLED_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash",
];

/**
 * Minimal subset of a SKILL.md frontmatter that this function needs. The full
 * `SkillSpec` from `skill-parser.ts` is structurally compatible — pass it
 * directly. (Tests can hand-roll the shape.)
 */
export interface DevCapabilitySkillView {
  frontmatter?: Pick<SkillSpec, "dev_capability" | "dev_permissions">;
  /** Backwards-compatible alternative — top-level fields if the caller has
   *  already destructured a parsed SkillSpec. */
  dev_capability?: SkillSpec["dev_capability"];
  dev_permissions?: SkillSpec["dev_permissions"];
}

/**
 * Resolve the SpawnDevPolicy for a SKILL given the workspace.yaml master
 * toggle + the SKILL's own dev_capability declaration.
 *
 * Layer-5 (user yaml) override hook is intentionally not implemented here —
 * v0.8.0 owns the per-user budget/identity injection, and this function only
 * deals with global dev_capability gating. When v0.8.0 lands, the caller can
 * post-process the returned policy.
 */
export function applyDevPermissions(
  skill: DevCapabilitySkillView,
  workspaceYaml: WorkspaceYaml | DevCapabilityConfig | null | undefined,
): SpawnDevPolicy {
  // Two acceptable input shapes for the workspace arg:
  //   - WorkspaceYaml (we extract .dev_capability)
  //   - DevCapabilityConfig already (or null)
  let raw: DevCapabilityConfig | undefined;
  if (workspaceYaml && typeof workspaceYaml === "object") {
    if ("dev_capability" in workspaceYaml && (workspaceYaml as WorkspaceYaml).dev_capability) {
      raw = (workspaceYaml as WorkspaceYaml).dev_capability;
    } else if (
      "enabled" in workspaceYaml ||
      "bash_denylist" in workspaceYaml ||
      "require_push_confirmation" in workspaceYaml
    ) {
      raw = workspaceYaml as DevCapabilityConfig;
    }
  }
  const wsCfg = resolveDevCapabilityConfig(raw);

  const skillCap =
    skill.frontmatter?.dev_capability ?? skill.dev_capability ?? false;
  const skillPerms = skill.frontmatter?.dev_permissions ?? skill.dev_permissions;

  // Master toggle off — everyone read-only.
  if (!wsCfg.enabled) {
    return {
      allowedTools: [...READ_ONLY_ALLOWED_TOOLS],
      disallowedTools: [...READ_ONLY_DISALLOWED_TOOLS],
      bashAllowlist: [],
      bashDenylist: wsCfg.bash_denylist.slice(),
      requirePushConfirmation: true,
      networkAllowed: false,
      reason: "workspace-disabled",
    };
  }

  // SKILL didn't opt in — read-only.
  if (skillCap !== true) {
    return {
      allowedTools: [...READ_ONLY_ALLOWED_TOOLS],
      disallowedTools: [...READ_ONLY_DISALLOWED_TOOLS],
      bashAllowlist: [],
      bashDenylist: wsCfg.bash_denylist.slice(),
      requirePushConfirmation: true,
      networkAllowed: false,
      reason: "read-only",
    };
  }

  // dev_capability path — merge workspace denylist on top.
  const skillAllowed = skillPerms?.bash?.allowed ?? [];
  const skillDenied = skillPerms?.bash?.denied ?? [];
  // Workspace denylist is the strict layer — duplicates are harmless but we
  // keep a stable de-duped order (workspace first, then SKILL extras).
  const seen = new Set<string>();
  const denylist: string[] = [];
  for (const item of wsCfg.bash_denylist) {
    if (!seen.has(item)) {
      seen.add(item);
      denylist.push(item);
    }
  }
  for (const item of skillDenied) {
    if (!seen.has(item)) {
      seen.add(item);
      denylist.push(item);
    }
  }

  return {
    allowedTools: [...DEV_ENABLED_ALLOWED_TOOLS],
    disallowedTools: [],
    bashAllowlist: skillAllowed.slice(),
    bashDenylist: denylist,
    // wsCfg.require_push_confirmation is always true (loader normalizes), but
    // a SKILL may set `requires_confirmation: false` only when the workspace
    // *also* tolerates it. Our workspace loader pins true, so this is true.
    requirePushConfirmation:
      skillPerms?.push_targets?.requires_confirmation ??
      wsCfg.require_push_confirmation,
    networkAllowed: skillPerms?.network ?? false,
    reason: "dev-enabled",
  };
}
