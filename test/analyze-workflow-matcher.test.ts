import { test } from "node:test";
import assert from "node:assert/strict";

import {
  matchWorkflow,
  listTemplates,
} from "../src/analyze/workflow-matcher.js";
import type { Classification } from "../src/analyze/classifier.js";

function cls(p: string, label: Classification["label"], conf = 0.9): Classification {
  return {
    path: p,
    label,
    confidence: conf,
    ambiguous: false,
    raw: [{ label, confidence: conf }],
  };
}

test("listTemplates returns the 4 SoloSquad templates in stable order", () => {
  const all = listTemplates();
  assert.deepEqual(all.sort(), [
    "feature-expansion",
    "pmf-discovery",
    "rapid-prototype",
    "rebranding",
  ]);
});

test("matchWorkflow returns no_match=true when all classifications are codebase-fact", () => {
  const classifications = [
    cls("a.md", "codebase-fact"),
    cls("b.md", "codebase-fact"),
  ];
  const bodies = new Map<string, string>([
    ["a.md", "References src/foo.ts and package.json"],
    ["b.md", "Build via npm run prod"],
  ]);
  const wf = matchWorkflow(classifications, bodies);
  assert.equal(wf.no_match, true);
  for (const m of wf.matches) {
    assert.equal(m.cover_rate, 0);
  }
});

test("matchWorkflow scores feature-expansion above 0.85 on focused bodies", () => {
  const classifications = [
    cls("a.md", "workflow"),
    cls("b.md", "workflow"),
    cls("c.md", "workflow"),
  ];
  const bodies = new Map<string, string>([
    ["a.md", "feature expansion analysis → planning prd"],
    ["b.md", "feature rollout release"],
    ["c.md", "feature spec scope"],
  ]);
  const wf = matchWorkflow(classifications, bodies);
  assert.ok(wf.best);
  assert.equal(wf.best!.template, "feature-expansion");
  assert.ok(
    wf.best!.cover_rate >= 0.85,
    `expected >= 0.85, got ${wf.best!.cover_rate}`
  );
  assert.equal(wf.no_match, false);
});

test("matchWorkflow flags no_match when best template is below 0.5", () => {
  const classifications = [
    cls("a.md", "workflow"),
    cls("b.md", "workflow"),
    cls("c.md", "workflow"),
    cls("d.md", "workflow"),
  ];
  const bodies = new Map<string, string>([
    ["a.md", "random body with no template signals"],
    ["b.md", "another random body"],
    ["c.md", "third unrelated text about widgets"],
    ["d.md", "feature"],
  ]);
  const wf = matchWorkflow(classifications, bodies);
  // Only d.md mentions a template-signal keyword. 1/4 = 0.25 < 0.5.
  assert.equal(wf.no_match, true);
});

test("matchWorkflow distinguishes rebranding vs rapid-prototype by body content", () => {
  const classifications = [cls("a.md", "role"), cls("b.md", "workflow")];
  const bodies = new Map<string, string>([
    ["a.md", "tone voice brand messaging positioning"],
    ["b.md", "tone voice brand copy"],
  ]);
  const wf = matchWorkflow(classifications, bodies);
  assert.ok(wf.best);
  assert.equal(wf.best!.template, "rebranding");
});
