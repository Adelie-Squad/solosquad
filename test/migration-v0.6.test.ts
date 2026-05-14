import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v050ToV060 } from "../src/migrations/scripts/0.5.0-to-0.6.0.js";
import { loadWorkspaceYaml } from "../src/util/config.js";
import { orgAgentProfilePath } from "../src/util/agent-profile.js";

/**
 * v0.6 §2.2 migration — detect / Pass 1 / Pass 2 / idempotency / rollback.
 *
 * The ledger redestination half lives in `test/migration-v0.6-ledger-
 * redestination.test.ts`. This file covers the structural changes: folder
 * re-shape, org-layer stubs, archive.sqlite init, workspace.yaml patches,
 * collab_pattern injection on user-authored SKILLs, version bump.
 */

function tempV050Workspace(opts: {
  orgs?: string[];
  /** Seed _teams/{team}/TEAM_KNOWLEDGE.md to test folder re-shape. */
  teams?: { team: string; body?: string }[];
  /** Seed an org-local user-authored SKILL.md without `collab_pattern`. */
  orgLocalSkill?: { org: string; team: string; agent: string };
  /** version string to write in workspace.yaml. */
  version?: string;
}): string {
  const orgs = opts.orgs ?? ["acme"];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-mig060-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    [
      `version: ${opts.version ?? "0.5.0"}`,
      "display_name: test-workspace",
      "timezone: Asia/Seoul",
      "skill_loader:",
      "  tiers: [org, user, bundle]",
      "author:",
      "  budget: { daily_usd: 10, weekly_usd: 50 }",
      "  on_cap_action: pause",
      "created_at: 2026-05-14T00:00:00Z",
      "last_migrated_to: 0.5.0",
      "",
    ].join("\n"),
    "utf-8",
  );

  for (const o of orgs) {
    fs.mkdirSync(path.join(dir, o, "repositories"), { recursive: true });
    fs.mkdirSync(path.join(dir, o, "memory"), { recursive: true });
    fs.mkdirSync(path.join(dir, o, ".solosquad"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, o, ".org.yaml"),
      `slug: ${o}\nname: ${o}\nprovider: github\ncreated_at: 2026-05-14T00:00:00Z\n`,
      "utf-8",
    );
  }

  if (opts.teams) {
    for (const t of opts.teams) {
      const teamDir = path.join(dir, ".solosquad", "agents", "_teams", t.team);
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "TEAM_KNOWLEDGE.md"),
        t.body ?? `# ${t.team} shared knowledge\n\nShared craft for ${t.team}.\n`,
        "utf-8",
      );
    }
  }

  if (opts.orgLocalSkill) {
    const { org, team, agent } = opts.orgLocalSkill;
    const agentDir = path.join(dir, org, ".agents", team, agent);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "SKILL.md"),
      [
        "---",
        `name: ${agent}`,
        `team: ${team}`,
        "description: test skill",
        "stateful: false",
        "triggers: { keyword: [], explicit: true }",
        "---",
        `# ${agent}`,
        "",
        "Body text.",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  return dir;
}

test("v0.5.0 → v0.6.0: detect() returns true on a 0.5.0 workspace", async () => {
  const ws = tempV050Workspace({ version: "0.5.0" });
  assert.equal(await v050ToV060.detect(ws), true);
});

test("v0.5.0 → v0.6.0: detect() returns true on a 0.5.1 workspace (matches 0.5.x)", async () => {
  const ws = tempV050Workspace({ version: "0.5.1" });
  assert.equal(await v050ToV060.detect(ws), true);
});

test("v0.5.0 → v0.6.0: detect() returns false on a 0.6.0 workspace", async () => {
  const ws = tempV050Workspace({ version: "0.6.0" });
  assert.equal(await v050ToV060.detect(ws), false);
});

test("v0.5.0 → v0.6.0: detect() returns false on a 0.4.0 workspace", async () => {
  const ws = tempV050Workspace({ version: "0.4.0" });
  assert.equal(await v050ToV060.detect(ws), false);
});

