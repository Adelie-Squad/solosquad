import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  KNOWN_TEAMS,
  loadComposition,
  loadAllCompositions,
  findTeamForMember,
  isSharedSkill,
} from "../src/util/composition.js";

function mkWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-composition-"));
}

function writeComposition(
  root: string,
  team: string,
  body: string
): void {
  const dir = path.join(root, "teams", team);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "composition.yaml"), body, "utf8");
}

test("loadComposition: returns null when file missing", () => {
  const ws = mkWorkspace();
  const result = loadComposition("product", { workspaceRoot: ws });
  assert.equal(result, null);
});

test("loadComposition: parses a valid composition.yaml", () => {
  const ws = mkWorkspace();
  writeComposition(
    ws,
    "product",
    `main: pm
members:
  - pmf-planner
  - feature-planner
shared_skills:
  - prd-writer
`
  );
  const c = loadComposition("product", { workspaceRoot: ws });
  assert.ok(c, "composition should load");
  assert.equal(c.main, "pm");
  assert.deepEqual(c.members, ["pmf-planner", "feature-planner"]);
  assert.deepEqual(c.shared_skills, ["prd-writer"]);
});

test("loadComposition: returns null on malformed yaml", () => {
  const ws = mkWorkspace();
  writeComposition(ws, "product", "not: real: yaml: ::::");
  const c = loadComposition("product", { workspaceRoot: ws });
  assert.equal(c, null);
});

test("loadComposition: returns null when 'main' missing", () => {
  const ws = mkWorkspace();
  writeComposition(ws, "product", `members: [pmf-planner]\n`);
  const c = loadComposition("product", { workspaceRoot: ws });
  assert.equal(c, null);
});

test("loadComposition: org override beats workspace bundle", () => {
  const ws = mkWorkspace();
  const orgRoot = path.join(ws, "demo-org");
  writeComposition(ws, "product", `main: pm\nmembers: [pmf-planner]\n`);
  fs.mkdirSync(path.join(orgRoot, "teams", "product"), { recursive: true });
  fs.writeFileSync(
    path.join(orgRoot, "teams", "product", "composition.yaml"),
    `main: pm\nmembers:\n  - custom-specialist\nshared_skills: []\n`,
    "utf8"
  );
  const c = loadComposition("product", { workspaceRoot: ws, orgRoot });
  assert.ok(c);
  assert.deepEqual(c.members, ["custom-specialist"]);
});

test("loadAllCompositions: only includes teams with files", () => {
  const ws = mkWorkspace();
  writeComposition(ws, "product", `main: pm\nmembers: [pmf-planner]\n`);
  writeComposition(ws, "marketing", `main: marketer\nmembers: [brand-marketer]\n`);
  const all = loadAllCompositions({ workspaceRoot: ws });
  assert.equal(Object.keys(all).length, 2);
  assert.ok(all.product);
  assert.ok(all.marketing);
  assert.equal(all.engineering, undefined);
});

test("findTeamForMember: locates a specialist by name", () => {
  const ws = mkWorkspace();
  writeComposition(
    ws,
    "engineering",
    `main: engineer\nmembers:\n  - backend-engineer\n  - architect\n`
  );
  writeComposition(
    ws,
    "design",
    `main: designer\nmembers:\n  - researcher\n`
  );
  assert.equal(
    findTeamForMember("backend-engineer", { workspaceRoot: ws }),
    "engineering"
  );
  assert.equal(findTeamForMember("researcher", { workspaceRoot: ws }), "design");
  assert.equal(findTeamForMember("nonexistent", { workspaceRoot: ws }), null);
});

test("findTeamForMember: cross_team_members fallback", () => {
  const ws = mkWorkspace();
  writeComposition(
    ws,
    "design",
    `main: designer\nmembers:\n  - ui-designer\ncross_team_members:\n  - brand-marketer\n`
  );
  // brand-marketer not in any team's `members`, but design lists it as cross-team.
  assert.equal(
    findTeamForMember("brand-marketer", { workspaceRoot: ws }),
    "design"
  );
});

test("isSharedSkill: true when listed under any team's shared_skills", () => {
  const ws = mkWorkspace();
  writeComposition(
    ws,
    "product",
    `main: pm\nmembers: [pmf-planner]\nshared_skills:\n  - prd-writer\n  - prioritization\n`
  );
  assert.equal(isSharedSkill("prd-writer", { workspaceRoot: ws }), true);
  assert.equal(isSharedSkill("nonexistent", { workspaceRoot: ws }), false);
});

test("KNOWN_TEAMS enumerates the four v1.1 teams", () => {
  assert.deepEqual([...KNOWN_TEAMS], [
    "product",
    "engineering",
    "design",
    "marketing",
  ]);
});
