import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateCronDef } from "../src/scheduler/cron-validate.js";
import { loadCronDefs, type CronDef } from "../src/scheduler/cron-def.js";
import { cronShowCommand } from "../src/cli/cron.js";

function def(p: Partial<CronDef>): CronDef {
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
  const r = validateCronDef(def({}), { promptExists: () => true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("invalid cron is an error", () => {
  const r = validateCronDef(def({ cron: "not a cron" }));
  assert.ok(codes(r.errors).includes("CRON_CRON_INVALID"));
});

test("missing prompt file is an error", () => {
  const r = validateCronDef(def({}), { promptExists: () => false });
  assert.ok(codes(r.errors).includes("CRON_PROMPT_MISSING"));
});

test("one-shot def (future `at`, empty cron) is valid", () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const r = validateCronDef(def({ cron: "", at: future }), { promptExists: () => true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("one-shot with a past `at` warns (cleaned up, not run)", () => {
  const r = validateCronDef(def({ cron: "", at: "2020-01-01T00:00:00.000Z" }), { promptExists: () => true });
  assert.equal(r.ok, true);
  assert.ok(codes(r.warnings).includes("CRON_AT_PAST"));
});

test("one-shot with a malformed `at` is an error", () => {
  const r = validateCronDef(def({ cron: "", at: "not-a-date" }), { promptExists: () => true });
  assert.ok(codes(r.errors).includes("CRON_AT_INVALID"));
});

test("neither cron nor at is a missing-schedule error", () => {
  const r = validateCronDef(def({ cron: "" }), { promptExists: () => true });
  assert.ok(codes(r.errors).includes("CRON_CRON_MISSING"));
});

test("id collision with a built-in is an error", () => {
  const r = validateCronDef(def({ id: "morning-brief" }), {
    reservedIds: new Set(["morning-brief"]),
    promptExists: () => true,
  });
  assert.ok(codes(r.errors).includes("CRON_ID_COLLISION"));
});

test("unknown kind is an error", () => {
  const r = validateCronDef(def({ kind: "weird" as unknown as CronDef["kind"] }), { promptExists: () => true });
  assert.ok(codes(r.errors).includes("CRON_KIND_UNKNOWN"));
});

test("malformed id is an error", () => {
  const r = validateCronDef(def({ id: "Bad Id" }), { promptExists: () => true });
  assert.ok(codes(r.errors).includes("CRON_ID_MALFORMED"));
});

test("every-minute cron warns (min-interval guard)", () => {
  const r = validateCronDef(def({ cron: "* * * * *" }), { promptExists: () => true });
  assert.ok(codes(r.warnings).includes("CRON_TOO_FREQUENT"));
});

// v1.3.4 §D — min-interval guard extended to <5 minutes.
test("sub-5-minute cron warns (min-interval guard extended)", () => {
  const r = validateCronDef(def({ cron: "*/2 * * * *" }), { promptExists: () => true });
  assert.ok(codes(r.warnings).includes("CRON_TOO_FREQUENT"));
});

// v1.3.4 §D — DST risk window.
test("daily cron at 02:00 warns about the DST window", () => {
  const r = validateCronDef(def({ cron: "0 2 * * *" }), { promptExists: () => true });
  assert.ok(codes(r.warnings).includes("CRON_DST_WINDOW"));
  const safe = validateCronDef(def({ cron: "0 9 * * *" }), { promptExists: () => true });
  assert.ok(!codes(safe.warnings).includes("CRON_DST_WINDOW"));
});

// v1.3.4 §C — timezone validation.
test("invalid timezone errors (CRON_TZ_INVALID), valid passes", () => {
  const bad = validateCronDef(def({ timezone: "Asia/Seuol" }), { promptExists: () => true });
  assert.ok(codes(bad.errors).includes("CRON_TZ_INVALID"));
  const ok = validateCronDef(def({ timezone: "America/New_York" }), { promptExists: () => true });
  assert.ok(!codes(ok.errors).includes("CRON_TZ_INVALID"));
});

// v1.3.4 §A — jitter validation.
test("unparseable maxRandomDelay errors; oversized jitter warns", () => {
  const bad = validateCronDef(def({ maxRandomDelay: "soon" }), { promptExists: () => true });
  assert.ok(codes(bad.errors).includes("CRON_JITTER_INVALID"));
  // daily cron (1440min cadence); 2h jitter > 720min half-cadence → warn
  const big = validateCronDef(def({ cron: "0 9 * * *", maxRandomDelay: "13h" }), { promptExists: () => true });
  assert.ok(codes(big.warnings).includes("CRON_JITTER_TOO_LARGE"));
});

// v1.3.4 §F2 — channel is now optional (auto-resolved); empty no longer errors.
test("empty channel no longer errors (auto-resolved to works-<handle>)", () => {
  const r = validateCronDef(def({ channel: "" }), { promptExists: () => true });
  assert.ok(!codes(r.errors).includes("CRON_CHANNEL_MISSING"));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("loadCronDefs reads yaml defs and applies defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-sched-"));
  fs.writeFileSync(path.join(dir, "weekly.yaml"), "id: weekly\nname: Weekly\nkind: background\ncron: \"0 9 * * 1\"\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
  const defs = loadCronDefs(dir);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].id, "weekly");
  assert.equal(defs[0].channel, ""); // v1.3.4 §F2 — empty = auto-resolve works-<handle>
  assert.equal(defs[0].enabled, true); // default
});

// §9.6 — `crons show <id>` lifecycle verb.
test("cronShowCommand: built-in cron prints, unknown id exits 1", async () => {
  const origLog = console.log;
  const prevExit = process.exitCode;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await cronShowCommand("morning-brief");
    assert.match(lines.join("\n"), /built-in cron/);
    process.exitCode = 0;
    await cronShowCommand("definitely-not-a-real-cron");
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = origLog;
    process.exitCode = prevExit;
  }
});

// §9.6 — `crons new` scaffolds a valid yaml + stub prompt (no LLM).
test("cronNewCommand: scaffolds valid files", async () => {
  const { cronNewCommand } = await import("../src/cli/cron.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-sched-new-"));
  // getCronsDir walks from cwd; create a .solosquad/crons under dir and chdir
  const prevCwd = process.cwd();
  const origLog = console.log;
  const prevExit = process.exitCode;
  console.log = () => {};
  fs.mkdirSync(path.join(dir, ".solosquad", "crons"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".solosquad", "workspace.yaml"), "version: 1.3.1\n");
  process.chdir(dir);
  try {
    await cronNewCommand("weekly-digest", { cron: "0 9 * * 1", kind: "background" });
    const base = path.join(dir, ".solosquad", "crons");
    assert.ok(fs.existsSync(path.join(base, "weekly-digest.yaml")));
    assert.ok(fs.existsSync(path.join(base, "weekly-digest.md")));
  } finally {
    process.chdir(prevCwd);
    console.log = origLog;
    process.exitCode = prevExit;
  }
});