test("v0.5.0 → v0.6.0: apply() reshapes _teams/{team}/TEAM_KNOWLEDGE.md into {team}/KNOWLEDGE.md", async () => {
  const ws = tempV050Workspace({
    teams: [
      { team: "strategy", body: "# strategy\nstrategy craft.\n" },
      { team: "growth", body: "# growth\ngrowth craft.\n" },
    ],
  });
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const teamsRoot = path.join(ws, ".solosquad", "agents", "_teams");
  assert.equal(fs.existsSync(teamsRoot), false, "_teams/ should be removed");

  const strategyK = path.join(ws, ".solosquad", "agents", "strategy", "KNOWLEDGE.md");
  const growthK = path.join(ws, ".solosquad", "agents", "growth", "KNOWLEDGE.md");
  assert.ok(fs.existsSync(strategyK));
  assert.ok(fs.existsSync(growthK));
  assert.match(fs.readFileSync(strategyK, "utf-8"), /strategy craft/);
  assert.match(fs.readFileSync(growthK, "utf-8"), /growth craft/);
});

test("v0.5.0 → v0.6.0: apply() generates org layer stubs (core, agent-profile.yaml, domain)", async () => {
  const ws = tempV050Workspace({ orgs: ["acme", "beta"] });
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  for (const o of ["acme", "beta"]) {
    assert.ok(fs.existsSync(path.join(ws, o, "core", "PRINCIPLES.md")));
    assert.ok(fs.existsSync(path.join(ws, o, "core", "VOICE.md")));
    const profile = path.join(ws, o, "agent-profile.yaml");
    assert.ok(fs.existsSync(profile));
    const yaml = fs.readFileSync(profile, "utf-8");
    assert.match(yaml, /schema_version:\s*1/);
    assert.match(yaml, /defaults:/);
    assert.ok(fs.existsSync(path.join(ws, o, "domain", "README.md")));
  }
});

test("v0.5.0 → v0.6.0: apply() initializes archive.sqlite per org with FTS5 schema", async () => {
  const ws = tempV050Workspace({ orgs: ["acme"] });
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const archive = path.join(ws, "acme", "memory", "archive.sqlite");
  assert.ok(fs.existsSync(archive), "archive.sqlite should exist");

  // Confirm the schema actually applied by opening the DB and listing tables.
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(archive);
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name='archive'")
      .get();
    assert.ok(row, "archive virtual table should exist");
    const meta = db.prepare("SELECT value FROM archive_meta WHERE key='schema_version'").get() as
      | { value: string }
      | undefined;
    assert.equal(meta?.value, "1");
  } finally {
    db.close();
  }
});

test("v0.5.0 → v0.6.0: apply() creates workspace knowledge guide stub", async () => {
  const ws = tempV050Workspace({});
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const readme = path.join(ws, ".solosquad", "knowledge", "README.md");
  assert.ok(fs.existsSync(readme));
  assert.match(fs.readFileSync(readme, "utf-8"), /Workspace Knowledge Layer/);
});

test("v0.5.0 → v0.6.0: apply() patches workspace.yaml (fs_watch, archive, spawn, migration) + bumps version", async () => {
  const ws = tempV050Workspace({});
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const after = loadWorkspaceYaml(ws)!;
  assert.equal(after.version, "0.6.0");
  assert.equal(after.last_migrated_to, "0.6.0");

  assert.ok(after.fs_watch, "fs_watch section should be present");
  assert.equal(after.fs_watch!.mode, "prompt");
  assert.equal(after.fs_watch!.git_only, false);

  assert.ok(after.archive);
  assert.equal(after.archive!.retention_days, 365);

  assert.ok(after.spawn);
  assert.equal(after.spawn!.max_context_tokens, 80_000);

  assert.ok(after.migration);
  assert.equal(after.migration!.budget_usd, 5);

  // v0.5 fields preserved.
  assert.equal(after.skill_loader?.tiers?.[0], "org");
  assert.equal(after.author?.on_cap_action, "pause");
});

