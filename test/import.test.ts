import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { classifyWorkspace } from "../src/lifecycle/classify.js";
import { extractRepoMeta } from "../src/lifecycle/repo-meta.js";
import { buildArchive } from "../src/lifecycle/archive.js";
import {
  collectRevokeData,
  renderManualRevokeFiles,
  renderRevokeChecklist,
} from "../src/lifecycle/revoke-checklist.js";
import { JournalWriter, newRunId, journalPath } from "../src/lifecycle/journal.js";
import { importArchive } from "../src/lifecycle/import.js";

/**
 * v0.8.1 — `solosquad import` round-trip regression.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §4 + §7 #12.
 *
 * Each test follows the same arc:
 *   1. Build a fresh "source" workspace fixture
 *   2. Pipe it through buildArchive → out.zip
 *   3. importArchive into a fresh "target" workspace, possibly seeded
 *      with conflicting content
 *   4. Assert the target now contains the expected merged state
 *
 * Tests deliberately use small fixtures so the archive is decompressible
 * in memory (yauzl handles the streaming for us).
 */

interface Fixture {
  source: string;
  archive: string;
}

function buildSource(extraSetup?: (ws: string) => void): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-src-"));
  fs.mkdirSync(path.join(ws, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".solosquad", "workspace.yaml"),
    "name: ws\ntimezone: Asia/Seoul\n",
  );
  fs.writeFileSync(
    path.join(ws, ".solosquad", ".env"),
    "DISCORD_TOKEN=src.disc.xyz\nNAME=src\n",
  );
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "# Source workspace guide\n");

  const org = path.join(ws, "myorg");
  fs.mkdirSync(path.join(org, "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(org, ".org.yaml"),
    yaml.dump({ slug: "myorg", name: "MyOrg", schema_version: 1, provider: "local" }),
  );
  fs.writeFileSync(
    path.join(org, "memory", "signals.jsonl"),
    '{"id":"sig-1","ts":"2026-05-01"}\n{"id":"sig-2","ts":"2026-05-02"}\n',
  );
  fs.mkdirSync(path.join(org, "workflows", "wf-src"), { recursive: true });
  fs.writeFileSync(
    path.join(org, "workflows", "wf-src", "_status.yaml"),
    "stages: []\n",
  );

  extraSetup?.(ws);
  return ws;
}

async function makeArchive(): Promise<Fixture> {
  const source = buildSource();
  const archive = path.join(source, "farewell.zip");
  const journal = new JournalWriter(journalPath(source), newRunId());
  const classification = classifyWorkspace(source);
  const extracted = extractRepoMeta(source);
  const revokeData = collectRevokeData(source);
  await buildArchive({
    workspace: source,
    workspaceSlug: "src-ws",
    archivePath: archive,
    classification,
    extractedRepos: extracted.extractions,
    envText: fs.readFileSync(path.join(source, ".solosquad", ".env"), "utf-8"),
    revokeChecklist: renderRevokeChecklist(revokeData),
    manualRevokeFiles: renderManualRevokeFiles(revokeData),
    solosquadVersion: "0.7.0",
    scrubContent: false,
    journal,
  });
  return { source, archive };
}

