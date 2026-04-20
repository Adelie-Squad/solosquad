import { fileURLToPath } from "url";
import path from "path";
import os from "os";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Bundled assets directory inside the npm package. */
export function getAssetsDir(): string {
  // In compiled dist: dist/src/util/paths.js → ../../assets
  // In dev (tsx): src/util/paths.ts → ../../assets
  const candidate = path.resolve(__dirname, "..", "..", "assets");
  if (fs.existsSync(candidate)) return candidate;
  // Fallback: from dist/src/util → ../../../assets
  return path.resolve(__dirname, "..", "..", "..", "assets");
}

/** Current workspace directory (where solosquad init was run). */
export function getWorkspaceDir(): string {
  return process.cwd();
}

/** Repos base path from env or default ~/repos. */
export function getReposBase(): string {
  return process.env.REPOS_BASE_PATH || path.join(os.homedir(), "repos");
}

/** Agents directory — workspace first, then fallback to assets. */
export function getAgentsDir(): string {
  const wsAgents = path.join(getWorkspaceDir(), "agents");
  if (fs.existsSync(wsAgents)) return wsAgents;
  return path.join(getAssetsDir(), "agents");
}

/** Routines directory — workspace first, then fallback to assets. */
export function getRoutinesDir(): string {
  const wsRoutines = path.join(getWorkspaceDir(), "routines");
  if (fs.existsSync(wsRoutines)) return wsRoutines;
  return path.join(getAssetsDir(), "routines");
}

/** Products JSON file path. */
export function getProductsFile(): string {
  return path.join(getWorkspaceDir(), "core", "products.json");
}
