import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { rotateArchive } from "../src/memory/archive-rotate.js";
import { openArchive } from "../src/memory/archive-db.js";

/**
 * v0.6 §4 archive-rotate tests.
 *
 * Each test gets its own tmp workspace. Inputs land in
 * `<ws>/<org>/memory/*.jsonl`; rotation moves cold rows into
 * `<ws>/<org>/memory/archive.sqlite` and trims the JSONL.
 */

function makeWorkspace(): { workspace: string; orgSlug: string; memoryDir: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-arch-rotate-"));
  const orgSlug = "demo";
  const memoryDir = path.join(workspace, orgSlug, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  return { workspace, orgSlug, memoryDir };
}

function isoDaysAgo(days: number, from = Date.now()): string {
  return new Date(from - days * 86_400_000).toISOString();
}

function writeJsonl(file: string, rows: unknown[]): void {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}

test("rotateArchive: archives rows older than hotWindow + trims JSONL", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  const file = path.join(memoryDir, "signals.jsonl");
  const now = "2026-05-14T00:00:00.000Z";
  writeJsonl(file, [
    { timestamp: isoDaysAgo(30, Date.parse(now)), content: "old signal A" },
    { timestamp: isoDaysAgo(20, Date.parse(now)), content: "old signal B" },
    { timestamp: isoDaysAgo(2, Date.parse(now)), content: "fresh signal" },
  ]);

  const stats = rotateArchive({ workspace, orgSlug, now });
  assert.equal(stats.archived_rows, 2);
  assert.equal(stats.deleted_from_jsonl, 2);

  const remaining = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0].includes("fresh signal"));

  // Verify SQLite has them.
  const db = openArchive(workspace, orgSlug);
  try {
    const rows = db.prepare("SELECT snippet FROM archive ORDER BY timestamp ASC").all() as Array<{ snippet: string }>;
    assert.equal(rows.length, 2);
    assert.ok(rows[0].snippet.includes("old signal A"));
  } finally {
    db.close();
  }
});

test("rotateArchive: keeps rows newer than hotWindow untouched (disk preserved)", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  const file = path.join(memoryDir, "decisions.jsonl");
  const now = "2026-05-14T00:00:00.000Z";
  writeJsonl(file, [
    { timestamp: isoDaysAgo(1, Date.parse(now)), content: "yesterday" },
    { timestamp: isoDaysAgo(5, Date.parse(now)), content: "five-day-old" },
  ]);
  const beforeSize = fs.statSync(file).size;

  const stats = rotateArchive({ workspace, orgSlug, now });
  assert.equal(stats.archived_rows, 0);
  assert.equal(stats.deleted_from_jsonl, 0);
  assert.equal(fs.statSync(file).size, beforeSize);
});

test("rotateArchive: retention deletes rows older than retention_days", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  const file = path.join(memoryDir, "decisions.jsonl");
  const now = "2026-05-14T00:00:00.000Z";
  // 400 days ago — older than default 365 retention.
  writeJsonl(file, [
    { timestamp: isoDaysAgo(400, Date.parse(now)), content: "way-too-old" },
    { timestamp: isoDaysAgo(30, Date.parse(now)), content: "in-window" },
  ]);

  const stats = rotateArchive({ workspace, orgSlug, now, retentionDays: 365 });
  // Both rows >= hotWindow(8d) so both archived; then retention deletes the 400d one.
  assert.equal(stats.archived_rows, 2);
  assert.equal(stats.deleted_by_retention, 1);

  const db = openArchive(workspace, orgSlug);
  try {
    const rows = db.prepare("SELECT snippet FROM archive").all() as Array<{ snippet: string }>;
    assert.equal(rows.length, 1);
    assert.ok(rows[0].snippet.includes("in-window"));
  } finally {
    db.close();
  }
});

test("rotateArchive: compressBeforeDelete writes archive-<YYYY-MM>.zst snapshots", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  const file = path.join(memoryDir, "signals.jsonl");
  const now = "2026-05-14T00:00:00.000Z";
  writeJsonl(file, [
    { timestamp: "2024-01-05T00:00:00.000Z", content: "very old A" },
    { timestamp: "2024-01-12T00:00:00.000Z", content: "very old B" },
  ]);

  const stats = rotateArchive({
    workspace,
    orgSlug,
    now,
    retentionDays: 365,
    compressBeforeDelete: true,
  });
  assert.equal(stats.deleted_by_retention, 2);
  assert.ok(stats.compressed_archives.length >= 1);
  for (const file of stats.compressed_archives) {
    assert.ok(file.endsWith(".zst"));
    assert.ok(fs.existsSync(file));
    assert.ok(fs.statSync(file).size > 0);
  }
});

test("rotateArchive: defaults event_type to routine_log for legacy JSONL rows", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  const file = path.join(memoryDir, "routine-logs", "old-log.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = "2026-05-14T00:00:00.000Z";
  writeJsonl(file, [
    { timestamp: isoDaysAgo(20, Date.parse(now)), content: "legacy A" },
    { timestamp: isoDaysAgo(15, Date.parse(now)), content: "legacy B" },
  ]);

  const stats = rotateArchive({ workspace, orgSlug, now });
  assert.equal(stats.archived_rows, 2);
  assert.equal(stats.per_event_type.routine_log, 2);

  const db = openArchive(workspace, orgSlug);
  try {
    const rows = db.prepare("SELECT event_type FROM archive").all() as Array<{ event_type: string }>;
    assert.deepEqual(
      rows.map((r) => r.event_type).sort(),
      ["routine_log", "routine_log"]
    );
  } finally {
    db.close();
  }
});
