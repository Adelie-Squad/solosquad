import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  getAgentsDir,
  getEnvPath,
  getProductsFile,
  getSolosquadConfigDir,
  getWorkspaceRoot,
  getWorkspaceYamlPath,
} from "./paths.js";
import { normalizeLine } from "./platform.js";

export interface Product {
  name: string;
  slug: string;
  github_org?: string;
}

export interface BriefingConfig {
  time: string; // "HH:MM" in workspace timezone
  enabled?: boolean;
}

export interface WeeklyRoutineConfig {
  day: string; // lowercase day name: sunday, monday, ...
  time: string;
  enabled?: boolean;
}

export interface GoalConfig {
  /** v0.4.0 — autonomous engine defaults. */
  default_hours?: number;
  default_budget_usd?: number;
  dedicated_session_prefix?: string;
}

/**
 * Chief session configuration. v1.2.10 renamed the TS type `PmConfig` →
 * `ChiefConfig` to match the Chief rebrand. The `workspace.yaml` property key
 * stays `pm` (see {@link WorkspaceYaml.pm}) — it's a persisted contract across
 * every existing workspace, so renaming the key is deferred to a dedicated
 * migration (docs/prd/v1.2.10-consolidation-cleanup.md §A.3).
 */
export interface ChiefConfig {
  /** Cap per claude --print call. Workspace default. */
  max_budget_usd?: number;
  /** Hard timeout per Chief invocation. */
  invoke_timeout_seconds?: number;
  /** Real-time partial reply streaming (--include-partial-messages). */
  include_partial_messages?: boolean;
  /** Cross-call prompt-cache friendliness (--exclude-dynamic-system-prompt-sections). */
  exclude_dynamic_system_prompt_sections?: boolean;
  /** Per-session in-process mutex queue depth (chief-runner). */
  mutex_queue_depth?: number;
  /** v0.3.0+: daily compaction-routine trigger time (HH:MM). */
  compaction_time?: string;
  /** v1.3.0 Part A: git push approval-gate policy. */
  git?: ChiefGitConfig;
}

/**
 * v1.3.0 Part A — git push approval-gate policy. Lives under `pm.git` in
 * workspace.yaml (the `pm` key is the persisted Chief-config contract, kept for
 * back-compat per v1.2.10 §4.2). Read at spawn time by the dev-confirm hook
 * (via env) and the bridge.
 */
export interface ChiefGitConfig {
  /**
   * Branches that may NEVER be pushed to directly — the hook blocks these
   * before the approval flow even starts (fail-closed, regardless of hook
   * error policy). Default `["main", "master", "develop"]`.
   */
  protected_branches?: string[];
  /**
   * When true, only feature branches reach the approval card; protected
   * branches are auto-blocked. Default true. (When false the protected list is
   * still honored, but the gate is otherwise advisory — reserved for future
   * relaxation; the hook treats it as true today.)
   */
  require_feature_branch?: boolean;
  /** Minutes the approval card waits before timing out (= block). Default 30. */
  approval_timeout_minutes?: number;
}

