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
import {
  readArchiveMeta,
  verifyArchive,
  checkSchemaCompat,
  parseManifestTsv,
  type ArchiveYamlDoc,
} from "../src/lifecycle/archive-reader.js";

/**
 * v0.8.1 — archive verify regression.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §5 + §7 #12.
 *
 * Coverage:
 *   - Round-trip a v0.7-shape archive through buildArchive → readArchiveMeta
 *   - verifyArchive returns ok=true for a pristine archive
 *   - verifyArchive flags SHA mismatch when the zip is tampered
 *   - checkSchemaCompat refuses unknown archive_format
 *   - parseManifestTsv tolerates extra blank lines
 */

function buildPristineArchive(workspace: string, dest: string, version = "0.7.0"): Promise<void> {
  return (async () => {
    fs.mkdirSync(path.join(workspace, ".solosquad"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, ".solosquad", "workspace.yaml"),
      "name: ws\ntimezone: Asia/Seoul\n",
    );
    fs.writeFileSync(
      path.join(workspace, ".solosquad", ".env"),
      "DISCORD_TOKEN=hush.disc.xyz\nNAME=demo\n",
    );
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# guide\n");

    const org = path.join(workspace, "myorg");
    fs.mkdirSync(path.join(org, "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(org, ".org.yaml"),
      yaml.dump({ slug: "myorg", name: "MyOrg", schema_version: 1, provider: "local" }),
    );
    fs.writeFileSync(path.join(org, "memory", "signals.jsonl"), '{"x":1}\n');

    const journal = new JournalWriter(journalPath(workspace), newRunId());
    const classification = classifyWorkspace(workspace);
    const extracted = extractRepoMeta(workspace);
    const revokeData = collectRevokeData(workspace);
    await buildArchive({
      workspace,
      workspaceSlug: "demo-ws",
      archivePath: dest,
      classification,
      extractedRepos: extracted.extractions,
      envText: fs.readFileSync(path.join(workspace, ".solosquad", ".env"), "utf-8"),
      revokeChecklist: renderRevokeChecklist(revokeData),
      manualRevokeFiles: renderManualRevokeFiles(revokeData),
      solosquadVersion: version,
      journal,
    });
  })();
}

test("readArchiveMeta extracts archive.yaml + manifest.tsv", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-verify-meta-"));
  const archivePath = path.join(workspace, "out.zip");
  await buildPristineArchive(workspace, archivePath);
  try {
    const meta = await readArchiveMeta(archivePath);
    // v0.7 buildArchive nests archive_format under import_compat. The reader
    // also looks there via checkSchemaCompat, so the schema-compat check is
    // the right assertion.
    assert.equal(meta.archiveYaml.import_compat?.archive_format, "zip-v1");
    assert.equal(meta.archiveYaml.schema_version, 1);
    assert.equal(meta.manifest.schemaVersion, 1);
    assert.ok(meta.manifest.entries.length >= 4);
    const archiveYamlEntry = meta.manifest.entries.find((e) => e.path === "archive.yaml");
    assert.ok(archiveYamlEntry, "manifest must include archive.yaml");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("verifyArchive returns ok=true on pristine archive", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-verify-ok-"));
  const archivePath = path.join(workspace, "out.zip");
  await buildPristineArchive(workspace, archivePath);
  try {
    const report = await verifyArchive(archivePath, { cliVersion: "0.8.1" });
    assert.equal(report.ok, true, JSON.stringify(report.schemaCompat));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.shaMismatches.length, 0);
    assert.equal(report.missingFromArchive.length, 0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("verifyArchive flags SHA mismatch when manifest declares wrong SHA", async () => {
  // Build a tiny archive from scratch using archiver so we can inject a
  // wrong SHA into manifest.tsv without touching central-directory bytes.
  const archiver = (await import("archiver")).default;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-verify-tamper-"));
  const archivePath = path.join(workspace, "tampered.zip");
  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(archivePath);
      const zip = archiver("zip", { zlib: { level: 0 } });
      out.on("close", () => resolve());
      out.on("error", reject);
      zip.on("error", reject);
      zip.pipe(out);

      const payload = Buffer.from("hello world\n");
      // Manifest declares a SHA that does NOT match the payload.
      const wrongSha = "0".repeat(64);
      const manifest =
        "# schema_version=1\n" +
        "path\tsha256\tsize\tclass\tnotes\n" +
        `payload.txt\t${wrongSha}\t${payload.byteLength}\tB\t-\n`;
      const archiveYaml = yaml.dump({
        schema_version: 1,
        export_ts: "2026-05-15T00:00:00Z",
        solosquad_version: "0.7.0",
        workspace_slug: "ws",
        created_by: "test",
        included_orgs: [],
        archive_format: "zip-v1",
        import_compat: {
          min_solosquad_version: "0.7.0",
          max_schema_version_supported: 1,
          archive_format: "zip-v1",
        },
      });
      zip.append(payload, { name: "payload.txt" });
      zip.append(Buffer.from(archiveYaml, "utf-8"), { name: "archive.yaml" });
      zip.append(manifest, { name: "manifest.tsv" });
      void zip.finalize();
    });

    const report = await verifyArchive(archivePath, { cliVersion: "0.8.1" });
    assert.equal(report.ok, false);
    assert.ok(
      report.shaMismatches.length > 0,
      "expected SHA mismatch when manifest declares a wrong SHA",
    );
    assert.equal(report.shaMismatches[0].path, "payload.txt");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("checkSchemaCompat refuses unknown archive_format", () => {
  const yamlDoc: ArchiveYamlDoc = {
    schema_version: 1,
    export_ts: "2026-05-15T00:00:00Z",
    solosquad_version: "0.7.0",
    workspace_slug: "ws",
    included_orgs: ["myorg"],
    archive_format: "zip-v999",
  };
  const result = checkSchemaCompat(yamlDoc, "0.8.1");
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("archive_format")));
});

test("checkSchemaCompat refuses min_solosquad_version > cliVersion", () => {
  const yamlDoc: ArchiveYamlDoc = {
    schema_version: 1,
    export_ts: "2026-05-15T00:00:00Z",
    solosquad_version: "9.9.9",
    workspace_slug: "ws",
    included_orgs: [],
    archive_format: "zip-v1",
    import_compat: {
      min_solosquad_version: "9.9.9",
      max_schema_version_supported: 1,
      archive_format: "zip-v1",
    },
  };
  const result = checkSchemaCompat(yamlDoc, "0.8.1");
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("requires solosquad")));
});

test("parseManifestTsv parses the header line + data rows", () => {
  const tsv =
    "# schema_version=1\n" +
    "path\tsha256\tsize\tclass\tnotes\n" +
    "foo.txt\tabc\t10\tB\t-\n" +
    "bar/baz.yaml\t-\t-\tD\tvalues redacted\n";
  const parsed = parseManifestTsv(tsv);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].path, "foo.txt");
  assert.equal(parsed.entries[0].sha256, "abc");
  assert.equal(parsed.entries[1].sha256, null);
  assert.equal(parsed.entries[1].size, null);
});
