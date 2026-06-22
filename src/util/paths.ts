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

/**
 * @deprecated v1.3.5 — the `assets/` bundle dir was retired; its only remaining
 * contents (`.env.example`, `docker/`) moved to the bundle root. Resolves to the
 * now-absent `<bundle>/assets` so the two historical migrations that probe
 * `assets/{agents,routines}` (already removed in v1.1/v1.3.1) keep no-op'ing.
 * New code should use `getBundleRoot()` + the specific file/dir.
 */
export function getAssetsDir(): string {
  return path.join(getBundleRoot(), "assets");
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

/** Agents dir — v0.2.2 looks in .solosquad/agents; falls back to workspace-root agents/ for legacy, then the bundle. */
export function getAgentsDir(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "agents");
  if (fs.existsSync(solosquad)) return solosquad;
  const legacy = path.join(root, "agents");
  if (fs.existsSync(legacy)) return legacy;
  // v1.3.2 — the last-resort fallback is the bundled roster at the package
  // root (`<bundle>/agents`), NOT `assets/agents` (which never existed: the
  // v1.1 flat layout ships agents at the bundle top level). Mirrors how
  // getSkillsDir/getCronsDir fall back to getBundleRoot().
  return getBundledAgentsDir();
}

/**
 * v1.3.2 — the bundled actor roster, resolved *deterministically* from the
 * installed package root (via getBundleRoot → __dirname), independent of the
 * current working directory.
 *
 * Use this (not getAgentsDir) wherever the intended scope is "the canonical
 * actors SoloSquad ships" — e.g. `agent validate --graph`, `workflow validate`
 * agent-ref resolution, and the adoption collision roster (§10.4). getAgentsDir
 * walks *up from cwd* to find a workspace, so when the package checkout itself
 * lives inside an unrelated SoloSquad workspace (a dev machine, or a user who
 * cloned the repo into their workspace tree), it would otherwise validate that
 * ancestor workspace's — possibly stale — agents instead of the shipped bundle.
 */
export function getBundledAgentsDir(): string {
  return path.join(getBundleRoot(), "agents");
}

// v1.3.x cron rename — getRoutinesDir() removed. It was the legacy v1.0.x
// layout resolver (`.solosquad/routines/`) with zero callers; the canonical
// resolver is getCronsDir() below, which still reads the old override dirs for
// back-compat until the cron-rename migration moves them.

// v1.3.1 §9 — getCoreDir() removed. The bundled `assets/core/` was a v0.x
// workspace-level persona default that nothing read after v1.1: the owner
// profile moved to `user/profile.md`/`user/voice.md`, and the live org persona
// is `<org>/core/{PRINCIPLES,VOICE}.md` (scaffolded fresh by init/migration and
// read directly by the spawn-assembler [4] layer). The resolver had zero
// callers, so the function and `assets/core/` were both deleted.

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
 * `teams/`, `user/`, `crons/`. These supersede the old `assets/*`
 * layout but the migration to `assets/` is gradual — both layouts may
 * coexist during the transition.
 */
export function getBundleRoot(): string {
  // v1.3.5 — anchor on package.json (always at the bundle root, always shipped),
  // independent of any single bundle dir. Two-candidate depth: source (src/util)
  // vs compiled (dist/src/util).
  const c1 = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(c1, "package.json"))) return c1;
  return path.resolve(__dirname, "..", "..", "..");
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
  return getBundledSkillsDir();
}

/**
 * v1.3.2 — the bundled skills dir, resolved deterministically from the package
 * root (cwd-independent). The skill-manager counterpart to
 * getBundledAgentsDir(): use it wherever the scope is "the skills SoloSquad
 * ships" (the adoption collision roster, bundled workflow templates), so an
 * ancestor workspace's `.solosquad/skills` override can never shadow the bundle.
 */
export function getBundledSkillsDir(): string {
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
 * v1.3.x — `crons/` (workspace bundle). Renamed from `schedules/` (v1.1) and
 * `routines/` (v1.0.x). Each `.md` file = a cron prompt run via node-cron. This
 * is the canonical resolver the scheduler reads (v1.3.1 §9 wired `loadCronPrompt`
 * here).
 *
 * Priority preserves existing-workspace customizations across the rename:
 *   1. `<workspace>/.solosquad/crons/` (v1.3.x user override, canonical)
 *   2. `<workspace>/.solosquad/schedules/` (v1.1 user override — legacy name)
 *   3. `<workspace>/.solosquad/routines/` (v1.0.x user override — legacy name;
 *      both legacy dirs are checked before the bundle so prior customizations
 *      still win until the cron-rename migration moves them)
 *   4. `<workspace>/crons/` (legacy out-of-config layout, defensive)
 *   5. `<bundle>/crons/` (bundled canonical, last resort)
 */
export function getCronsDir(): string {
  const root = getWorkspaceRoot();
  const userOverride = path.join(root, ".solosquad", "crons");
  if (fs.existsSync(userOverride)) return userOverride;
  const legacySchedules = path.join(root, ".solosquad", "schedules");
  if (fs.existsSync(legacySchedules)) return legacySchedules;
  const legacyRoutines = path.join(root, ".solosquad", "routines");
  if (fs.existsSync(legacyRoutines)) return legacyRoutines;
  const legacy = path.join(root, "crons");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getBundleRoot(), "crons");
}

/**
 * v1.3.5 §3.9 B-D3 — canonical WRITE target for an org's user cron defs/prompts.
 * Crons are now **org-scoped** (`<org>/crons/`), aligning with workflow
 * (`<org>/workflows/`) and goal (`<org>/goals/`). Each org owns its crons, so a
 * cron only fires for its org (was: `.solosquad/crons/` workspace-global, firing
 * for every org). The `1.3.4-to-1.3.5` migration relocates the legacy dir.
 *
 * (v1.3.3 §C history: was `<workspace>/.solosquad/crons`. Unlike getCronsDir()
 * — a read-resolver that falls back to the bundle for built-in prompts — this is
 * a write target so `cron new/edit/delete` never write into the installed
 * package. The dir is created lazily by the writer.)
 */
export function getCronsWriteDir(orgSlug: string, workspace?: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "crons");
}

/**
 * v1.3.5 §3.9 B-D3 — the workspace-global legacy user-cron dir
 * (`<workspace>/.solosquad/crons`). Pre-1.3.5 write target; retained so the
 * migration and a defensive runtime fallback can still find un-migrated defs.
 */
export function getLegacyCronsWriteDir(workspace?: string): string {
  return path.join(workspace ?? getWorkspaceRoot(), ".solosquad", "crons");
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