export interface WorkspaceYaml {
  version: string;
  display_name: string;
  persona?: string;
  /** IANA timezone (e.g. "Asia/Seoul"). v0.2.4+. Defaults applied at load time. */
  timezone?: string;
  /** v0.2.4+: user-facing daily briefs. */
  briefings?: {
    morning?: BriefingConfig;
    evening?: BriefingConfig;
  };
  /** v0.2.4+: background routines that feed into the briefs. */
  background_routines?: {
    signal_scan?: BriefingConfig;
    experiment_check?: BriefingConfig;
    weekly_review?: WeeklyRoutineConfig;
  };
  /**
   * v0.3.0+: Chief session configuration. Property key kept as `pm` for
   * back-compat with existing workspace.yaml files (v1.2.10 §4.2/§7).
   */
  pm?: ChiefConfig;
  /** v0.4.0+: autonomous goal engine configuration. */
  goal?: GoalConfig;
  /** v0.5.0+: 3-tier skill loader ordering. */
  skill_loader?: SkillLoaderConfig;
  /** v0.5.0+: author-loop budget envelope. */
  author?: AuthorConfig;
  /** v0.6.0+: spawn-assembler token cap (§2.2 P1 #4). */
  spawn?: SpawnConfig;
  /** v0.6.0+: FTS5 cold archive retention + compression (§4.7). */
  archive?: ArchiveConfig;
  /** v0.6.0+: fs.watch external-edit reload policy (§10.5). */
  fs_watch?: FsWatchConfig;
  /** v0.6.0+: migration budget cap (§2.2 P0 #2). */
  migration?: MigrationBudgetConfig;
  /** v0.8.2+: workspace-wide dev_capability master toggle + bash denylist. */
  dev_capability?: DevCapabilityConfig;
  /** v1.2.0+: messenger-wide policies (owner-only gate, install mode, thread budget). */
  messenger?: MessengerWorkspaceConfig;
  created_at: string;
  last_migrated_to?: string;
}

/**
 * v0.8 §3.6 (broadcast fields) + v1.2 §13.3 (discord/slack subsections) —
 * Workspace-level messenger policies. Per-org / per-guild binding still
 * lives at `<org>/<platform>/config.yaml` (v0.2.2+); this section is for
 * policies that apply across every adapter instance.
 */
export interface MessengerWorkspaceConfig {
  /** v0.8 §3.6 — broadcast channel opt-in (single designated owner bot). */
  broadcast_enabled?: boolean;
  broadcast_owner_handle?: string | null;
  broadcast_channel?: string;
  /** v1.2 §4.5 / §3 / §9.2 — Discord-specific policies. */
  discord?: DiscordWorkspaceConfig;
  /** v1.2.x — Slack-specific policies (mirror of discord). */
  slack?: SlackWorkspaceConfig;
}

export interface DiscordWorkspaceConfig {
  /**
   * v1.2 §4.5 — When `true` (fresh install default), Chief only processes
   * messages whose `author.id === user.yaml.messenger_user_id`. v1.0.x
   * upgrades land with `false` (preserves v1.0.2 channel-ACL-only behavior).
   */
  owner_only?: boolean;
  /**
   * v1.2 §3 — `oauth_invite` (default fresh install) auto-synthesizes the
   * invite URL via `solosquad discord invite-url`. `byo_manual` skips URL
   * synthesis — user pastes their own. Migration defaults existing users
   * to `byo_manual` (their current flow).
   */
  install_mode?: "oauth_invite" | "byo_manual";
  /**
   * v1.2 §9.2 — Token budget per workflow thread. Once exceeded, Chief
   * prompts the user to start a fresh thread with a summary link back.
   */
  thread_token_budget?: number;
}

export interface SlackWorkspaceConfig {
  owner_only?: boolean;
}

export const DEFAULT_DISCORD_WORKSPACE_CONFIG: Required<
  Pick<DiscordWorkspaceConfig, "owner_only" | "install_mode" | "thread_token_budget">
> = {
  owner_only: true,
  install_mode: "oauth_invite",
  thread_token_budget: 80_000,
};

/**
 * Resolve Discord workspace config — fresh-install defaults from
 * DEFAULT_DISCORD_WORKSPACE_CONFIG. Migrations write explicit values for
 * upgraded workspaces so the resolver never has to guess based on workspace
 * age.
 */
export function loadDiscordWorkspaceConfig(
  workspace?: string,
): Required<Pick<DiscordWorkspaceConfig, "owner_only" | "install_mode" | "thread_token_budget">> {
  const ws = loadWorkspaceYaml(workspace);
  const partial = ws?.messenger?.discord ?? {};
  return {
    owner_only: partial.owner_only ?? DEFAULT_DISCORD_WORKSPACE_CONFIG.owner_only,
    install_mode: partial.install_mode ?? DEFAULT_DISCORD_WORKSPACE_CONFIG.install_mode,
    thread_token_budget:
      partial.thread_token_budget ?? DEFAULT_DISCORD_WORKSPACE_CONFIG.thread_token_budget,
  };
}

