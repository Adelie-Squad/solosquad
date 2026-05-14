/**
 * v0.6 S6.B §11 — GitHub Actions PR review bot entry point.
 *
 * Runs inside `.github/workflows/skill-review.yml`. Reads the PR event payload
 * from `$GITHUB_EVENT_PATH`, walks the changed files for SKILL.md /
 * agent-profile.yaml / core/*.md / domain/*.md, and emits a markdown body to
 * `pr-review-body.md` (path is configurable via `PR_REVIEW_OUTPUT`). A
 * subsequent workflow step uses the `gh` CLI to post or update the comment.
 *
 * Why pure-Node + gh-CLI instead of @octokit/rest:
 *   - Zero new devDependencies. The workflow already has `gh` pre-installed
 *     on `ubuntu-latest`, so `gh pr comment` works out of the box.
 *   - The orchestration is more testable — modules emit data, the entry
 *     script renders, the *workflow* posts. Each layer is unit-testable.
 *
 * The script is NOT exported as a default — it self-runs when invoked, but
 * exposes its core orchestration as `runPrReview()` for tests to drive
 * without touching env vars.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { diffFrontmatter, type FrontmatterDiff } from "./skill-pr-review/frontmatter-diff.js";
import {
  detectKeywordConflicts,
  type SkillKeywordSet,
} from "./skill-pr-review/keyword-conflict.js";
import { validateProfileYaml } from "./skill-pr-review/profile-validator.js";
import { lintCoreMarkdown } from "./skill-pr-review/markdown-lint.js";
import { detectDomainOverlap } from "./skill-pr-review/domain-overlap.js";
import {
  buildComment,
  type CommentInput,
  type ProfileFileResult,
  type CoreFileResult,
} from "./skill-pr-review/comment-formatter.js";
import { parseSkillMd } from "../src/bot/skill-parser.js";

export type FileStatus = "added" | "modified" | "removed" | "renamed";

export interface ChangedFile {
  path: string;
  status: FileStatus;
  /** Previous path on rename (otherwise same as path). */
  previousPath?: string;
}

export interface ContentLoader {
  /** Load content at HEAD (after the PR). undefined for `removed`. */
  loadAfter(file: string): string | undefined;
  /** Load content at the merge base (before the PR). undefined for `added`. */
  loadBefore(file: string): string | undefined;
}

export interface RunPrReviewOpts {
  changedFiles: ChangedFile[];
  loader: ContentLoader;
  /** Pre-PR baseline of all SKILL keyword sets across the repo. */
  existingKeywords: SkillKeywordSet[];
}

export interface RunPrReviewResult {
  body: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
}

const SKILL_PATH_RE = /(?:^|\/)SKILL\.md$/;
const PROFILE_PATH_RE = /(?:^|\/)agent-profile\.yaml$/;
const CORE_PATH_RE = /(?:^|\/)core\/[^/]+\.md$/;
const DOMAIN_PATH_RE = /(?:^|\/)domain\/[^/]+\.md$/;

export function runPrReview(opts: RunPrReviewOpts): RunPrReviewResult {
  const diffs: FrontmatterDiff[] = [];
  const profileResults: ProfileFileResult[] = [];
  const coreResults: CoreFileResult[] = [];
  const domainFiles: { path: string; content: string }[] = [];
  const incomingKeywords: SkillKeywordSet[] = [];

  for (const cf of opts.changedFiles) {
    if (SKILL_PATH_RE.test(cf.path)) {
      const after = cf.status === "removed" ? undefined : opts.loader.loadAfter(cf.path);
      const before =
        cf.status === "added"
          ? undefined
          : opts.loader.loadBefore(cf.previousPath ?? cf.path);

      const diff = diffFrontmatter(before, after, cf.path);
      diffs.push(diff);

      if (after !== undefined) {
        try {
          const spec = parseSkillMd(after, cf.path);
          const kws = spec.triggers?.keyword ?? [];
          if (kws.length > 0) {
            incomingKeywords.push({ name: spec.name, keywords: kws });
          }
        } catch {
          // Parse errors already surfaced via diff.parseErrors.
        }
      }
    } else if (PROFILE_PATH_RE.test(cf.path)) {
      if (cf.status === "removed") continue;
      const content = opts.loader.loadAfter(cf.path);
      if (content === undefined) continue;
      const result = validateProfileYaml(content);
      profileResults.push({ path: cf.path, issues: result.issues });
    } else if (CORE_PATH_RE.test(cf.path)) {
      if (cf.status === "removed") continue;
      const content = opts.loader.loadAfter(cf.path);
      if (content === undefined) continue;
      const result = lintCoreMarkdown(content);
      coreResults.push({ path: cf.path, issues: result.issues });
    } else if (DOMAIN_PATH_RE.test(cf.path)) {
      if (cf.status === "removed") continue;
      const content = opts.loader.loadAfter(cf.path);
      if (content === undefined) continue;
      domainFiles.push({ path: cf.path, content });
    }
  }

  // Keyword conflicts — incoming vs existing.
  const keywordConflicts = detectKeywordConflicts(incomingKeywords, opts.existingKeywords);

  // Domain overlap — within the PR's changed set.
  const domainOverlaps = detectDomainOverlap(domainFiles);

  const input: CommentInput = {
    diffs,
    keywordConflicts,
    profileResults,
    coreResults,
    domainOverlaps,
  };
  const built = buildComment(input);
  return {
    body: built.body,
    ok: built.ok,
    errorCount: built.errorCount,
    warningCount: built.warningCount,
  };
}

