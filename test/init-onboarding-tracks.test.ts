import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectV05Usage } from "../src/cli/detect-v05-usage.js";
import { LEDGER_REL_PATH } from "../src/analyze/ledger.js";

/**
 * v0.6 §2.6 — onboarding 두 트랙 분기 unit tests.
 *
 * `detectV05Usage(workspace)` returns true iff *any* org under the workspace
 * has a v0.5 `analysis-ledger.yaml`. The init wizard reads this to decide
 * between the "existing v0.5 user — keep templates as-is" branch and the
 * "new user — accept retrospective defaults" branch.
 */

function mkWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-onboarding-"));
}

test("detectV05Usage returns false on empty workspace (new user branch)", () => {
  const ws = mkWorkspace();
  try {
    assert.equal(detectV05Usage(ws), false);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("detectV05Usage returns true when an org has an analysis-ledger (existing v0.5 user branch)", () => {
  const ws = mkWorkspace();
  try {
    const orgDir = path.join(ws, "demo");
    const ledgerPath = path.join(orgDir, LEDGER_REL_PATH);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(
      ledgerPath,
      "version: 1\nanalyzed: []\nmodel:\n  fingerprint: test\n"
    );
    assert.equal(detectV05Usage(ws), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("detectV05Usage ignores hidden dirs and non-ledger orgs", () => {
  const ws = mkWorkspace();
  try {
    // Hidden dir with a ledger inside — should be ignored.
    const hidden = path.join(ws, ".scratch", ".solosquad");
    fs.mkdirSync(hidden, { recursive: true });
    fs.writeFileSync(path.join(hidden, "analysis-ledger.yaml"), "version: 1\n");

    // Org without a ledger — should not trigger detection.
    const org = path.join(ws, "demo");
    fs.mkdirSync(path.join(org, "memory"), { recursive: true });
    fs.writeFileSync(path.join(org, ".org.yaml"), "slug: demo\nname: demo\n");

    assert.equal(detectV05Usage(ws), false);

    // Now add the ledger to the demo org — detection flips to true.
    const ledger = path.join(org, LEDGER_REL_PATH);
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, "version: 1\nanalyzed: []\nmodel:\n  fingerprint: x\n");
    assert.equal(detectV05Usage(ws), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
