import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v040ToV050 } from "../src/migrations/scripts/0.4.0-to-0.5.0.js";
import { loadWorkspaceYaml } from "../src/util/config.js";
import { parseSkillMd, validateSkill } from "../src/bot/skill-parser.js";
import {
  CANONICAL_KEYWORDS,
  hasFrontmatter,
} from "../src/migrations/skill-frontmatter-backfill.js";

/**
 * v0.5 §10 migration regression — mocked v0.4.0 workspace.
 *
 * Tests the 0.4.0 → 0.5.0 migration end-to-end:
 *  - frontmatter is prepended to every reachable SKILL.md (idempotent)
 *  - workspace.yaml gets `skill_loader` + `author` + version bump
 *  - 3-tier dirs (user/org/analysis) are created with READMEs
 *  - bodies are preserved verbatim (no body byte loss)
 */

const BUNDLED_AGENT_KEYS = Object.keys(CANONICAL_KEYWORDS);

function tempV040Workspace(opts: {
  orgs?: string[];
  /** Seed N bundled agents at .solosquad/agents (verbatim copy from canonical list). */
  bundledAgents?: number;
  /** Inject an extra org-local SKILL.md for one of the orgs. */
  orgLocalAgent?: { org: string; team: string; agent: string };
}): string {
  const orgs = opts.orgs ?? ["acme"];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-mig050-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    [
      "version: 0.4.0",
      "display_name: test-workspace",
      "timezone: Asia/Seoul",
      "briefings:",
      "  morning: { time: \"08:00\", enabled: true }",
      "  evening: { time: \"18:00\", enabled: true }",
      "background_routines:",
      "  signal_scan: { time: \"12:00\", enabled: true }",
      "  experiment_check: { time: \"16:00\", enabled: true }",
      "  weekly_review: { day: sunday, time: \"20:00\", enabled: true }",
      "pm:",
      "  max_budget_usd: 5",
      "  invoke_timeout_seconds: 300",
      "  compaction_time: \"23:00\"",
      "goal:",
      "  default_hours: 8",
      "  default_budget_usd: 5",
      "created_at: 2026-05-13T00:00:00Z",
      "last_migrated_to: 0.4.0",
      "",
    ].join("\n"),
    "utf-8",
  );

  // Seed orgs.
  for (const o of orgs) {
    fs.mkdirSync(path.join(dir, o, "repositories"), { recursive: true });
    fs.mkdirSync(path.join(dir, o, "goals"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, o, ".org.yaml"),
      `slug: ${o}\nname: ${o}\nprovider: github\nrepos: []\ncreated_at: 2026-05-13T00:00:00Z\n`,
      "utf-8",
    );
  }

  // Seed bundled SKILL.md files (verbatim body, no frontmatter — v0.4 state).
  if (opts.bundledAgents && opts.bundledAgents > 0) {
    const count = Math.min(opts.bundledAgents, BUNDLED_AGENT_KEYS.length);
    for (let i = 0; i < count; i++) {
      const key = BUNDLED_AGENT_KEYS[i];
      const [team, agent] = key.split("/");
      const agentDir = path.join(dir, ".solosquad", "agents", team, agent);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "SKILL.md"),
        [
          `# ${agent} Agent`,
          "",
          `> One-liner describing ${agent}.`,
          "",
          "## Process",
          "",
          "1. Step one.",
          "",
        ].join("\n"),
        "utf-8",
      );
    }
  }

  // Seed an org-local SKILL.md (user-authored, may or may not be in canonical map).
  if (opts.orgLocalAgent) {
    const { org, team, agent } = opts.orgLocalAgent;
    const dirAgent = path.join(dir, org, ".agents", team, agent);
    fs.mkdirSync(dirAgent, { recursive: true });
    fs.writeFileSync(
      path.join(dirAgent, "SKILL.md"),
      [
        `# ${agent}`,
        "",
        `> Custom SKILL for ${org}.`,
        "",
        "## Process",
        "",
        "1. Do the thing.",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  return dir;
}

test("v0.4.0 → v0.5.0: detect() returns true on a fresh 0.4.0 workspace", async () => {
  const ws = tempV040Workspace({});
  assert.equal(await v040ToV050.detect(ws), true);
});

test("v0.4.0 → v0.5.0: detect() returns false on a 0.5.0 workspace", async () => {
  const ws = tempV040Workspace({});
  // Manually bump to simulate already-migrated state.
  const wsYaml = loadWorkspaceYaml(ws)!;
  wsYaml.version = "0.5.0";
  fs.writeFileSync(
    path.join(ws, ".solosquad", "workspace.yaml"),
    `version: 0.5.0\ndisplay_name: x\ncreated_at: 2026-05-14T00:00:00Z\n`,
    "utf-8",
  );
  assert.equal(await v040ToV050.detect(ws), false);
});

test("v0.4.0 → v0.5.0: apply() backfills frontmatter into all 25 mock-bundled SKILLs", async () => {
  const ws = tempV040Workspace({ bundledAgents: 25 });
  const plan = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan);

  let checked = 0;
  for (const key of BUNDLED_AGENT_KEYS) {
    const [team, agent] = key.split("/");
    const skillPath = path.join(ws, ".solosquad", "agents", team, agent, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf-8");
    assert.ok(hasFrontmatter(raw), `${skillPath} should have frontmatter`);
    const spec = parseSkillMd(raw, skillPath);
    assert.equal(spec.name, agent, `${skillPath}: name mismatch`);
    assert.equal(spec.team, team, `${skillPath}: team mismatch`);
    assert.equal(spec.stateful, false, `${skillPath}: stateful must be false`);
    assert.deepEqual(spec.triggers?.keyword, CANONICAL_KEYWORDS[key]);
    assert.equal(spec.triggers?.explicit, true);
    assert.equal(validateSkill(spec).ok, true, `${skillPath} validation failed`);
    checked++;
  }
  assert.equal(checked, 25, "all 25 mock-bundled SKILLs should be backfilled");
});

test("v0.4.0 → v0.5.0: apply() preserves SKILL.md body verbatim (only frontmatter is added)", async () => {
  const ws = tempV040Workspace({ bundledAgents: 1 });
  const key = BUNDLED_AGENT_KEYS[0];
  const [team, agent] = key.split("/");
  const skillPath = path.join(ws, ".solosquad", "agents", team, agent, "SKILL.md");
  const originalBody = fs.readFileSync(skillPath, "utf-8");

  const plan = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan);

  const after = fs.readFileSync(skillPath, "utf-8");
  // After backfill: starts with frontmatter fence, then the original body verbatim.
  assert.ok(after.startsWith("---\n"));
  const fenceEnd = after.indexOf("\n---\n", 4);
  assert.ok(fenceEnd > 0, "closing fence should exist");
  const bodyAfter = after.slice(fenceEnd + 5);
  assert.equal(bodyAfter, originalBody, "body must be byte-identical to original");
});

test("v0.4.0 → v0.5.0: apply() patches workspace.yaml (skill_loader + author + version)", async () => {
  const ws = tempV040Workspace({});
  const plan = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan);

  const wsAfter = loadWorkspaceYaml(ws)!;
  assert.equal(wsAfter.version, "0.5.0");
  assert.equal(wsAfter.last_migrated_to, "0.5.0");

  assert.ok(wsAfter.skill_loader, "skill_loader section should be present");
  assert.deepEqual(wsAfter.skill_loader!.tiers, ["org", "user", "bundle"]);

  assert.ok(wsAfter.author, "author section should be present");
  assert.equal(wsAfter.author!.on_cap_action, "pause");
  assert.equal(wsAfter.author!.budget?.daily_usd, 10);
  assert.equal(wsAfter.author!.budget?.weekly_usd, 50);

  // Existing v0.4 fields must survive.
  assert.equal(wsAfter.goal?.default_hours, 8);
});

