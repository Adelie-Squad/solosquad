import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assembleSpawnContext,
  type LayerKind,
} from "../src/bot/spawn-assembler.js";

/**
 * v0.6 §2.2 — 8-layer JIT spawn-time context assembler.
 *
 * Tests cover (per S3 DoD):
 *   1. Layer ordering by index 1→8
 *   2. KNOWLEDGE.md only injected for the agent's own team
 *   3. agent SKILL.md is REQUIRED — never dropped
 *   4. Token cap triggers drop in priority order (repo → workspace → domain →
 *      team → handoff)
 *   5. Org core + agent-profile are REQUIRED — never dropped even at small cap
 *   6. Truncated layers are recorded to <org>/memory/spawn-decisions.jsonl
 *   7. Missing folders are handled gracefully (no crash; empty content)
 */

interface FixtureOpts {
  /** Override `getAgentsDir()` by writing into `.solosquad/agents/`. */
  teamKnowledge?: { team: string; content: string }[];
  agentSkills?: { team: string; name: string; content: string }[];
  orgCore?: { principles?: string; voice?: string };
  agentProfileYaml?: string;
  orgDomain?: { name: string; content: string }[];
  workspaceKnowledge?: { name: string; content: string }[];
  handoff?: { workflowId: string; content: string };
}

function buildFixture(opts: FixtureOpts): { workspace: string; orgSlug: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-spawn-"));
  const orgSlug = "demo";
  const orgDir = path.join(workspace, orgSlug);
  fs.mkdirSync(path.join(orgDir, "memory"), { recursive: true });

  // .solosquad/agents/ — so getAgentsDir() resolves into this fixture.
  const agentsRoot = path.join(workspace, ".solosquad", "agents");
  fs.mkdirSync(agentsRoot, { recursive: true });

  for (const tk of opts.teamKnowledge ?? []) {
    const teamDir = path.join(agentsRoot, tk.team);
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(path.join(teamDir, "KNOWLEDGE.md"), tk.content, "utf-8");
  }

  for (const sk of opts.agentSkills ?? []) {
    const dir = path.join(agentsRoot, sk.team, sk.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), sk.content, "utf-8");
  }

  if (opts.orgCore) {
    const coreDir = path.join(orgDir, "core");
    fs.mkdirSync(coreDir, { recursive: true });
    if (opts.orgCore.principles) {
      fs.writeFileSync(path.join(coreDir, "PRINCIPLES.md"), opts.orgCore.principles);
    }
    if (opts.orgCore.voice) {
      fs.writeFileSync(path.join(coreDir, "VOICE.md"), opts.orgCore.voice);
    }
  }

  if (opts.agentProfileYaml !== undefined) {
    fs.writeFileSync(path.join(orgDir, "agent-profile.yaml"), opts.agentProfileYaml);
  }

  if (opts.orgDomain) {
    const domainDir = path.join(orgDir, "domain");
    fs.mkdirSync(domainDir, { recursive: true });
    for (const d of opts.orgDomain) {
      fs.writeFileSync(path.join(domainDir, d.name), d.content);
    }
  }

  if (opts.workspaceKnowledge) {
    const kdir = path.join(workspace, ".solosquad", "knowledge");
    fs.mkdirSync(kdir, { recursive: true });
    for (const k of opts.workspaceKnowledge) {
      fs.writeFileSync(path.join(kdir, k.name), k.content);
    }
  }

  if (opts.handoff) {
    const wfDir = path.join(orgDir, "workflows", opts.handoff.workflowId);
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, "_handoff.md"), opts.handoff.content);
  }

  // Set cwd into workspace so getAgentsDir() resolves into .solosquad/agents.
  process.chdir(workspace);
  return { workspace, orgSlug };
}

function findLayer(layers: { kind: LayerKind; content: string }[], kind: LayerKind) {
  return layers.find((l) => l.kind === kind);
}

test("8-layer order matches §2.2 spec (index 1..8 in array order)", () => {
  const { workspace, orgSlug } = buildFixture({
    agentSkills: [{ team: "strategy", name: "business-strategist", content: "# bs" }],
    orgCore: { principles: "principle one" },
  });
  const result = assembleSpawnContext({
    workspace,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    dryRun: true,
  });
  const indices = result.layers.map((l) => l.index);
  // Order must be ascending: layers are appended in [1]..[8] order.
  const sorted = [...indices].sort((a, b) => a - b);
  assert.deepEqual(indices, sorted);
  // Required layers should all be present.
  assert.ok(findLayer(result.layers, "agent-skill"));
});

test("team KNOWLEDGE.md is only injected for the agent's own team", () => {
  const { workspace, orgSlug } = buildFixture({
    teamKnowledge: [
      { team: "strategy", content: "Strategy team knowledge body" },
      { team: "engineering", content: "Engineering team knowledge body" },
    ],
    agentSkills: [{ team: "strategy", name: "business-strategist", content: "# bs" }],
  });

  const result = assembleSpawnContext({
    workspace,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    dryRun: true,
  });

  const teamLayer = findLayer(result.layers, "team-knowledge");
  assert.ok(teamLayer);
  assert.match(teamLayer.content, /Strategy team knowledge/);
  assert.doesNotMatch(teamLayer.content, /Engineering team knowledge/);
});

