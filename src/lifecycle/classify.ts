import fs from "fs";
import path from "path";
import { listOrganizations } from "../util/config.js";
import { getSolosquadConfigDir } from "../util/paths.js";

/**
 * v0.7 — workspace asset classifier.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §4 + §10 #1.
 *
 * Walks the workspace tree and tags each entry with one of 6 classes:
 *
 *   A   — User code (`<org>/repositories/<repo>/`) — untouched, not enumerated
 *   A*  — `<repo>/.solosquad/repo.yaml` — surgical extract (whitelist length 1)
 *   B   — Accumulated knowledge — archive then delete
 *   C   — Operational metadata — archive metadata only, delete
 *   D   — Secrets — mask + delete
 *   E   — External resources — guide only, do not touch
 *
 * Critical contract: this walker NEVER descends into a repository directory
 * beyond `<repo>/.solosquad/repo.yaml`. The rest of the repo tree is left
 * entirely untraversed so even read-side bugs cannot leak user code.
 */

export type AssetClass = "A" | "A*" | "B" | "C" | "D" | "E";

export interface AssetEntry {
  /** Absolute path on disk. */
  absPath: string;
  /** Relative to workspace root (forward-slash, for archive layout). */
  relPath: string;
  /** Classification. */
  cls: AssetClass;
  /** File or directory. */
  kind: "file" | "directory";
  /** Bytes (files only). */
  size?: number;
  /** Owning org slug when applicable. */
  orgSlug?: string;
  /** Owning repo slug when applicable (A* only). */
  repoSlug?: string;
}

export interface ClassifyResult {
  entries: AssetEntry[];
  /** Tallies per class. */
  totals: Record<AssetClass, { count: number; bytes: number }>;
  /** Repository roots that were *not* enumerated (class A — untouched). */
  untraversedRepoRoots: string[];
}

const CLASS_B_WORKSPACE_FILES = new Set<string>([
  "AGENTS.md",
]);

const CLASS_B_WORKSPACE_DIRS = new Set<string>([
  "knowledge",
]);

const CLASS_C_WORKSPACE_FILES = new Set<string>([
  "docker-compose.yml",
  "Dockerfile",
]);

const CLASS_B_ORG_DIRS = new Set<string>([
  "memory",
  "workflows",
  "goals",
  "domain",
  "core",
]);

const CLASS_C_ORG_DIRS = new Set<string>([
  "slack",
  "discord",
  ".claude",
]);