/**
 * v0.8.2 §3.3 — workspace-level master toggle for engineering dev actions.
 *
 * - `enabled` (default `true`): when `false`, every SKILL is forced into
 *   read-only mode regardless of its frontmatter `dev_capability: true`. Used
 *   for sandbox / client-confidential repos / emergency-stop.
 * - `require_push_confirmation` (default `true`, always `true` — the schema
 *   accepts `false` but the loader rejects it): every `git push` / `gh pr
 *   merge` / `gh pr close` waits for a user confirmation event before the
 *   bash invocation runs.
 * - `bash_denylist`: workspace-strict denylist. SKILLs cannot override it —
 *   merged on top of any per-SKILL `dev_permissions.bash.denied`.
 */
export interface DevCapabilityConfig {
  enabled?: boolean;
  require_push_confirmation?: boolean;
  bash_denylist?: string[];
}

export const DEFAULT_DEV_CAPABILITY_DENYLIST: readonly string[] = [
  "rm -rf /",
  "rm -rf /*",
  "sudo",
  "chmod 777",
  "mkfs",
  "dd if=",
  ":(){:|:&};:",
];

export const DEFAULT_DEV_CAPABILITY_CONFIG: Required<DevCapabilityConfig> = {
  enabled: true,
  require_push_confirmation: true,
  bash_denylist: [...DEFAULT_DEV_CAPABILITY_DENYLIST],
};

/**
 * Resolve dev_capability config — applies v0.8.2 defaults when workspace.yaml
 * is absent or lacks a `dev_capability` section. `require_push_confirmation`
 * is normalized to `true` (false is rejected per §3.3 박제 정책 — always true).
 */
export function loadDevCapabilityConfig(
  workspace?: string,
): Required<DevCapabilityConfig> {
  const ws = loadWorkspaceYaml(workspace);
  return resolveDevCapabilityConfig(ws?.dev_capability);
}

/** Pure resolver — exposed for spawn-assembler hot-path (avoid re-reading yaml). */
export function resolveDevCapabilityConfig(
  partial: DevCapabilityConfig | undefined,
): Required<DevCapabilityConfig> {
  const p = partial ?? {};
  const denylist =
    Array.isArray(p.bash_denylist) && p.bash_denylist.length > 0
      ? p.bash_denylist.slice()
      : [...DEFAULT_DEV_CAPABILITY_DENYLIST];
  return {
    enabled: p.enabled ?? DEFAULT_DEV_CAPABILITY_CONFIG.enabled,
    // §3.3 박제: require_push_confirmation: false 거부 — 항상 true.
    require_push_confirmation: true,
    bash_denylist: denylist,
  };
}

/** v1.2.9 §E — read the dev-capability master toggle (default ON). */
export function isDevCapabilityEnabled(workspace?: string): boolean {
  return loadDevCapabilityConfig(workspace).enabled;
}

/** v1.3.0 Part A — protected branches the push gate never lets through. */
export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = [
  "main",
  "master",
  "develop",
];

export const DEFAULT_CHIEF_GIT_CONFIG: Required<ChiefGitConfig> = {
  protected_branches: [...DEFAULT_PROTECTED_BRANCHES],
  require_feature_branch: true,
  approval_timeout_minutes: 30,
};

/**
 * v1.3.0 Part A — resolve the git push approval-gate policy from
 * `workspace.yaml.pm.git`, applying defaults when absent. Used by the
 * dev-confirm bridge + hook (the hook receives the resolved values via spawn
 * env, so it never re-reads yaml on its hot path).
 */
export function loadChiefGitConfig(
  workspace?: string,
): Required<ChiefGitConfig> {
  const ws = loadWorkspaceYaml(workspace);
  return resolveChiefGitConfig(ws?.pm?.git);
}

