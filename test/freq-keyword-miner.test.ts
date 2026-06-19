import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  mineFrequentKeywords,
  applyKeywordSuggestion,
  recordKeywordRejection,
  freqSuggestionLine,
  type KeywordSuggestion,
} from "../src/scheduler/freq-keyword-miner.js";
import { recordRouteMiss } from "../src/memory/route-event-sink.js";
import { installRoutes } from "../src/bot/agent-router.js";
import { parseSkillMd } from "../src/bot/skill-parser.js";

/**
 * v0.6 S5 §3.4 — freq-keyword-miner tests.
 *
 * Pattern: seed route_miss events that contain a recurring N-gram + a
 * SKILL.md whose existing triggers/description share tokens with the
 * N-gram. The miner should propose patching the SKILL's frontmatter only.
 */

function makeWorkspace(): { workspace: string; orgSlug: string; skillRoot: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-freq-"));
  const orgSlug = "demo";
  const skillRoot = path.join(workspace, orgSlug, ".agents");
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });
  fs.mkdirSync(skillRoot, { recursive: true });
  return { workspace, orgSlug, skillRoot };
}

function isolateRouter(): void {
  installRoutes({ slash: {}, keyword: {}, freq: [], explicit: {} });
}

function seedSkill(
  skillRoot: string,
  team: string,
  slug: string,
  description: string,
  existingKeywords: string[],
): string {
  const dir = path.join(skillRoot, team, slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  const fm = [
    `name: "${slug}"`,
    `description: "${description}"`,
    `team: ${team}`,
    "stateful: false",
    "triggers:",
    `  keyword: [${existingKeywords.map((k) => `"${k}"`).join(", ")}]`,
    "  explicit: true",
  ].join("\n");
  const content = `---\n${fm}\n---\n# ${slug}\n\n> ${description}\n`;
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

function seedMisses(
  workspace: string,
  orgSlug: string,
  text: string,
  count: number,
  baseIso: string,
): void {
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.parse(baseIso) + i * 60_000).toISOString();
    recordRouteMiss({ workspace, orgSlug, now: ts, message: text });
  }
}

test("freq: detects keyword that misses 3+ times and overlaps with an existing SKILL", async () => {
  const { workspace, orgSlug, skillRoot } = makeWorkspace();
  seedSkill(
    skillRoot,
    "strategy",
    "pmf-planner",
    "PMF planning and survey design",
    ["pmf planning", "survey"],
  );
  seedMisses(workspace, orgSlug, "pmf survey monitor", 4, "2026-05-10T00:00:00.000Z");

  const suggestions = await mineFrequentKeywords({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
    skillRoots: [skillRoot],
  });
  assert.ok(suggestions.length >= 1);
  // The suggestion must target the SKILL we seeded.
  const hit = suggestions.find((s) => s.target_skill_name === "pmf-planner");
  assert.ok(hit, "expected match for pmf-planner");
  assert.ok(hit!.miss_count >= 3);
  assert.ok(hit!.overlap_score >= 2);
});

test("freq: returns 0 suggestions when no SKILL semantically overlaps with the keyword", async () => {
  const { workspace, orgSlug, skillRoot } = makeWorkspace();
  // SKILL is about UI design; misses are about API access — no overlap.
  seedSkill(
    skillRoot,
    "experience",
    "ui-designer",
    "UI design wireframe layout color",
    ["ui design", "wireframe"],
  );
  seedMisses(workspace, orgSlug, "rest api token bearer", 5, "2026-05-10T00:00:00.000Z");

  const suggestions = await mineFrequentKeywords({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
    skillRoots: [skillRoot],
  });
  assert.equal(suggestions.length, 0);
});

