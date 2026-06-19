import { test } from "node:test";
import assert from "node:assert/strict";

import { parseKindMarker, type ChiefKind } from "../src/bot/chief-runner.js";

test("parseKindMarker — extracts the marker and strips it from the reply", () => {
  const r = parseKindMarker("[kind:workflow]\nLet's start with discovery-cycle.\n");
  assert.equal(r.kind, "workflow");
  assert.equal(r.text, "Let's start with discovery-cycle.\n");
});

test("parseKindMarker — accepts each documented kind", () => {
  const kinds: ChiefKind[] = ["chat", "workflow", "cron", "goal"];
  for (const k of kinds) {
    const r = parseKindMarker(`[kind:${k}]\nbody`);
    assert.equal(r.kind, k);
  }
});

test("parseKindMarker — case-insensitive (Chief might emit [Kind:Workflow])", () => {
  const r = parseKindMarker("[Kind:Workflow]\nbody");
  assert.equal(r.kind, "workflow");
});

test("parseKindMarker — tolerates leading whitespace", () => {
  const r = parseKindMarker("   [kind:goal]\nplan it");
  assert.equal(r.kind, "goal");
  assert.equal(r.text, "plan it");
});

test("parseKindMarker — no marker → returns kind=null + unchanged text", () => {
  const r = parseKindMarker("Just a regular reply.");
  assert.equal(r.kind, null);
  assert.equal(r.text, "Just a regular reply.");
});

test("parseKindMarker — marker only matches at the start (mid-reply ignored)", () => {
  const r = parseKindMarker("hello\n[kind:workflow] no thanks");
  assert.equal(r.kind, null);
  assert.equal(r.text, "hello\n[kind:workflow] no thanks");
});

test("parseKindMarker — invalid kind name → returns null", () => {
  const r = parseKindMarker("[kind:bogus]\nbody");
  assert.equal(r.kind, null);
  assert.equal(r.text, "[kind:bogus]\nbody");
});

test("parseKindMarker — preserves multi-line body intact", () => {
  const r = parseKindMarker("[kind:workflow]\nfirst line\nsecond line\n\nthird");
  assert.equal(r.kind, "workflow");
  assert.equal(r.text, "first line\nsecond line\n\nthird");
});