/** Pure resolver — exposed so callers can resolve without re-reading yaml. */
export function resolveChiefGitConfig(
  partial: ChiefGitConfig | undefined,
): Required<ChiefGitConfig> {
  const p = partial ?? {};
  const protectedBranches =
    Array.isArray(p.protected_branches) && p.protected_branches.length > 0
      ? p.protected_branches.slice()
      : [...DEFAULT_PROTECTED_BRANCHES];
  return {
    protected_branches: protectedBranches,
    require_feature_branch:
      p.require_feature_branch ?? DEFAULT_CHIEF_GIT_CONFIG.require_feature_branch,
    approval_timeout_minutes:
      typeof p.approval_timeout_minutes === "number" &&
      p.approval_timeout_minutes > 0
        ? p.approval_timeout_minutes
        : DEFAULT_CHIEF_GIT_CONFIG.approval_timeout_minutes,
  };
}

/**
 * v1.2.9 §E — flip the dev-capability master toggle in workspace.yaml and
 * persist it. Returns the PREVIOUS value (so callers can report "already on").
 * Backs the `/grant` (enabled=true) and `/revoke` (enabled=false) commands.
 */
export function setDevCapabilityEnabled(
  enabled: boolean,
  workspace?: string,
): boolean {
  const ws = loadWorkspaceYaml(workspace);
  if (!ws) throw new Error("workspace.yaml not found");
  const prev = resolveDevCapabilityConfig(ws.dev_capability).enabled;
  ws.dev_capability = { ...(ws.dev_capability ?? {}), enabled };
  saveWorkspaceYaml(ws, workspace);
  return prev;
}

/**
 * v0.6 §10.5 — fs.watch reload policy. The watcher itself lives in v0.6 S6.A
 * (`src/bot/fs-watcher.ts` / `reload-policy.ts`); the migration only ensures
 * the workspace.yaml exposes the defaults so the watcher boots without
 * extra prompts on first run.
 */
export interface FsWatchConfig {
  mode?: "auto" | "prompt" | "manual";
  git_only?: boolean;
}

export const DEFAULT_FS_WATCH_CONFIG: Required<FsWatchConfig> = {
  mode: "prompt",
  git_only: false,
};

/**
 * Resolve fs-watch config — falls back to v0.6 defaults when workspace.yaml
 * is absent or lacks an `fs_watch` section. The reload-policy module reads
 * this to decide auto/prompt/manual behavior on each fs-watcher event.
 */
export function loadFsWatchConfig(workspace?: string): Required<FsWatchConfig> {
  const ws = loadWorkspaceYaml(workspace);
  const partial = ws?.fs_watch ?? {};
  return {
    mode: partial.mode ?? DEFAULT_FS_WATCH_CONFIG.mode,
    git_only: partial.git_only ?? DEFAULT_FS_WATCH_CONFIG.git_only,
  };
}

/**
 * v0.6 §2.2 P0 #2 — migration budget cap. `budget_usd` is the hard ceiling
 * for *one* `solosquad migrate --apply` invocation. The 0.5.0→0.6.0 step is
 * the first migration to honor it; LLM fallback for ledger redestination
 * checks `recordAuthorCost`-style cumulative spend against this cap and
 * stops rather than ballooning past it.
 */
export interface MigrationBudgetConfig {
  budget_usd?: number;
}

export const DEFAULT_MIGRATION_BUDGET_USD = 5;

/**
 * v0.6 §2.2 P1 #4 — 8-layer spawn context cap.
 *
 * When the assembled context approaches the model token limit, the assembler
 * drops lower-priority layers in the order documented in
 * `src/bot/spawn-assembler.ts`. Default 80,000 tokens — leaves headroom
 * inside Claude Sonnet/Opus 200k context for the actual conversation.
 */
export interface SpawnConfig {
  max_context_tokens?: number;
}

export const DEFAULT_SPAWN_MAX_CONTEXT_TOKENS = 80_000;

export interface SkillLoaderConfig {
  /** Tier ordering — higher index = higher priority. v0.5 default: [org, user, bundle]. */
  tiers: ("org" | "user" | "bundle")[];
}

