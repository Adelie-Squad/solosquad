import { test } from "node:test";
import assert from "node:assert/strict";

import { assetListCommand, assetShowCommand, assetValidateCommand } from "../src/cli/asset.js";

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  return { lines, restore: () => { console.log = origLog; } };
}

test("asset list skill: lists bundled skills", async () => {
  const c = capture();
  try {
    await assetListCommand("skill");
  } finally {
    c.restore();
  }
  assert.match(c.lines.join("\n"), /skill\(s\)/);
});

test("asset list agent: delegates to the agent lister", async () => {
  const c = capture();
  try {
    await assetListCommand("agent");
  } finally {
    c.restore();
  }
  assert.match(c.lines.join("\n"), /actor\(s\)/);
});

test("asset: bad kind → exit 2", async () => {
  const prevExit = process.exitCode;
  const origErr = console.error;
  console.error = () => {};
  try {
    process.exitCode = 0;
    await assetListCommand("frobnicate");
    assert.equal(process.exitCode, 2);
    process.exitCode = 0;
    await assetShowCommand("frobnicate", "x");
    assert.equal(process.exitCode, 2);
  } finally {
    console.error = origErr;
    process.exitCode = prevExit;
  }
});

test("asset show: missing id → exit 2", async () => {
  const prevExit = process.exitCode;
  const origErr = console.error;
  console.error = () => {};
  try {
    process.exitCode = 0;
    await assetShowCommand("agent", undefined);
    assert.equal(process.exitCode, 2);
  } finally {
    console.error = origErr;
    process.exitCode = prevExit;
  }
});

test("asset validate workflow: delegates to the workflow gate (passes on bundle)", async () => {
  const prevExit = process.exitCode;
  const c = capture();
  try {
    process.exitCode = 0;
    await assetValidateCommand("workflow");
    assert.notEqual(process.exitCode, 1);
  } finally {
    c.restore();
    process.exitCode = prevExit;
  }
});