// ---------------------------------------------------------------------------
// CLI / Actions entry
// ---------------------------------------------------------------------------

interface PullRequestEventPayload {
  pull_request?: {
    base?: { sha?: string };
    head?: { sha?: string };
  };
  number?: number;
}

interface GhFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

function readEventPayload(): PullRequestEventPayload | undefined {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PullRequestEventPayload;
  } catch {
    return undefined;
  }
}

function fetchChangedFilesFromGh(prNumber: number): ChangedFile[] {
  const out = execFileSync("gh", ["pr", "view", String(prNumber), "--json", "files"], {
    encoding: "utf-8",
  });
  const parsed = JSON.parse(out) as { files?: { path: string; additions: number; deletions: number }[] };
  // `gh pr view --json files` only gives paths + counts, not status. Use
  // the GitHub API directly for the status field.
  const apiOut = execFileSync(
    "gh",
    ["api", `repos/${process.env.GITHUB_REPOSITORY}/pulls/${prNumber}/files`, "--paginate"],
    { encoding: "utf-8" },
  );
  const apiFiles = JSON.parse(apiOut) as GhFile[];
  return apiFiles.map((f) => ({
    path: f.filename,
    status: (f.status === "renamed" ? "renamed" : (f.status as FileStatus)) ?? "modified",
    previousPath: f.previous_filename,
  }));
}

function fetchContentAt(file: string, sha: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${sha}:${file}`], { encoding: "utf-8" });
  } catch {
    return undefined;
  }
}

function loadAllExistingKeywords(baseSha: string, changedPaths: Set<string>): SkillKeywordSet[] {
  // Walk the base tree for all SKILL.md, excluding files that this PR is
  // editing (those are the incoming side of the conflict comparison).
  let lsTree: string;
  try {
    lsTree = execFileSync("git", ["ls-tree", "-r", "--name-only", baseSha], {
      encoding: "utf-8",
    });
  } catch {
    return [];
  }

  const skillPaths = lsTree
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => SKILL_PATH_RE.test(l) && !changedPaths.has(l));

  const out: SkillKeywordSet[] = [];
  for (const sp of skillPaths) {
    const content = fetchContentAt(sp, baseSha);
    if (!content) continue;
    try {
      const spec = parseSkillMd(content, sp);
      const kws = spec.triggers?.keyword ?? [];
      if (kws.length > 0) out.push({ name: spec.name, keywords: kws });
    } catch {
      // Skip malformed pre-existing SKILLs — that's pre-existing tech debt.
    }
  }
  return out;
}

function mainCli(): void {
  const payload = readEventPayload();
  if (!payload?.pull_request) {
    console.error("skill-pr-review: not running in a pull_request context — exiting");
    process.exitCode = 0;
    return;
  }

  const prNumber = payload.number;
  const baseSha = payload.pull_request.base?.sha;
  const headSha = payload.pull_request.head?.sha;
  if (!prNumber || !baseSha || !headSha) {
    console.error("skill-pr-review: missing PR number / base / head sha");
    process.exitCode = 1;
    return;
  }

  const files = fetchChangedFilesFromGh(prNumber);
  const changedPaths = new Set(files.map((f) => f.path));
  const existingKeywords = loadAllExistingKeywords(baseSha, changedPaths);

  const loader: ContentLoader = {
    loadAfter(file) {
      return fetchContentAt(file, headSha);
    },
    loadBefore(file) {
      return fetchContentAt(file, baseSha);
    },
  };

  const result = runPrReview({ changedFiles: files, loader, existingKeywords });
  const outPath = process.env.PR_REVIEW_OUTPUT ?? "pr-review-body.md";
  fs.writeFileSync(outPath, result.body, "utf-8");
  console.log(
    `skill-pr-review: ${result.ok ? "PASS" : "FAIL"} — ${result.errorCount} error(s), ${result.warningCount} warning(s) → ${outPath}`,
  );

  // Fail the action when there are hard errors; warnings alone are non-fatal.
  process.exitCode = result.ok ? 0 : 1;
}

const __filename = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (invokedDirectly) {
  mainCli();
}
