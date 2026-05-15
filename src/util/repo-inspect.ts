import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { IS_WINDOWS, commandExists, normalizeLine } from "./platform.js";

/**
 * v0.8.3 §3 — Pre-flight inspection for `solosquad add repo`.
 *
 * Detects five risk scenarios that can corrupt a move (or surface broken
 * paths post-move) — surfaces them in --dry-run / --inspect output so the
 * user can decide whether to proceed.
 *
 *   1. Active processes holding files (lsof / handle.exe)
 *   2. Symlinks pointing INTO this repo from elsewhere
 *   3. Repo-internal absolute-path references (configs, docs) to original
 *   4. Slug collision in the target org
 *   5. IDE workspace files with absolute-path settings
 *
 * Each detector is best-effort: a missing tool (lsof not installed,
 * handle.exe absent) returns `available: false` rather than throwing.
 * dry-run never fails on inspection alone — risks are reported as
 * warnings, the user keeps control.
 */

export interface FileSizeStats {
  fileCount: number;
  totalBytes: number;
  gitBytes: number;
}

export interface IdeWorkspaceFinding {
  path: string;
  hasAbsolutePathSetting: boolean;
}

export interface LsofFinding {
  available: boolean;
  /** PIDs holding files; empty array if none, undefined if probe failed. */
  pids?: number[];
  /** Why detection was skipped (tool missing, permission, …). */
  note?: string;
}

export interface InspectionReport {
  source: string;
  fileStats: FileSizeStats;
  ide: IdeWorkspaceFinding[];
  symlinksIntoRepo: string[];
  internalAbsolutePathHits: string[];
  slugCollision: boolean;
  collisionWith?: string;
  activeProcesses: LsofFinding;
  /** Whichever risks are nonzero — for fast "any risk?" check. */
  hasAnyRisk: boolean;
}

export interface InspectOpts {
  /** The org's repositories/ dir — used to detect slug collisions. */
  reposDir?: string;
  /** Slug to test for collision (defaults to basename). */
  slug?: string;
  /**
   * Cap on per-file scans for the absolute-path grep — prevents the
   * inspector from chewing through a multi-gig repo when ripgrep is absent.
   */
  maxFilesToGrep?: number;
}

const IDE_HINT_FILES = [
  ".vscode/settings.json",
  ".vscode/launch.json",
  ".vscode/tasks.json",
  ".idea/workspace.xml",
  ".idea/modules.xml",
  ".vs/ProjectSettings.json",
];

// IDE settings often store Windows paths as JSON, where backslashes are
// doubled. We probe for either form. POSIX paths are matched as at least
// two consecutive `/segment` parts (e.g. /Users/alice or /home/bob).
const ABSOLUTE_PATH_REGEXES: RegExp[] = IS_WINDOWS
  ? [
      /[A-Za-z]:\\\\[^"\r\n]+/g, // JSON-escaped C:\\Users\\...
      /[A-Za-z]:\\[A-Za-z0-9 ._-]+/g, // raw C:\Users
      /[A-Za-z]:\/[A-Za-z0-9 ._/-]+/g, // forward-slash C:/Users
    ]
  : [/(?:\/[A-Za-z0-9._-]+){2,}/g];

const DEFAULT_GREP_FILE_CAP = 200;

const GREP_EXT_WHITELIST = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini",
  ".env", ".cfg", ".conf",
  ".md", ".txt",
]);

export function inspectRepo(source: string, opts: InspectOpts = {}): InspectionReport {
  const abs = path.resolve(source);
  const fileStats = computeFileStats(abs);
  const ide = scanIdeWorkspaceFiles(abs);
  const symlinksIntoRepo = scanSymlinksIntoRepo(abs);
  const internalAbsolutePathHits = scanInternalAbsolutePaths(
    abs,
    opts.maxFilesToGrep ?? DEFAULT_GREP_FILE_CAP,
  );
  const slug = opts.slug ?? path.basename(abs);
  const slugCollision = opts.reposDir
    ? fs.existsSync(path.join(opts.reposDir, slug))
    : false;
  const collisionWith = slugCollision && opts.reposDir
    ? path.join(opts.reposDir, slug)
    : undefined;
  const activeProcesses = probeActiveProcesses(abs);

  const hasAnyRisk =
    ide.some((i) => i.hasAbsolutePathSetting) ||
    symlinksIntoRepo.length > 0 ||
    internalAbsolutePathHits.length > 0 ||
    slugCollision ||
    (activeProcesses.pids?.length ?? 0) > 0;

  return {
    source: abs,
    fileStats,
    ide,
    symlinksIntoRepo,
    internalAbsolutePathHits,
    slugCollision,
    collisionWith,
    activeProcesses,
    hasAnyRisk,
  };
}

