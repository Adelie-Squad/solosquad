import { test } from "node:test";
import assert from "node:assert/strict";

import {
  neutralize,
  shingles,
  checkOriginality,
} from "../src/analyze/originality.js";

/**
 * v1.3.6 §3.2 — originality gate (anti-reskin) unit tests.
 */

test("neutralize: lowercases, drops own name tokens, strips markdown", () => {
  const out = neutralize("**Skill-Manager** does `the thing`.", "skill-manager");
  // "skill" and "manager" (name tokens) are removed; markdown stripped.
  assert.ok(!out.includes("skill"));
  assert.ok(!out.includes("manager"));
  assert.ok(out.includes("does"));
  assert.ok(out.includes("the thing"));
  assert.ok(!out.includes("`"));
});

test("shingles: 8-word windows; short text becomes one shingle", () => {
  const long = shingles("a b c d e f g h i", 8);
  assert.equal(long.size, 2); // windows [a..h], [b..i]
  const short = shingles("a b c", 8);
  assert.equal(short.size, 1);
  assert.ok(short.has("a b c"));
});

test("checkOriginality: near-identical re-skin trips FAIL", () => {
  const body =
    "this agent reviews the deployment pipeline and reports regressions to the team lead every morning without fail";
  const findings = checkOriginality([
    { id: "alpha", text: body },
    { id: "beta", text: body }, // identical prose, different id == re-skin
  ]);
  assert.ok(findings.length >= 1);
  const alpha = findings.find((f) => f.id === "alpha");
  assert.ok(alpha);
  assert.equal(alpha!.level, "fail");
  assert.equal(alpha!.against, "beta");
  assert.ok(alpha!.overlap >= 0.4);
});

test("checkOriginality: distinct prose produces no finding", () => {
  const findings = checkOriginality([
    {
      id: "researcher",
      text: "interviews users, synthesizes journey maps, and surfaces unmet needs from qualitative signal",
    },
    {
      id: "infra",
      text: "provisions cloud resources, tunes autoscaling policy, and keeps the deployment topology healthy",
    },
  ]);
  assert.equal(findings.length, 0);
});

test("checkOriginality: overlap between thresholds is graded WARN not FAIL", () => {
  const body =
    "this agent reviews the deployment pipeline and reports regressions to the team lead every morning without fail";
  // Identical prose → overlap 1.0. With fail above and warn below, 1.0 lands in the warn band.
  const findings = checkOriginality(
    [
      { id: "a", text: body },
      { id: "b", text: body },
    ],
    { failThreshold: 1.5, warnThreshold: 0.5 },
  );
  const a = findings.find((f) => f.id === "a");
  assert.ok(a, "expected a finding");
  assert.equal(a!.level, "warn");
});
