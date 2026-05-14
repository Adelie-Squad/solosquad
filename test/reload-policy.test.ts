import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyReloadPolicy,
  triggerCount,
  summarizeChanges,
} from "../src/bot/reload-policy.js";
import type { RouteIndex } from "../src/bot/agent-router.js";

/**
 * v0.6 §10.5 — reload-policy tests.
 *
 * The policy is pure aside from `rebuildRoutes()` + `defaultGitProbe()`; we
 * inject `rebuild` and `gitProbe` to keep these tests hermetic.
 */

function makeIdx(slash = 1, keyword = 2, explicit = 1, freq = 0): RouteIndex {
  const idx: RouteIndex = { slash: {}, keyword: {}, freq: [], explicit: {} };
  for (let i = 0; i < slash; i++) {
    idx.slash[`/s${i}`] = makeRef(`agent${i}`);
  }
  for (let i = 0; i < keyword; i++) {
    idx.keyword[`kw${i}`] = makeRef(`agent${i}`);
  }
  for (let i = 0; i < explicit; i++) {
    idx.explicit[`agent${i}`] = makeRef(`agent${i}`);
  }
  for (let i = 0; i < freq; i++) {
    idx.freq.push({
      ref: makeRef(`agent${i}`),
      keywords: ["x"],
      window_turns: 5,
      threshold: 2,
      cooldown_turns: 4,
    });
  }
  return idx;
}

function makeRef(name: string) {
  return {
    team: "strategy",
    name,
    source_path: `/tmp/${name}/SKILL.md`,
    tier: "workspace" as const,
    stateful: false,
  };
}

// ---------- auto mode ----------

test("auto mode reloads immediately and reports trigger count", async () => {
  const decision = await applyReloadPolicy({
    mode: "auto",
    changes: ["/tmp/a/SKILL.md"],
    rebuild: () => makeIdx(2, 3, 1, 1),
  });
  assert.equal(decision.outcome, "auto");
  assert.equal(decision.reloaded, true);
  assert.equal(decision.triggerCount, 7);
  assert.match(decision.notice, /🔄 SKILL routes reloaded — 7 triggers/);
});

// ---------- prompt mode — yes ----------

test("prompt mode reloads when onConfirm resolves true", async () => {
  let asked = "";
  const decision = await applyReloadPolicy({
    mode: "prompt",
    changes: ["/a/SKILL.md", "/b/SKILL.md"],
    onConfirm: async (p) => {
      asked = p;
      return true;
    },
    rebuild: () => makeIdx(1, 1, 1, 0),
  });
  assert.equal(decision.outcome, "prompt");
  assert.equal(decision.reloaded, true);
  assert.match(asked, /🔄 2개 SKILL 변경 감지 — 적용\? \[y\/N\]/);
  assert.match(decision.notice, /SKILL routes reloaded/);
});

// ---------- prompt mode — no/timeout ----------

test("prompt mode skips when onConfirm resolves false", async () => {
  const decision = await applyReloadPolicy({
    mode: "prompt",
    changes: ["/a/SKILL.md"],
    onConfirm: async () => false,
    rebuild: () => makeIdx(1, 1, 1, 0),
  });
  assert.equal(decision.reloaded, false);
  assert.match(decision.notice, /skipped/i);
});

test("prompt mode without onConfirm returns deferred decision (no rebuild)", async () => {
  let rebuildCalled = false;
  const decision = await applyReloadPolicy({
    mode: "prompt",
    changes: ["/a/SKILL.md"],
    rebuild: () => {
      rebuildCalled = true;
      return makeIdx();
    },
  });
  assert.equal(decision.outcome, "prompt");
  assert.equal(decision.reloaded, false);
  assert.equal(rebuildCalled, false);
  assert.ok(decision.prompt && decision.prompt.length > 0);
});

// ---------- manual mode ----------

test("manual mode never reloads and emits a manual-action hint", async () => {
  let rebuildCalled = false;
  const decision = await applyReloadPolicy({
    mode: "manual",
    changes: ["/a/SKILL.md", "/b/SKILL.md"],
    rebuild: () => {
      rebuildCalled = true;
      return makeIdx();
    },
  });
  assert.equal(decision.outcome, "manual");
  assert.equal(decision.reloaded, false);
  assert.equal(rebuildCalled, false);
  assert.match(decision.notice, /solosquad agent reload/);
  assert.match(decision.notice, /2개/);
});

// ---------- gitOnly: probe returns false → skip ----------

test("gitOnly: when probe returns false, no reload regardless of mode", async () => {
  let rebuildCalled = false;
  const decision = await applyReloadPolicy({
    mode: "auto",
    changes: ["/a/SKILL.md"],
    gitOnly: true,
    gitProbe: () => false,
    rebuild: () => {
      rebuildCalled = true;
      return makeIdx();
    },
  });
  assert.equal(decision.reloaded, false);
  assert.equal(rebuildCalled, false);
  assert.match(decision.notice, /gitOnly/);
});

// ---------- gitOnly: probe returns true → proceed ----------

test("gitOnly: when probe returns true, auto reload proceeds", async () => {
  const decision = await applyReloadPolicy({
    mode: "auto",
    changes: ["/a/SKILL.md"],
    gitOnly: true,
    gitProbe: () => true,
    rebuild: () => makeIdx(1, 0, 0, 0),
  });
  assert.equal(decision.reloaded, true);
  assert.equal(decision.triggerCount, 1);
});

// ---------- empty changes ----------

test("empty changes list returns no-op decision", async () => {
  const decision = await applyReloadPolicy({
    mode: "auto",
    changes: [],
    rebuild: () => makeIdx(),
  });
  assert.equal(decision.reloaded, false);
  assert.equal(decision.notice, "");
});

// ---------- helpers ----------

test("triggerCount sums all four channels", () => {
  assert.equal(triggerCount(makeIdx(2, 3, 1, 4)), 10);
});

test("summarizeChanges shortens long lists", () => {
  const s = summarizeChanges([
    "/x/a/SKILL.md",
    "/x/b/SKILL.md",
    "/x/c/SKILL.md",
    "/x/d/SKILL.md",
    "/x/e/SKILL.md",
  ]);
  assert.match(s, /\+2 more/);
});