/** Recursively count files + bytes, separating .git/ contribution. */
function computeFileStats(root: string): FileSizeStats {
  let fileCount = 0;
  let totalBytes = 0;
  let gitBytes = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      const insideGit = isInsideDotGit(root, p);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        fileCount++;
        totalBytes += st.size;
        if (insideGit) gitBytes += st.size;
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return { fileCount, totalBytes, gitBytes };
}

function isInsideDotGit(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..")) return false;
  const first = rel.split(path.sep)[0];
  return first === ".git";
}

function scanIdeWorkspaceFiles(root: string): IdeWorkspaceFinding[] {
  const findings: IdeWorkspaceFinding[] = [];
  for (const rel of IDE_HINT_FILES) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    let hasAbsolutePathSetting = false;
    try {
      const body = normalizeLine(fs.readFileSync(p, "utf-8"));
      for (const re of ABSOLUTE_PATH_REGEXES) {
        re.lastIndex = 0;
        if (re.test(body)) {
          hasAbsolutePathSetting = true;
          break;
        }
      }
    } catch {
      // permission or binary — skip
    }
    findings.push({ path: p, hasAbsolutePathSetting });
  }
  return findings;
}

/**
 * Scan immediate parent + user home (1 level deep) for symlinks pointing
 * INTO this repo. Bounded to avoid traversing the whole filesystem.
 */
function scanSymlinksIntoRepo(repoRoot: string): string[] {
  const hits: string[] = [];
  const checkDirs = new Set<string>([
    path.dirname(repoRoot),
    os.homedir(),
  ]);
  for (const dir of checkDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const linkPath = path.join(dir, entry.name);
      try {
        const target = fs.realpathSync(linkPath);
        if (target === repoRoot || target.startsWith(repoRoot + path.sep)) {
          hits.push(linkPath);
        }
      } catch {
        // dangling — ignore
      }
    }
  }
  return hits;
}

/**
 * Scan textual config/doc files for occurrences of the repo's parent
 * directory path — flags absolute-path references that will break post-move.
 * File count is bounded by `maxFiles` so this stays bounded on large repos.
 *
 * Cross-platform: on Windows, paths inside JSON get escaped as `\\` (so
 * `C:\foo` becomes `C:\\foo` in the file). We test for both the raw path
 * and its JSON-escaped form so the detector works regardless of the
 * encoding the config used.
 */
function scanInternalAbsolutePaths(repoRoot: string, maxFiles: number): string[] {
  const parent = path.dirname(repoRoot);
  const needles = uniqueNeedles(parent);
  const hits: string[] = [];
  let scanned = 0;
  const stack: string[] = [repoRoot];
  while (stack.length > 0 && scanned < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (scanned >= maxFiles) break;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // skip .git/ and node_modules — too noisy
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        stack.push(p);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!GREP_EXT_WHITELIST.has(ext)) continue;
      scanned++;
      try {
        const body = fs.readFileSync(p, "utf-8");
        if (needles.some((n) => body.includes(n))) {
          hits.push(p);
        }
      } catch {
        // permission or binary — skip
      }
    }
  }
  return hits;
}

function uniqueNeedles(absPath: string): string[] {
  const out = new Set<string>([absPath]);
  // Windows escaped form (JSON-style double-backslash).
  if (absPath.includes("\\")) {
    out.add(absPath.replace(/\\/g, "\\\\"));
    // Also a forward-slash form (some configs normalize this way).
    out.add(absPath.replace(/\\/g, "/"));
  }
  return [...out];
}

/**
 * Active-process detection via lsof (Unix) / handle.exe (Win).
 * If the tool is absent, returns `available: false` with a hint rather
 * than failing — dry-run should still run on systems without these tools.
 */
