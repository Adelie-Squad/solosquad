import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildAgentFile,
  extractDescription,
  listSourceAgents,
  syncAgentsToOrg,
} from "../src/bot/agents-builder.js";

function tempWorkspaceWithAssets(orgSlug = "test-org"): {
  workspace: string;
  agentsDir: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-agentsbuilder-"));
  fs.mkdirSync(path.join(dir, orgSlug), { recursive: true });
  const agentsDir = path.join(dir, "_test_assets", "agents");
  fs.mkdirSync(path.join(agentsDir, "strategy", "pmf-planner"), { recursive: true });
  fs.mkdirSync(path.join(agentsDir, "engineering", "backend-developer"), { recursive: true });
  fs.mkdirSync(path.join(agentsDir, "engineering", "qa-engineer"), { recursive: true });
  fs.mkdirSync(path.join(agentsDir, "_teams", "strategy"), { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "strategy", "pmf-planner", "SKILL.md"),
    "# PMF Planner\n\n> Hypothesis & MVP design for 0→1 fit.\n\n## R&R\n…\n"
  );
  fs.writeFileSync(
    path.join(agentsDir, "engineering", "backend-developer", "SKILL.md"),
    "# Backend Developer\n\n> Server-side implementation specialist.\n\n…\n"
  );
  fs.writeFileSync(
    path.join(agentsDir, "engineering", "qa-engineer", "SKILL.md"),
    "# QA Engineer\n\n> Test design, regression suites, bug triage.\n\n…\n"
  );
  fs.writeFileSync(
    path.join(agentsDir, "_teams", "strategy", "TEAM_KNOWLEDGE.md"),
    "team-level lore (should be skipped)"
  );
  return { workspace: dir, agentsDir };
}

test("listSourceAgents discovers all (team, agent) pairs and skips _teams/", () => {
  const { agentsDir } = tempWorkspaceWithAssets();
  const found = listSourceAgents(agentsDir);
  const names = found.map((f) => `${f.team}/${f.agent}`).sort();
  assert.deepEqual(names, [
    "engineering/backend-developer",
    "engineering/qa-engineer",
    "strategy/pmf-planner",
  ]);
});

test("extractDescription pulls the blockquote line right after the H1", () => {
  const body = "# Backend Developer\n\n> Server-side implementation specialist.\n\n…\n";
  assert.equal(
    extractDescription(body),
    "Server-side implementation specialist."
  );
});

