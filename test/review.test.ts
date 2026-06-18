import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewPrompt,
  parseReviewReply,
  reviewAsset,
  type ReviewCaller,
} from "../src/bot/review.js";

test("buildReviewPrompt: includes kind lens, id, body, and findings context", () => {
  const p = buildReviewPrompt({
    kind: "workflow",
    id: "wf-x",
    body: "stages: ...",
    findings: ["WF_X: something"],
  });
  assert.match(p, /SoloSquad workflow/);
  assert.match(p, /measurable/); // workflow lens
  assert.match(p, /wf-x/);
  assert.match(p, /WF_X: something/);
  assert.match(p, /ONLY a JSON object/);
});

test("buildReviewPrompt: omits findings section when none", () => {
  const p = buildReviewPrompt({ kind: "skill", id: "s", body: "x" });
  assert.equal(/Static findings/.test(p), false);
});

test("parseReviewReply: extracts JSON, normalizes bad severity, drops empty messages", () => {
  const r = parseReviewReply(
    'sure: {"summary":"ok","suggestions":[{"severity":"blocker","message":"fix X"},{"severity":"weird","message":"y"},{"severity":"nit","message":""}]} done',
  );
  assert.equal(r?.summary, "ok");
  assert.equal(r?.suggestions.length, 2); // empty-message one dropped
  assert.equal(r?.suggestions[0].severity, "blocker");
  assert.equal(r?.suggestions[1].severity, "improvement"); // "weird" normalized
});

test("parseReviewReply: garbage → null", () => {
  assert.equal(parseReviewReply("no json"), null);
  assert.equal(parseReviewReply("{not valid}"), null);
});

test("reviewAsset: routes through the injected caller (no live LLM)", async () => {
  const caller: ReviewCaller = {
    call_count: 0,
    async review(input) {
      caller.call_count!++;
      return { summary: `reviewed ${input.kind}/${input.id}`, suggestions: [] };
    },
  };
  const r = await reviewAsset({ kind: "agent", id: "product/x", body: "..." }, caller);
  assert.equal(caller.call_count, 1);
  assert.equal(r?.summary, "reviewed agent/product/x");
});

// CLI dispatch — agent review resolves a bundled actor and feeds the caller.
import { reviewCommand } from "../src/cli/review.js";

test("reviewCommand(agent): loads a bundled actor body and prints suggestions", async () => {
  const caller: ReviewCaller & { lastBodyLen: number } = {
    call_count: 0,
    lastBodyLen: 0,
    async review(input) {
      caller.call_count!++;
      caller.lastBodyLen = input.body.length;
      return { summary: "s", suggestions: [{ severity: "improvement", message: "tighten the role" }] };
    },
  };
  const lines: string[] = [];
  const origLog = console.log;
  const prevExit = process.exitCode;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await reviewCommand("agent", "product/pmf-planner", { caller });
    assert.equal(caller.call_count, 1);
    assert.ok(caller.lastBodyLen > 0, "actor SKILL.md body was loaded");
    assert.match(lines.join("\n"), /tighten the role/);
  } finally {
    console.log = origLog;
    process.exitCode = prevExit;
  }
});

test("reviewCommand: unknown id → exit 1, caller not invoked", async () => {
  const caller: ReviewCaller = { call_count: 0, async review() { caller.call_count!++; return null; } };
  const origErr = console.error;
  const prevExit = process.exitCode;
  console.error = () => {};
  try {
    process.exitCode = 0;
    await reviewCommand("agent", "no-such-actor", { caller });
    assert.equal(process.exitCode, 1);
    assert.equal(caller.call_count, 0);
  } finally {
    console.error = origErr;
    process.exitCode = prevExit;
  }
});
