import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSkillMd,
  validateSkill,
  RESERVED_SLASHES,
} from "../src/bot/skill-parser.js";

/**
 * v0.5 §11.5 — exhaustive slash-conflict regression.
 *
 * Plan §7 reserves the PM-mode slashes (/think /plan /build /review /ship)
 * + /help from the bot's slash-command pre-processor. A user-authored SKILL
 * may NOT register triggers.slash that exactly matches OR has any prefix
 * relationship with these — both directions, conservatively. Rationale is
 * typo-tolerance: when the user mistypes, dispatch ambiguity is worse than
 * a friendly "name is reserved" at author time.
 */

const PM_SLASHES = ["/think", "/plan", "/build", "/review", "/ship", "/help"];

function makeSkillWithSlash(slash: string): string {
  return [
    "---",
    `name: "x"`,
    `description: "y"`,
    `triggers:`,
    `  slash: ["${slash}"]`,
    "---",
    "",
    "# x",
    "",
  ].join("\n");
}

// ---------- Exact collisions ----------

for (const r of PM_SLASHES) {
  test(`exact collision rejected: ${r}`, () => {
    const spec = parseSkillMd(makeSkillWithSlash(r));
    const result = validateSkill(spec);
    assert.equal(result.ok, false, `expected ${r} to be rejected`);
    assert.ok(
      result.errors.find((e) => e.code === "SLASH_RESERVED"),
      `expected SLASH_RESERVED error for ${r}`,
    );
  });
}

// ---------- Prefix collisions: candidate starts with reserved ----------

const prefixCases: Array<[string, string]> = [
  ["/thinker", "/think"],
  ["/think-tank", "/think"],
  ["/planner", "/plan"],
  ["/plan-x", "/plan"],
  ["/builder", "/build"],
  ["/reviewer", "/review"],
  ["/shipit", "/ship"],
  ["/helper", "/help"],
];

for (const [candidate, reserved] of prefixCases) {
  test(`prefix collision rejected: ${candidate} starts with ${reserved}`, () => {
    const spec = parseSkillMd(makeSkillWithSlash(candidate));
    const result = validateSkill(spec);
    assert.equal(result.ok, false, `expected ${candidate} to be rejected`);
    assert.ok(
      result.errors.find((e) => e.code === "SLASH_PREFIX_CONFLICT"),
      `expected SLASH_PREFIX_CONFLICT for ${candidate}`,
    );
  });
}

// ---------- Reverse prefix: reserved starts with candidate ----------
// (Less common but the policy is symmetric — see skill-parser.ts validator.)

const reverseCases: Array<[string, string]> = [
  ["/thi", "/think"],
  ["/th", "/think"],
  ["/pla", "/plan"],
  ["/build_var", "/build"],
];

for (const [candidate, reserved] of reverseCases) {
  // /build_var is NOT a prefix of /build (build < build_var) so no reverse
  // conflict — assert correctly. Filter the cases.
  const candStartsWithReserved = candidate.startsWith(reserved);
  const reservedStartsWithCand = reserved.startsWith(candidate);
  test(`symmetric prefix: ${candidate} vs ${reserved} → ${candStartsWithReserved || reservedStartsWithCand ? "rejected" : "allowed"}`, () => {
    const spec = parseSkillMd(makeSkillWithSlash(candidate));
    const result = validateSkill(spec);
    if (candStartsWithReserved || reservedStartsWithCand) {
      assert.equal(result.ok, false);
    } else {
      // Reserved is reachable by this candidate's text but neither direction
      // is a prefix — should pass.
      assert.equal(result.ok, true, `${candidate} should NOT collide with ${reserved}`);
    }
  });
}

// ---------- Safe slashes (sanity — must remain allowed) ----------

const safeSlashes = [
  "/realestate-watch",
  "/weekly-digest",
  "/customer-onboard",
  "/triage",
  "/release-notes",
];

for (const s of safeSlashes) {
  test(`safe slash allowed: ${s}`, () => {
    const spec = parseSkillMd(makeSkillWithSlash(s));
    assert.equal(validateSkill(spec).ok, true, `${s} should be allowed`);
  });
}

// ---------- Multiple slashes in one SKILL — first match wins, all are checked ----------

test("multiple slashes — one bad among many trips validation", () => {
  const raw = [
    "---",
    `name: "x"`,
    `description: "y"`,
    `triggers:`,
    `  slash: ["/safe-one", "/think", "/safe-two"]`,
    "---",
    "",
    "# x",
    "",
  ].join("\n");
  const spec = parseSkillMd(raw);
  const result = validateSkill(spec);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length >= 1, true);
});

// ---------- Reserved-set sanity ----------

test("RESERVED_SLASHES has exactly the documented 6 entries", () => {
  assert.equal(RESERVED_SLASHES.size, PM_SLASHES.length);
  for (const r of PM_SLASHES) assert.ok(RESERVED_SLASHES.has(r));
});

// ---------- Context override (test isolation, future PM slash extensions) ----------

test("custom reserved_slashes can extend the default set", () => {
  const spec = parseSkillMd(makeSkillWithSlash("/custom-reserved"));
  const result = validateSkill(spec, {
    reserved_slashes: new Set([...RESERVED_SLASHES, "/custom-reserved"]),
  });
  assert.equal(result.ok, false);
});