test("buildAgentFile produces YAML frontmatter with name/description/tools/model/team", () => {
  const out = buildAgentFile(
    "engineering",
    "backend-developer",
    "# Backend Developer\n\n> Server-side specialist.\n\nBody"
  );
  assert.match(out, /^---\n/);
  assert.match(out, /name: backend-developer\n/);
  assert.match(out, /description: Server-side specialist\.\n/);
  assert.match(out, /tools: \[/);
  assert.match(out, /model: (opus|sonnet|haiku)\n/);
  assert.match(out, /team: engineering\n/);
  // Body comes after the closing --- and a blank line
  assert.match(out, /---\n\n# Backend Developer/);
});

test("buildAgentFile honors per-agent overrides (qa-engineer gets Bash, idea-refiner gets haiku)", () => {
  const qa = buildAgentFile("engineering", "qa-engineer", "# QA\n\n> Tests.\n");
  assert.match(qa, /tools: \[.*Bash.*\]/);

  const idea = buildAgentFile("strategy", "idea-refiner", "# Idea\n\n> Brainstorm.\n");
  assert.match(idea, /model: haiku\n/);
});

test("syncAgentsToOrg writes <org>/.claude/agents/<name>.md for each source agent", () => {
  const { workspace, agentsDir } = tempWorkspaceWithAssets();
  const built = syncAgentsToOrg(workspace, "test-org", agentsDir);
  assert.equal(built.length, 3);
  const targetDir = path.join(workspace, "test-org", ".claude", "agents");
  assert.ok(fs.existsSync(targetDir));
  const written = fs.readdirSync(targetDir).sort();
  assert.deepEqual(written, [
    "backend-developer.md",
    "pmf-planner.md",
    "qa-engineer.md",
  ]);

  const content = fs.readFileSync(
    path.join(targetDir, "backend-developer.md"),
    "utf-8"
  );
  assert.match(content, /^---\nname: backend-developer\n/);
  assert.match(content, /team: engineering\n/);
});

test("listSourceAgents v1.1 flat layout — main/ and specialists/ resolve team from frontmatter", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-agbuild-v11-"));
  const agentsDir = path.join(dir, "agents");
  // main bots
  fs.mkdirSync(path.join(agentsDir, "main", "chief"), { recursive: true });
  fs.mkdirSync(path.join(agentsDir, "main", "pm"), { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "main", "chief", "SKILL.md"),
    `---
name: chief
team: chief
description: "Org supervisor"
---

# Chief
`
  );
  fs.writeFileSync(
    path.join(agentsDir, "main", "pm", "SKILL.md"),
    `---
name: pm
team: product
description: "PM main bot"
---

# PM
`
  );
  // specialists
  fs.mkdirSync(path.join(agentsDir, "specialists", "pmf-planner"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(agentsDir, "specialists", "backend-engineer"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(agentsDir, "specialists", "pmf-planner", "SKILL.md"),
    `---
name: pmf-planner
team: product
description: "PMF planning"
---

# PMF Planner
`
  );
  fs.writeFileSync(
    path.join(agentsDir, "specialists", "backend-engineer", "SKILL.md"),
    `---
name: backend-engineer
team: engineering
description: "Backend code"
---

# Backend Engineer
`
  );

  const found = listSourceAgents(agentsDir);
  const byAgent = new Map(found.map((f) => [f.agent, f.team]));
  assert.equal(byAgent.get("chief"), "chief");
  assert.equal(byAgent.get("pm"), "product");
  assert.equal(byAgent.get("pmf-planner"), "product");
  assert.equal(byAgent.get("backend-engineer"), "engineering");
  assert.equal(found.length, 4);
});

test("listSourceAgents v1.1 flat fallback team when frontmatter missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-agbuild-v11nf-"));
  const agentsDir = path.join(dir, "agents");
  fs.mkdirSync(path.join(agentsDir, "main", "no-fm-bot"), { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "main", "no-fm-bot", "SKILL.md"),
    "# No frontmatter\n\nbody only\n"
  );
  fs.mkdirSync(path.join(agentsDir, "specialists", "no-fm-spec"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(agentsDir, "specialists", "no-fm-spec", "SKILL.md"),
    "# No frontmatter\n\nbody only\n"
  );
  const found = listSourceAgents(agentsDir);
  const byAgent = new Map(found.map((f) => [f.agent, f.team]));
  // Fallback: main bucket → "chief", specialists bucket → "engineering".
  assert.equal(byAgent.get("no-fm-bot"), "chief");
  assert.equal(byAgent.get("no-fm-spec"), "engineering");
});

test("listSourceAgents mixed layout — v1.0.x nested + v1.1 flat coexist in one scan", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-agbuild-mixed-"));
  const agentsDir = path.join(dir, "agents");
  // Legacy
  fs.mkdirSync(path.join(agentsDir, "strategy", "legacy-planner"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(agentsDir, "strategy", "legacy-planner", "SKILL.md"),
    "# Legacy Planner\n"
  );
  // v1.1 flat
  fs.mkdirSync(path.join(agentsDir, "specialists", "new-planner"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(agentsDir, "specialists", "new-planner", "SKILL.md"),
    `---
name: new-planner
team: product
description: "v1.1"
---

# New Planner
`
  );
  const found = listSourceAgents(agentsDir);
  const byAgent = new Map(found.map((f) => [f.agent, f.team]));
  assert.equal(byAgent.get("legacy-planner"), "strategy");
  assert.equal(byAgent.get("new-planner"), "product");
  assert.equal(found.length, 2);
});
