import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyReport,
  destinationFor,
  inferTeam,
  inferAgentSlug,
} from "../src/analyze/applier.js";
import {
  emptyLedger,
  loadLedger,
  makeEntry,
  saveLedger,
  PENDING_KEY,
  LEDGER_REL_PATH,
} from "../src/analyze/ledger.js";
import type { ScannedSkill } from "../src/analyze/scanner.js";

function scan(p: string, hash = "h"): ScannedSkill {
  return { path: p, hash, size_bytes: 100, mtime_iso: "2026-05-14T00:00:00.000Z" };
}

interface SetupOpts {
  skills: { rel: string; body: string; label: "role" | "workflow" | "codebase-fact" | "domain" }[];
}

function setup(opts: SetupOpts) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-app-"));
  const userGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ug-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ws-"));
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-bk-"));
  fs.mkdirSync(path.join(workspace, "acme"), { recursive: true });
  const ledgerPath = path.join(repoRoot, LEDGER_REL_PATH);
  const led = emptyLedger("test");
  for (const s of opts.skills) {
    const full = path.join(repoRoot, s.rel.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, s.body, "utf-8");
    led.analyzed.push(makeEntry(scan(s.rel), s.label, 0.9, "<dest>"));
  }
  saveLedger(ledgerPath, led);
  return {
    repoRoot,
    userGlobal,
    workspace,
    backupRoot,
    cleanup() {
      for (const d of [repoRoot, userGlobal, workspace, backupRoot]) {
        try {
          fs.rmSync(d, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
  };
}

test("inferTeam routes filenames by hint keywords", () => {
  assert.equal(inferTeam("backend-deploy.md"), "engineering");
  assert.equal(inferTeam("feature-planner.md"), "strategy");
  assert.equal(inferTeam("brand-tone.md"), "growth");
  assert.equal(inferTeam("ux-research.md"), "experience");
});

test("inferAgentSlug normalizes to lowercase kebab-case", () => {
  assert.equal(inferAgentSlug("My_Custom Agent.md"), "my-custom-agent");
});

test("destinationFor: codebase-fact returns null (stay in repo)", () => {
  const entry = makeEntry(scan("x.md"), "codebase-fact", 0.9, "");
  assert.equal(
    destinationFor(entry, {
      workspace_root: "/ws",
      org_slug: "acme",
      user_global_dir: "/ug",
    }),
    null
  );
});

test("destinationFor: role goes to user-global agents path; workflow to org workflows", () => {
  const role = makeEntry(scan("feature-planner.md"), "role", 0.9, "");
  const wf = makeEntry(scan("ship-wf.md"), "workflow", 0.9, "");
  const dRole = destinationFor(role, {
    workspace_root: path.join("/", "ws"),
    org_slug: "acme",
    user_global_dir: path.join("/", "ug"),
  });
  const dWf = destinationFor(wf, {
    workspace_root: path.join("/", "ws"),
    org_slug: "acme",
    user_global_dir: path.join("/", "ug"),
  });
  assert.ok(dRole);
  assert.ok(dRole!.includes("strategy"));
  assert.ok(dRole!.endsWith("SKILL.md"));
  assert.ok(dWf);
  assert.ok(dWf!.includes("workflows"));
});

test("applyReport applies entries and marks pending_v0.6_redestination on role + domain only", async () => {
  const ctx = setup({
    skills: [
      { rel: ".claude/skills/feature-planner.md", body: "Act as feature planner. Voice: precise.", label: "role" },
      { rel: ".claude/skills/deploy-staging.md", body: "Deploys via package.json", label: "codebase-fact" },
      { rel: ".claude/skills/pricing-glossary.md", body: "Domain glossary for pricing.", label: "domain" },
      { rel: ".claude/skills/ship-pipeline.md", body: "Stage 1 → Stage 2", label: "workflow" },
    ],
  });
  try {
    const result = await applyReport({
      repo_root: ctx.repoRoot,
      org_slug: "acme",
      workspace_root: ctx.workspace,
      user_global_dir: ctx.userGlobal,
      backup_root: ctx.backupRoot,
      verify: () => ({ ok: true }),
    });
    assert.equal(result.rolled_back, false);
    assert.equal(result.applied_count, 4);
    const after = loadLedger(path.join(ctx.repoRoot, LEDGER_REL_PATH));
    assert.ok(after);
    const role = after!.analyzed.find((e) => e.classification === "role");
    const fact = after!.analyzed.find((e) => e.classification === "codebase-fact");
    const dom = after!.analyzed.find((e) => e.classification === "domain");
    const wf = after!.analyzed.find((e) => e.classification === "workflow");
    assert.ok(role && fact && dom && wf);
    assert.equal(role!.applied, true);
    assert.equal(role![PENDING_KEY], true);
    assert.equal(dom![PENDING_KEY], true);
    assert.equal(fact![PENDING_KEY], false);
    assert.equal(wf![PENDING_KEY], false);
  } finally {
    ctx.cleanup();
  }
});

test("applyReport creates a backup directory and copies the ledger snapshot", async () => {
  const ctx = setup({
    skills: [
      { rel: ".claude/skills/x.md", body: "Act as x. Persona.", label: "role" },
    ],
  });
  try {
    const result = await applyReport({
      repo_root: ctx.repoRoot,
      org_slug: "acme",
      workspace_root: ctx.workspace,
      user_global_dir: ctx.userGlobal,
      backup_root: ctx.backupRoot,
      verify: () => ({ ok: true }),
    });
    assert.ok(fs.existsSync(result.backup_dir));
    assert.ok(result.backup_dir.includes("repo-onboard"));
    // Backup should contain a mirror of the ledger file.
    const entries = fs.readdirSync(result.backup_dir);
    assert.ok(entries.length >= 1);
  } finally {
    ctx.cleanup();
  }
});

test("applyReport rolls back when verify() returns ok=false", async () => {
  const ctx = setup({
    skills: [
      { rel: ".claude/skills/x.md", body: "Act as x. Persona.", label: "role" },
    ],
  });
  try {
    const result = await applyReport({
      repo_root: ctx.repoRoot,
      org_slug: "acme",
      workspace_root: ctx.workspace,
      user_global_dir: ctx.userGlobal,
      backup_root: ctx.backupRoot,
      verify: () => ({ ok: false, error: "deliberate" }),
    });
    assert.equal(result.rolled_back, true);
    assert.match(result.error ?? "", /verify failed/);
    // Ledger entries should not be marked applied after rollback.
    const after = loadLedger(path.join(ctx.repoRoot, LEDGER_REL_PATH));
    assert.ok(after);
    for (const e of after!.analyzed) {
      assert.equal(e.applied, false);
    }
  } finally {
    ctx.cleanup();
  }
});

test("applyReport skips entries already applied", async () => {
  const ctx = setup({
    skills: [
      { rel: ".claude/skills/x.md", body: "Act as x. Persona.", label: "role" },
    ],
  });
  try {
    // Pre-mark applied
    const ledgerPath = path.join(ctx.repoRoot, LEDGER_REL_PATH);
    const led = loadLedger(ledgerPath);
    assert.ok(led);
    led!.analyzed[0].applied = true;
    saveLedger(ledgerPath, led!);

    const result = await applyReport({
      repo_root: ctx.repoRoot,
      org_slug: "acme",
      workspace_root: ctx.workspace,
      user_global_dir: ctx.userGlobal,
      backup_root: ctx.backupRoot,
      verify: () => ({ ok: true }),
    });
    assert.equal(result.applied_count, 0);
    assert.equal(result.skipped_count, 1);
  } finally {
    ctx.cleanup();
  }
});
