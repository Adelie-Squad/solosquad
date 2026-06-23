import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSkillMd, validateSkill } from "../src/bot/skill-parser.js";

/**
 * v1.3.6 §3.2 — authoring-standard validator rules:
 * reserved words, vague phrasing, missing trigger clause, body length.
 */

function mk(opts: { name?: string; description?: string; body?: string }): string {
  const name = opts.name ?? "demo-skill";
  const desc = opts.description ?? "Generates demo output. Use this when you need a demo.";
  const body = opts.body ?? "# Demo\nProcedural guidance here.\n";
  return `---\nname: ${name}\ndescription: ${desc}\nschema_version: 1\n---\n${body}`;
}

const codes = (rs: { code: string }[]) => rs.map((r) => r.code);

test("NAME_RESERVED_WORD: names containing anthropic/claude are rejected (strict)", () => {
  const spec = parseSkillMd(mk({ name: "claude-helper" }));
  const r = validateSkill(spec, { strict_name: true });
  assert.ok(codes(r.errors).includes("NAME_RESERVED_WORD"));
  assert.equal(r.ok, false);
});

test("NAME_RESERVED_WORD: not enforced without strict_name (adopted corpus)", () => {
  const spec = parseSkillMd(mk({ name: "claude-helper" }));
  const r = validateSkill(spec, { strict_name: false });
  assert.ok(!codes(r.errors).includes("NAME_RESERVED_WORD"));
});

test("DESCRIPTION_VAGUE: 'helps with' warns", () => {
  const spec = parseSkillMd(mk({ description: "Helps with various things. Use when stuck." }));
  const r = validateSkill(spec);
  assert.ok(codes(r.warnings).includes("DESCRIPTION_VAGUE"));
  assert.equal(r.ok, true); // advisory only
});

test("DESCRIPTION_NO_TRIGGER: warns when no 'use when' clause", () => {
  const spec = parseSkillMd(mk({ description: "Generates a quarterly revenue report from raw ledgers." }));
  const r = validateSkill(spec);
  assert.ok(codes(r.warnings).includes("DESCRIPTION_NO_TRIGGER"));
});

test("DESCRIPTION_NO_TRIGGER: cleared by a Korean '사용 시점' clause", () => {
  const spec = parseSkillMd(
    mk({ description: "분기 매출 리포트를 생성한다. 사용 시점 — 월말 마감 때." }),
  );
  const r = validateSkill(spec);
  assert.ok(!codes(r.warnings).includes("DESCRIPTION_NO_TRIGGER"));
});

test("BODY_TOO_LONG: body over 500 lines warns", () => {
  const longBody = "# Big\n" + Array.from({ length: 520 }, (_, i) => `line ${i}`).join("\n");
  const spec = parseSkillMd(mk({ body: longBody }));
  const r = validateSkill(spec);
  assert.ok(codes(r.warnings).includes("BODY_TOO_LONG"));
});

test("clean skill: no new advisory warnings", () => {
  const spec = parseSkillMd(
    mk({ description: "Generates a release changelog from merged PRs. Use this when cutting a release." }),
  );
  const r = validateSkill(spec, { strict_name: true, dir_name: "demo-skill" });
  const noisy = ["DESCRIPTION_VAGUE", "DESCRIPTION_NO_TRIGGER", "BODY_TOO_LONG", "NAME_RESERVED_WORD"];
  assert.equal(codes(r.warnings).filter((c) => noisy.includes(c)).length, 0);
  assert.ok(!codes(r.errors).includes("NAME_RESERVED_WORD"));
});