test("v0.5.0 → v0.6.0: apply() injects collab_pattern into a user-authored SKILL.md without one", async () => {
  const ws = tempV050Workspace({
    orgLocalSkill: { org: "acme", team: "custom", agent: "weekly-digest" },
  });
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const skillPath = path.join(
    ws,
    "acme",
    ".agents",
    "custom",
    "weekly-digest",
    "SKILL.md",
  );
  const body = fs.readFileSync(skillPath, "utf-8");
  assert.match(body, /collab_pattern:\s*hierarchical/);
});

test("v0.5.0 → v0.6.0: apply() leaves SKILL.md alone when collab_pattern already present (idempotent)", async () => {
  const ws = tempV050Workspace({});
  const skillDir = path.join(ws, "acme", ".agents", "growth", "content-writer");
  fs.mkdirSync(skillDir, { recursive: true });
  const original = [
    "---",
    "name: content-writer",
    "team: growth",
    "description: test",
    "stateful: false",
    "triggers: { keyword: [], explicit: true }",
    "collab_pattern: dynamic",
    "---",
    "# content-writer",
    "",
  ].join("\n");
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, original, "utf-8");

  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);
  const after = fs.readFileSync(skillPath, "utf-8");
  assert.equal(after.split("\n").filter((l) => l.startsWith("collab_pattern:")).length, 1);
});

test("v0.5.0 → v0.6.0: verify() passes on a freshly migrated workspace", async () => {
  const ws = tempV050Workspace({ orgs: ["acme"] });
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);
  const res = await v050ToV060.verify(ws);
  assert.equal(res.ok, true, res.error);
});

test("v0.5.0 → v0.6.0: verify() fails when _teams/ was not removed", async () => {
  const ws = tempV050Workspace({ orgs: ["acme"], teams: [{ team: "strategy" }] });
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  // Manually re-create the _teams folder to simulate post-migration corruption.
  fs.mkdirSync(path.join(ws, ".solosquad", "agents", "_teams", "strategy"), { recursive: true });
  const res = await v050ToV060.verify(ws);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /_teams\//);
});

test("v0.5.0 → v0.6.0: apply() is idempotent (running twice produces identical outcomes)", async () => {
  const ws = tempV050Workspace({
    orgs: ["acme"],
    teams: [{ team: "strategy" }],
  });
  const plan1 = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan1);

  const profilePath = orgAgentProfilePath(ws, "acme");
  const profileFirst = fs.readFileSync(profilePath, "utf-8");
  const ymlFirst = fs.readFileSync(
    path.join(ws, ".solosquad", "workspace.yaml"),
    "utf-8",
  );

  // detect() should now return false (already at 0.6.0).
  assert.equal(await v050ToV060.detect(ws), false);

  // Run apply() again anyway — should be a no-op (idempotent).
  await v050ToV060.apply(ws, plan1);
  const profileSecond = fs.readFileSync(profilePath, "utf-8");
  const ymlSecond = fs.readFileSync(
    path.join(ws, ".solosquad", "workspace.yaml"),
    "utf-8",
  );
  assert.equal(profileFirst, profileSecond, "agent-profile.yaml should not change on re-apply");
  assert.equal(ymlFirst, ymlSecond, "workspace.yaml should not change on re-apply");
});

test("v0.5.0 → v0.6.0: rollback — pre-existing org-color values in agent-profile.yaml survive when no ledger entry merges them", async () => {
  const ws = tempV050Workspace({ orgs: ["acme"] });
  const profilePath = orgAgentProfilePath(ws, "acme");
  // Pre-seed with a non-default profile (simulating partial migration recovery).
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    [
      "schema_version: 1",
      "defaults:",
      "  budget: { daily_usd: 3, weekly_usd: 15, on_cap_action: pause }",
      "business-strategist:",
      "  emphasis: \"한국 SMB\"",
      "",
    ].join("\n"),
    "utf-8",
  );

  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const after = fs.readFileSync(profilePath, "utf-8");
  // The migration should NOT overwrite the user's pre-existing file.
  assert.match(after, /emphasis:\s+["']?한국 SMB["']?/);
  assert.match(after, /daily_usd:\s+3/);
});