export interface AuthorConfig {
  budget?: {
    daily_usd?: number;
    weekly_usd?: number;
    per_call_usd?: number;
  };
  /** What to do when a cap is hit. v0.5 default: "pause". */
  on_cap_action?: "pause" | "warn" | "block";
}

export interface ArchiveConfig {
  /**
   * v0.6 §4.7 — rows older than this in archive.sqlite are deleted by the
   * nightly retention pass. Default 365.
   */
  retention_days?: number;
  /**
   * v0.6 §4.7 — when true, the retention pass writes
   * `archive-<YYYY-MM>.zst` snapshots before DELETE; default false.
   */
  compress_before_delete?: boolean;
}

export const DEFAULT_ARCHIVE_CONFIG: Required<ArchiveConfig> = {
  retention_days: 365,
  compress_before_delete: false,
};

/**
 * Resolve archive config — falls back to the v0.6 defaults when
 * workspace.yaml is absent or lacks an `archive` section.
 */
export function loadArchiveConfig(workspace?: string): Required<ArchiveConfig> {
  const ws = loadWorkspaceYaml(workspace);
  const partial = ws?.archive ?? {};
  return {
    retention_days: partial.retention_days ?? DEFAULT_ARCHIVE_CONFIG.retention_days,
    compress_before_delete:
      partial.compress_before_delete ?? DEFAULT_ARCHIVE_CONFIG.compress_before_delete,
  };
}

/** v0.2.4 defaults — used both at init and as fallbacks when fields are missing. */
export const DEFAULT_WORKSPACE_SETTINGS = {
  timezone: "Asia/Seoul",
  briefings: {
    morning: { time: "08:00", enabled: true },
    evening: { time: "18:00", enabled: true },
  },
  /**
   * @deprecated v0.8.5 — `signal-scan`, `experiment-check`, `weekly-review`
   * routines were removed from the live scheduler. This constant is preserved
   * solely so the historical `0.2.1-to-0.2.4.ts` migration script (immutable
   * per AGENTS.md) continues to compile and reproduce the schema state it was
   * written for. `init.ts` no longer writes these defaults, and
   * `applyWorkspaceDefaults` no longer injects them at load time.
   */
  background_routines: {
    signal_scan: { time: "12:00", enabled: true },
    experiment_check: { time: "16:00", enabled: true },
    weekly_review: { day: "sunday", time: "20:00", enabled: true },
  },
  /** v0.3.0 (PM mode) defaults; compaction_time added in v0.3.0. */
  pm: {
    max_budget_usd: 5,
    invoke_timeout_seconds: 300,
    include_partial_messages: true,
    exclude_dynamic_system_prompt_sections: true,
    mutex_queue_depth: 4,
    compaction_time: "23:00",
  },
} as const;

/** Merge a partial WorkspaceYaml with defaults for v0.2.4+ fields. */
export function applyWorkspaceDefaults(ws: WorkspaceYaml): WorkspaceYaml {
  return {
    ...ws,
    timezone: ws.timezone ?? DEFAULT_WORKSPACE_SETTINGS.timezone,
    briefings: {
      morning: { ...DEFAULT_WORKSPACE_SETTINGS.briefings.morning, ...(ws.briefings?.morning ?? {}) },
      evening: { ...DEFAULT_WORKSPACE_SETTINGS.briefings.evening, ...(ws.briefings?.evening ?? {}) },
    },
    // v0.8.5 — background_routines is no longer defaulted at load time.
    // Pre-existing keys on the loaded yaml are passed through untouched (the
    // scheduler ignores them), so older workspaces don't lose data.
    background_routines: ws.background_routines,
    pm: { ...DEFAULT_WORKSPACE_SETTINGS.pm, ...(ws.pm ?? {}) },
  };
}

export interface OrgProduct {
  name: string;
  slug: string;
  description?: string;
  repos?: string[];
}

