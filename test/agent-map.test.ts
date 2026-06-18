import { test } from "node:test";
import assert from "node:assert/strict";

import { mapAgentToTaxonomy } from "../src/analyze/agent-map.js";

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
