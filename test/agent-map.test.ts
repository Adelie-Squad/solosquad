import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mapAgentToTaxonomy,
  mapAgentTeam,
  parseTeamReply,
  type AgentTeamCaller,
} from "../src/analyze/agent-map.js";

test("known frontmatter team wins (high confidence)", () => {
  const m = mapAgentToTaxonomy({ name: "whatever", frontmatterTeam: "design", frontmatterTier: "member" });
  assert.equal(m.team, "design");
  assert.equal(m.tier, "member");
  assert.equal(m.confidence, "high");
  assert.equal(m.source, "frontmatter");
});

test("name keyword maps to a team (high)", () => {
  assert.equal(mapAgentToTaxonomy({ name: "backend-engineer" }).team, "engineering");
  assert.equal(mapAgentToTaxonomy({ name: "ux-designer" }).team, "design");
  assert.equal(mapAgentToTaxonomy({ name: "gtm-strategist" }).team, "marketing");
  assert.equal(mapAgentToTaxonomy({ name: "pmf-planner" }).team, "product");
  assert.equal(mapAgentToTaxonomy({ name: "backend-engineer" }).source, "heuristic");
});

test("description keyword maps low-confidence when name is opaque", () => {
  const m = mapAgentToTaxonomy({ name: "helper", description: "writes marketing campaign copy" });
  assert.equal(m.team, "marketing");
  assert.equal(m.confidence, "low");
});

test("unknown maps to engineering default (low)", () => {
  const m = mapAgentToTaxonomy({ name: "zzz", description: "does opaque things" });
  assert.equal(m.team, "engineering");
  assert.equal(m.confidence, "low");
  assert.equal(m.source, "default");
});

test("leader hint in name → leader tier", () => {
  assert.equal(mapAgentToTaxonomy({ name: "growth-lead" }).tier, "leader");
  assert.equal(mapAgentToTaxonomy({ name: "ux-designer" }).tier, "member");
});

// --- §10.3 LLM fallback ---------------------------------------------------

/** A caller that records inputs and returns a fixed verdict. */
function mockCaller(verdict: { team: string; tier?: string } | null): AgentTeamCaller & { seen: string[] } {
  const caller = {
    call_count: 0,
    seen: [] as string[],
    async classify(input: { name: string }) {
      caller.call_count++;
      caller.seen.push(input.name);
      return verdict as { team: "product"; tier?: "member" } | null;
    },
  };
  return caller;
}

test("mapAgentTeam: confident actors never reach the LLM (call_count 0)", async () => {
  const caller = mockCaller({ team: "design" });
  const m = await mapAgentTeam({ name: "backend-engineer" }, { caller });
  assert.equal(m.team, "engineering"); // heuristic stood; LLM not consulted
  assert.equal(m.source, "heuristic");
  assert.equal(caller.call_count, 0);
});

test("mapAgentTeam: ambiguous actor is escalated and adopts the LLM team", async () => {
  const caller = mockCaller({ team: "marketing", tier: "leader" });
  const m = await mapAgentTeam({ name: "zzz", description: "does opaque things" }, { caller });
  assert.equal(caller.call_count, 1);
  assert.equal(caller.seen[0], "zzz");
  assert.equal(m.team, "marketing");
  assert.equal(m.tier, "leader");
  assert.equal(m.source, "llm");
  assert.equal(m.confidence, "low"); // llm guess stays flagged for review
});

test("mapAgentTeam: caller error/garbage falls back to heuristic default", async () => {
  const bad: AgentTeamCaller = {
    async classify() {
      throw new Error("model offline");
    },
  };
  const m = await mapAgentTeam({ name: "zzz", description: "opaque" }, { caller: bad });
  assert.equal(m.team, "engineering");
  assert.equal(m.source, "default");
});

test("mapAgentTeam: unrecognized team from LLM is ignored (heuristic default)", async () => {
  const caller = mockCaller({ team: "legal" }); // not a SoloSquad team
  const m = await mapAgentTeam({ name: "zzz", description: "opaque" }, { caller });
  assert.equal(m.source, "default");
  assert.equal(m.team, "engineering");
});

test("mapAgentTeam: no caller → pure heuristic (offline/dry-run path)", async () => {
  const m = await mapAgentTeam({ name: "zzz", description: "opaque" });
  assert.equal(m.source, "default");
});

test("parseTeamReply: extracts JSON from prose, validates team", () => {
  assert.deepEqual(parseTeamReply('Here you go: {"team": "product", "tier": "member"} done'), {
    team: "product",
    tier: "member",
  });
  assert.equal(parseTeamReply('{"team": "legal"}'), null); // unknown team
  assert.equal(parseTeamReply("no json here"), null);
  assert.deepEqual(parseTeamReply('{"team":"CHIEF"}'), { team: "chief", tier: undefined });
});