test("v0.4.0 → v0.5.0: apply() creates 3-tier dirs with READMEs", async () => {
  const ws = tempV040Workspace({ orgs: ["acme", "beta"] });
  const plan = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan);

  // Org-local
  for (const o of ["acme", "beta"]) {
    const orgAgents = path.join(ws, o, ".agents");
    assert.ok(fs.existsSync(orgAgents), `${o}/.agents/ should exist`);
    assert.ok(
      fs.existsSync(path.join(orgAgents, "README.md")),
      `${o}/.agents/README.md should exist`,
    );
    const analysis = path.join(ws, o, ".solosquad", "analysis");
    assert.ok(fs.existsSync(analysis), `${o}/.solosquad/analysis/ should exist`);
    assert.ok(fs.existsSync(path.join(analysis, "README.md")));
  }

  // User-global dir is in $HOME; check the README exists at the resolved path.
  const userRoot = path.join(os.homedir(), ".solosquad", "agents");
  assert.ok(fs.existsSync(userRoot));
  assert.ok(fs.existsSync(path.join(userRoot, "README.md")));
});

test("v0.4.0 → v0.5.0: apply() is idempotent (running twice is a no-op)", async () => {
  const ws = tempV040Workspace({ bundledAgents: 3 });
  const plan1 = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan1);

  // Snapshot one file's content.
  const key = BUNDLED_AGENT_KEYS[0];
  const [team, agent] = key.split("/");
  const skillPath = path.join(ws, ".solosquad", "agents", team, agent, "SKILL.md");
  const afterFirst = fs.readFileSync(skillPath, "utf-8");

  // Run again — must be identical.
  const plan2 = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan2);
  const afterSecond = fs.readFileSync(skillPath, "utf-8");
  assert.equal(afterSecond, afterFirst, "second apply must not change SKILL.md");

  // verify() still passes.
  const res = await v040ToV050.verify(ws);
  assert.equal(res.ok, true, res.error);
});

