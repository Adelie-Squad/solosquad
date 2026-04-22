import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";

/**
 * Detect which SoloSquad version layout a directory corresponds to.
 * Returns the source version string, or null if the directory is not a
 * recognizable SoloSquad workspace.
 */
export function detectWorkspaceVersion(workspace: string): string | null {
  if (!fs.existsSync(workspace)) return null;

  // v1.2.2+: .solosquad/ subdirectory with workspace.yaml
  const solosquadDir = path.join(workspace, ".solosquad");
  if (fs.existsSync(solosquadDir)) {
    const wsFile = path.join(solosquadDir, "workspace.yaml");
    if (fs.existsSync(wsFile)) {
      try {
        const doc = yaml.load(
          normalizeLine(fs.readFileSync(wsFile, "utf-8"))
        ) as { version?: string } | undefined;
        if (doc?.version) return doc.version;
      } catch {
        /* fall through */
      }
    }
    return "1.2.2";
  }

  // v1.1.x: config folders at root, no .solosquad/
  const legacyMarkers = ["agents", "routines", "core"];
  if (legacyMarkers.every((m) => fs.existsSync(path.join(workspace, m)))) {
    return "1.1.x";
  }

  return null;
}

/**
 * Walk up from a starting directory to find the nearest workspace root
 * (v1.2.2 = has .solosquad/; v1.1.x = has agents/+routines/+core/).
 * Returns the absolute path or null.
 */
export function findWorkspaceRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    if (detectWorkspaceVersion(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null; // hit filesystem root
    current = parent;
  }
}

/** Matcher: does a migration's "from" spec match the detected version? */
export function versionMatches(spec: string, detected: string): boolean {
  if (spec === detected) return true;
  // "1.1.x" matches "1.1.0", "1.1.5" etc.
  if (spec.endsWith(".x")) {
    const prefix = spec.slice(0, -1); // "1.1."
    return detected.startsWith(prefix);
  }
  return false;
}
