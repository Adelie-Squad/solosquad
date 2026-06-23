import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSkillMd,
  validateSkill,
  emitSkillMd,
} from "../src/bot/skill-parser.js";

/**
 * v1.3.6 §3.4 — pm_conventions + category are now parsed & validator-enforced
 * (load-bearing), not dropped into `extra`.
 */

const SKILL = `---
name: demo-skill
description: Generates a demo report. Use this when you need a demo.
schema_version: 1
category: planning
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 2
---
# Demo
Body.
`;

test("pm_conventions + category are parsed (not in extra)", () => {
  const spec = parseSkillMd(SKILL);
  assert.equal(spec.category, "planning");
  assert.deepEqual(spec.pm_conventions, {
    anti_sycophancy: true,
    hard_gate: false,
    post_labeling: true,
    minimum_approaches: 2,
  });
  assert.ok(!("pm_conventions" in spec.extra));
  assert.ok(!("category" in spec.extra));
});

test("minimum_approaches < 1 is an error", () => {
  const spec = parseSkillMd(SKILL.replace("minimum_approaches: 2", "minimum_approaches: 0"));
  const r = validateSkill(spec);
  assert.ok(r.errors.some((e) => e.code === "MIN_APPROACHES_INVALID"));
  assert.equal(r.ok, false);
});

test("minimum_approaches: 2 validates", () => {
  const r = validateSkill(parseSkillMd(SKILL));
  assert.ok(!r.errors.some((e) => e.code === "MIN_APPROACHES_INVALID"));
});

test("non-kebab category warns (format lint, not enum)", () => {
  const spec = parseSkillMd(SKILL.replace("category: planning", "category: Problem_Definition"));
  const r = validateSkill(spec);
  assert.ok(r.warnings.some((w) => w.code === "CATEGORY_MALFORMED"));
  assert.equal(r.ok, true); // warn only
});

test("re-emit preserves pm_conventions + category", () => {
  const spec = parseSkillMd(SKILL);
  const out = emitSkillMd(spec);
  const reparsed = parseSkillMd(out);
  assert.equal(reparsed.category, "planning");
  assert.equal(reparsed.pm_conventions?.minimum_approaches, 2);
  assert.equal(reparsed.pm_conventions?.post_labeling, true);
});
