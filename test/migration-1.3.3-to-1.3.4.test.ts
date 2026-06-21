import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v133ToV134 } from "../src/migrations/scripts/1.3.3-to-1.3.4.js";
import { loadWorkspaceYaml } from "../src/util/config.js";

/** v1.3.3 → v1.3.4 chain-completion migration (version bump, no data transform). */

function makeWorkspace(version = "1.3.3"): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sq-133-"));
  const solo = path.join(ws, ".solosquad");
  fs.mkdirSync(solo, { recursive: true });
  fs.writeFileSync(
    path.join(solo, "workspace.yaml"),
    `version: "${version}"\ndisplay_name: Demo\ncreated_at: "2026-01-01"\n`,
  );
  return ws;
}

test("v1.3.3 → v1.3.4 detect matches 1.3.3 only", async () => {
  const ws = makeWorkspace("1.3.3");
  try {
    assert.equal(await v133ToV134.detect(ws), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  for (const other of ["1.3.2", "1.3.4", "1.2.9"]) {
    const w = makeWorkspace(other);
    try {
      assert.equal(await v133ToV134.detect(w), false, `should not match ${other}`);
    } finally {
      fs.rmSync(w, { recursive: true, force: true });
    }
  }
});

test("v1.3.3 → v1.3.4 bumps version + verify passes", async () => {
  const ws = makeWorkspace("1.3.3");
  try {
    const plan = await v133ToV134.plan(ws);
    await v133ToV134.apply(ws, plan);

    const after = loadWorkspaceYaml(ws);
    assert.equal(after?.version, "1.3.4");
    assert.equal(after?.last_migrated_to, "1.3.4");

    const v = await v133ToV134.verify(ws);
    assert.equal(v.ok, true, v.ok ? "" : v.error);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v1.3.3 → v1.3.4 is idempotent (re-run is a no-op)", async () => {
  const ws = makeWorkspace("1.3.3");
  try {
    const plan = await v133ToV134.plan(ws);
    await v133ToV134.apply(ws, plan);
    await v133ToV134.apply(ws, plan);
    assert.equal(loadWorkspaceYaml(ws)?.version, "1.3.4");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