export interface OrgYaml {
  name: string;
  slug: string;
  provider: "github" | "gitlab" | "gitea" | "local";
  remote_url?: string | null;
  homepage?: string | null;
  products?: OrgProduct[];
  description?: string;
  /**
   * v1.2 §4.1 — org-level Chief display name (e.g. "Hermes", "Atlas").
   * One Chief per org; init/add-org prompts for it and recommends the same
   * string for the Discord Developer Portal Bot name. Missing → runtime
   * falls back to the literal "Chief".
   */
  chief_name?: string;
  created_at: string;
}

export interface RepoYaml {
  slug: string;
  name: string;
  /**
   * @deprecated v1.0.1 — repo `role` field is no longer prompted at
   * registration or read for routing. Existing yamls keep the value for
   * backward compat; new yamls default to "main" silently. Multi-repo
   * intent resolution is now handled by (a) `@<slug>` mention syntax in
   * user messages (`src/bot/mention-parser.ts`), (b) PM clarifying
   * question when ambiguous, (c) workflow stage `target_repo` for
   * explicit declaration. Hard removal scheduled for v2.0 per
   * `docs/api-stability.md` schema read-window policy.
   */
  role: "main" | "frontend" | "backend" | "data" | "infra" | "docs" | "unknown";
  language?: string;
  linked_org: string;
  remote_url?: string | null;
  products?: string[];
  notes?: string;
  registered_at: string;
  /**
   * v0.9.1 — path-reference mode (workspace ↔ repo 관계 재설계).
   * When set, the workspace's `<workspace>/<org>/repositories/<slug>/` tree
   * does not exist (or is empty) — the actual repo lives at this absolute
   * path on disk. The agent's spawn cwd resolves to this path via
   * `src/util/paths.ts:resolveRepoCwd`.
   *
   * Backward-compat: when omitted, behavior falls back to the legacy
   * `<workspace>/<org>/repositories/<slug>/` tree (move/copy modes from v0.8.x).
   *
   * Documented: docs/plan/v0.9.1-workspace-repo-relationship.md §7 (path-reference
   * is the v0.9+ default; legacy tree stays permanently supported).
   */
  path?: string;
}

/* -------------------------------------------------------------------------- */
/* .env                                                                        */
/* -------------------------------------------------------------------------- */

function resolveEnvFile(dir?: string): string {
  if (dir) {
    // Caller-specified dir — prefer .solosquad/.env, then root .env
    const inSolosquad = path.join(dir, ".solosquad", ".env");
    if (fs.existsSync(inSolosquad)) return inSolosquad;
    return path.join(dir, ".env");
  }
  const solosquad = getEnvPath();
  if (fs.existsSync(solosquad)) return solosquad;
  return path.join(getWorkspaceRoot(), ".env");
}

export function loadEnv(dir?: string): Record<string, string> {
  const envFile = resolveEnvFile(dir);
  const env: Record<string, string> = {};
  if (!fs.existsSync(envFile)) return env;

  for (const line of normalizeLine(fs.readFileSync(envFile, "utf-8")).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

export function saveEnv(updates: Record<string, string>, dir?: string): void {
  const envFile = resolveEnvFile(dir);
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  const remaining = { ...updates };
  const lines: string[] = [];

  if (fs.existsSync(envFile)) {
    for (const line of normalizeLine(fs.readFileSync(envFile, "utf-8")).split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
        if (key in remaining) {
          lines.push(`${key}=${remaining[key]}`);
          delete remaining[key];
        } else {
          lines.push(line);
        }
      } else {
        lines.push(line);
      }
    }
  }

  for (const [k, v] of Object.entries(remaining)) {
    lines.push(`${k}=${v}`);
  }

  fs.writeFileSync(envFile, lines.join("\n") + "\n");
}

/* -------------------------------------------------------------------------- */
/* workspace.yaml                                                              */
/* -------------------------------------------------------------------------- */

export function loadWorkspaceYaml(workspace?: string): WorkspaceYaml | null {
  const file = getWorkspaceYamlPath(workspace);
  if (!fs.existsSync(file)) return null;
  try {
    return yaml.load(normalizeLine(fs.readFileSync(file, "utf-8"))) as WorkspaceYaml;
  } catch {
    return null;
  }
}

export function saveWorkspaceYaml(doc: WorkspaceYaml, workspace?: string): void {
  const file = getWorkspaceYamlPath(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100 }));
}

