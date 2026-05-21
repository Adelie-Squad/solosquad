import { test } from "node:test";
import assert from "node:assert/strict";
import { _precheckInternals } from "../src/lifecycle/precheck.js";

/**
 * v0.9.2 regression catcher — `detectLivePids` must not match its own
 * detection-query process.
 *
 * Pre-v0.9.2 bug: on Windows, detectLivePids ran a PowerShell command whose
 * Where-Object clause contained the literals 'solosquad' and
 * '(bot|schedule|run-routine)'. That PowerShell process's CommandLine
 * therefore matched both regexes, and the WMI enumeration returned the
 * PowerShell PID itself. Symptom: `solosquad uninstall` reported phantom
 * "bot/schedule appears to be running (pid X, Y)" with X/Y changing every
 * invocation, because each call spawned a fresh powershell.exe.
 *
 * Fix (precheck.ts): added `$_.Name -eq 'node.exe'` to the Where-Object
 * clause so powershell.exe (which runs the query) is filtered out first.
 *
 * Regression assertion: calling detectLivePids multiple times in a row
 * must return identical PID sets. With the bug, each call returns a
 * different powershell.exe PID, so the sets diverge.
 */
test("v0.9.2 — detectLivePids returns stable result across invocations (no self-match)", () => {
  const r1 = _precheckInternals.detectLivePids().slice().sort();
  const r2 = _precheckInternals.detectLivePids().slice().sort();
  const r3 = _precheckInternals.detectLivePids().slice().sort();

  assert.deepEqual(
    r1,
    r2,
    `detectLivePids drift between call 1 and 2 — ${JSON.stringify({ r1, r2 })}. ` +
      `Pre-v0.9.2 self-match regression: each call spawned a fresh powershell.exe ` +
      `whose CommandLine matched the WMI query's own regex literals.`,
  );
  assert.deepEqual(r2, r3, `detectLivePids drift between call 2 and 3 — ${JSON.stringify({ r2, r3 })}`);
});
