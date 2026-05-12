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
