import { test } from "node:test";
import assert from "node:assert/strict";

import { Findings, runRules, type BaseFinding } from "../src/util/validation.js";

test("Findings: accumulates and reports ok=false when any error", () => {
  const f = new Findings();
  f.warn({ code: "W1", message: "a warning" });
  assert.equal(f.result().ok, true); // warnings don't fail
  f.error({ code: "E1", message: "an error" });
  const r = f.result();
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.warnings.length, 1);
});

test("Findings.errorIf/warnIf return the condition and only push when true", () => {
  const f = new Findings();
  assert.equal(f.errorIf(false, { code: "X", message: "x" }), false);
  assert.equal(f.errorIf(true, { code: "Y", message: "y" }), true);
  assert.equal(f.warnIf(true, { code: "Z", message: "z" }), true);
  assert.deepEqual(f.errors.map((e) => e.code), ["Y"]);
  assert.deepEqual(f.warnings.map((w) => w.code), ["Z"]);
});

test("Findings.merge folds a sub-result", () => {
  const parent = new Findings();
  const child = new Findings();
  child.error({ code: "C", message: "child error" });
  parent.merge(child.result());
  assert.equal(parent.result().ok, false);
  assert.equal(parent.result().errors[0].code, "C");
});

test("runRules: applies every rule, supports single/array/null returns", () => {
  interface F extends BaseFinding {}
  const r = runRules<{ n: number }, F>({ n: 5 }, [
    (s) => (s.n > 3 ? { severity: "error", finding: { code: "TOO_BIG", message: "n>3" } } : null),
    (s) => (s.n % 2 === 1 ? { severity: "warning", finding: { code: "ODD", message: "odd" } } : undefined),
    () => null,
    (s) => [
      { severity: "warning", finding: { code: "A", message: "a" } },
      { severity: "error", finding: { code: "B", message: "b" } },
    ],
  ]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.code).sort(), ["B", "TOO_BIG"]);
  assert.deepEqual(r.warnings.map((w) => w.code).sort(), ["A", "ODD"]);
});
