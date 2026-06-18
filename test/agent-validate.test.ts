import { test } from "node:test";
import assert from "node:assert/strict";

import { validateAgents } from "../src/bot/agent-validate.js";
import type { AgentSpec } from "../src/bot/agent-spec.js";

/** Build an AgentSpec with sane defaults; override per case. */
function spec(p: Partial<AgentSpec> & { name: string; team: string }): AgentSpec {
  const bucket = p.bucket ?? (p.tier === "leader" ? "main" : "specialists");
  return {
    tier: p.tier,
    category: p.category,
    devCapability: p.devCapability,
    collaborators: p.collaborators ?? [],
    usedBy: p.usedBy ?? [],
    skillsUsed: p.skillsUsed ?? [],
    dir: p.dir ?? p.name,
    bucket,
    skillPath: p.skillPath ?? `/agents/${bucket}/${p.name}/SKILL.md`,
    id: p.id ?? `${p.team}/${p.name}`,
    name: p.name,
    team: p.team,
  };
}

const codes = (fs: { code: string }[]): string[] => fs.map((f) => f.code);

test("clean hierarchical DAG passes", () => {
  const specs = [
    spec({ name: "chief", team: "chief", tier: "leader", collaborators: ["main/pm", "main/engineer"] }),
    spec({ name: "pm", team: "product", tier: "leader", usedBy: ["chief"], collaborators: ["engineering/architect"] }),
    spec({ name: "engineer", team: "engineering", tier: "leader", usedBy: ["chief", "pm"], collaborators: ["engineering/architect"] }),
    spec({ name: "architect", team: "engineering", tier: "member", usedBy: ["engineer", "pm"] }),
  ];
  const r = validateAgents(specs);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.errors.length, 0);
});

test("peer cycle is a warning, not an error (collaborators = peer mesh)", () => {
  const specs = [
    spec({ name: "chief", team: "chief", tier: "leader", collaborators: ["engineering/architect"] }),
    spec({ name: "architect", team: "engineering", tier: "member", collaborators: ["chief/chief"] }),
  ];
  const r = validateAgents(specs);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(codes(r.warnings).includes("AGENT_PEER_CYCLES"));
});

test("self-reference is a warning, not an error", () => {
  const specs = [spec({ name: "pm", team: "product", tier: "leader", collaborators: ["product/pm"] })];
  const r = validateAgents(specs);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(codes(r.warnings).includes("AGENT_SELF_REF"));
});

test("wildcard used_by '*' is valid (not an unresolved ref)", () => {
  const specs = [
    spec({ name: "chief", team: "chief", tier: "leader", usedBy: ["*"], collaborators: ["main/pm"] }),
    spec({ name: "pm", team: "product", tier: "leader", usedBy: ["chief"] }),
  ];
  const r = validateAgents(specs);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(codes(r.errors).filter((c) => c === "AGENT_REF_UNRESOLVED").length, 0);
});

test("unresolved collaborator ref is an error", () => {
  const specs = [
    spec({ name: "chief", team: "chief", tier: "leader", collaborators: ["engineering/ghost"] }),
  ];
  const r = validateAgents(specs);
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes("AGENT_REF_UNRESOLVED"));
});

test("dir mismatch and malformed name are errors", () => {
  const specs = [
    spec({ name: "Bad_Name", team: "engineering", tier: "member", dir: "good-dir" }),
  ];
  const r = validateAgents(specs);
  assert.ok(codes(r.errors).includes("AGENT_NAME_MALFORMED"));
  assert.ok(codes(r.errors).includes("AGENT_DIR_MISMATCH"));
});

test("orphan specialist (no leader reaches it) is a warning", () => {
  const specs = [
    spec({ name: "chief", team: "chief", tier: "leader", collaborators: ["main/pm"] }),
    spec({ name: "pm", team: "product", tier: "leader", usedBy: ["chief"] }),
    spec({ name: "lonely", team: "engineering", tier: "member" }),
  ];
  const r = validateAgents(specs);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const orphan = r.warnings.find((w) => w.code === "AGENT_ORPHAN");
  assert.ok(orphan);
  assert.equal(orphan.agent, "engineering/lonely");
});

test("depth beyond cap warns", () => {
  const specs = [
    spec({ name: "chief", team: "chief", tier: "leader", collaborators: ["specialists/a"] }),
    spec({ name: "a", team: "engineering", tier: "member", collaborators: ["specialists/b"] }),
    spec({ name: "b", team: "engineering", tier: "member", collaborators: ["specialists/c"] }),
    spec({ name: "c", team: "engineering", tier: "member" }),
  ];
  const r = validateAgents(specs, { maxDelegationDepth: 2 });
  assert.ok(codes(r.warnings).includes("AGENT_DEPTH_EXCEEDS"));
});

test("skills_used resolution against knownSkills", () => {
  const specs = [
    spec({ name: "pm", team: "product", tier: "leader", skillsUsed: ["triage", "ghost-skill"] }),
  ];
  const r = validateAgents(specs, { knownSkills: new Set(["triage"]) });
  const w = r.warnings.find((w) => w.code === "AGENT_SKILL_UNRESOLVED");
  assert.ok(w);
  assert.match(w.message, /ghost-skill/);
});

test("tier/bucket mismatch warns", () => {
  const specs = [
    spec({ name: "architect", team: "engineering", tier: "leader", bucket: "specialists" }),
  ];
  const r = validateAgents(specs);
  assert.ok(codes(r.warnings).includes("AGENT_TIER_BUCKET_MISMATCH"));
});
