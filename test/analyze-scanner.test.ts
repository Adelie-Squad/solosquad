import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanRepoSkills, readScannedBody } from "../src/analyze/scanner.js";
import { materializeFixture } from "./analyze/fixtures-helper.js";

/**
 * v0.5 §6.4 — scanner discovery, hash stability, mtime tracking, missing dir.
 */

test("scanner returns empty list when .claude/skills/ is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-scan-miss-"));
  try {
    assert.deepEqual(scanRepoSkills(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scanner discovers recursive .md files and skips non-md", () => {
  const fx = materializeFixture("mixed-typical");
  try {
    const skills = scanRepoSkills(fx.repo);
    assert.equal(skills.length, 4);
    // Should be sorted by relative path.
    const sorted = [...skills].sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(
      skills.map((s) => s.path),
      sorted.map((s) => s.path)
    );
    // POSIX-style separators in stored path.
    for (const s of skills) {
      assert.ok(s.path.startsWith(".claude/skills/"), `path is ${s.path}`);
    }
  } finally {
    fx.cleanup();
  }
});

test("scanner SHA256 hash is 12 hex chars and stable across reads", () => {
  const fx = materializeFixture("pure-codebase-facts");
  try {
    const first = scanRepoSkills(fx.repo);
    const second = scanRepoSkills(fx.repo);
    assert.equal(first.length, 2);
    for (let i = 0; i < first.length; i++) {
      assert.equal(first[i].hash, second[i].hash);
      assert.match(first[i].hash, /^[0-9a-f]{12}$/);
    }
  } finally {
    fx.cleanup();
  }
});

test("scanner hash changes after body edit", () => {
  const fx = materializeFixture("pure-codebase-facts");
  try {
    const before = scanRepoSkills(fx.repo);
    const target = path.join(
      fx.repo,
      ".claude",
      "skills",
      "deploy-staging.md"
    );
    fs.appendFileSync(target, "\n\n## Extra section\n", "utf-8");
    const after = scanRepoSkills(fx.repo);
    const beforeMap = new Map(before.map((s) => [s.path, s.hash]));
    const afterEntry = after.find((s) => s.path.endsWith("deploy-staging.md"));
    assert.ok(afterEntry);
    assert.notEqual(afterEntry.hash, beforeMap.get(afterEntry.path));
  } finally {
    fx.cleanup();
  }
});

test("scanner records mtime ISO and size, readScannedBody returns text", () => {
  const fx = materializeFixture("mixed-typical");
  try {
    const skills = scanRepoSkills(fx.repo);
    assert.ok(skills.length > 0);
    for (const s of skills) {
      assert.match(s.mtime_iso, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(s.size_bytes > 0);
    }
    const body = readScannedBody(fx.repo, skills[0]);
    assert.ok(body.length > 0);
  } finally {
    fx.cleanup();
  }
});
