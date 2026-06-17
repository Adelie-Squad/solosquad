import { fileURLToPath } from "url";
import path from "path";
import os from "os";
import fs from "fs";
import { createRequire } from "module";
import { findWorkspaceRoot } from "../migrations/detect.js";

// v0.9.1 — js-yaml accessed lazily via createRequire because resolveRepoCwd
// is in a hot path (called on every spawn) and we want to avoid a top-level
// ESM import of js-yaml (which would bloat startup). The require ref is
// cached after first call.
const _requireFromPaths = createRequire(import.meta.url);
let _yamlLib: typeof import("js-yaml") | undefined;
function loadYamlLib(): typeof import("js-yaml") {
  if (!_yamlLib) _yamlLib = _requireFromPaths("js-yaml") as typeof import("js-yaml");
  return _yamlLib;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Bundled assets directory inside the npm package. */
export function getAssetsDir(): string {
  const candidate = path.resolve(__dirname, "..", "..", "assets");
  if (fs.existsSync(candidate)) return candidate;
  return path.resolve(__dirname, "..", "..", "..", "assets");
}

/**
 * Workspace root — the directory that contains either `.solosquad/` (v0.2.2+)
 * or the legacy layout markers (v0.1.x: agents/, routines/, core/).
 * Walks up from CWD. Falls back to CWD if nothing is found (fresh install).
 */
export function getWorkspaceRoot(): string {
  const cwd = process.cwd();
  return findWorkspaceRoot(cwd) ?? cwd;
}

/** Back-compat: legacy callers expect CWD. Kept as alias during migration. */
export function getWorkspaceDir(): string {
  return getWorkspaceRoot();
}

/** v0.2.2+: path to the hidden `.solosquad/` config directory. */
export function getSolosquadConfigDir(workspace?: string): string {
  return path.join(workspace ?? getWorkspaceRoot(), ".solosquad");
}

/** v0.2.2+: path to workspace.yaml. */
export function getWorkspaceYamlPath(workspace?: string): string {
  return path.join(getSolosquadConfigDir(workspace), "workspace.yaml");
}

/** v0.2.2+: path to .env (inside .solosquad/). */
export function getEnvPath(workspace?: string): string {
  return path.join(getSolosquadConfigDir(workspace), ".env");
}

/** Agents dir — v0.2.2 looks in .solosquad/agents; falls back to workspace-root agents/ for legacy, then assets/. */
export function getAgentsDir(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "agents");
  if (fs.existsSync(solosquad)) return solosquad;
  const legacy = path.join(root, "agents");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getAssetsDir(), "agents");
}

/**
 * Routines dir — legacy v1.0.x layout resolver. v1.1 renamed this to
 * `schedules/`; prefer `getSchedulesDir()`. Kept for back-compat with
 * workspaces that still hold a `.solosquad/routines/` override. The bundle
 * fallback now points at the canonical top-level `schedules/` (the old
 * `assets/routines/` source was removed in v1.3.1 §9).
 */
export function getRoutinesDir(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "routines");
  if (fs.existsSync(solosquad)) return solosquad;
  const legacy = path.join(root, "routines");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "schedules");
}

/** Core dir — owner profile, principles, voice. */
export function getCoreDir(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "core");
  if (fs.existsSync(solosquad)) return solosquad;
  const legacy = path.join(root, "core");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getAssetsDir(), "core");
}

/**
 * v0.6 §2.3 — Workspace knowledge layer.
 *
 * User-accumulated craft, decision frameworks, and glossaries that are
 * orthogonal to any single agent role. Resolution mirrors `getAgentsDir()`
 * and `getCoreDir()`:
 *   1. `<workspace>/.solosquad/knowledge/` (user-authored, top priority)
 *   2. `<workspace>/knowledge/` (legacy out-of-config-dir layout, defensive)
 *   3. `<bundle>/knowledge/` (bundled starter guide — top-level since v1.1;
 *      the old `assets/knowledge/` source was removed in v1.3.1 §9)
 *
 * Always returns *some* path so callers can `fs.existsSync` without an extra
 * undefined check — the bundled dir is the last-resort fallback.
 */
