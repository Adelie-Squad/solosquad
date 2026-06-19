import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * v1.3.2 §10.1 — multi-asset Discover. Walks a registered repo and detects the
 * four first-class assets by convention. Read-only: produces an inventory the
 * adoption report (§10.5 dry-run) and validators consume; it never writes.
 *
 * Distinct from `scanner.ts` (skill-only `.claude/skills` ledger) — that one
 * stays for the existing `analyze` flow. This is the generalized scanner.
 *
 * Detection (by path convention):
 *   skill     — `.../.claude/skills/<id>/SKILL.md`  or  `.../skills/<id>/SKILL.md`
 *   agent     — `.../.claude/agents/<id>.md`        or  `.../agents/(main|specialists)/<id>/SKILL.md`
 *   workflow  — any `workflow.yaml` / `workflow.yml`
 *   cron  — `.../crons/<id>.yaml|.yml`
 */

export type AssetKind = "skill" | "agent" | "workflow" | "cron";

export interface ScannedAsset {
  kind: AssetKind;
  /** Repo-relative POSIX path. */
  path: string;
  /** Derived id (directory name or filename stem). */
  id: string;
  /** SHA256 hex, first 12 chars — for dedup / change detection. */
  hash: string;
  size_bytes: number;
}

export interface ScanAssetsOptions {
  /** Directory names to skip while walking. */
  ignoreDirs?: ReadonlySet<string>;
  /** Safety cap on files visited (pathological repos). */
  maxFiles?: number;
}

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  "vendor",
]);

function hashFile(full: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex").slice(0, 12);
}

/** Classify one file by its repo-relative POSIX path. Returns null if not an asset. */
export function classifyAssetPath(rel: string): { kind: AssetKind; id: string } | null {
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  const dirs = parts.slice(0, -1);

  // workflow — any workflow.yaml/.yml
  if (base === "workflow.yaml" || base === "workflow.yml") {
    return { kind: "workflow", id: parent ?? base };
  }
  // skill — <...>/skills/<id>/SKILL.md  (covers .claude/skills and bundle skills)
  if (base === "SKILL.md" && dirs.includes("skills")) {
    return { kind: "skill", id: parent ?? "skill" };
  }
  // agent — .claude/agents/<id>.md  OR  agents/(main|specialists)/<id>/SKILL.md
  if (base === "SKILL.md" && dirs.includes("agents")) {
    return { kind: "agent", id: parent ?? "agent" };
  }
  if (base.endsWith(".md") && dirs.includes("agents") && dirs.includes(".claude")) {
    return { kind: "agent", id: base.replace(/\.md$/, "") };
  }
  // cron — crons/<id>.yaml
  if ((base.endsWith(".yaml") || base.endsWith(".yml")) && parent === "crons") {
    return { kind: "cron", id: base.replace(/\.ya?ml$/, "") };
  }
  return null;
}

export function scanRepoAssets(repoRoot: string, opts: ScanAssetsOptions = {}): ScannedAsset[] {
  const ignore = opts.ignoreDirs ?? DEFAULT_IGNORE;
  const maxFiles = opts.maxFiles ?? 50_000;
  if (!fs.existsSync(repoRoot)) return [];

  const out: ScannedAsset[] = [];
  const stack: string[] = [repoRoot];
  let visited = 0;

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        stack.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (++visited > maxFiles) break;
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, full).split(path.sep).join("/");
      const hit = classifyAssetPath(rel);
      if (!hit) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      out.push({ kind: hit.kind, id: hit.id, path: rel, hash: hashFile(full), size_bytes: size });
    }
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
  return out;
}
