import { test } from "node:test";
import assert from "node:assert/strict";

import { diffFrontmatter } from "../scripts/skill-pr-review/frontmatter-diff.js";

/**
 * v0.6 S6.B §11 — frontmatter diff extraction unit tests.
 *
 * Coverage: added / removed / modified field detection across the v0.5
 * SkillSpec surface, plus parse-error surfacing and extra-key (unknown
 * forward-compat field) handling.
 */

function withFm(frontmatter: string, body = "\n# T\n"): string {
  return `---\n${frontmatter}\n---${body}`;
}

test("diff detects added field", () => {
  const before = withFm(`name: "x"\ndescription: "d"`);
  const after = withFm(`name: "x"\ndescription: "d"\nscope: agent`);
  const d = diffFrontmatter(before, after, "a/SKILL.md");
  assert.equal(d.added, false);
  assert.equal(d.removed, false);
  const change = d.changes.find((c) => c.field === "scope");
  assert.ok(change, "scope change present");
  assert.equal(change.kind, "added");
  assert.equal(change.after, "agent");
});

test("diff detects removed field", () => {
  const before = withFm(`name: "x"\ndescription: "d"\nteam: strategy`);
  const after = withFm(`name: "x"\ndescription: "d"`);
  const d = diffFrontmatter(before, after, "a/SKILL.md");
  const change = d.changes.find((c) => c.field === "team");
  assert.ok(change);
  assert.equal(change.kind, "removed");
  assert.equal(change.before, "strategy");
});

test("diff detects modified field — triggers.keyword list edit", () => {
  const before = withFm(
    `name: "x"\ndescription: "d"\ntriggers:\n  keyword: ["deploy"]`,
  );
  const after = withFm(
    `name: "x"\ndescription: "d"\ntriggers:\n  keyword: ["deploy", "release"]`,
  );
  const d = diffFrontmatter(before, after, "a/SKILL.md");
  const change = d.changes.find((c) => c.field === "triggers");
  assert.ok(change);
  assert.equal(change.kind, "modified");
});

test("diff treats new file as pure-add and skips field table", () => {
  const after = withFm(`name: "new-skill"\ndescription: "hello"`);
  const d = diffFrontmatter(undefined, after, "new/SKILL.md");
  assert.equal(d.added, true);
  assert.equal(d.removed, false);
  assert.equal(d.changes.length, 0);
  assert.ok(d.afterRaw && d.afterRaw.includes("new-skill"));
});

test("diff treats removed file as pure-remove", () => {
  const before = withFm(`name: "old"\ndescription: "going away"`);
  const d = diffFrontmatter(before, undefined, "old/SKILL.md");
  assert.equal(d.added, false);
  assert.equal(d.removed, true);
  assert.ok(d.beforeRaw && d.beforeRaw.includes("old"));
});

test("diff surfaces parse error on malformed after, no changes emitted", () => {
  const before = withFm(`name: "x"\ndescription: "d"`);
  const after = "no frontmatter at all";
  const d = diffFrontmatter(before, after, "a/SKILL.md");
  assert.ok(d.parseErrors.length > 0, "parse error reported");
  // No field rows when one side fails to parse.
  assert.equal(d.changes.length, 0);
});

test("diff picks up unknown (extra) frontmatter keys", () => {
  // Use a truly forward-compat field name (not one promoted in v0.6).
  const before = withFm(`name: "x"\ndescription: "d"`);
  const after = withFm(`name: "x"\ndescription: "d"\nmysterious_v07_field: hello`);
  const d = diffFrontmatter(before, after, "a/SKILL.md");
  const change = d.changes.find((c) => c.field === "mysterious_v07_field");
  assert.ok(change);
  assert.equal(change.kind, "added");
  assert.equal(change.after, "hello");
});

test("diff picks up promoted v0.6 collab_pattern field", () => {
  const before = withFm(`name: "x"\ndescription: "d"`);
  const after = withFm(`name: "x"\ndescription: "d"\ncollab_pattern: graph`);
  const d = diffFrontmatter(before, after, "a/SKILL.md");
  const change = d.changes.find((c) => c.field === "collab_pattern");
  assert.ok(change, "collab_pattern is a typed v0.6 field and must surface in the diff");
  assert.equal(change.kind, "added");
  assert.equal(change.after, "graph");
});