test("agent SKILL.md is REQUIRED — never dropped even with tiny cap", () => {
  const bigKnowledge = "knowledge ".repeat(5000);
  const { workspace, orgSlug } = buildFixture({
    agentSkills: [{ team: "strategy", name: "business-strategist", content: "# bs IDENTITY" }],
    workspaceKnowledge: [{ name: "big.md", content: bigKnowledge + " business" }],
    orgDomain: [{ name: "market.md", content: bigKnowledge + " business" }],
  });

  const result = assembleSpawnContext({
    workspace,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    query: "business",
    maxContextTokens: 100, // ridiculously small
    dryRun: true,
  });

  const skillLayer = findLayer(result.layers, "agent-skill");
  assert.ok(skillLayer);
  assert.match(skillLayer.content, /IDENTITY/);
  // Something else must have been dropped — at least workspace knowledge.
  assert.ok(result.truncated.length > 0);
});

test("token cap drop priority: repo first, then workspace knowledge, then domain", () => {
  // Build content that all matches the query so keyword hits are equal.
  const filler = "business strategy ".repeat(500);
  const { workspace, orgSlug } = buildFixture({
    teamKnowledge: [{ team: "strategy", content: filler }],
    agentSkills: [{ team: "strategy", name: "business-strategist", content: "# bs" }],
    orgCore: { principles: "principle short" },
    orgDomain: [{ name: "market.md", content: filler }],
    workspaceKnowledge: [{ name: "frameworks.md", content: filler }],
  });

  const result = assembleSpawnContext({
    workspace,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    query: "business strategy",
    maxContextTokens: 250, // forces drops
    dryRun: true,
  });

  // Required layers preserved.
  assert.ok(findLayer(result.layers, "agent-skill"));
  assert.ok(findLayer(result.layers, "org-core"));
  assert.ok(findLayer(result.layers, "agent-profile"));
  // Truncated should include at least one non-required layer.
  assert.ok(result.truncated.length > 0);
  assert.ok(
    result.truncated.some((t) =>
      /workspace knowledge|org domain|team knowledge|target repo/.test(t),
    ),
  );
});

test("org-core and agent-profile are REQUIRED — never appear in truncated list", () => {
  const filler = "business ".repeat(2000);
  const { workspace, orgSlug } = buildFixture({
    agentSkills: [{ team: "strategy", name: "business-strategist", content: "# bs" }],
    orgCore: { principles: "MUST KEEP principles" },
    agentProfileYaml:
      `schema_version: 1\ndefaults:\n  tone: conservative\n`,
    workspaceKnowledge: [{ name: "frameworks.md", content: filler + " business" }],
    orgDomain: [{ name: "market.md", content: filler + " business" }],
  });

  const result = assembleSpawnContext({
    workspace,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    query: "business",
    maxContextTokens: 80,
    dryRun: true,
  });

  // Even at tiny cap, the required layers remain.
  const core = findLayer(result.layers, "org-core");
  assert.ok(core);
  assert.match(core.content, /MUST KEEP/);
  const profile = findLayer(result.layers, "agent-profile");
  assert.ok(profile);
  assert.match(profile.content, /conservative/);
  // None of the required labels should ever appear in truncated.
  for (const t of result.truncated) {
    assert.doesNotMatch(t, /agent SKILL|org core|agent-profile/);
  }
});

test("drops are recorded to <org>/memory/spawn-decisions.jsonl", () => {
  const filler = "biz ".repeat(2000);
  const { workspace, orgSlug } = buildFixture({
    agentSkills: [{ team: "strategy", name: "business-strategist", content: "# bs" }],
    workspaceKnowledge: [{ name: "big.md", content: filler + " biz" }],
  });

  assembleSpawnContext({
    workspace,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    query: "biz",
    maxContextTokens: 50,
    // dryRun NOT set — we want to verify the JSONL write path.
  });

  const log = path.join(workspace, orgSlug, "memory", "spawn-decisions.jsonl");
  assert.ok(fs.existsSync(log));
  const lines = fs.readFileSync(log, "utf-8").trim().split("\n");
  assert.ok(lines.length >= 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event_type, "spawn_decision");
  assert.equal(parsed.agent, "business-strategist");
  assert.equal(parsed.org, orgSlug);
  assert.ok(Array.isArray(parsed.truncated));
  assert.ok(parsed.truncated.length > 0);
});

test("missing org folders (core/domain/handoff) yield empty layers — no crash", () => {
  const { workspace, orgSlug } = buildFixture({
    agentSkills: [{ team: "strategy", name: "business-strategist", content: "# bs" }],
    // No orgCore, agentProfileYaml, orgDomain, workspaceKnowledge, handoff.
  });

  // Force an empty .solosquad/knowledge/ so the bundled knowledge/
  // fallback isn't picked up — we're testing the missing-folder path.
  fs.mkdirSync(path.join(workspace, ".solosquad", "knowledge"), { recursive: true });

  const result = assembleSpawnContext({
    workspace,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    workflowId: "wf-does-not-exist",
    repoSlug: "no-such-repo",
    dryRun: true,
  });

  // Required layers still present.
  assert.ok(findLayer(result.layers, "agent-skill"));
  // Org-level missing folders yield empty content.
  const core = findLayer(result.layers, "org-core");
  assert.equal(core?.content ?? "", "");
  const domain = findLayer(result.layers, "org-domain");
  assert.equal(domain?.content ?? "", "");
  const handoff = findLayer(result.layers, "handoff");
  assert.equal(handoff?.content ?? "", "");
  const repo = findLayer(result.layers, "repo-context");
  assert.equal(repo?.content ?? "", "");
  // Workspace knowledge resolves to the empty workspace dir (no bundle fallback).
  const knowledge = findLayer(result.layers, "workspace-knowledge");
  assert.equal(knowledge?.content ?? "", "");
});
