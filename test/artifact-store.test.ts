import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ARTIFACT_MIN_CHARS,
  isArtifactWorthy,
  deriveArtifactTitle,
  artifactsDir,
  saveArtifact,
} from "../src/messenger/artifact-store.js";

test("isArtifactWorthy — threshold", () => {
  assert.equal(isArtifactWorthy("short"), false);
  assert.equal(isArtifactWorthy("x".repeat(ARTIFACT_MIN_CHARS - 1)), false);
  assert.equal(isArtifactWorthy("x".repeat(ARTIFACT_MIN_CHARS)), true);
});

test("deriveArtifactTitle — heading wins, else first line, capped", () => {
  assert.equal(deriveArtifactTitle("## PMF 가설 검증\n본문"), "PMF 가설 검증");
  assert.equal(deriveArtifactTitle("\n\n첫 줄 제목\n다음"), "첫 줄 제목");
  assert.equal(deriveArtifactTitle("# **굵게** `코드`"), "굵게 코드");
  const long = "# " + "a".repeat(100);
  assert.ok(deriveArtifactTitle(long).length <= 70);
  assert.equal(deriveArtifactTitle("   "), "artifact");
});

test("saveArtifact — writes file under <org>/artifacts and returns paths", () => {
  const org = fs.mkdtempSync(path.join(os.tmpdir(), "ss-art-"));
  const when = new Date("2026-06-16T09:08:07");
  const saved = saveArtifact(
    org,
    { title: "PMF 가설 검증 보고서", content: "# report\nbody" },
    when,
  );
  assert.ok(saved.fileName.startsWith("20260616-090807-"));
  assert.ok(saved.fileName.endsWith(".md"));
  assert.equal(saved.relPath, path.join("artifacts", saved.fileName));
  assert.equal(saved.absPath, path.join(artifactsDir(org), saved.fileName));
  assert.equal(fs.readFileSync(saved.absPath, "utf-8"), "# report\nbody");
});

test("saveArtifact — honours ext + slug fallback", () => {
  const org = fs.mkdtempSync(path.join(os.tmpdir(), "ss-art-"));
  const saved = saveArtifact(
    org,
    { title: "!!!", content: "data", ext: "json" },
    new Date("2026-01-02T03:04:05"),
  );
  assert.ok(saved.fileName.endsWith(".json"));
  // non-sluggable title falls back to "artifact"
  assert.ok(saved.fileName.includes("-artifact."));
});
