import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateStopCondition,
  normalizeStopWhen,
  readStopHookEvents,
  stopHookEventsPath,
  type NaturalEvaluator,
  type LoopModeForHook,
} from "../src/engine/stop-hook-adapter.js";
import { ensureResultsTsv, appendResults } from "../src/engine/tracker.js";

/**
 * v0.6 S5 §5b — stop-hook-adapter tests.
 *
 * The three DSL forms are exercised independently. The `command` form uses
 * platform-portable shell builtins ("exit 0", "exit 1") so the test does
 * not depend on npm/test binaries being installed.
 */

function makeWorkspace(): { workspace: string; orgSlug: string; goalId: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-stop-hook-"));
  const orgSlug = "demo";
  const goalId = "test-goal";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });
  fs.mkdirSync(path.join(workspace, orgSlug, "goals", goalId), { recursive: true });
  return { workspace, orgSlug, goalId };
}

const TRUE_CMD = process.platform === "win32" ? "cmd /c exit 0" : "sh -c \"exit 0\"";
const FALSE_CMD = process.platform === "win32" ? "cmd /c exit 1" : "sh -c \"exit 1\"";

test("command form: exit code 0 → stop", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { command: TRUE_CMD },
  };
  const result = await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 1, rows: [] },
    loopMode,
  });
  assert.equal(result.stop, true);
  assert.equal(result.form, "command");
  assert.equal(result.timedOut, false);
});

test("command form: non-zero exit → continue", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { command: FALSE_CMD },
  };
  const result = await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 1, rows: [] },
    loopMode,
  });
  assert.equal(result.stop, false);
  assert.equal(result.form, "command");
});

test("command form: timeout → continue (conservative)", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  // A command that sleeps far beyond the timeout. Use a portable form.
  const sleepCmd =
    process.platform === "win32"
      ? "powershell -Command Start-Sleep 30"
      : "sh -c \"sleep 30\"";
  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { command: sleepCmd },
  };
  const t0 = Date.now();
  const result = await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 1, rows: [] },
    loopMode,
    commandTimeoutMs: 300,
  });
  const elapsed = Date.now() - t0;
  assert.equal(result.stop, false, "timeout must continue (conservative)");
  assert.equal(result.timedOut, true);
  assert.ok(elapsed < 5_000, `timeout fired in ${elapsed}ms — should be near 300ms`);
});

test("metric form: threshold ≥ met → stop", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  // Seed results.tsv with a row above threshold.
  ensureResultsTsv(workspace, orgSlug, goalId);
  appendResults(workspace, orgSlug, goalId, [
    {
      cycle: 3,
      timestamp: "2026-05-14T00:00:00.000Z",
      agent: "cycle",
      metric: "cvr_7day",
      value: 0.12,
      status: "keep",
      commit: "abc1234",
      provenance: "conversions/visitors",
      task_id: "task-1",
      description: "cycle 3 keep",
    },
  ]);

  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { metric: { name: "cvr_7day", threshold: 0.10, direction: "≥" } },
  };
  const result = await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 3 },
    loopMode,
  });
  assert.equal(result.stop, true);
  assert.equal(result.form, "metric");
});

test("metric form: threshold not met → continue", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  ensureResultsTsv(workspace, orgSlug, goalId);
  appendResults(workspace, orgSlug, goalId, [
    {
      cycle: 1,
      timestamp: "2026-05-14T00:00:00.000Z",
      agent: "cycle",
      metric: "cvr_7day",
      value: 0.05,
      status: "keep",
      commit: "abc",
      provenance: "p",
      task_id: "task-1",
      description: "cycle 1 keep",
    },
  ]);
  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { metric: { name: "cvr_7day", threshold: 0.10, direction: "≥" } },
  };
  const result = await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 1 },
    loopMode,
  });
  assert.equal(result.stop, false);
});

test("natural form: LLM evaluator returns stop=true → stop", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  const evaluator: NaturalEvaluator = {
    async evaluate({ natural }) {
      return {
        stop: natural.includes("all tests pass"),
        reason: "tests verified green",
      };
    },
  };
  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { natural: "all tests pass and lint clean" },
  };
  const result = await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 1, rows: [] },
    loopMode,
    naturalEvaluator: evaluator,
  });
  assert.equal(result.stop, true);
  assert.equal(result.form, "natural");
});

test("natural form: missing evaluator → continue (conservative)", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { natural: "the goal is met" },
  };
  const result = await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 1, rows: [] },
    loopMode,
  });
  assert.equal(result.stop, false);
  assert.equal(result.form, "natural");
});

test("DSL priority: command > metric > natural when multiple keys are present", () => {
  const normalized = normalizeStopWhen({
    command: "echo hi",
    metric: { name: "x", threshold: 1, direction: "≥" },
    natural: "all tests pass",
  });
  assert.ok(normalized);
  assert.equal(normalized!.form, "command");
});

test("DSL normalization: invalid metric → falls through to natural; v0.5 string → natural", () => {
  // Missing direction → metric form rejected, then natural is the fallback.
  const n1 = normalizeStopWhen({
    metric: { name: "x", threshold: 1 },
    natural: "fallback ok",
  } as unknown as Parameters<typeof normalizeStopWhen>[0]);
  assert.ok(n1);
  assert.equal(n1!.form, "natural");

  // Empty / unknown shape → null.
  const n2 = normalizeStopWhen({} as Parameters<typeof normalizeStopWhen>[0]);
  assert.equal(n2, null);

  // v0.5 string form → treated as natural (caller may attach an evaluator).
  const n3 = normalizeStopWhen("all tests pass");
  assert.ok(n3);
  assert.equal(n3!.form, "natural");
});

test("stop_hook events are appended to <org>/memory/stop-hook-events.jsonl", async () => {
  const { workspace, orgSlug, goalId } = makeWorkspace();
  const loopMode: LoopModeForHook = {
    kind: "spec-gate",
    stop_when: { command: TRUE_CMD },
  };
  await evaluateStopCondition({
    workspace,
    orgSlug,
    goalId,
    cycleResult: { cycle: 5, rows: [] },
    loopMode,
    now: "2026-05-14T12:00:00.000Z",
  });
  const events = readStopHookEvents(workspace, orgSlug) as Array<{
    event_type: string;
    form: string;
    stop: boolean;
    cycle: number;
    goal_id: string;
  }>;
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "stop_hook");
  assert.equal(events[0].form, "command");
  assert.equal(events[0].stop, true);
  assert.equal(events[0].cycle, 5);
  assert.equal(events[0].goal_id, goalId);
  assert.ok(fs.existsSync(stopHookEventsPath(workspace, orgSlug)));
});
