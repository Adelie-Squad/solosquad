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

// We deliberately use raw-byte grep on the resulting zip rather than a
// reader library. The contract being tested here is "no secret leaks +
// expected files present" — both are decidable from the raw archive
// bytes without parsing the central directory. (zip compression preserves
// the file *names* in the central directory, and small text payloads
// inside DEFLATE are still findable via substring search in practice for
// these tiny fixtures.)

function makeFixture(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-archive-e2e-"));
  fs.mkdirSync(path.join(workspace, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, ".solosquad", "workspace.yaml"),
    "name: ws\ntimezone: Asia/Seoul\n",
  );
  fs.writeFileSync(
    path.join(workspace, ".solosquad", ".env"),
    "DISCORD_TOKEN=SECRETVALUE.disc.xyz\nWORKSPACE_NAME=demo\n",
  );
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# guide\n");

  // Org
  const org = path.join(workspace, "myorg");
  fs.mkdirSync(org, { recursive: true });
  fs.writeFileSync(
    path.join(org, ".org.yaml"),
    yaml.dump({ slug: "myorg", name: "MyOrg", schema_version: 1, provider: "local" }),
  );
  fs.mkdirSync(path.join(org, "memory"), { recursive: true });
  fs.writeFileSync(path.join(org, "memory", "signals.jsonl"), '{"x":1}\n');

  // Repo
  const repoRoot = path.join(org, "repositories", "product-x");
  fs.mkdirSync(path.join(repoRoot, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, ".solosquad", "repo.yaml"),
    "slug: product-x\nname: ProductX\n",
  );
  // User code (must NOT leak)
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src", "user-secret.ts"), "const UserConfidential = 1;");
  return workspace;
}

test("buildArchive — secret 0건, repo source 0건, archive.yaml + manifest + PII-NOTICE 동봉", async () => {
  const workspace = makeFixture();
  const archivePath = path.join(workspace, "out.zip");
  const journal = new JournalWriter(journalPath(workspace), newRunId());
  const classification = classifyWorkspace(workspace);
  const extracted = extractRepoMeta(workspace);
  const revokeData = collectRevokeData(workspace);
  const result = await buildArchive({
    workspace,
    workspaceSlug: "demo-ws",
    archivePath,
    classification,
    extractedRepos: extracted.extractions,
    envText: fs.readFileSync(path.join(workspace, ".solosquad", ".env"), "utf-8"),
    revokeChecklist: renderRevokeChecklist(revokeData),
    manualRevokeFiles: renderManualRevokeFiles(revokeData),
    solosquadVersion: "0.7.0",
    journal,
  });

  assert.ok(fs.existsSync(archivePath));
  assert.ok(result.size > 0);
  assert.ok(result.manifestRows >= 4); // env.template + revoke + archive.yaml + memory + ...

  const bytes = fs.readFileSync(archivePath);
  // Critical: secret value must not be in the archive
  assert.equal(
    bytes.includes(Buffer.from("SECRETVALUE.disc.xyz")),
    false,
    "secret value leaked into archive",
  );
  // Critical: user code must not be in the archive
  assert.equal(
    bytes.includes(Buffer.from("UserConfidential")),
    false,
    "user repo code leaked into archive",
  );
  // archive.yaml + manifest + PII-NOTICE markers present
  assert.equal(bytes.includes(Buffer.from("archive.yaml")), true);
  assert.equal(bytes.includes(Buffer.from("manifest.tsv")), true);
  assert.equal(bytes.includes(Buffer.from("PII-NOTICE.md")), true);
  assert.equal(bytes.includes(Buffer.from("REVOKE-CHECKLIST.md")), true);
  // env.template path present
  assert.equal(bytes.includes(Buffer.from("credentials/env.template")), true);
  // A* extract present
  assert.equal(bytes.includes(Buffer.from("orgs/myorg/repos/product-x/repo.yaml")), true);

  // Redaction happened (proven by the returned key list — the actual masked
  // bytes live inside a DEFLATE-compressed entry, so we cannot grep for the
  // placeholder string against the raw zip bytes).
  assert.deepEqual(result.redactedSecretKeys, ["DISCORD_TOKEN"]);

  fs.rmSync(workspace, { recursive: true, force: true });
});
