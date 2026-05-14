import { test } from "node:test";
import assert from "node:assert/strict";

import { detectKeywordConflicts } from "../scripts/skill-pr-review/keyword-conflict.js";

/**
 * v0.6 S6.B §11 — keyword conflict detection unit tests.
 *
 * Covers exact, substring, and same-PR-vs-same-PR scenarios. The router
 * uses *case-insensitive substring* matching (agent-router.ts L175), so any
 * containment in either direction is a routing ambiguity.
 */

test("clean case — disjoint keywords produce zero conflicts", () => {
  const conflicts = detectKeywordConflicts(
    [{ name: "alpha", keywords: ["pricing", "discount"] }],
    [{ name: "bravo", keywords: ["latency", "cache"] }],
  );
  assert.equal(conflicts.length, 0);
});

test("exact-match collision against an existing SKILL is an error", () => {
  const conflicts = detectKeywordConflicts(
    [{ name: "new-marketer", keywords: ["paid"] }],
    [{ name: "paid-marketer", keywords: ["paid", "ads"] }],
  );
  const exact = conflicts.find(
    (c) => c.severity === "error" && c.conflictsWith === "paid-marketer",
  );
  assert.ok(exact, "exact-match error emitted");
  assert.match(exact.reason, /exact keyword collision/i);
});

test("substring overlap is a warning (not an error)", () => {
  const conflicts = detectKeywordConflicts(
    [{ name: "deploy-bot", keywords: ["deploy"] }],
    [{ name: "release-bot", keywords: ["redeploy"] }],
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, "warning");
  assert.match(conflicts[0].reason, /substring overlap/i);
});

test("case-insensitive matching catches PRicing vs pricing", () => {
  const conflicts = detectKeywordConflicts(
    [{ name: "new", keywords: ["PRicing"] }],
    [{ name: "old", keywords: ["pricing"] }],
  );
  // Normalized exact match → error.
  const e = conflicts.find((c) => c.severity === "error");
  assert.ok(e);
});

test("two SKILLs in the same PR introducing the same keyword → error", () => {
  const conflicts = detectKeywordConflicts(
    [
      { name: "a", keywords: ["growth"] },
      { name: "b", keywords: ["growth"] },
    ],
    [],
  );
  const e = conflicts.find((c) => c.severity === "error");
  assert.ok(e, "intra-PR exact collision flagged");
});

test("same SKILL re-declaring its own keyword is not a conflict", () => {
  // The "existing" set lists the same SKILL name, simulating the case
  // where the baseline (pre-PR) already contained keywords for this SKILL.
  // In practice the orchestrator excludes the changed SKILL from the
  // existing list, but the detector should also be robust to it.
  const conflicts = detectKeywordConflicts(
    [{ name: "same-skill", keywords: ["x"] }],
    [{ name: "same-skill", keywords: ["x"] }],
  );
  assert.equal(conflicts.length, 0);
});
