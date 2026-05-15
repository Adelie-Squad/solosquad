import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { classifyWorkspace } from "../src/lifecycle/classify.js";

function mkFixture(): { workspace: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-classify-"));
  // workspace metadata
  fs.mkdirSync(path.join(workspace, ".solosquad"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".solosquad", "workspace.yaml"), "name: ws\n");
  fs.writeFileSync(path.join(workspace, ".solosquad", ".env"), "DISCORD_TOKEN=x\nNAME=y\n");
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# Workspace guide\n");
  fs.mkdirSync(path.join(workspace, ".solosquad", "knowledge"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".solosquad", "knowledge", "glossary.md"), "x\n");

  // org
  const orgRoot = path.join(workspace, "myorg");
  fs.mkdirSync(orgRoot, { recursive: true });
  fs.writeFileSync(
    path.join(orgRoot, ".org.yaml"),
    yaml.dump({ name: "MyOrg", slug: "myorg", schema_version: 1, provider: "local" }),
  );
  fs.mkdirSync(path.join(orgRoot, "memory"), { recursive: true });
  fs.writeFileSync(path.join(orgRoot, "memory", "signals.jsonl"), '{"x":1}\n');
  fs.mkdirSync(path.join(orgRoot, "workflows", "wf-1"), { recursive: true });
  fs.writeFileSync(path.join(orgRoot, "workflows", "wf-1", "_status.yaml"), "stages: []\n");

  // repo with .solosquad/repo.yaml + user code
  const repoRoot = path.join(orgRoot, "repositories", "product-x");
  fs.mkdirSync(path.join(repoRoot, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, ".solosquad", "repo.yaml"),
    "slug: product-x\nname: ProductX\n",
  );
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src", "app.ts"), "console.log('user code');");
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# user repo\n");
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".git", "config"), "[core]\n");

  return { workspace };
}

test("classifyWorkspace finds .env as class D", () => {
  const { workspace } = mkFixture();
  const result = classifyWorkspace(workspace);
  const env = result.entries.find((e) => e.relPath === ".solosquad/.env");
  assert.ok(env, ".env should be classified");
  assert.equal(env!.cls, "D");
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("classifyWorkspace finds AGENTS.md as class B", () => {
  const { workspace } = mkFixture();
  const result = classifyWorkspace(workspace);
  const agents = result.entries.find((e) => e.relPath === "AGENTS.md");
  assert.ok(agents, "AGENTS.md should be classified");
  assert.equal(agents!.cls, "B");
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("classifyWorkspace finds memory/signals.jsonl as class B", () => {
  const { workspace } = mkFixture();
  const result = classifyWorkspace(workspace);
  const mem = result.entries.find((e) => e.relPath === "myorg/memory/signals.jsonl");
  assert.ok(mem, "memory entry should be classified");
  assert.equal(mem!.cls, "B");
  assert.equal(mem!.orgSlug, "myorg");
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("classifyWorkspace extracts ONLY <repo>/.solosquad/repo.yaml as A*, never user code", () => {
  const { workspace } = mkFixture();
  const result = classifyWorkspace(workspace);

  // repo.yaml must be A*
  const repoYaml = result.entries.find((e) =>
    e.relPath === "myorg/repositories/product-x/.solosquad/repo.yaml"
  );
  assert.ok(repoYaml, "repo.yaml extracted");
  assert.equal(repoYaml!.cls, "A*");
  assert.equal(repoYaml!.repoSlug, "product-x");

  // No user code should be enumerated
  const userCode = result.entries.find((e) =>
    e.relPath.includes("repositories/product-x/src") ||
    e.relPath.includes("repositories/product-x/README.md") ||
    e.relPath.includes("repositories/product-x/.git")
  );
  assert.equal(userCode, undefined, "user code under repo must NOT be enumerated");

  // The protected repo root must be reported
  assert.equal(result.untraversedRepoRoots.length, 1);
  assert.ok(result.untraversedRepoRoots[0].endsWith(path.join("repositories", "product-x")));

  fs.rmSync(workspace, { recursive: true, force: true });
});

test("classifyWorkspace produces correct totals", () => {
  const { workspace } = mkFixture();
  const result = classifyWorkspace(workspace);
  assert.ok(result.totals["A*"].count >= 1, "at least one A* entry (repo.yaml + container)");
  assert.ok(result.totals["B"].count >= 1, "at least one B entry");
  assert.ok(result.totals["D"].count >= 1, ".env is class D");
  // class A is never enumerated, but A roots are reported separately
  assert.equal(result.totals["A"].count, 0);
  fs.rmSync(workspace, { recursive: true, force: true });
});
