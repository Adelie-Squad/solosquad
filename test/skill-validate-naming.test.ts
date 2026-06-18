import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSkillMd, validateSkill } from "../src/bot/skill-parser.js";

const md = (name: string, description: string): string =>
  `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\nschema_version: 1\n---\n# x\nbody\n`;

const codes = (fs: { code: string }[]): string[] => fs.map((f) => f.code);

test("strict_name rejects non-kebab name; lenient allows it", () => {
  const spec = parseSkillMd(md("Bad Name", "does a thing"));
  assert.ok(codes(validateSkill(spec, { strict_name: true }).errors).includes("NAME_MALFORMED"));
  // external/adopted skills (no strict_name) are NOT rejected for style
  assert.ok(!codes(validateSkill(spec).errors).includes("NAME_MALFORMED"));
});

test("dir-match fires whenever dir_name is supplied", () => {
  const spec = parseSkillMd(md("foo", "does a thing"));
  assert.ok(codes(validateSkill(spec, { dir_name: "bar" }).errors).includes("NAME_DIR_MISMATCH"));
  assert.ok(!codes(validateSkill(spec, { dir_name: "foo" }).errors).includes("NAME_DIR_MISMATCH"));
});

test("name over 64 chars is an error under strict_name", () => {
  const spec = parseSkillMd(md("a".repeat(65), "does a thing"));
  assert.ok(codes(validateSkill(spec, { strict_name: true }).errors).includes("NAME_TOO_LONG"));
});

test("description over 1024 chars is an error (universal)", () => {
  const spec = parseSkillMd(md("foo", "x".repeat(1025)));
  assert.ok(codes(validateSkill(spec).errors).includes("DESCRIPTION_TOO_LONG"));
});

test("first-person description warns", () => {
  const spec = parseSkillMd(md("foo", "I will help you write tests"));
  assert.ok(codes(validateSkill(spec).warnings).includes("DESCRIPTION_FIRST_PERSON"));
});

test("reserved name rejected under strict_name", () => {
  const spec = parseSkillMd(md("review", "does a thing"));
  const r = validateSkill(spec, { strict_name: true, reserved_names: new Set(["review"]) });
  assert.ok(codes(r.errors).includes("NAME_RESERVED"));
});