test("v0.4.0 → v0.5.0: org-local user-authored SKILL.md is backfilled even when outside canonical map", async () => {
  const ws = tempV040Workspace({
    orgs: ["acme"],
    orgLocalAgent: { org: "acme", team: "custom", agent: "weekly-digest" },
  });
  const plan = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan);

  const skillPath = path.join(
    ws,
    "acme",
    ".agents",
    "custom",
    "weekly-digest",
    "SKILL.md",
  );
  const raw = fs.readFileSync(skillPath, "utf-8");
  assert.ok(hasFrontmatter(raw));
  const spec = parseSkillMd(raw, skillPath);
  assert.equal(spec.name, "weekly-digest");
  assert.equal(spec.team, "custom");
  assert.equal(spec.stateful, false);
  // No canonical mapping → empty keyword list is fine, explicit:true keeps it callable.
  assert.deepEqual(spec.triggers?.keyword ?? [], []);
  assert.equal(spec.triggers?.explicit, true);
  assert.equal(validateSkill(spec).ok, true);
});

test("v0.4.0 → v0.5.0: verify() passes on a freshly migrated workspace", async () => {
  const ws = tempV040Workspace({ bundledAgents: 5, orgs: ["acme"] });
  const plan = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan);
  const res = await v040ToV050.verify(ws);
  assert.equal(res.ok, true, res.error);
});

test("v0.4.0 → v0.5.0: verify() rejects a workspace where SKILL.md backfill is incomplete", async () => {
  const ws = tempV040Workspace({ bundledAgents: 2, orgs: ["acme"] });

  // Run migration but then *re-corrupt* one of the SKILL.md by stripping its
  // frontmatter. verify() must catch this.
  const plan = await v040ToV050.plan(ws);
  await v040ToV050.apply(ws, plan);

  const key = BUNDLED_AGENT_KEYS[0];
  const [team, agent] = key.split("/");
  const skillPath = path.join(ws, ".solosquad", "agents", team, agent, "SKILL.md");
  const after = fs.readFileSync(skillPath, "utf-8");
  const fenceEnd = after.indexOf("\n---\n", 4);
  // Strip frontmatter, leaving only the body — simulates a manual edit gone wrong.
  fs.writeFileSync(skillPath, after.slice(fenceEnd + 5), "utf-8");

  const res = await v040ToV050.verify(ws);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /missing frontmatter/i);
});
