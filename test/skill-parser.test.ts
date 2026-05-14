import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSkillMd,
  validateSkill,
  writeSkillMd,
  emitSkillMd,
  serializeFrontmatter,
  SkillParseError,
  RESERVED_SLASHES,
  FREQ_SKILL_CAP,
} from "../src/bot/skill-parser.js";

/**
 * v0.5 SKILL.md parser + validator unit tests.
 *
 * Coverage map:
 *   - Required fields (name, description)
 *   - Optional fields: triggers (slash/keyword/freq/explicit), inputs,
 *     outputs, handoff_to, scope, confidence, source, loop_mode, budget
 *   - stateful: true rejection (v0.5 §12)
 *   - Slash conflicts: exact + prefix (v0.5 §11.5) — see also slash-conflict.test.ts
 *     for full enumeration of the 5 PM slashes
 *   - Freq cap (v0.5 §13)
 *   - Round-trip byte preservation via raw_frontmatter
 *   - serializeFrontmatter for migrations
 *   - Forward compat — unknown fields land in `extra`
 */

function makeSkill(frontmatter: string, body = "\n# Title\n\nBody.\n"): string {
  return `---\n${frontmatter}\n---${body}`;
}

// ---------- Required fields ----------

test("parser rejects file with no frontmatter", () => {
  assert.throws(
    () => parseSkillMd("# No frontmatter here\n"),
    SkillParseError,
  );
});

test("parser rejects missing name", () => {
  assert.throws(
    () => parseSkillMd(makeSkill(`description: "x"`)),
    /name/i,
  );
});

test("parser rejects missing description", () => {
  assert.throws(
    () => parseSkillMd(makeSkill(`name: "x"`)),
    /description/i,
  );
});

test("parser accepts minimal Anthropic-compatible frontmatter", () => {
  const spec = parseSkillMd(makeSkill(`name: "Minimal"\ndescription: "Just the basics"`));
  assert.equal(spec.name, "Minimal");
  assert.equal(spec.description, "Just the basics");
  assert.equal(spec.triggers, undefined);
  assert.equal(spec.stateful, undefined);
  assert.deepEqual(spec.extra, {});
});

// ---------- Triggers ----------

test("parser reads all 4 trigger channels", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "Watcher"
description: "tracks signals"
triggers:
  slash: ["/realestate-watch"]
  keyword: ["등기부", "real estate"]
  freq:
    keywords: ["부동산", "signal"]
    window_turns: 8
    threshold: 4
    cooldown_turns: 6
  explicit: true
`.trim()),
  );
  assert.deepEqual(spec.triggers?.slash, ["/realestate-watch"]);
  assert.deepEqual(spec.triggers?.keyword, ["등기부", "real estate"]);
  assert.equal(spec.triggers?.freq?.window_turns, 8);
  assert.equal(spec.triggers?.freq?.threshold, 4);
  assert.equal(spec.triggers?.freq?.cooldown_turns, 6);
  assert.equal(spec.triggers?.explicit, true);
});

test("parser supplies sensible freq defaults", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "Loose"
description: "..."
triggers:
  freq:
    keywords: ["foo"]
`.trim()),
  );
  assert.equal(spec.triggers?.freq?.window_turns, 10);
  assert.equal(spec.triggers?.freq?.threshold, 3);
  assert.equal(spec.triggers?.freq?.cooldown_turns, undefined);
});

test("parser drops freq with no keywords (malformed sub-field is tolerated, not fatal)", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "Loose"
description: "..."
triggers:
  freq:
    window_turns: 5
    threshold: 2
`.trim()),
  );
  assert.equal(spec.triggers?.freq, undefined);
});

// ---------- stateful + scope + confidence + loop_mode + budget ----------

test("parser captures stateful boolean", () => {
  const spec = parseSkillMd(makeSkill(`name: "x"\ndescription: "y"\nstateful: false`));
  assert.equal(spec.stateful, false);
});

test("parser captures loop_mode.spec-gate", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "Builder"
description: "spec-gated builder"
loop_mode:
  kind: spec-gate
  spec_path: "spec/feature.md"
  stop_when: "all tests pass"
`.trim()),
  );
  assert.equal(spec.loop_mode?.kind, "spec-gate");
  assert.equal(spec.loop_mode?.spec_path, "spec/feature.md");
  assert.equal(spec.loop_mode?.stop_when, "all tests pass");
});

test("parser captures budget", () => {
  const spec = parseSkillMd(
    makeSkill(`name: "x"\ndescription: "y"\nbudget:\n  per_call_usd: 1.5\n  daily_usd: 10`),
  );
  assert.equal(spec.budget?.per_call_usd, 1.5);
  assert.equal(spec.budget?.daily_usd, 10);
});

// ---------- Forward compat ----------

test("unknown frontmatter keys land in extra", () => {
  const spec = parseSkillMd(
    makeSkill(`name: "x"\ndescription: "y"\nmysterious_future_field: 42\nfoo: "bar"`),
  );
  assert.equal(spec.extra.mysterious_future_field, 42);
  assert.equal(spec.extra.foo, "bar");
});

// ---------- Validator: stateful=true rejection (v0.5 §12) ----------

test("validator rejects stateful: true", () => {
  const spec = parseSkillMd(makeSkill(`name: "x"\ndescription: "y"\nstateful: true`));
  const result = validateSkill(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((e) => e.code === "STATEFUL_NOT_ALLOWED"));
});

test("validator accepts stateful: false and omitted stateful", () => {
  assert.equal(validateSkill(parseSkillMd(makeSkill(`name: "x"\ndescription: "y"`))).ok, true);
  assert.equal(
    validateSkill(parseSkillMd(makeSkill(`name: "x"\ndescription: "y"\nstateful: false`))).ok,
    true,
  );
});

