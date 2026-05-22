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

  // v0.2.2+: .solosquad/ subdirectory with workspace.yaml
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
    return "0.2.0";
  }

  // v0.1.x: config folders at root, no .solosquad/
  const legacyMarkers = ["agents", "routines", "core"];
  if (legacyMarkers.every((m) => fs.existsSync(path.join(workspace, m)))) {
    return "0.1.x";
  }

  return null;
}

/**
 * Walk up from a starting directory to find the nearest workspace root
 * (v0.2.2 = has .solosquad/; v0.1.x = has agents/+routines/+core/).
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

/** Matcher: does a migration's "from" spec match the detected version?
 *
 * v1.0.3 fix — `X.Y.Z.x` patterns must match exact `X.Y.Z` too. Pre-v1.0.3
 * the matcher sliced off only the trailing `x`, leaving `"1.0.0."` as the
 * startsWith prefix — so `"1.0.0"` (without trailing dot) silently missed,
 * breaking patch-level migrations. Both ".x" patterns now match:
 *   - "0.1.x"   → matches "0.1" exact AND "0.1.0"/"0.1.5"/...
 *   - "1.0.0.x" → matches "1.0.0" exact AND "1.0.0.5"/... (4-segment is
 *                  unused in semver but pattern preserved for legacy migrations)
 */
export function versionMatches(spec: string, detected: string): boolean {
  if (spec === detected) return true;
  if (spec.endsWith(".x")) {
    const baseExact = spec.slice(0, -2);          // "1.0.0.x" → "1.0.0"
    const prefixWithDot = spec.slice(0, -1);      // "1.0.0.x" → "1.0.0."
    return detected === baseExact || detected.startsWith(prefixWithDot);
  }
  return false;
}
