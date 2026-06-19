import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeCronDef,
  readCronDef,
  patchCronDef,
  setCronEnabled,
  deleteCronFiles,
  resolveCronRef,
  loadCronDefs,
  type CronDef,
} from "../src/scheduler/cron-def.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sq-cronlc-"));
}

function sampleDef(id: string, over: Partial<CronDef> = {}): CronDef {
  return {
    id, name: id, kind: "background", cron: "0 9 * * 1",
    channel: "workflow", emoji: "⏰", memoryTargets: [], enabled: true, ...over,
  };
}

test("write + read round-trips a def (and scaffolds the prompt)", () => {
  const dir = tmpDir();
  try {
    writeCronDef(sampleDef("foo", { name: "Foo" }), dir, true);
    assert.ok(fs.existsSync(path.join(dir, "foo.yaml")));
    assert.ok(fs.existsSync(path.join(dir, "foo.md")), "prompt scaffolded");
    const back = readCronDef("foo", dir);
    assert.equal(back?.name, "Foo");
    assert.equal(back?.cron, "0 9 * * 1");
    assert.equal(back?.enabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("patchCronDef updates only given fields; id is immutable", () => {
  const dir = tmpDir();
  try {
    writeCronDef(sampleDef("foo"), dir);
    const next = patchCronDef("foo", { cron: "0 0 * * *", name: "Renamed" }, dir);
    assert.equal(next?.cron, "0 0 * * *");
    assert.equal(next?.name, "Renamed");
    assert.equal(next?.kind, "background", "untouched field preserved");
    assert.equal(readCronDef("foo", dir)?.cron, "0 0 * * *");
    assert.equal(patchCronDef("missing", { name: "x" }, dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("setCronEnabled toggles without deleting (pause ≠ delete)", () => {
  const dir = tmpDir();
  try {
    writeCronDef(sampleDef("foo"), dir, true);
    setCronEnabled("foo", false, dir);
    assert.equal(readCronDef("foo", dir)?.enabled, false);
    assert.ok(fs.existsSync(path.join(dir, "foo.yaml")), "file kept when paused");
    setCronEnabled("foo", true, dir);
    assert.equal(readCronDef("foo", dir)?.enabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteCronFiles archives by default, hard removes with --hard", () => {
  const dir = tmpDir();
  try {
    writeCronDef(sampleDef("foo"), dir, true);
    const moved = deleteCronFiles("foo", dir);
    assert.equal(moved.length, 2, "yaml + md moved");
    assert.ok(!fs.existsSync(path.join(dir, "foo.yaml")));
    assert.ok(fs.existsSync(path.join(dir, "_archived")), "archive dir created");

    writeCronDef(sampleDef("bar"), dir, true);
    const removed = deleteCronFiles("bar", dir, { hard: true });
    assert.equal(removed.length, 2);
    assert.ok(!fs.existsSync(path.join(dir, "bar.yaml")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCronRef matches by id, by name (case-insensitive), refuses ambiguity", () => {
  const dir = tmpDir();
  try {
    writeCronDef(sampleDef("foo", { name: "Daily Report" }), dir);
    writeCronDef(sampleDef("bar", { name: "daily report" }), dir); // duplicate name

    assert.deepEqual(resolveCronRef("foo", dir), { kind: "ok", id: "foo" });
    assert.deepEqual(resolveCronRef("MISSING", dir), { kind: "missing" });

    const amb = resolveCronRef("Daily Report", dir);
    assert.equal(amb.kind, "ambiguous");

    // unique name resolves
    writeCronDef(sampleDef("baz", { name: "Unique" }), dir);
    assert.deepEqual(resolveCronRef("unique", dir), { kind: "ok", id: "baz" });
    assert.equal(loadCronDefs(dir).length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
