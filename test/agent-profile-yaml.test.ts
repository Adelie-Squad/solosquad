import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadAgentProfile,
  mergeProfiles,
  resolveAgentBudget,
  AGENT_PROFILE_SCHEMA_VERSION,
} from "../src/util/agent-profile.js";

/**
 * v0.6 §2.2 — agent-profile.yaml inheritance + budget invariants.
 *
 * Order (low → high priority): workspace bundle → user global → org.
 * Same-keyed value: narrower wins. Budget caps in a child must be ≤ parent
 * (looser → warning + parent value kept).
 */

function mkWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-agent-profile-"));
}

function writeProfile(file: string, doc: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, doc, "utf-8");
}

test("loadAgentProfile returns empty defaults when no files exist", () => {
  const ws = mkWorkspace();
  const result = loadAgentProfile({
    workspace: ws,
    orgSlug: "acme",
    userDefaultsPath: path.join(ws, "no-such-user.yaml"),
    workspaceDefaultsPath: path.join(ws, "no-such-bundle.yaml"),
  });
  assert.deepEqual(result.defaults, {});
  assert.deepEqual(result.agents, {});
  // No file at all → no warnings.
  assert.equal(result.warnings.length, 0);
});

test("3-tier inheritance: org overrides user overrides workspace bundle", () => {
  const ws = mkWorkspace();
  const orgSlug = "acme";
  fs.mkdirSync(path.join(ws, orgSlug), { recursive: true });

  const bundle = path.join(ws, "bundle.yaml");
  const userGlobal = path.join(ws, "user.yaml");
  const orgFile = path.join(ws, orgSlug, "agent-profile.yaml");

  writeProfile(
    bundle,
    `schema_version: 1\ndefaults:\n  tone: neutral\n  voice: workspace-default\n`,
  );
  writeProfile(
    userGlobal,
    `schema_version: 1\ndefaults:\n  tone: friendly\n`,
  );
  writeProfile(
    orgFile,
    `schema_version: 1\ndefaults:\n  tone: conservative\n`,
  );

  const result = loadAgentProfile({
    workspace: ws,
    orgSlug,
    userDefaultsPath: userGlobal,
    workspaceDefaultsPath: bundle,
  });

  // org wins for tone, voice still inherited from bundle.
  assert.equal(result.defaults.tone, "conservative");
  assert.equal(result.defaults.voice, "workspace-default");
});

test("agent budget override may only tighten parent cap (looser → warning + parent kept)", () => {
  const ws = mkWorkspace();
  const orgSlug = "acme";
  fs.mkdirSync(path.join(ws, orgSlug), { recursive: true });

  const orgFile = path.join(ws, orgSlug, "agent-profile.yaml");
  writeProfile(
    orgFile,
    [
      "schema_version: 1",
      "defaults:",
      "  budget:",
      "    daily_usd: 5",
      "    weekly_usd: 25",
      "    on_cap_action: pause",
      "paid-marketer:",
      "  budget:",
      "    daily_usd: 2", // narrower — accepted
      "content-writer:",
      "  budget:",
      "    daily_usd: 10", // looser — rejected
      "",
    ].join("\n"),
  );

  const result = loadAgentProfile({
    workspace: ws,
    orgSlug,
    userDefaultsPath: path.join(ws, "no-user.yaml"),
    workspaceDefaultsPath: path.join(ws, "no-bundle.yaml"),
  });

  const paidBudget = resolveAgentBudget(result, "paid-marketer");
  assert.equal(paidBudget?.daily_usd, 2);

  const writerBudget = resolveAgentBudget(result, "content-writer");
  // Looser → forced back to parent.
  assert.equal(writerBudget?.daily_usd, 5);
  assert.ok(result.warnings.some((w) => w.includes("content-writer")));
});

test("mergeProfiles: per-agent fields cascade from defaults", () => {
  const parent = {
    defaults: { tone: "conservative", priorities: ["profitability"] },
    agents: {},
    warnings: [],
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
  };
  const child = {
    schema_version: 1,
    "business-strategist": {
      emphasis: "한국 SMB 시장",
    },
  };
  const merged = mergeProfiles(parent, child, "test");
  // Per-agent section inherits parent defaults (tone) and adds emphasis.
  const bs = merged.agents["business-strategist"];
  assert.ok(bs);
  assert.equal(bs.tone, "conservative");
  assert.equal(bs.emphasis, "한국 SMB 시장");
});

test("schema_version mismatch refuses load (returns empty profile + warning)", () => {
  const ws = mkWorkspace();
  const orgSlug = "acme";
  fs.mkdirSync(path.join(ws, orgSlug), { recursive: true });

  const orgFile = path.join(ws, orgSlug, "agent-profile.yaml");
  writeProfile(
    orgFile,
    `schema_version: 9\ndefaults:\n  tone: anything\n`,
  );

  const result = loadAgentProfile({
    workspace: ws,
    orgSlug,
    userDefaultsPath: path.join(ws, "no-user.yaml"),
    workspaceDefaultsPath: path.join(ws, "no-bundle.yaml"),
  });

  assert.deepEqual(result.defaults, {});
  assert.ok(result.warnings.some((w) => w.includes("schema_version=9")));
});

test("missing schema_version yields warning-only (not a refusal)", () => {
  const ws = mkWorkspace();
  const orgSlug = "acme";
  fs.mkdirSync(path.join(ws, orgSlug), { recursive: true });

  const orgFile = path.join(ws, orgSlug, "agent-profile.yaml");
  writeProfile(
    orgFile,
    `defaults:\n  tone: conservative\n`,
  );

  const result = loadAgentProfile({
    workspace: ws,
    orgSlug,
    userDefaultsPath: path.join(ws, "no-user.yaml"),
    workspaceDefaultsPath: path.join(ws, "no-bundle.yaml"),
  });

  // Loaded successfully despite missing schema_version.
  assert.equal(result.defaults.tone, "conservative");
  assert.ok(result.warnings.some((w) => /schema_version/i.test(w)));
});
