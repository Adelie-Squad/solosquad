import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  listSourceAgents,
  listTeamKnowledge,
} from "../src/bot/agents-builder.js";

/**
 * v0.6 S2 §2.1 — Team(=domain) KNOWLEDGE.md scanner tests.
 *
 * Validates the post-_teams/ topology where `agents/{team}/KNOWLEDGE.md`
 * sits side-by-side with `agents/{team}/{agent}/SKILL.md`. The two scanners
 * (`listSourceAgents` and `listTeamKnowledge`) must operate on disjoint
 * subsets — agents on the SKILL files, knowledge on the KNOWLEDGE files —
 * and both must skip `_meta/` and any legacy `_teams/` carryover.
 */

function buildFixture(): { agentsDir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-teamknow-"));
  const agentsDir = path.join(dir, "agents");

  // 4 team folders, each with at least one agent + one KNOWLEDGE.md
  for (const team of ["strategy", "growth", "experience", "engineering"]) {
    const teamPath = path.join(agentsDir, team);
    fs.mkdirSync(teamPath, { recursive: true });
    fs.writeFileSync(
      path.join(teamPath, "KNOWLEDGE.md"),
      `# ${team} - shared knowledge\n\n> craft notes for the ${team} team.\n`,
      "utf-8"
    );
    // one agent per team so the directory looks realistic
    const agentDir = path.join(teamPath, `${team}-anchor`);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "SKILL.md"),
      `---\nname: ${team}-anchor\ndescription: anchor agent for ${team}\n---\n# Anchor\n`,
      "utf-8"
    );
  }

  // _meta/ must be skipped
  fs.mkdirSync(path.join(agentsDir, "_meta", "workflow-maker"), { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "_meta", "workflow-maker", "SKILL.md"),
    "---\nname: workflow-maker\ndescription: meta\n---\n",
    "utf-8"
  );

  // legacy _teams/ carryover (e.g. an in-flight migration). Must be skipped.
  fs.mkdirSync(path.join(agentsDir, "_teams", "strategy"), { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "_teams", "strategy", "TEAM_KNOWLEDGE.md"),
    "legacy file that should not be discovered\n",
    "utf-8"
  );

  return {
    agentsDir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test("listTeamKnowledge discovers KNOWLEDGE.md for all 4 teams", () => {
  const { agentsDir, cleanup } = buildFixture();
  try {
    const found = listTeamKnowledge(agentsDir);
    const teams = found.map((f) => f.team).sort();
    assert.deepEqual(teams, ["engineering", "experience", "growth", "strategy"]);
    for (const entry of found) {
      assert.ok(
        entry.path.endsWith(path.join(entry.team, "KNOWLEDGE.md")),
        `path ${entry.path} should resolve under team ${entry.team}`
      );
      assert.ok(
        fs.existsSync(entry.path),
        "returned path should exist on disk"
      );
    }
  } finally {
    cleanup();
  }
});

test("listTeamKnowledge skips _meta/ and legacy _teams/", () => {
  const { agentsDir, cleanup } = buildFixture();
  try {
    const found = listTeamKnowledge(agentsDir);
    for (const entry of found) {
      assert.ok(
        !entry.team.startsWith("_"),
        `team "${entry.team}" must not be an underscore-prefixed directory`
      );
      // path must never traverse a _ -prefixed directory either
      const segments = entry.path.split(path.sep);
      const underscored = segments.find((s) => s.startsWith("_"));
      assert.equal(
        underscored,
        undefined,
        `path segment "${underscored}" should have been skipped`
      );
    }
  } finally {
    cleanup();
  }
});

test("listSourceAgents and listTeamKnowledge are disjoint — neither walks into the other", () => {
  const { agentsDir, cleanup } = buildFixture();
  try {
    const skills = listSourceAgents(agentsDir).map((s) => s.skillPath);
    const knowledge = listTeamKnowledge(agentsDir).map((k) => k.path);
    for (const sp of skills) {
      assert.ok(
        !knowledge.includes(sp),
        "SKILL path leaked into team knowledge scanner"
      );
      assert.ok(
        sp.endsWith("SKILL.md"),
        "agent scanner should only return SKILL.md files"
      );
    }
    for (const kp of knowledge) {
      assert.ok(
        !skills.includes(kp),
        "KNOWLEDGE path leaked into agent scanner"
      );
      assert.ok(
        kp.endsWith("KNOWLEDGE.md"),
        "knowledge scanner should only return KNOWLEDGE.md files"
      );
    }
  } finally {
    cleanup();
  }
});

test("listTeamKnowledge returns empty when agentsDir does not exist or has no KNOWLEDGE.md", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-teamknow-empty-"));
  try {
    // No files inside — empty result.
    assert.deepEqual(listTeamKnowledge(path.join(empty, "agents")), []);

    // Dir exists but only contains a team folder without KNOWLEDGE.md.
    const lone = path.join(empty, "lonely", "agents", "strategy", "pmf-planner");
    fs.mkdirSync(lone, { recursive: true });
    fs.writeFileSync(
      path.join(lone, "SKILL.md"),
      "---\nname: pmf-planner\ndescription: x\n---\n",
      "utf-8"
    );
    const found = listTeamKnowledge(path.join(empty, "lonely", "agents"));
    assert.deepEqual(found, []);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
