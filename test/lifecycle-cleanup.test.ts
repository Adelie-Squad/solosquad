import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { classifyWorkspace } from "../src/lifecycle/classify.js";
import { extractRepoMeta } from "../src/lifecycle/repo-meta.js";
import { runCleanup } from "../src/lifecycle/cleanup.js";
import { JournalWriter, newRunId, journalPath } from "../src/lifecycle/journal.js";

function fixtureWithRepo(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-cleanup-"));
  fs.mkdirSync(path.join(workspace, ".solosquad"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".solosquad", "workspace.yaml"), "name: ws\n");

  const org = path.join(workspace, "myorg");
  fs.mkdirSync(org, { recursive: true });
  fs.writeFileSync(
    path.join(org, ".org.yaml"),
    yaml.dump({ slug: "myorg", name: "MyOrg", schema_version: 1, provider: "local" }),
  );
  fs.mkdirSync(path.join(org, "memory"), { recursive: true });
  fs.writeFileSync(path.join(org, "memory", "signals.jsonl"), '{"x":1}\n');

  const repoRoot = path.join(org, "repositories", "product-x");
  fs.mkdirSync(path.join(repoRoot, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, ".solosquad", "repo.yaml"),
    "slug: product-x\nname: ProductX\n",
  );
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src", "app.ts"), "console.log('user code');");
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# user\n");
  return workspace;
}

test("dry-run cleanup writes nothing", async () => {
  const ws = fixtureWithRepo();
  const journal = new JournalWriter(journalPath(ws), newRunId());
  const beforeSize = fs.statSync(path.join(ws, "myorg", "memory", "signals.jsonl")).size;
  const extracted = extractRepoMeta(ws);
  await runCleanup({
    workspace: ws,
    classification: classifyWorkspace(ws),
    extractedRepos: extracted.extractions,
    reposMissingRepoYaml: extracted.reposMissingRepoYaml,
    journal,
    dryRun: true,
    keepWorkspace: false,
    alsoPurgeBackups: false,
  });
  // memory file should still exist with same size
  assert.equal(fs.existsSync(path.join(ws, "myorg", "memory", "signals.jsonl")), true);
  assert.equal(fs.statSync(path.join(ws, "myorg", "memory", "signals.jsonl")).size, beforeSize);
  // repo source still untouched
  assert.equal(fs.existsSync(path.join(ws, "myorg", "repositories", "product-x", "src", "app.ts")), true);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("surgical repo cleanup removes .solosquad/ but leaves all other repo files byte-identical", async () => {
  const ws = fixtureWithRepo();
  const repoRoot = path.join(ws, "myorg", "repositories", "product-x");
  const srcBefore = fs.readFileSync(path.join(repoRoot, "src", "app.ts"));
  const readmeBefore = fs.readFileSync(path.join(repoRoot, "README.md"));

  const journal = new JournalWriter(journalPath(ws), newRunId());
  const extracted = extractRepoMeta(ws);
  const report = await runCleanup({
    workspace: ws,
    classification: classifyWorkspace(ws),
    extractedRepos: extracted.extractions,
    reposMissingRepoYaml: extracted.reposMissingRepoYaml,
    journal,
    dryRun: false,
    keepWorkspace: false,
    alsoPurgeBackups: false,
  });

  // .solosquad/ gone
  assert.equal(fs.existsSync(path.join(repoRoot, ".solosquad")), false);
  // user code byte-identical
  assert.deepEqual(fs.readFileSync(path.join(repoRoot, "src", "app.ts")), srcBefore);
  assert.deepEqual(fs.readFileSync(path.join(repoRoot, "README.md")), readmeBefore);
  // assertion passed
  assert.equal(report.assertions[0]?.passed, true);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("--keep-workspace preserves class B files on disk", async () => {
  const ws = fixtureWithRepo();
  const journal = new JournalWriter(journalPath(ws), newRunId());
  const extracted = extractRepoMeta(ws);
  await runCleanup({
    workspace: ws,
    classification: classifyWorkspace(ws),
    extractedRepos: extracted.extractions,
    reposMissingRepoYaml: extracted.reposMissingRepoYaml,
    journal,
    dryRun: false,
    keepWorkspace: true,
    alsoPurgeBackups: false,
  });
  // memory still on disk
  assert.equal(fs.existsSync(path.join(ws, "myorg", "memory", "signals.jsonl")), true);
  // .solosquad/ still gets removed (A* is always surgical regardless of keep)
  assert.equal(fs.existsSync(path.join(ws, "myorg", "repositories", "product-x", ".solosquad")), false);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("repo with missing repo.yaml is NOT touched", async () => {
  const ws = fixtureWithRepo();
  const repoRoot = path.join(ws, "myorg", "repositories", "product-x");
  // Simulate a half-broken setup: .solosquad exists but no repo.yaml
  fs.unlinkSync(path.join(repoRoot, ".solosquad", "repo.yaml"));
  fs.writeFileSync(path.join(repoRoot, ".solosquad", "garbage.txt"), "x");

  const journal = new JournalWriter(journalPath(ws), newRunId());
  const extracted = extractRepoMeta(ws);
  // extractedRepos must be empty; reposMissingRepoYaml gets the entry
  assert.equal(extracted.extractions.length, 0);
  assert.equal(extracted.reposMissingRepoYaml.length, 1);

  await runCleanup({
    workspace: ws,
    classification: classifyWorkspace(ws),
    extractedRepos: extracted.extractions,
    reposMissingRepoYaml: extracted.reposMissingRepoYaml,
    journal,
    dryRun: false,
    keepWorkspace: false,
    alsoPurgeBackups: false,
  });
  // .solosquad/ still on disk — never touched because extraction failed
  assert.equal(fs.existsSync(path.join(repoRoot, ".solosquad", "garbage.txt")), true);
  fs.rmSync(ws, { recursive: true, force: true });
});
