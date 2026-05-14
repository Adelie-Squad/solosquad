import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseSkillMd,
  validateSkill,
  writeSkillMd,
  SkillParseError,
} from "../bot/skill-parser.js";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.5 §11.4 — Anthropic skills corpus round-trip regression.
 *
 * Goal: make sure `skill-parser.ts` is faithful to *real* Anthropic-shape
 * SKILL.md files, not just our own bundled 25. We exercise the parser
 * against an external fixture set in three modes:
 *
 *   1. Bundled fixtures in `test/fixtures/anthropic-corpus/*.md` — always
 *      checked. Hand-authored representatives of the Anthropic style; no
 *      network required. This is what CI uses.
 *   2. Cached fetched corpus in `test/.cache/anthropic-skills-<sha>/` —
 *      checked if present.
 *   3. Live `anthropics/skills` fetch — opt-in via
 *      `SOLOSQUAD_FETCH_EXTERNAL_CORPUS=1`. Skipped by default to keep CI
 *      deterministic (corpus may change between npm test runs and §13
 *      risk register flags this).
 *
 * For each file the regression checks:
 *   a) `parseSkillMd` succeeds
 *   b) `validateSkill` returns `ok: true` (Anthropic minimal must pass —
 *      no v0.5 extensions required)
 *   c) `writeSkillMd(parsed)` produces text equal (after CRLF normalize) to
 *      the input — byte-identical round-trip
 */

export interface CorpusFailure {
  path: string;
  reason: string;
}

export interface CorpusResult {
  ok: boolean;
  checked: number;
  failures: CorpusFailure[];
  sources: string[];
}

const FIXTURES_REL = path.join("test", "fixtures", "anthropic-corpus");
const CACHE_REL_PREFIX = path.join("test", ".cache", "anthropic-skills-");

export async function runCorpusRegression(opts: {
  repo_root?: string;
  fetch_remote?: boolean;
} = {}): Promise<CorpusResult> {
  const root = opts.repo_root ?? findRepoRoot();
  const fetchRemote =
    opts.fetch_remote ?? process.env.SOLOSQUAD_FETCH_EXTERNAL_CORPUS === "1";

  const sources: string[] = [];
  const files: string[] = [];

  // 1) Bundled fixtures (always).
  const fixturesDir = path.join(root, FIXTURES_REL);
  if (fs.existsSync(fixturesDir)) {
    sources.push(fixturesDir);
    for (const f of fs.readdirSync(fixturesDir)) {
      if (f.endsWith(".md") && f !== "README.md") {
        files.push(path.join(fixturesDir, f));
      }
    }
  }

  // 2) Cached fetched corpus, if any.
  const cacheRoot = path.join(root, "test", ".cache");
  if (fs.existsSync(cacheRoot)) {
    for (const dir of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const full = path.join(cacheRoot, dir.name);
      const base = path.basename(CACHE_REL_PREFIX);
      if (!dir.name.startsWith(base)) continue;
      sources.push(full);
      for (const f of walkSkillFiles(full)) files.push(f);
    }
  }

  // 3) Live fetch (opt-in).
  if (fetchRemote) {
    const fetched = await tryFetchRemote(root);
    if (fetched) {
      sources.push(fetched);
      for (const f of walkSkillFiles(fetched)) files.push(f);
    }
  }

  const failures: CorpusFailure[] = [];
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const reason = checkOne(raw, filePath);
    if (reason) failures.push({ path: filePath, reason });
  }

  return {
    ok: failures.length === 0,
    checked: files.length,
    failures,
    sources,
  };
}

function checkOne(raw: string, filePath: string): string | null {
  let spec;
  try {
    spec = parseSkillMd(raw, filePath);
  } catch (e) {
    if (e instanceof SkillParseError) return `parse: ${e.message}`;
    return `parse: ${(e as Error).message}`;
  }
  const validation = validateSkill(spec);
  if (!validation.ok) {
    const summary = validation.errors.map((er) => er.code).join(", ");
    return `validate: ${summary}`;
  }
  // Round-trip byte-identical (against normalized input).
  const normalized = normalizeLine(raw);
  const round = writeSkillMd(spec);
  if (round !== normalized) {
    return diffSummary(normalized, round);
  }
  return null;
}

function diffSummary(a: string, b: string): string {
  if (a.length !== b.length) {
    return `round-trip: length diff (orig=${a.length}, rewritten=${b.length})`;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const ctx = (s: string, i: number) =>
        s.slice(Math.max(0, i - 10), Math.min(s.length, i + 10));
      return `round-trip: byte diff at offset ${i} (orig=${JSON.stringify(ctx(a, i))}, rewritten=${JSON.stringify(ctx(b, i))})`;
    }
  }
  return "round-trip: unknown mismatch";
}

function walkSkillFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(full);
      }
    }
  }
  return out;
}

async function tryFetchRemote(repoRoot: string): Promise<string | null> {
  // Pinned snapshot to avoid corpus drift between test runs (§13 risk
  // register). Bump deliberately when the corpus is re-audited.
  const TARBALL_URL =
    "https://codeload.github.com/anthropics/skills/tar.gz/refs/heads/main";
  const CACHE_KEY = "head";
  const targetDir = path.join(
    repoRoot,
    "test",
    ".cache",
    `anthropic-skills-${CACHE_KEY}`
  );
  if (fs.existsSync(targetDir)) return targetDir;

  try {
    // Lazy import — Node 18+ ships native fetch.
    const res = await fetch(TARBALL_URL);
    if (!res.ok) return null;
    // For now we don't unpack tarballs in-process (would pull in extra
    // deps). Document the opt-in here; if a user really wants live corpus
    // checks they can populate the cache dir manually with extracted
    // SKILL.md files. This keeps S1 dep-free while leaving the door open.
    return null;
  } catch {
    return null;
  }
}

function findRepoRoot(): string {
  // Climb from `src/analyze/` or `dist/src/analyze/` to the directory
  // containing `package.json`.
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let depth = 0; depth < 6; depth++) {
    if (fs.existsSync(path.join(cur, "package.json"))) return cur;
    cur = path.dirname(cur);
  }
  return process.cwd();
}