export function getKnowledgeDir(workspace?: string): string {
  const root = workspace ?? getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "knowledge");
  if (fs.existsSync(solosquad)) return solosquad;
  const legacy = path.join(root, "knowledge");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "knowledge");
}

/**
 * v1.1 — Bundle root (the directory above `assets/`). Used by new
 * top-level bundled folders introduced in v1.1: `agents/`, `skills/`,
 * `teams/`, `user/`, `schedules/`. These supersede the old `assets/*`
 * layout but the migration to `assets/` is gradual — both layouts may
 * coexist during the transition.
 */
export function getBundleRoot(): string {
  // Mirror getAssetsDir's two-candidate resolution then strip the trailing
  // `/assets`. Keeps the source-vs-installed-package distinction consistent.
  const fromAssets = getAssetsDir();
  return path.dirname(fromAssets);
}

/**
 * v1.1 — `agents/main/<name>/` (workspace bundle). Main bot SKILL.md
 * files: pm, engineer, designer, marketer (chief lives org-side).
 * Resolution mirrors getAgentsDir: workspace override > bundle.
 */
export function getMainAgentsDir(): string {
  const root = getWorkspaceRoot();
  const userOverride = path.join(root, ".solosquad", "agents", "main");
  if (fs.existsSync(userOverride)) return userOverride;
  const legacy = path.join(root, "agents", "main");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "agents", "main");
}

/**
 * v1.1 — `agents/specialists/<name>/` (workspace bundle, flat). Members
 * of teams are declared in `teams/<team>/composition.yaml`, not by
 * folder nesting.
 */
export function getSpecialistsDir(): string {
  const root = getWorkspaceRoot();
  const userOverride = path.join(root, ".solosquad", "agents", "specialists");
  if (fs.existsSync(userOverride)) return userOverride;
  const legacy = path.join(root, "agents", "specialists");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "agents", "specialists");
}

/**
 * v1.1 — `skills/<name>/` (workspace bundle, flat). agentskills.io-
 * compliant: each skill folder has SKILL.md + optional assets/, scripts/,
 * references/.
 */
export function getSkillsDir(): string {
  const root = getWorkspaceRoot();
  const userOverride = path.join(root, ".solosquad", "skills");
  if (fs.existsSync(userOverride)) return userOverride;
  const legacy = path.join(root, "skills");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "skills");
}

/**
 * v1.1 — `teams/<team>/` (workspace bundle). KNOWLEDGE.md + OKR.md +
 * composition.yaml per team. Four known teams: product, engineering,
 * design, marketing.
 */
export function getTeamsDir(): string {
  const root = getWorkspaceRoot();
  const userOverride = path.join(root, ".solosquad", "teams");
  if (fs.existsSync(userOverride)) return userOverride;
  const legacy = path.join(root, "teams");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "teams");
}

/** v1.1 — `user/` (workspace bundle): profile.md, voice.md, preferences.md. */
export function getUserDir(): string {
  const root = getWorkspaceRoot();
  const userOverride = path.join(root, ".solosquad", "user");
  if (fs.existsSync(userOverride)) return userOverride;
  const legacy = path.join(root, "user");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "user");
}

/**
 * v1.1 — `schedules/` (workspace bundle). Renamed from `routines/`. Each
 * `.md` file = scheduled prompt run via node-cron. This is the canonical
 * resolver the scheduler reads (v1.3.1 §9 wired `loadRoutinePrompt` here).
 *
 * Priority preserves existing-workspace customizations across the rename:
 *   1. `<workspace>/.solosquad/schedules/` (v1.1 user override)
 *   2. `<workspace>/.solosquad/routines/` (v1.0.x user override — legacy
 *      name; checked before the bundle so prior customizations still win)
 *   3. `<workspace>/schedules/` (legacy out-of-config layout, defensive)
 *   4. `<bundle>/schedules/` (bundled canonical, last resort)
 */
export function getSchedulesDir(): string {
  const root = getWorkspaceRoot();
  const userOverride = path.join(root, ".solosquad", "schedules");
  if (fs.existsSync(userOverride)) return userOverride;
  const legacyRoutines = path.join(root, ".solosquad", "routines");
  if (fs.existsSync(legacyRoutines)) return legacyRoutines;
  const legacy = path.join(root, "schedules");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "schedules");
}

