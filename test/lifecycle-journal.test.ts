import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  JournalWriter,
  newRunId,
  readJournal,
  findIncompleteStages,
  isStageCompleted,
  journalPath,
} from "../src/lifecycle/journal.js";

test("JournalWriter appends begin/end and survives reads", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-journal-"));
  const file = journalPath(tmp);
  const w = new JournalWriter(file, newRunId());
  w.begin("stage.a", { foo: 1 });
  w.end("stage.a", { ok: true });
  w.begin("stage.b");
  // crash mid-stage — no end for stage.b

  const entries = readJournal(file);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].status, "begin");
  assert.equal(entries[1].status, "end");
  assert.equal(entries[2].stage, "stage.b");
  assert.equal(entries[2].status, "begin");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("findIncompleteStages returns stages with begin but no end", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-journal-"));
  const file = journalPath(tmp);
  const runId = newRunId();
  const w = new JournalWriter(file, runId);
  w.begin("stage.a");
  w.end("stage.a");
  w.begin("stage.b");
  // intentionally no end
  const incomplete = findIncompleteStages(readJournal(file));
  assert.deepEqual(incomplete, ["stage.b"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("isStageCompleted respects runId scoping", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-journal-"));
  const file = journalPath(tmp);
  const run1 = newRunId();
  const run2 = newRunId();
  new JournalWriter(file, run1).end("only-run1");
  const w1 = new JournalWriter(file, run1);
  w1.begin("shared");
  w1.end("shared");
  const w2 = new JournalWriter(file, run2);
  w2.begin("shared"); // not ended

  const entries = readJournal(file);
  assert.equal(isStageCompleted(entries, "shared", run1), true);
  assert.equal(isStageCompleted(entries, "shared", run2), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("readJournal skips malformed lines", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-journal-"));
  const file = journalPath(tmp);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ ts: "x", stage: "a", status: "begin", runId: "r1" }),
      "garbage",
      "",
      JSON.stringify({ ts: "y", stage: "a", status: "end", runId: "r1" }),
    ].join("\n"),
  );
  const entries = readJournal(file);
  assert.equal(entries.length, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});
