import { fileURLToPath } from "url";
import path from "path";
import os from "os";
import fs from "fs";
import { findWorkspaceRoot } from "../migrations/detect.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Bundled assets directory inside the npm package. */
export function getAssetsDir(): string {
  const candidate = path.resolve(__dirname, "..", "..", "assets");
  if (fs.existsSync(candidate)) return candidate;
  return path.resolve(__dirname, "..", "..", "..", "assets");
}

/**
 * Workspace root — the directory that contains either `.solosquad/` (v1.2.2+)
 * or the legacy layout markers (v1.1.x: agents/, routines/, core/).
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

/** v1.2.2+: path to the hidden `.solosquad/` config directory. */
export function getSolosquadConfigDir(workspace?: string): string {
  return path.join(workspace ?? getWorkspaceRoot(), ".solosquad");
}

/** v1.2.2+: path to workspace.yaml. */
export function getWorkspaceYamlPath(workspace?: string): string {
  return path.join(getSolosquadConfigDir(workspace), "workspace.yaml");
}

/** v1.2.2+: path to .env (inside .solosquad/). */
export function getEnvPath(workspace?: string): string {
  return path.join(getSolosquadConfigDir(workspace), ".env");
}

/** Agents dir — v1.2.2 looks in .solosquad/agents; falls back to workspace-root agents/ for legacy, then assets/. */
export function getAgentsDir(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "agents");
  if (fs.existsSync(solosquad)) return solosquad;
  const legacy = path.join(root, "agents");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getAssetsDir(), "agents");
}

/** Routines dir — mirrors getAgentsDir layout. */
export function getRoutinesDir(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "routines");
  if (fs.existsSync(solosquad)) return solosquad;
  const legacy = path.join(root, "routines");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(getAssetsDir(), "routines");
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

/** Products file (v1.1.x legacy only). v1.2.2+ uses .org.yaml per organization. */
export function getProductsFile(): string {
  const root = getWorkspaceRoot();
  const solosquad = path.join(root, ".solosquad", "core", "products.json");
  if (fs.existsSync(solosquad)) return solosquad;
  return path.join(root, "core", "products.json");
}

/**
 * Directory that holds "product/organization" folders.
 *
 * - v1.2.2+: organizations live directly under the workspace root, so this
 *   returns the workspace root itself. Legacy callers looking up
 *   `<base>/<slug>/...` still work because the slug sits at the workspace root.
 * - v1.1.x: REPOS_BASE_PATH env var (or ~/repos fallback).
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

/** v1.2.2+: path to an org directory under the workspace. */
export function getOrgDir(orgSlug: string, workspace?: string): string {
  return path.join(workspace ?? getWorkspaceRoot(), orgSlug);
}

/** v1.2.2+: path to an org's `repositories/` container folder. */
export function getRepositoriesDir(orgSlug: string, workspace?: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "repositories");
}

/** v1.2.2+: path to a specific repo directory (under `<org>/repositories/<repo>`). */
export function getRepoDir(orgSlug: string, repoSlug: string, workspace?: string): string {
  return path.join(getRepositoriesDir(orgSlug, workspace), repoSlug);
}

/**
 * Resolve the runtime cwd for a given org/repo.
 *
 * Normal case (post-sync): `<workspace>/<org>/repositories/<repo>` exists — return it.
 *
 * Legacy case (org = repo, .git at org root, pre-sync): fall back to the org
 * root so the bot/scheduler keep working for single-repo migrated orgs.
 */
export function resolveRepoCwd(
  orgSlug: string,
  repoSlug: string | null,
  workspace?: string
): string {
  const root = workspace ?? getWorkspaceRoot();
  if (repoSlug) {
    const canonical = path.join(root, orgSlug, "repositories", repoSlug);
    if (fs.existsSync(canonical)) return canonical;
  }
  const orgDir = path.join(root, orgSlug);
  const legacyGit = path.join(orgDir, ".git");
  if (fs.existsSync(legacyGit)) return orgDir;
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
  "telegram",
  "product",
]);
