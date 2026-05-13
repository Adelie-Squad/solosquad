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
  /** v1.3.0 — autonomous engine defaults. */
  default_hours?: number;
  default_budget_usd?: number;
  dedicated_session_prefix?: string;
}

export interface PmConfig {
  /** Cap per claude --print call. Workspace default. */
  max_budget_usd?: number;
  /** Hard timeout per PM invocation. */
  invoke_timeout_seconds?: number;
  /** Real-time partial reply streaming (--include-partial-messages). */
  include_partial_messages?: boolean;
  /** Cross-call prompt-cache friendliness (--exclude-dynamic-system-prompt-sections). */
  exclude_dynamic_system_prompt_sections?: boolean;
  /** Per-session in-process mutex queue depth (pm-runner). */
  mutex_queue_depth?: number;
  /** v1.2.5+: daily pm-compaction trigger time (HH:MM). */
  compaction_time?: string;
}

export interface WorkspaceYaml {
  version: string;
  display_name: string;
  persona?: string;
  /** IANA timezone (e.g. "Asia/Seoul"). v1.2.4+. Defaults applied at load time. */
  timezone?: string;
  /** v1.2.4+: user-facing daily briefs. */
  briefings?: {
    morning?: BriefingConfig;
    evening?: BriefingConfig;
  };
  /** v1.2.4+: background routines that feed into the briefs. */
  background_routines?: {
    signal_scan?: BriefingConfig;
    experiment_check?: BriefingConfig;
    weekly_review?: WeeklyRoutineConfig;
  };
  /** v1.2.5+: PM mode configuration. */
  pm?: PmConfig;
  /** v1.3.0+: autonomous goal engine configuration. */
  goal?: GoalConfig;
  created_at: string;
  last_migrated_to?: string;
}

/** v1.2.4 defaults — used both at init and as fallbacks when fields are missing. */
export const DEFAULT_WORKSPACE_SETTINGS = {
  timezone: "Asia/Seoul",
  briefings: {
    morning: { time: "08:00", enabled: true },
    evening: { time: "18:00", enabled: true },
  },
  background_routines: {
    signal_scan: { time: "12:00", enabled: true },
    experiment_check: { time: "16:00", enabled: true },
    weekly_review: { day: "sunday", time: "20:00", enabled: true },
  },
  /** v1.2.5 (PM mode) defaults; compaction_time added in v1.2.5. */
  pm: {
    max_budget_usd: 5,
    invoke_timeout_seconds: 300,
    include_partial_messages: true,
    exclude_dynamic_system_prompt_sections: true,
    mutex_queue_depth: 4,
    compaction_time: "23:00",
  },
} as const;

/** Merge a partial WorkspaceYaml with defaults for v1.2.4+ fields. */
export function applyWorkspaceDefaults(ws: WorkspaceYaml): WorkspaceYaml {
  return {
    ...ws,
    timezone: ws.timezone ?? DEFAULT_WORKSPACE_SETTINGS.timezone,
    briefings: {
      morning: { ...DEFAULT_WORKSPACE_SETTINGS.briefings.morning, ...(ws.briefings?.morning ?? {}) },
      evening: { ...DEFAULT_WORKSPACE_SETTINGS.briefings.evening, ...(ws.briefings?.evening ?? {}) },
    },
    background_routines: {
      signal_scan: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.signal_scan, ...(ws.background_routines?.signal_scan ?? {}) },
      experiment_check: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.experiment_check, ...(ws.background_routines?.experiment_check ?? {}) },
      weekly_review: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.weekly_review, ...(ws.background_routines?.weekly_review ?? {}) },
    },
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
  created_at: string;
}

export interface RepoYaml {
  slug: string;
  name: string;
  role: "main" | "frontend" | "backend" | "data" | "infra" | "docs" | "unknown";
  language?: string;
  linked_org: string;
  remote_url?: string | null;
  products?: string[];
  notes?: string;
  registered_at: string;
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
/* Legacy v1.1.x products.json — still readable by migration scripts          */
/* -------------------------------------------------------------------------- */

export function loadProducts(dir?: string): Product[] {
  // v1.2.2+: if workspace.yaml exists, synthesize Product[] from organizations.
  const workspace = dir ?? getWorkspaceRoot();
  const wsYaml = path.join(workspace, ".solosquad", "workspace.yaml");
  if (fs.existsSync(wsYaml)) {
    return listOrganizations(workspace).map((o) => ({
      name: o.yaml.name,
      slug: o.yaml.slug,
      github_org: o.yaml.provider === "github" ? extractGithubOrgFromUrl(o.yaml.remote_url ?? undefined) : undefined,
    }));
  }
  // v1.1.x legacy
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

/** Messenger channel config (per-org on v1.2.2+, per-product on v1.1.x). */
export function loadMessengerConfig(orgOrProductDir: string, platform: string): Record<string, unknown> {
  try {
    const configFile = path.join(orgOrProductDir, platform, "config.yaml");
    if (!fs.existsSync(configFile)) return {};
    return (yaml.load(fs.readFileSync(configFile, "utf-8")) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

/** Guard: MESSENGER must be a single platform in v1.2.2+. */
export function normalizeMessenger(raw: string | undefined): string {
  if (!raw) return "discord";
  const first = raw.split(",")[0].trim().toLowerCase();
  return first || "discord";
}

/** Read silently — helps callers that still expect the old agentsDir path. */
export { getAgentsDir, getSolosquadConfigDir };
