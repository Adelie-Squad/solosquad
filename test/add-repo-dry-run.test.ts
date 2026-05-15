import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatInspectionReport,
  inspectRepo,
  humanBytes,
} from "../src/util/repo-inspect.js";

/**
 * v0.8.3 §3 — add-repo --dry-run + repo-inspect.
 *
 * The inspector itself is testable in isolation. The CLI wrapper
 * (src/cli/add-repo.ts) just calls inspectRepo + formats; we test it
 * indirectly by asserting that a dry-run pass over a tmp dir writes
 * exactly zero new files.
 */

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-repo-inspect-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# sample\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "index.ts"), "export const x = 1;\n");
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return dir;
}

test("inspectRepo returns file stats with git bytes separated", () => {
  const dir = tempRepo();
  try {
    const report = inspectRepo(dir);
    assert.ok(report.fileStats.fileCount >= 3);
    assert.ok(report.fileStats.totalBytes > 0);
    assert.ok(report.fileStats.gitBytes > 0);
    assert.ok(report.fileStats.totalBytes >= report.fileStats.gitBytes);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("inspectRepo detects slug collision when reposDir already has target slug", () => {
  const dir = tempRepo();
  const reposDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-repos-"));
  const slug = path.basename(dir);
  fs.mkdirSync(path.join(reposDir, slug)); // pre-existing collision target
  try {
    const report = inspectRepo(dir, { reposDir, slug });
    assert.equal(report.slugCollision, true);
    assert.equal(report.hasAnyRisk, true);
    assert.ok(report.collisionWith?.endsWith(slug));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(reposDir, { recursive: true, force: true });
  }
});

test("inspectRepo flags IDE workspace files with absolute paths", () => {
  const dir = tempRepo();
  try {
    fs.mkdirSync(path.join(dir, ".vscode"));
    const absPath = process.platform === "win32" ? "C:\\Users\\alice\\foo\\bar" : "/Users/alice/projects/foo";
    fs.writeFileSync(
      path.join(dir, ".vscode", "settings.json"),
      JSON.stringify({ "python.envFile": absPath }, null, 2),
    );
    const report = inspectRepo(dir);
    assert.equal(report.ide.length, 1);
    assert.equal(report.ide[0].hasAbsolutePathSetting, true);
    assert.equal(report.hasAnyRisk, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("inspectRepo finds internal absolute-path references in config files", () => {
  const dir = tempRepo();
  try {
    // The inspector greps for the parent dir path. Use process.cwd() since
    // the temp dir is under tmpdir, parent is tmpdir.
    const parent = path.dirname(dir);
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ source: path.join(parent, "external", "file") }),
    );
    const report = inspectRepo(dir);
    assert.ok(report.internalAbsolutePathHits.length >= 1);
    assert.equal(report.hasAnyRisk, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("inspectRepo reports zero risks for a clean repo with no IDE/config hits", () => {
  const dir = tempRepo();
  try {
    const report = inspectRepo(dir);
    // No IDE file, no symlinks, no slug collision, no abs-path hits.
    assert.equal(report.slugCollision, false);
    assert.equal(report.symlinksIntoRepo.length, 0);
    assert.equal(report.internalAbsolutePathHits.length, 0);
    assert.equal(report.ide.length, 0);
    // hasAnyRisk only true if active processes claim the path; on CI it shouldn't.
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("inspectRepo + dry-run pass writes zero files to disk", () => {
  const dir = tempRepo();
  const reposDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-zero-write-"));
  try {
    const beforeRepos = fs.readdirSync(reposDir);
    const beforeDir = listAllFiles(dir);
    const report = inspectRepo(dir, { reposDir, slug: path.basename(dir) });
    const _formatted = formatInspectionReport(report, {
      destination: path.join(reposDir, path.basename(dir)),
      addedFile: `<repo>/.solosquad/repo.yaml`,
    });
    assert.ok(_formatted.includes("From:"));
    assert.ok(_formatted.includes("Risks:"));
    const afterRepos = fs.readdirSync(reposDir);
    const afterDir = listAllFiles(dir);
    assert.deepEqual(beforeRepos, afterRepos);
    assert.deepEqual(beforeDir, afterDir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(reposDir, { recursive: true, force: true });
  }
});

test("humanBytes formats bytes / KB / MB / GB", () => {
  assert.equal(humanBytes(0), "0 B");
  assert.equal(humanBytes(512), "512 B");
  assert.equal(humanBytes(1024), "1.0 KB");
  assert.equal(humanBytes(1024 * 1024), "1.0 MB");
  assert.equal(humanBytes(1024 * 1024 * 1024), "1.00 GB");
});

function listAllFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out.sort();
}