/* -------------------------------------------------------------------------- */
/* .org.yaml                                                                   */
/* -------------------------------------------------------------------------- */

export function loadOrgYaml(orgDir: string): OrgYaml | null {
  const file = path.join(orgDir, ".org.yaml");
  if (!fs.existsSync(file)) return null;
  try {
    return yaml.load(normalizeLine(fs.readFileSync(file, "utf-8"))) as OrgYaml;
  } catch {
    return null;
  }
}

export function saveOrgYaml(orgDir: string, doc: OrgYaml): void {
  fs.mkdirSync(orgDir, { recursive: true });
  fs.writeFileSync(path.join(orgDir, ".org.yaml"), yaml.dump(doc, { lineWidth: 100 }));
}

/** List all organization directories inside a workspace. */
export function listOrganizations(workspace?: string): { slug: string; path: string; yaml: OrgYaml }[] {
  const root = workspace ?? getWorkspaceRoot();
  if (!fs.existsSync(root)) return [];
  const results: { slug: string; path: string; yaml: OrgYaml }[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const orgPath = path.join(root, entry.name);
    const doc = loadOrgYaml(orgPath);
    if (doc) results.push({ slug: entry.name, path: orgPath, yaml: doc });
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* repo.yaml                                                                   */
/* -------------------------------------------------------------------------- */

export function loadRepoYaml(repoDir: string): RepoYaml | null {
  const file = path.join(repoDir, ".solosquad", "repo.yaml");
  if (!fs.existsSync(file)) return null;
  try {
    return yaml.load(normalizeLine(fs.readFileSync(file, "utf-8"))) as RepoYaml;
  } catch {
    return null;
  }
}

export function saveRepoYaml(repoDir: string, doc: RepoYaml): void {
  const dir = path.join(repoDir, ".solosquad");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "repo.yaml"), yaml.dump(doc, { lineWidth: 100 }));
}

/* -------------------------------------------------------------------------- */
/* Legacy v0.1.x products.json — still readable by migration scripts          */
/* -------------------------------------------------------------------------- */

export function loadProducts(dir?: string): Product[] {
  // v0.2.2+: if workspace.yaml exists, synthesize Product[] from organizations.
  const workspace = dir ?? getWorkspaceRoot();
  const wsYaml = path.join(workspace, ".solosquad", "workspace.yaml");
  if (fs.existsSync(wsYaml)) {
    return listOrganizations(workspace).map((o) => ({
      name: o.yaml.name,
      slug: o.yaml.slug,
      github_org: o.yaml.provider === "github" ? extractGithubOrgFromUrl(o.yaml.remote_url ?? undefined) : undefined,
    }));
  }
  // v0.1.x legacy
  const file = dir ? path.join(dir, "core", "products.json") : getProductsFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function extractGithubOrgFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(/github\.com\/([^/?#]+)/i);
  return match ? match[1] : undefined;
}

export function saveProducts(products: Product[], dir?: string): void {
  const file = dir ? path.join(dir, "core", "products.json") : getProductsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(products, null, 2));
}

/** Messenger channel config (per-org on v0.2.2+, per-product on v0.1.x). */
export function loadMessengerConfig(orgOrProductDir: string, platform: string): Record<string, unknown> {
  try {
    const configFile = path.join(orgOrProductDir, platform, "config.yaml");
    if (!fs.existsSync(configFile)) return {};
    return (yaml.load(fs.readFileSync(configFile, "utf-8")) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

/** Guard: MESSENGER must be a single platform in v0.2.2+. */
export function normalizeMessenger(raw: string | undefined): string {
  if (!raw) return "discord";
  const first = raw.split(",")[0].trim().toLowerCase();
  return first || "discord";
}

/** Read silently — helps callers that still expect the old agentsDir path. */
export { getAgentsDir, getSolosquadConfigDir };