/** Products file (v0.1.x legacy only). v0.2.2+ uses .org.yaml per organization. */
export function getProductsFile(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "core", "products.json");
  if (fs.existsSync(solosquad)) return solosquad;
  return path.join(root, "core", "products.json");
}

/**
 * Directory that holds "product/organization" folders.
 *
 * - v0.2.2+: organizations live directly under the workspace root, so this
 *   returns the workspace root itself. Legacy callers looking up
 *   `<base>/<slug>/...` still work because the slug sits at the workspace root.
 * - v0.1.x: REPOS_BASE_PATH env var (or ~/repos fallback).
 *
 * Kept under this name because existing bot/scheduler/adapter code imports it;
 * migration scripts still read `process.env.REPOS_BASE_PATH` directly when
 * they need the original value.
 */
export function getReposBase(): string {
  const workspace = getWorkspaceRoot();
  if (fs.existsSync(path.join(workspace, ".solosquad"))) {
    return workspace;
  }
  return process.env.REPOS_BASE_PATH || path.join(os.homedir(), "repos");
}

/** v0.2.2+: path to an org directory under the workspace. */
export function getOrgDir(orgSlug: string, workspace?: string): string {
  return path.join(workspace ?? getWorkspaceRoot(), orgSlug);
}

/** v0.2.2+: path to an org's `repositories/` container folder. */
export function getRepositoriesDir(orgSlug: string, workspace?: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "repositories");
}

/** v0.2.2+: path to a specific repo directory (under `<org>/repositories/<repo>`). */
export function getRepoDir(orgSlug: string, repoSlug: string, workspace?: string): string {
  return path.join(getRepositoriesDir(orgSlug, workspace), repoSlug);
}

/**
 * Resolve the runtime cwd for a given org/repo.
 *
 * Priority (v0.9.1+):
 * 1. **path-reference (model B)**: `<workspace>/<org>/repositories/<repo>.yaml`
 *    (file, not directory) has a `path:` field → resolve to that absolute
 *    external path (validated to exist).
 * 2. **legacy tree (model A)**: `<workspace>/<org>/repositories/<repo>/`
 *    directory exists → use it (v0.8.x and earlier default).
 * 3. **legacy root (org=repo, pre-sync)**: `<org>/.git` exists → org root.
 * 4. Fallback: org root.
 *
 * See `docs/plan/v0.9.1-workspace-repo-relationship.md` §7 for the design
 * rationale (path-reference becomes the v0.9+ default; the legacy tree stays
 * permanently supported for backward-compat).
 */
export function resolveRepoCwd(
  orgSlug: string,
  repoSlug: string | null,
  workspace?: string
): string {
  const root = workspace ?? getWorkspaceRoot();
  if (repoSlug) {
    // (1) path-reference mode (v0.9.1+) — repo.yaml file at repositories/<slug>.yaml
    const yamlPath = path.join(root, orgSlug, "repositories", `${repoSlug}.yaml`);
    if (fs.existsSync(yamlPath)) {
      try {
        const yamlLib = loadYamlLib();
        const doc = yamlLib.load(fs.readFileSync(yamlPath, "utf-8")) as { path?: string } | null;
        if (doc && typeof doc.path === "string" && doc.path.trim().length > 0) {
          const resolved = path.resolve(doc.path);
          if (fs.existsSync(resolved)) return resolved;
          // path-reference exists but target missing — fall through to legacy
        }
      } catch {
        // malformed yaml — fall through to legacy
      }
    }
    // (2) legacy tree — repositories/<slug>/ directory
    const canonical = path.join(root, orgSlug, "repositories", repoSlug);
    if (fs.existsSync(canonical)) return canonical;
  }
  const orgDir = path.join(root, orgSlug);
  // (3) legacy root (org=repo)
  const legacyGit = path.join(orgDir, ".git");
  if (fs.existsSync(legacyGit)) return orgDir;
  // (4) fallback
  return orgDir;
}

/** System-reserved folder names that must not be treated as repos. */
export const RESERVED_ORG_CHILDREN = new Set([
  ".solosquad",
  ".org.yaml",
  "memory",
  "workflows",
  "repositories",
  "slack",
  "discord",
  "product",
]);
