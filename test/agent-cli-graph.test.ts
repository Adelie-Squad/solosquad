import { test } from "node:test";
import assert from "node:assert/strict";

import { agentValidateCommand, agentListCommand, agentShowCommand } from "../src/cli/agent.js";

/**
 * `agent validate --graph` should pass on the bundled actor set (0 errors;
 * the peer-mesh cycle warning is expected). We stub console.log to keep test
 * output clean and restore process.exitCode afterward.
 */
test("agent validate --graph passes on the bundled actors", async () => {
  const origLog = console.log;
  const prevExit = process.exitCode;
  console.log = () => {};
  try {
    await agentValidateCommand(undefined, { graph: true });
    assert.notEqual(process.exitCode, 1, "graph validation should not fail on the bundle");
  } finally {
    console.log = origLog;
    process.exitCode = prevExit;
  }
});

test("agent validate with no path and no flags errors", async () => {
  const origErr = console.error;
  const prevExit = process.exitCode;
  console.error = () => {};
  try {
    await agentValidateCommand(undefined, {});
    assert.equal(process.exitCode, 2);
  } finally {
    console.error = origErr;
    process.exitCode = prevExit;
  }
});

// §9.6 — list/show lifecycle verbs over the deterministic bundle.
test("agent list prints the bundled actors grouped by team", async () => {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await agentListCommand({});
  } finally {
    console.log = origLog;
  }
  const out = lines.join("\n");
  assert.match(out, /actor\(s\) — bundle/);
  assert.match(out, /product/);
  assert.match(out, /pmf-planner/);
});

test("agent show resolves by canonical id and by bare name; missing → exit 1", async () => {
  const origLog = console.log;
  const prevExit = process.exitCode;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await agentShowCommand("product/pmf-planner", {});
    assert.match(lines.join("\n"), /team:\s+product/);
    lines.length = 0;
    await agentShowCommand("pmf-planner", {}); // bare name
    assert.match(lines.join("\n"), /product\/pmf-planner/);
    process.exitCode = 0;
    await agentShowCommand("does-not-exist", {});
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = origLog;
    process.exitCode = prevExit;
  }
});