function probeActiveProcesses(repoRoot: string): LsofFinding {
  if (IS_WINDOWS) return probeHandleExe(repoRoot);
  return probeLsof(repoRoot);
}

function probeLsof(repoRoot: string): LsofFinding {
  if (!commandExists("lsof")) {
    return { available: false, note: "lsof not installed" };
  }
  try {
    const out = execSync(`lsof -F p +D "${repoRoot}"`, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      encoding: "utf-8",
    });
    const pids = parseLsofPids(out);
    return { available: true, pids };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number | null };
    // lsof exits 1 when there are no matches — treat as empty.
    if (e?.status === 1) return { available: true, pids: [] };
    return { available: false, note: `lsof error: ${e?.message ?? "unknown"}` };
  }
}

function parseLsofPids(out: string): number[] {
  const pids = new Set<number>();
  for (const line of normalizeLine(out).split("\n")) {
    if (!line.startsWith("p")) continue;
    const n = parseInt(line.slice(1), 10);
    if (!Number.isNaN(n)) pids.add(n);
  }
  return [...pids];
}

function probeHandleExe(repoRoot: string): LsofFinding {
  if (!commandExists("handle")) {
    return { available: false, note: "handle.exe (Sysinternals) not installed" };
  }
  try {
    const out = execSync(`handle -nobanner "${repoRoot}"`, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      encoding: "utf-8",
    });
    const pids = parseHandleExePids(out);
    return { available: true, pids };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { available: false, note: `handle.exe error: ${e?.message ?? "unknown"}` };
  }
}

function parseHandleExePids(out: string): number[] {
  const pids = new Set<number>();
  const re = /pid:\s*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n)) pids.add(n);
  }
  return [...pids];
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Render the inspection report as a human-readable block for --dry-run /
 * --inspect output. The exact format is consumed by tests, so don't
 * change cosmetic strings without updating add-repo-dry-run.test.ts.
 */
export function formatInspectionReport(
  report: InspectionReport,
  opts: { destination?: string; addedFile?: string } = {},
): string {
  const lines: string[] = [];
  lines.push(`From: ${report.source}`);
  if (opts.destination) lines.push(`To:   ${opts.destination}`);
  lines.push(
    `Files: ${report.fileStats.fileCount} (${humanBytes(report.fileStats.totalBytes)})  .git: ${humanBytes(report.fileStats.gitBytes)}`,
  );
  if (opts.addedFile) {
    lines.push(`Added: ${opts.addedFile} (1 file)`);
    lines.push(`Untouched: ${Math.max(report.fileStats.fileCount - 0, 0)} user files`);
  }

  const ideHits = report.ide.filter((i) => i.hasAbsolutePathSetting);
  if (report.ide.length > 0) {
    if (ideHits.length === 0) {
      lines.push(`IDE workspace files detected: ${report.ide.map((i) => path.basename(i.path)).join(", ")} (paths preserved)`);
    } else {
      lines.push(
        `IDE workspace files with absolute paths: ${ideHits.map((i) => i.path).join(", ")} — manual review needed`,
      );
    }
  }

  if (report.symlinksIntoRepo.length === 0) {
    lines.push("Symlinks pointing INTO this repo from elsewhere: 0 found");
  } else {
    lines.push(
      `Symlinks pointing INTO this repo: ${report.symlinksIntoRepo.length} (${report.symlinksIntoRepo.join(", ")})`,
    );
  }

  if (report.internalAbsolutePathHits.length > 0) {
    lines.push(
      `Internal absolute-path references: ${report.internalAbsolutePathHits.length} file(s) — first: ${report.internalAbsolutePathHits[0]}`,
    );
  }

  if (report.activeProcesses.available) {
    const pids = report.activeProcesses.pids ?? [];
    lines.push(
      pids.length === 0
        ? "Active processes holding files (lsof): NONE"
        : `Active processes holding files: pid ${pids.join(", ")}`,
    );
  } else {
    lines.push(`Active processes check skipped: ${report.activeProcesses.note ?? "tool unavailable"}`);
  }

  if (report.slugCollision) {
    lines.push(`Slug collision: ${report.collisionWith} already exists`);
  }

  lines.push(report.hasAnyRisk ? "Risks: detected (see above)" : "Risks: none detected");
  return lines.join("\n");
}
