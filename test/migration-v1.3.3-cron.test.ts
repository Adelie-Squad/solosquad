import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v132ToV133 } from "../src/migrations/scripts/1.3.2-to-1.3.3.js";
import { loadWorkspaceYaml } from "../src/util/config.js";

/** v1.3.3 cron rename — on-disk dir migration. */

function makeWorkspace(version = "1.3.2"): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sq-cron-"));
  const solo = path.join(ws, ".solosquad");
  fs.mkdirSync(solo, { recursive: true });
  fs.writeFileSync(
    path.join(solo, "workspace.yaml"),
    `version: "${version}"\ndisplay_name: Demo\ncreated_at: "2026-01-01"\n`
  );
  // v1.1 user override dir with a user-authored cron def
  fs.mkdirSync(path.join(solo, "schedules"), { recursive: true });
  fs.writeFileSync(path.join(solo, "schedules", "foo.yaml"), "id: foo\ncron: '0 9 * * 1'\n");
  fs.writeFileSync(path.join(solo, "schedules", "foo.md"), "# foo\n");
  // an org with legacy routine-logs
  const org = path.join(ws, "demo");
  fs.mkdirSync(path.join(org, ".solosquad"), { recursive: true });
  fs.writeFileSync(path.join(org, ".org.yaml"), "slug: demo\nname: Demo\n");
  fs.mkdirSync(path.join(org, "memory", "routine-logs"), { recursive: true });
  fs.writeFileSync(path.join(org, "memory", "routine-logs", "run.jsonl"), "{}\n");
  return ws;
}

test("v1.3.2 → v1.3.3 detect matches 1.3.2 only", async () => {
  const ws = makeWorkspace("1.3.2");
  try {
    assert.equal(await v132ToV133.detect(ws), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  const ws2 = makeWorkspace("1.3.3");
  try {
    assert.equal(await v132ToV133.detect(ws2), false);
  } finally {
    fs.rmSync(ws2, { recursive: true, force: true });
  }
});

test("v1.3.2 → v1.3.3 renames schedules→crons + routine-logs→cron-logs and bumps version", async () => {
  const ws = makeWorkspace("1.3.2");
  try {
    await v132ToV133.apply(ws);

    // .solosquad/schedules → .solosquad/crons
    assert.ok(
      fs.existsSync(path.join(ws, ".solosquad", "crons", "foo.yaml")),
      "crons/foo.yaml should exist"
    );
    assert.ok(
      fs.existsSync(path.join(ws, ".solosquad", "crons", "foo.md")),
      "crons/foo.md should exist"
    );
    assert.ok(
      !fs.existsSync(path.join(ws, ".solosquad", "schedules")),
      ".solosquad/schedules should be gone"
    );

    // <org>/memory/routine-logs → cron-logs
    assert.ok(
      fs.existsSync(path.join(ws, "demo", "memory", "cron-logs", "run.jsonl")),
      "cron-logs/run.jsonl should exist"
    );
    assert.ok(
      !fs.existsSync(path.join(ws, "demo", "memory", "routine-logs")),
      "memory/routine-logs should be gone"
    );

    // version bumped + verify passes
    assert.equal(loadWorkspaceYaml(ws)?.version, "1.3.3");
    const v = await v132ToV133.verify(ws);
    assert.equal(v.ok, true, v.ok ? "" : v.error);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v1.3.2 → v1.3.3 is idempotent (re-run is a no-op)", async () => {
  const ws = makeWorkspace("1.3.2");
  try {
    await v132ToV133.apply(ws);
    // second run on an already-migrated workspace must not throw
    await v132ToV133.apply(ws);
    assert.ok(fs.existsSync(path.join(ws, ".solosquad", "crons", "foo.yaml")));
    assert.equal(loadWorkspaceYaml(ws)?.version, "1.3.3");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
