import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateScheduleDef } from "../src/scheduler/schedule-validate.js";
import { loadScheduleDefs, type ScheduleDef } from "../src/scheduler/schedule-def.js";
import { scheduleShowCommand } from "../src/cli/schedule.js";

function def(p: Partial<ScheduleDef>): ScheduleDef {
  return {
    id: "my-digest",
    name: "My Digest",
    kind: "background",
    cron: "0 9 * * 1",
    channel: "workflow",
    emoji: "📊",
    memoryTargets: [],
    enabled: true,
    ...p,
  };
}

const codes = (fs: { code: string }[]): string[] => fs.map((f) => f.code);

test("valid def passes", () => {
  const r = validateScheduleDef(def({}), { promptExists: () => true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("invalid cron is an error", () => {
  const r = validateScheduleDef(def({ cron: "not a cron" }));
  assert.ok(codes(r.errors).includes("SCHED_CRON_INVALID"));
});

test("missing prompt file is an error", () => {
  const r = validateScheduleDef(def({}), { promptExists: () => false });
  assert.ok(codes(r.errors).includes("SCHED_PROMPT_MISSING"));
});

test("id collision with a built-in is an error", () => {
  const r = validateScheduleDef(def({ id: "morning-brief" }), {
    reservedIds: new Set(["morning-brief"]),
    promptExists: () => true,
  });
  assert.ok(codes(r.errors).includes("SCHED_ID_COLLISION"));
});

test("unknown kind is an error", () => {
  const r = validateScheduleDef(def({ kind: "weird" as unknown as ScheduleDef["kind"] }), { promptExists: () => true });
  assert.ok(codes(r.errors).includes("SCHED_KIND_UNKNOWN"));
});

test("malformed id is an error", () => {
  const r = validateScheduleDef(def({ id: "Bad Id" }), { promptExists: () => true });
  assert.ok(codes(r.errors).includes("SCHED_ID_MALFORMED"));
});

test("every-minute cron warns (min-interval guard)", () => {
  const r = validateScheduleDef(def({ cron: "* * * * *" }), { promptExists: () => true });
  assert.ok(codes(r.warnings).includes("SCHED_TOO_FREQUENT"));
});

test("loadScheduleDefs reads yaml defs and applies defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-sched-"));
  fs.writeFileSync(path.join(dir, "weekly.yaml"), "id: weekly\nname: Weekly\nkind: background\ncron: \"0 9 * * 1\"\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
  const defs = loadScheduleDefs(dir);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].id, "weekly");
  assert.equal(defs[0].channel, "workflow"); // default
  assert.equal(defs[0].enabled, true); // default
});

// §9.6 — `schedules show <id>` lifecycle verb.
test("scheduleShowCommand: built-in routine prints, unknown id exits 1", async () => {
  const origLog = console.log;
  const prevExit = process.exitCode;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await scheduleShowCommand("morning-brief");
    assert.match(lines.join("\n"), /built-in routine/);
    process.exitCode = 0;
    await scheduleShowCommand("definitely-not-a-real-schedule");
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = origLog;
    process.exitCode = prevExit;
  }
});

// §9.6 — `schedules new` scaffolds a valid yaml + stub prompt (no LLM).
test("scheduleNewCommand: scaffolds valid files", async () => {
  const { scheduleNewCommand } = await import("../src/cli/schedule.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-sched-new-"));
  // getSchedulesDir walks from cwd; create a .solosquad/schedules under dir and chdir
  const prevCwd = process.cwd();
  const origLog = console.log;
  const prevExit = process.exitCode;
  console.log = () => {};
  fs.mkdirSync(path.join(dir, ".solosquad", "schedules"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".solosquad", "workspace.yaml"), "version: 1.3.1\n");
  process.chdir(dir);
  try {
    await scheduleNewCommand("weekly-digest", { cron: "0 9 * * 1", kind: "background" });
    const base = path.join(dir, ".solosquad", "schedules");
    assert.ok(fs.existsSync(path.join(base, "weekly-digest.yaml")));
    assert.ok(fs.existsSync(path.join(base, "weekly-digest.md")));
  } finally {
    process.chdir(prevCwd);
    console.log = origLog;
    process.exitCode = prevExit;
  }
});
