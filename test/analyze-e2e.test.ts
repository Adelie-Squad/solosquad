import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyzeRepoCommand } from "../src/cli/analyze.js";
import { applyReport } from "../src/analyze/applier.js";
import { loadLedger, PENDING_KEY, LEDGER_REL_PATH } from "../src/analyze/ledger.js";
import { createHeuristicCaller } from "../src/analyze/classifier.js";
import { materializeFixture } from "./analyze/fixtures-helper.js";

/**
 * v0.5 §11.3 — analyze → apply end-to-end, with the §13 success criterion
 * "second analyze makes 0 LLM calls" asserted explicitly.
 */

test("analyze repo → apply report end-to-end on mixed-typical fixture", async () => {
  const fx = materializeFixture("mixed-typical");
  const userGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ug-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ws-"));
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-bk-"));
  fs.mkdirSync(path.join(workspace, "acme"), { recursive: true });
  try {
    const caller = createHeuristicCaller();
    const result = await analyzeRepoCommand(fx.repo, { caller });
    assert.equal(result.scanned_count, 4);
    assert.equal(result.classified_count, 4);
    assert.ok(result.caller_calls >= 1);
    assert.ok(fs.existsSync(result.ledger_path));
    assert.ok(result.report_path);
    assert.ok(fs.existsSync(result.report_path!));

    const apply = await applyReport({
      repo_root: fx.repo,
      org_slug: "acme",
      workspace_root: workspace,
      user_global_dir: userGlobal,
      backup_root: backupRoot,
      verify: () => ({ ok: true }),
    });
    assert.equal(apply.rolled_back, false);
    assert.equal(apply.applied_count, 4);
    const after = loadLedger(path.join(fx.repo, LEDGER_REL_PATH));
    assert.ok(after);
    for (const e of after!.analyzed) {
      assert.equal(e.applied, true);
    }
  } finally {
    fx.cleanup();
    fs.rmSync(userGlobal, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
});

test("analyze running twice on unchanged repo makes 0 caller calls on 2nd run (§13)", async () => {
  const fx = materializeFixture("mixed-typical");
  try {
    const caller1 = createHeuristicCaller();
    await analyzeRepoCommand(fx.repo, { caller: caller1 });
    assert.ok((caller1.call_count ?? 0) >= 1);

    const caller2 = createHeuristicCaller();
    const r2 = await analyzeRepoCommand(fx.repo, { caller: caller2 });
    assert.equal(caller2.call_count, 0);
    assert.equal(r2.classified_count, 0);
    assert.equal(r2.scanned_count, 4);
  } finally {
    fx.cleanup();
  }
});

test("analyze on no-workflow-match fixture reports no_match: true", async () => {
  const fx = materializeFixture("no-workflow-match");
  try {
    const caller = createHeuristicCaller();
    const result = await analyzeRepoCommand(fx.repo, { caller });
    assert.equal(result.no_match, true);
  } finally {
    fx.cleanup();
  }
});