test("freq: rejected suggestion is excluded for 30 days", async () => {
  const { workspace, orgSlug, skillRoot } = makeWorkspace();
  seedSkill(
    skillRoot,
    "strategy",
    "feature-planner",
    "feature planning roadmap scope estimation",
    ["feature plan"],
  );
  // miss N-gram overlaps on `feature` + `roadmap` (both in description) → ≥ 2.
  seedMisses(workspace, orgSlug, "feature roadmap quarterly", 4, "2026-05-10T00:00:00.000Z");

  const first = await mineFrequentKeywords({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
    skillRoots: [skillRoot],
  });
  assert.ok(first.length >= 1);

  recordKeywordRejection({
    workspace,
    orgSlug,
    suggestion_id: first[0].suggestion_id,
    now: "2026-05-14T00:00:00.000Z",
  });

  const second = await mineFrequentKeywords({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
    skillRoots: [skillRoot],
  });
  assert.equal(
    second.find((s) => s.suggestion_id === first[0].suggestion_id),
    undefined,
    "rejected (keyword, skill) pair must not re-appear within 30d cooldown",
  );
});

test("freq: applyKeywordSuggestion patches frontmatter only — body is byte-identical", async () => {
  isolateRouter();
  const { workspace, orgSlug, skillRoot } = makeWorkspace();
  const skillPath = seedSkill(
    skillRoot,
    "strategy",
    "policy-architect",
    "policy architecture and decision frameworks",
    ["policy"],
  );
  const before = fs.readFileSync(skillPath, "utf-8");
  const bodyBefore = before.split("---")[2];

  const suggestion: KeywordSuggestion = {
    suggestion_id: "freq-policy-architect-architecture",
    keyword: "architecture",
    target_skill_path: skillPath,
    target_skill_name: "policy-architect",
    miss_count: 4,
    overlap_score: 2,
    first_seen: "2026-05-10T00:00:00.000Z",
  };

  await applyKeywordSuggestion({ workspace, orgSlug, suggestion });

  const after = fs.readFileSync(skillPath, "utf-8");
  const bodyAfter = after.split("---")[2];
  assert.equal(bodyAfter, bodyBefore, "SKILL body must be byte-identical");

  // Frontmatter must now include the new keyword.
  const reparsed = parseSkillMd(after, skillPath);
  assert.ok(reparsed.triggers?.keyword?.includes("architecture"));
  assert.ok(reparsed.triggers?.keyword?.includes("policy"), "existing keyword preserved");
});

test("freq: N-gram extraction respects stop-word filter (size 1..3)", async () => {
  const { workspace, orgSlug, skillRoot } = makeWorkspace();
  // Use a phrase whose only meaningful tokens are stop-words — should be filtered.
  seedSkill(
    skillRoot,
    "strategy",
    "filler",
    "the the the and and and",
    ["filler"],
  );
  seedMisses(workspace, orgSlug, "the and how what where", 5, "2026-05-10T00:00:00.000Z");

  const suggestions = await mineFrequentKeywords({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
    skillRoots: [skillRoot],
  });
  // Stop-word filter strips all tokens — no proposal.
  assert.equal(suggestions.length, 0);
});

test("freq: does not re-suggest a keyword that is already in triggers.keyword", async () => {
  const { workspace, orgSlug, skillRoot } = makeWorkspace();
  // SKILL already has "deploy pipeline" — the same N-gram is in misses.
  seedSkill(
    skillRoot,
    "engineering",
    "cloud-admin",
    "deploy pipeline operations",
    ["deploy pipeline", "deploy"],
  );
  seedMisses(workspace, orgSlug, "deploy pipeline check", 5, "2026-05-10T00:00:00.000Z");

  const suggestions = await mineFrequentKeywords({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
    skillRoots: [skillRoot],
  });
  // No suggestion should point at "deploy pipeline" since it already exists.
  const dupe = suggestions.find((s) => s.keyword === "deploy pipeline");
  assert.equal(dupe, undefined, "must not propose a keyword that already exists");
});

test("freqSuggestionLine returns null when there's nothing to suggest (brief stays clean)", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sq-freqline-"));
  try {
    fs.mkdirSync(path.join(ws, "demo", ".solosquad"), { recursive: true });
    fs.writeFileSync(path.join(ws, "demo", ".org.yaml"), "slug: demo\nname: Demo\n");
    assert.equal(await freqSuggestionLine(ws, "demo"), null);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