export function classifyWorkspace(workspace: string): ClassifyResult {
  const entries: AssetEntry[] = [];
  const untraversedRepoRoots: string[] = [];
  const totals: Record<AssetClass, { count: number; bytes: number }> = {
    "A": { count: 0, bytes: 0 },
    "A*": { count: 0, bytes: 0 },
    "B": { count: 0, bytes: 0 },
    "C": { count: 0, bytes: 0 },
    "D": { count: 0, bytes: 0 },
    "E": { count: 0, bytes: 0 },
  };

  function pushFile(absPath: string, cls: AssetClass, orgSlug?: string, repoSlug?: string): void {
    let size = 0;
    try {
      size = fs.statSync(absPath).size;
    } catch {
      return;
    }
    const rel = path.relative(workspace, absPath).split(path.sep).join("/");
    entries.push({ absPath, relPath: rel, cls, kind: "file", size, orgSlug, repoSlug });
    totals[cls].count++;
    totals[cls].bytes += size;
  }

  function pushDir(absPath: string, cls: AssetClass, orgSlug?: string): void {
    const rel = path.relative(workspace, absPath).split(path.sep).join("/");
    entries.push({ absPath, relPath: rel, cls, kind: "directory", orgSlug });
    totals[cls].count++;
  }

  function walkDir(absDir: string, cls: AssetClass, orgSlug?: string): void {
    if (!fs.existsSync(absDir)) return;
    pushDir(absDir, cls, orgSlug);
    let entriesList: fs.Dirent[];
    try {
      entriesList = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entriesList) {
      const child = path.join(absDir, e.name);
      if (e.isDirectory()) {
        walkDir(child, cls, orgSlug);
      } else if (e.isFile()) {
        pushFile(child, cls, orgSlug);
      }
    }
  }

  // ----- Workspace-level (.solosquad/) -----

  const cfg = getSolosquadConfigDir(workspace);
  if (fs.existsSync(cfg)) {
    walkConfigDir(cfg);
  }

  function walkConfigDir(dir: string): void {
    pushDir(dir, "C");
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, e.name);
      if (e.name === ".env") {
        pushFile(child, "D");
      } else if (e.name === "knowledge" && e.isDirectory()) {
        walkDir(child, "B");
      } else if (e.name === "core" && e.isDirectory()) {
        walkDir(child, "B");
      } else if (e.name === "secret-keys.txt") {
        pushFile(child, "C");
      } else if (e.name === "workspace.yaml") {
        pushFile(child, "C");
      } else if (e.isDirectory()) {
        walkDir(child, "C");
      } else if (e.isFile()) {
        pushFile(child, "C");
      }
    }
  }

  // ----- Workspace-level root files -----

  for (const e of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (e.name === ".solosquad" || e.name === ".git") continue;
    const child = path.join(workspace, e.name);
    if (e.isFile()) {
      if (CLASS_B_WORKSPACE_FILES.has(e.name)) pushFile(child, "B");
      else if (CLASS_C_WORKSPACE_FILES.has(e.name)) pushFile(child, "C");
      // unknown root files left alone (likely user)
    } else if (e.isDirectory()) {
      if (CLASS_B_WORKSPACE_DIRS.has(e.name)) {
        walkDir(child, "B");
      }
      // org directories are walked below
    }
  }

  // ----- Org-level -----

  const orgs = listOrganizations(workspace);
  for (const org of orgs) {
    classifyOrg(org.slug, org.path);
  }

  function classifyOrg(orgSlug: string, orgRoot: string): void {
    pushFile(path.join(orgRoot, ".org.yaml"), "C", orgSlug);

    for (const e of fs.readdirSync(orgRoot, { withFileTypes: true })) {
      if (e.name === ".org.yaml") continue;
      const child = path.join(orgRoot, e.name);

      if (e.name === "repositories" && e.isDirectory()) {
        classifyRepositories(orgSlug, child);
        continue;
      }
      if (e.name === ".solosquad" && e.isDirectory()) {
        // org-level .solosquad (sessions, etc.) — class C
        walkDir(child, "C", orgSlug);
        continue;
      }
      if (e.isDirectory()) {
        if (CLASS_B_ORG_DIRS.has(e.name)) {
          walkDir(child, "B", orgSlug);
        } else if (CLASS_C_ORG_DIRS.has(e.name)) {
          walkDir(child, "C", orgSlug);
        }
        // unknown org-level dirs left alone (treat as user content)
      } else if (e.isFile()) {
        // unknown org-level files left alone
      }
    }
  }

  function classifyRepositories(orgSlug: string, reposDir: string): void {
    if (!fs.existsSync(reposDir)) return;
    for (const e of fs.readdirSync(reposDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const repoRoot = path.join(reposDir, e.name);
      untraversedRepoRoots.push(repoRoot);

      // Surgical: extract ONLY <repo>/.solosquad/repo.yaml. Anything else
      // inside <repo>/ is class A (user code) — do not enumerate.
      const repoYaml = path.join(repoRoot, ".solosquad", "repo.yaml");
      if (fs.existsSync(repoYaml)) {
        pushFile(repoYaml, "A*", orgSlug, e.name);
      }
      // The .solosquad container itself is also A* (gets removed surgically).
      const solosquadDir = path.join(repoRoot, ".solosquad");
      if (fs.existsSync(solosquadDir)) {
        entries.push({
          absPath: solosquadDir,
          relPath: path.relative(workspace, solosquadDir).split(path.sep).join("/"),
          cls: "A*",
          kind: "directory",
          orgSlug,
          repoSlug: e.name,
        });
        totals["A*"].count++;
      }
    }
  }

  return { entries, totals, untraversedRepoRoots };
}

/**
 * Summary line per class for CLI/doctor reports.
 */
export function summarizeClassification(result: ClassifyResult): string[] {
  const lines: string[] = [];
  for (const cls of ["A", "A*", "B", "C", "D", "E"] as const) {
    const t = result.totals[cls];
    if (t.count === 0) continue;
    lines.push(`${cls.padEnd(2)} ${t.count.toString().padStart(5)} entries, ${formatBytes(t.bytes)}`);
  }
  if (result.untraversedRepoRoots.length > 0) {
    lines.push(`A   ${result.untraversedRepoRoots.length} repo root(s) — not traversed (user code, immutable)`);
  }
  return lines;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
