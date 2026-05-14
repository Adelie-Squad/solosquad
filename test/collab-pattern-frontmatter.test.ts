import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listSourceAgents } from "../src/bot/agents-builder.js";
import { parseSkillMd, validateSkill } from "../src/bot/skill-parser.js";
import {
  COLLAB_PATTERN_OVERRIDES,
  injectCollabPattern,
  type CollabPattern,
} from "../scripts/inject-collab-pattern.js";

/**
 * v0.6 S2 §2.4 — collab_pattern frontmatter coverage.
 *
 * Ensures that every bundled 25 agent SKILL.md exposes a valid
 * `collab_pattern` value, and that the v0.5 skill-parser absorbs it via the
 * forward-compat `extra` bag (no SkillSpec interface change in this sprint).
 *
 * Also verifies the override map (3 non-hierarchical agents) is honored.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_AGENTS_DIR = path.resolve(__dirname, "..", "assets", "agents");

const VALID_PATTERNS: ReadonlySet<CollabPattern> = new Set([
  "hierarchical",
  "graph",
  "dynamic",
]);

function frontmatterFor(skillPath: string): Record<string, unknown> {
  const raw = fs.readFileSync(skillPath, "utf-8");
  const spec = parseSkillMd(raw, skillPath);
  // collab_pattern is unknown to v0.5 schema → lands in `extra`
  return { ...spec.extra, _spec: spec };
}

test("all 25 bundled SKILL.md files declare a valid collab_pattern", () => {
  const sources = listSourceAgents(ASSETS_AGENTS_DIR);
  assert.equal(
    sources.length,
    25,
    `expected 25 bundled SKILL.md files, found ${sources.length}`
  );

  for (const { team, agent, skillPath } of sources) {
    const fm = frontmatterFor(skillPath);
    const pattern = fm.collab_pattern;
    assert.ok(
      typeof pattern === "string" && VALID_PATTERNS.has(pattern as CollabPattern),
      `${team}/${agent}: collab_pattern is ${JSON.stringify(pattern)} (expected one of ${[...VALID_PATTERNS].join("|")})`
    );

    // Expected value per the override map.
    const expected =
      COLLAB_PATTERN_OVERRIDES[`${team}/${agent}`] ?? "hierarchical";
    assert.equal(
      pattern,
      expected,
      `${team}/${agent}: collab_pattern should be "${expected}" but is "${pattern}"`
    );
  }
});

test("v0.5 skill-parser ignores collab_pattern gracefully — validator still green", () => {
  const sources = listSourceAgents(ASSETS_AGENTS_DIR);
  for (const { team, agent, skillPath } of sources) {
    const raw = fs.readFileSync(skillPath, "utf-8");
    const spec = parseSkillMd(raw, skillPath);
    const result = validateSkill(spec);
    assert.ok(
      result.ok,
      `${team}/${agent}: validator unexpectedly failed — ${result.errors
        .map((e) => `${e.code}:${e.message}`)
        .join("; ")}`
    );
    // Verify field is in `extra` (forward-compat behavior, not a typed field).
    assert.ok(
      Object.prototype.hasOwnProperty.call(spec.extra, "collab_pattern"),
      `${team}/${agent}: collab_pattern should land in spec.extra (v0.5 parser is unchanged)`
    );
  }
});

test("injectCollabPattern is idempotent and adds field only when missing", () => {
  const minimal = [
    "---",
    "name: dummy",
    "description: tester",
    "---",
    "# Body",
    "",
  ].join("\n");

  const once = injectCollabPattern(minimal, "graph");
  assert.ok(once, "should inject on a fresh SKILL");
  assert.match(once, /collab_pattern: graph/);

  const twice = injectCollabPattern(once, "graph");
  assert.equal(twice, null, "second pass must be a no-op (idempotent)");

  // A SKILL that already declares a different value is also left alone.
  const preset = minimal.replace(
    "description: tester",
    "description: tester\ncollab_pattern: dynamic"
  );
  assert.equal(
    injectCollabPattern(preset, "hierarchical"),
    null,
    "pre-set value must be respected by idempotent skip"
  );
});
