import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v129ToV132 } from "../src/migrations/scripts/1.2.9-to-1.3.2.js";
import { loadWorkspaceYaml } from "../src/util/config.js";

/** v1.2.9 → v1.3.2 chain-completion migration (version bump, no data transform). */

function makeWorkspace(version = "1.2.9"): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sq-129-"));
  const solo = path.join(ws, ".solosquad");
  fs.mkdirSync(solo, { recursive: true });
  fs.writeFileSync(
    path.join(solo, "workspace.yaml"),
    `version: "${version}"\ndisplay_name: Demo\ncreated_at: "2026-01-01"\n`,
  );
  return ws;
}

test("v1.2.9 → v1.3.2 detect matches 1.2.9 only", async () => {
  const ws = makeWorkspace("1.2.9");
  try {
    assert.equal(await v129ToV132.detect(ws), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  for (const other of ["1.2.8", "1.3.2", "1.3.3"]) {
    const w = makeWorkspace(other);
    try {
      assert.equal(await v129ToV132.detect(w), false, `should not match ${other}`);
    } finally {
      fs.rmSync(w, { recursive: true, force: true });
    }
  }
});

test("v1.2.9 → v1.3.2 bumps version + verify passes", async () => {
  const ws = makeWorkspace("1.2.9");
  try {
    const plan = await v129ToV132.plan(ws);
    await v129ToV132.apply(ws, plan);

    const after = loadWorkspaceYaml(ws);
    assert.equal(after?.version, "1.3.2");
    assert.equal(after?.last_migrated_to, "1.3.2");

    const v = await v129ToV132.verify(ws);
    assert.equal(v.ok, true, v.ok ? "" : v.error);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v1.2.9 → v1.3.2 is idempotent (re-run is a no-op)", async () => {
  const ws = makeWorkspace("1.2.9");
  try {
    const plan = await v129ToV132.plan(ws);
    await v129ToV132.apply(ws, plan);
    await v129ToV132.apply(ws, plan);
    assert.equal(loadWorkspaceYaml(ws)?.version, "1.3.2");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