// ---------- Validator: slash conflicts (also covered by slash-conflict.test.ts) ----------

test("validator rejects exact PM slash collision", () => {
  const spec = parseSkillMd(
    makeSkill(`name: "x"\ndescription: "y"\ntriggers:\n  slash: ["/think"]`),
  );
  const result = validateSkill(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((e) => e.code === "SLASH_RESERVED"));
});

test("validator rejects slash prefix conflict", () => {
  const spec = parseSkillMd(
    makeSkill(`name: "x"\ndescription: "y"\ntriggers:\n  slash: ["/thinker"]`),
  );
  const result = validateSkill(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((e) => e.code === "SLASH_PREFIX_CONFLICT"));
});

test("validator rejects malformed slash (missing leading /)", () => {
  const spec = parseSkillMd(
    makeSkill(`name: "x"\ndescription: "y"\ntriggers:\n  slash: ["nosled"]`),
  );
  const result = validateSkill(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((e) => e.code === "SLASH_MALFORMED"));
});

test("validator allows unrelated slashes", () => {
  const spec = parseSkillMd(
    makeSkill(`name: "x"\ndescription: "y"\ntriggers:\n  slash: ["/realestate"]`),
  );
  assert.equal(validateSkill(spec).ok, true);
});

// ---------- Validator: freq cap + sanity ----------

test("validator rejects 21st freq SKILL", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "x"
description: "y"
triggers:
  freq:
    keywords: ["foo"]
    window_turns: 10
    threshold: 3
`.trim()),
  );
  const result = validateSkill(spec, { freq_skill_count: FREQ_SKILL_CAP });
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((e) => e.code === "FREQ_CAP_EXCEEDED"));
});

test("validator accepts 20th freq SKILL (under cap)", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "x"
description: "y"
triggers:
  freq:
    keywords: ["foo"]
    window_turns: 10
    threshold: 3
`.trim()),
  );
  assert.equal(validateSkill(spec, { freq_skill_count: FREQ_SKILL_CAP - 1 }).ok, true);
});

test("validator rejects freq window_turns < 1", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "x"
description: "y"
triggers:
  freq:
    keywords: ["foo"]
    window_turns: 0
    threshold: 3
`.trim()),
  );
  assert.equal(validateSkill(spec).ok, false);
});

// ---------- Validator: loop_mode + budget + confidence ----------

test("validator warns about spec-gate without stop_when", () => {
  const spec = parseSkillMd(
    makeSkill(`
name: "x"
description: "y"
loop_mode:
  kind: spec-gate
  spec_path: "spec/foo.md"
`.trim()),
  );
  const result = validateSkill(spec);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.find((w) => w.code === "LOOP_MODE_NO_STOP"));
});

test("validator rejects negative budget", () => {
  const spec = parseSkillMd(
    makeSkill(`name: "x"\ndescription: "y"\nbudget:\n  per_call_usd: -1`),
  );
  assert.equal(validateSkill(spec).ok, false);
});

test("validator rejects confidence > 1", () => {
  const spec = parseSkillMd(makeSkill(`name: "x"\ndescription: "y"\nconfidence: 1.5`));
  assert.equal(validateSkill(spec).ok, false);
});

// ---------- Round-trip (v0.5 §11.4) ----------

test("round-trip via writeSkillMd preserves bytes (LF input)", () => {
  const original =
    "---\n" +
    "name: Realestate Watcher\n" +
    "description: tracks 등기부 signals\n" +
    "triggers:\n" +
    "  keyword:\n" +
    '    - "등기부"\n' +
    "---\n" +
    "\n# Realestate Watcher\n\nBody content here.\n";
  const spec = parseSkillMd(original);
  assert.equal(writeSkillMd(spec), original);
});

test("round-trip normalizes CRLF to LF (intentional — cross-platform contract)", () => {
  // normalizeLine() always converts CRLF -> LF. Round-trip therefore lands
  // on LF regardless of input. This is the documented behavior in
  // src/util/platform.ts; cross-platform.md mandates it.
  const crlf =
    "---\r\nname: x\r\ndescription: y\r\n---\r\n\r\n# x\r\n";
  const lf = "---\nname: x\ndescription: y\n---\n\n# x\n";
  const spec = parseSkillMd(crlf);
  assert.equal(writeSkillMd(spec), lf);
});

// ---------- serializeFrontmatter (migrations) ----------

test("serializeFrontmatter emits required fields first", () => {
  const spec = parseSkillMd(makeSkill(`name: "x"\ndescription: "y"\nteam: "strategy"`));
  const yamlStr = serializeFrontmatter(spec);
  const nameIdx = yamlStr.indexOf("name:");
  const descIdx = yamlStr.indexOf("description:");
  const teamIdx = yamlStr.indexOf("team:");
  assert.ok(nameIdx >= 0 && descIdx > nameIdx && teamIdx > descIdx);
});

test("emitSkillMd produces parseable output", () => {
  const original = makeSkill(`name: "x"\ndescription: "y"\nteam: "strategy"\nstateful: false`);
  const spec = parseSkillMd(original);
  const reEmitted = emitSkillMd(spec);
  // Should re-parse cleanly and equal-by-value
  const reparsed = parseSkillMd(reEmitted);
  assert.equal(reparsed.name, spec.name);
  assert.equal(reparsed.description, spec.description);
  assert.equal(reparsed.team, spec.team);
  assert.equal(reparsed.stateful, spec.stateful);
});

// ---------- Constants are exported ----------

test("RESERVED_SLASHES contains the 5 PM slashes + /help", () => {
  for (const r of ["/think", "/plan", "/build", "/review", "/ship", "/help"]) {
    assert.ok(RESERVED_SLASHES.has(r), `${r} should be reserved`);
  }
});
