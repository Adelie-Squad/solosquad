import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v134ToV135 } from "../src/migrations/scripts/1.3.4-to-1.3.5.js";
import { loadWorkspaceYaml } from "../src/util/config.js";

/** v1.3.4 → v1.3.5 — relocate user crons `.solosquad/crons/` → `<org>/crons/`. */

function makeWorkspace(version = "1.3.4", orgs: string[] = []): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sq-135-"));
  const solo = path.join(ws, ".solosquad");
  fs.mkdirSync(solo, { recursive: true });
  fs.writeFileSync(
    path.join(solo, "workspace.yaml"),
    `version: "${version}"\ndisplay_name: Demo\ncreated_at: "2026-01-01"\n`,
  );
  for (const slug of orgs) {
    fs.mkdirSync(path.join(ws, slug), { recursive: true });
    fs.writeFileSync(path.join(ws, slug, ".org.yaml"), `schema_version: 1\nname: ${slug}\nslug: ${slug}\n`);
  }
  return ws;
}

/** Seed a legacy global cron (yaml + md) under `.solosquad/crons/`. */
function seedLegacyCron(ws: string, id: string): void {
  const dir = path.join(ws, ".solosquad", "crons");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\nname: ${id}\nkind: background\ncron: "0 9 * * 1"\nenabled: true\n`);
  fs.writeFileSync(path.join(dir, `${id}.md`), `# ${id}\n`);
}

test("v1.3.4 → v1.3.5 detect matches 1.3.4 only", async () => {
  const ws = makeWorkspace("1.3.4");
  try {
    assert.equal(await v134ToV135.detect(ws), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  for (const other of ["1.3.3", "1.3.5", "1.2.9"]) {
    const w = makeWorkspace(other);
    try {
      assert.equal(await v134ToV135.detect(w), false, `should not match ${other}`);
    } finally {
      fs.rmSync(w, { recursive: true, force: true });
    }
  }
});

test("v1.3.4 → v1.3.5 moves legacy crons into the sole org + bumps version", async () => {
  const ws = makeWorkspace("1.3.4", ["acme"]);
  seedLegacyCron(ws, "weekly-digest");
  try {
    const plan = await v134ToV135.plan(ws);
    await v134ToV135.apply(ws, plan);

    // Relocated into <org>/crons/, legacy dir drained.
    assert.ok(fs.existsSync(path.join(ws, "acme", "crons", "weekly-digest.yaml")));
    assert.ok(fs.existsSync(path.join(ws, "acme", "crons", "weekly-digest.md")));
    assert.ok(!fs.existsSync(path.join(ws, ".solosquad", "crons", "weekly-digest.yaml")));

    const after = loadWorkspaceYaml(ws);
    assert.equal(after?.version, "1.3.5");
    assert.equal(after?.last_migrated_to, "1.3.5");

    const v = await v134ToV135.verify(ws);
    assert.equal(v.ok, true, v.ok ? "" : v.error);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v1.3.4 → v1.3.5 with multiple orgs moves into the first org + warns", async () => {
  const ws = makeWorkspace("1.3.4", ["acme", "globex"]);
  seedLegacyCron(ws, "digest");
  try {
    const plan = await v134ToV135.plan(ws);
    assert.ok(plan.warnings.some((w) => /multiple orgs/i.test(w)), "expected a multi-org warning");
    await v134ToV135.apply(ws, plan);
    // First org by directory order = acme.
    assert.ok(fs.existsSync(path.join(ws, "acme", "crons", "digest.yaml")));
    assert.equal((await v134ToV135.verify(ws)).ok, true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v1.3.4 → v1.3.5 with no crons just bumps the version", async () => {
  const ws = makeWorkspace("1.3.4", ["acme"]);
  try {
    const plan = await v134ToV135.plan(ws);
    await v134ToV135.apply(ws, plan);
    assert.equal(loadWorkspaceYaml(ws)?.version, "1.3.5");
    assert.equal((await v134ToV135.verify(ws)).ok, true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v1.3.4 → v1.3.5 never clobbers an existing destination + is idempotent", async () => {
  const ws = makeWorkspace("1.3.4", ["acme"]);
  seedLegacyCron(ws, "digest");
  // Pre-existing destination with custom content must survive.
  const destDir = path.join(ws, "acme", "crons");
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, "digest.yaml"), "id: digest\ncustom: keep-me\n");
  try {
    const plan = await v134ToV135.plan(ws);
    await v134ToV135.apply(ws, plan);
    assert.match(fs.readFileSync(path.join(destDir, "digest.yaml"), "utf-8"), /keep-me/);
    // Re-run is a no-op (version already bumped; detect false).
    assert.equal(await v134ToV135.detect(ws), false);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
