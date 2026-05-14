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
 * Every bundled 25 agent SKILL.md must expose a valid `collab_pattern`.
 *
 * v0.5 parser landed `collab_pattern` in the `extra` bag (forward-compat).
 * v0.6 promotes it to a typed `SkillSpec.collab_pattern` field — so we now
 * read the typed field directly and assert that `extra` no longer carries
 * it (a regression in v0.5/v0.6 surface would land it in extra again).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_AGENTS_DIR = path.resolve(__dirname, "..", "assets", "agents");

const VALID_PATTERNS: ReadonlySet<CollabPattern> = new Set([
  "hierarchical",
  "graph",
  "dynamic",
]);

test("all 25 bundled SKILL.md files declare a valid collab_pattern", () => {
  const sources = listSourceAgents(ASSETS_AGENTS_DIR);
  assert.equal(
    sources.length,
    25,
    `expected 25 bundled SKILL.md files, found ${sources.length}`
  );

  for (const { team, agent, skillPath } of sources) {
    const raw = fs.readFileSync(skillPath, "utf-8");
    const spec = parseSkillMd(raw, skillPath);
    const pattern = spec.collab_pattern;
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

test("v0.6 skill-parser surfaces collab_pattern as a typed field — validator still green + not in extra", () => {
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
    // v0.6 — typed field is set, `extra` should NOT carry it.
    assert.ok(
      spec.collab_pattern !== undefined,
      `${team}/${agent}: collab_pattern should be typed-parsed`
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(spec.extra, "collab_pattern"),
      `${team}/${agent}: collab_pattern should NOT remain in spec.extra after v0.6 promotion`
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
