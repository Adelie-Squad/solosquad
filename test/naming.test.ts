import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KEBAB_RE,
  isKebabCase,
  isReserved,
  collides,
  normalizeToKebab,
  checkId,
  DEFAULT_NAME_MAX,
} from "../src/util/naming.js";

test("isKebabCase / KEBAB_RE", () => {
  for (const ok of ["a", "a1", "my-skill", "pmf-planner", "a-b-c"]) assert.equal(isKebabCase(ok), true, ok);
  for (const bad of ["", "A", "my_skill", "-x", "x-", "a--b", "x/y", "café"]) assert.equal(isKebabCase(bad), false, bad);
  assert.equal(KEBAB_RE.test("good-id"), true);
});

test("isReserved / collides", () => {
  const set = new Set(["chief", "pm"]);
  assert.equal(isReserved("chief", set), true);
  assert.equal(isReserved("other", set), false);
  assert.equal(isReserved("chief", undefined), false);
  assert.equal(collides("a", new Set(["a", "b"])), true);
  assert.equal(collides("c", new Set(["a", "b"])), false);
});

test("normalizeToKebab: slugify arbitrary text", () => {
  assert.equal(normalizeToKebab("My Cool Skill!"), "my-cool-skill");
  assert.equal(normalizeToKebab("  Trim --me-- "), "trim-me");
  assert.equal(normalizeToKebab("___"), "untitled"); // nothing usable
  assert.equal(normalizeToKebab("", DEFAULT_NAME_MAX, "fallback"), "fallback");
  // clamp without trailing hyphen
  const long = normalizeToKebab("a".repeat(70) + " b", 64);
  assert.ok(long.length <= 64);
  assert.equal(/-$/.test(long), false);
});

test("checkId: ordered problem list", () => {
  assert.deepEqual(checkId(undefined), ["empty"]);
  assert.deepEqual(checkId(""), ["empty"]);
  assert.deepEqual(checkId("good-id"), []);
  assert.deepEqual(checkId("Bad_Id"), ["malformed"]);
  assert.deepEqual(checkId("a".repeat(65)), ["too_long"]); // valid kebab but long
  assert.deepEqual(checkId("chief", { reserved: new Set(["chief"]) }), ["reserved"]);
  // a long, reserved, non-kebab id reports all three
  const id = "Bad_" + "x".repeat(70);
  assert.deepEqual(checkId(id, { reserved: new Set([id]) }), ["malformed", "too_long", "reserved"]);
});
