import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v142ToV143 } from "../src/migrations/scripts/1.4.2-to-1.4.3.js";
import { loadWorkspaceYaml } from "../src/util/config.js";

/** v1.4.2 → v1.4.3 — move `<org>/docs/reports/` up to org-level `<org>/reports/`. */

function makeWorkspace(version = "1.4.2", orgs: string[] = []): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sq-143-"));
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

function seedDocsReports(ws: string, slug: string, files: Record<string, string>): void {
  const dir = path.join(ws, slug, "docs", "reports");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
}

test("v1.4.2 → v1.4.3 detect matches 1.4.2 only", async () => {
  const ws = makeWorkspace("1.4.2");
  try {
    assert.equal(await v142ToV143.detect(ws), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  for (const other of ["1.4.1", "1.4.3", "1.3.11"]) {
    const w = makeWorkspace(other);
    try {
      assert.equal(await v142ToV143.detect(w), false, `should not match ${other}`);
    } finally {
      fs.rmSync(w, { recursive: true, force: true });
    }
  }
});

test("v1.4.2 → v1.4.3 moves docs/reports up to org-level reports/ + drops INDEX + bumps version", async () => {
  const ws = makeWorkspace("1.4.2", ["acme"]);
  seedDocsReports(ws, "acme", {
    "INDEX.md": "# stale seed\n",
    "market-research-widget-260701.md": "# widget research\n",
  });
  try {
    await v142ToV143.apply(ws);

    // report moved up, INDEX dropped, docs/reports removed
    assert.equal(
      fs.readFileSync(path.join(ws, "acme", "reports", "market-research-widget-260701.md"), "utf-8"),
      "# widget research\n",
    );
    assert.equal(fs.existsSync(path.join(ws, "acme", "reports", "INDEX.md")), false, "stale INDEX should be dropped");
    assert.equal(fs.existsSync(path.join(ws, "acme", "docs", "reports")), false, "docs/reports should be removed");

    // version bumped + verify passes
    assert.equal(loadWorkspaceYaml(ws)?.version, "1.4.3");
    assert.equal((await v142ToV143.verify(ws)).ok, true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v1.4.2 → v1.4.3 never overwrites an existing org-level report", async () => {
  const ws = makeWorkspace("1.4.2", ["acme"]);
  seedDocsReports(ws, "acme", { "keep.md": "# from docs\n" });
  fs.mkdirSync(path.join(ws, "acme", "reports"), { recursive: true });
  fs.writeFileSync(path.join(ws, "acme", "reports", "keep.md"), "# existing\n");
  try {
    await v142ToV143.apply(ws);
    // existing org-level file preserved (collision skipped)
    assert.equal(fs.readFileSync(path.join(ws, "acme", "reports", "keep.md"), "utf-8"), "# existing\n");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