test("importArchive --dry-run reports without writing", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    const report = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: true,
      mode: "merge",
    });
    assert.equal(report.ok, true, report.errors.join("; "));
    assert.ok(report.actions.length > 0);
    // Nothing on disk yet (except the .solosquad/ scaffold the orchestrator
    // creates for the journal).
    assert.equal(fs.existsSync(path.join(target, "myorg")), false);
    assert.equal(fs.existsSync(path.join(target, "AGENTS.md")), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("importArchive extracts AGENTS.md + memory/signals.jsonl into target", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    const report = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: false,
      mode: "merge",
    });
    assert.equal(report.ok, true, report.errors.join("; "));
    assert.ok(fs.existsSync(path.join(target, "AGENTS.md")));
    assert.match(
      fs.readFileSync(path.join(target, "AGENTS.md"), "utf-8"),
      /Source workspace/,
    );
    assert.ok(fs.existsSync(path.join(target, "myorg", "memory", "signals.jsonl")));
    assert.ok(fs.existsSync(path.join(target, "myorg", ".org.yaml")));
    // env.template is class D, copied to .solosquad/.env.template
    assert.ok(fs.existsSync(path.join(target, ".solosquad", ".env.template")));
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("importArchive --merge dedups jsonl rows in existing target", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    // Pre-seed target with overlap + a unique row that should survive.
    fs.mkdirSync(path.join(target, "myorg", "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(target, "myorg", "memory", "signals.jsonl"),
      '{"id":"sig-2","ts":"2026-05-02"}\n{"id":"sig-tgt","ts":"2026-05-10"}\n',
    );

    const report = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: false,
      mode: "merge",
    });
    assert.equal(report.ok, true, report.errors.join("; "));

    const merged = fs.readFileSync(
      path.join(target, "myorg", "memory", "signals.jsonl"),
      "utf-8",
    ).trim().split("\n");
    const ids = merged.map((l) => (JSON.parse(l) as { id: string }).id);
    // dedup preserves existing first, then appends the new ones from archive
    assert.deepEqual(ids.sort(), ["sig-1", "sig-2", "sig-tgt"]);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("importArchive --merge refuses workflow id conflict", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    // Pre-seed target with a workflow that shares wf-src's id
    fs.mkdirSync(path.join(target, "myorg", "workflows", "wf-src"), { recursive: true });
    fs.writeFileSync(
      path.join(target, "myorg", "workflows", "wf-src", "_status.yaml"),
      "stages: []\nuser_owned: true\n",
    );

    const report = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: true, // dry-run still reports conflicts
      mode: "merge",
    });
    assert.equal(report.idConflicts.length, 1);
    assert.deepEqual(report.idConflicts[0].workflowConflicts, ["wf-src"]);
    assert.ok(report.errors.some((e) => /wf-src|workflow id/.test(e)));
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("importArchive --replace overwrites conflicting AGENTS.md", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    // Pre-seed target with an AGENTS.md that should be overwritten
    fs.writeFileSync(path.join(target, "AGENTS.md"), "# Target guide\n");

    const report = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: false,
      mode: "replace",
    });
    assert.equal(report.ok, true, report.errors.join("; "));
    assert.match(
      fs.readFileSync(path.join(target, "AGENTS.md"), "utf-8"),
      /Source workspace/,
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("importArchive --merge preserves existing AGENTS.md as sibling", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    fs.writeFileSync(path.join(target, "AGENTS.md"), "# Target guide (different)\n");

    const report = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: false,
      mode: "merge",
    });
    assert.equal(report.ok, true, report.errors.join("; "));
    // Existing AGENTS.md preserved
    assert.match(
      fs.readFileSync(path.join(target, "AGENTS.md"), "utf-8"),
      /Target guide/,
    );
    // Imported version available alongside
    assert.ok(fs.existsSync(path.join(target, "AGENTS.imported.md")));
    assert.match(
      fs.readFileSync(path.join(target, "AGENTS.imported.md"), "utf-8"),
      /Source workspace/,
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("importArchive into a workspace mapped via --into rewrites org slug", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    const report = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      into: "secondary",
      dryRun: false,
      mode: "merge",
    });
    assert.equal(report.ok, true, report.errors.join("; "));
    assert.ok(fs.existsSync(path.join(target, "secondary", ".org.yaml")));
    assert.equal(fs.existsSync(path.join(target, "myorg")), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("importArchive is idempotent — second run does not mutate disk content", async () => {
  const { source, archive } = await makeArchive();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ss-import-tgt-"));
  try {
    const first = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: false,
      mode: "merge",
    });
    assert.equal(first.ok, true, first.errors.join("; "));

    // Capture content of every imported file before the second run.
    const watchedFiles = [
      path.join(target, "AGENTS.md"),
      path.join(target, "myorg", ".org.yaml"),
      path.join(target, "myorg", "memory", "signals.jsonl"),
    ];
    const before = watchedFiles.map((f) => fs.readFileSync(f));

    // Second run — workflow id collision is *expected* now (wf-src already
    // exists), so we run with --replace so the importer doesn't bail.
    const second = await importArchive({
      archivePath: archive,
      workspace: target,
      cliVersion: "0.8.1",
      dryRun: false,
      mode: "replace",
    });
    assert.equal(second.ok, true, second.errors.join("; "));

    // Bytes must be identical — idempotence means rerun does not mutate.
    const after = watchedFiles.map((f) => fs.readFileSync(f));
    for (let i = 0; i < before.length; i++) {
      assert.ok(
        before[i].equals(after[i]),
        `idempotence broken for ${watchedFiles[i]}`,
      );
    }
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
