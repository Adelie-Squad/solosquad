import { test } from "node:test";
import assert from "node:assert/strict";

import { agentValidateCommand } from "../src/cli/agent.js";

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
