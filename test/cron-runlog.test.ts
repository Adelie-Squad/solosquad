import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recordCronRun,
  readCronRuns,
  lastCronRun,
  lastSuccessfulRun,
  type CronRunRecord,
} from "../src/scheduler/cron-runlog.js";

function orgDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sq-runlog-"));
}

function rec(id: string, status: CronRunRecord["status"], iso: string): CronRunRecord {
  return { id, name: id, startedAt: iso, finishedAt: iso, status, ms: 100 };
}

test("recordCronRun appends and readCronRuns returns newest-first", () => {
  const dir = orgDir();
  try {
    recordCronRun(dir, rec("a", "ok", "2026-06-01T09:00:00.000Z"));
    recordCronRun(dir, rec("a", "ok", "2026-06-02T09:00:00.000Z"));
    recordCronRun(dir, rec("b", "error", "2026-06-03T09:00:00.000Z"));
    const all = readCronRuns(dir);
    assert.equal(all.length, 3);
    assert.equal(all[0].id, "b", "newest first");
    assert.equal(readCronRuns(dir, { id: "a" }).length, 2);
    assert.equal(readCronRuns(dir, { limit: 1 }).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lastCronRun / lastSuccessfulRun pick the right record", () => {
  const dir = orgDir();
  try {
    recordCronRun(dir, rec("a", "ok", "2026-06-01T09:00:00.000Z"));
    recordCronRun(dir, rec("a", "error", "2026-06-02T09:00:00.000Z"));
    assert.equal(lastCronRun(dir, "a")?.status, "error", "last = most recent (any status)");
    assert.equal(lastSuccessfulRun(dir, "a")?.finishedAt, "2026-06-01T09:00:00.000Z", "skips error");
    assert.equal(lastCronRun(dir, "missing"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readCronRuns is empty (not throwing) when no log exists", () => {
  const dir = orgDir();
  try {
    assert.deepEqual(readCronRuns(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
