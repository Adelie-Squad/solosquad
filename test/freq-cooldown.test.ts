import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolve,
  tickCooldowns,
  type RouteIndex,
} from "../src/bot/agent-router.js";
import { SessionStore } from "../src/bot/session-store.js";

/**
 * v0.5 §7 — freq channel hysteresis (cooldown_turns).
 *
 * When a SKILL is auto-loaded via the freq channel, the router emits
 * `start_cooldown` and the caller persists it via SessionStore.updateFreqCooldowns.
 * For the next N turns, the same SKILL must NOT auto-fire — keeping the
 * routing surface from oscillating mid-conversation on a single hot topic.
 */

const ref = {
  team: "strategy",
  name: "watcher",
  source_path: "<fixture>",
  tier: "workspace" as const,
  stateful: false,
};

function indexWithFreq(threshold = 2, cooldownTurns = 4): RouteIndex {
  return {
    slash: {},
    keyword: {},
    explicit: {},
    freq: [
      {
        ref,
        keywords: ["등기부", "부동산"],
        window_turns: 10,
        threshold,
        cooldown_turns: cooldownTurns,
      },
    ],
  };
}

// ---------- Cooldown lifecycle ----------

test("freq match emits start_cooldown with the SKILL's cooldown_turns", () => {
  const idx = indexWithFreq(2, 4);
  const history = [{ text: "등기부 어때?" }, { text: "부동산 신호 좀" }];
  const result = resolve("뭐 새로운 거 있어?", idx, { history });
  assert.equal(result?.channel, "freq");
  assert.deepEqual(result?.start_cooldown, { skill_name: "watcher", turns: 4 });
});

test("cooldown blocks re-fire of the same SKILL", () => {
  const idx = indexWithFreq(2, 4);
  const history = [
    { text: "등기부 어때?" },
    { text: "등기부 또?" },
    { text: "부동산 보고 싶어" },
  ];
  // First match: no cooldowns → fires.
  const first = resolve("플레인", idx, { history });
  assert.equal(first?.channel, "freq");
  // Subsequent message during cooldown window: same history but cooldown active.
  const second = resolve("계속 등기부 얘기", idx, {
    history,
    freq_cooldowns: { watcher: 4 },
  });
  assert.equal(second, null, "expected null while cooldown is non-zero");
});

test("cooldown expires after N tickCooldowns calls", () => {
  // start with turns=3; expect to clear after exactly 3 ticks.
  let cd: Record<string, number> = { watcher: 3 };
  cd = tickCooldowns(cd);
  assert.equal(cd.watcher, 2);
  cd = tickCooldowns(cd);
  assert.equal(cd.watcher, 1);
  cd = tickCooldowns(cd);
  assert.equal(cd.watcher, undefined, "expected watcher to be dropped at 0");
});

test("cooldown does not leak between distinct SKILLs", () => {
  const ref2 = { ...ref, name: "second" };
  const idx: RouteIndex = {
    slash: {},
    keyword: {},
    explicit: {},
    freq: [
      {
        ref,
        keywords: ["a"],
        window_turns: 10,
        threshold: 1,
        cooldown_turns: 4,
      },
      {
        ref: ref2,
        keywords: ["b"],
        window_turns: 10,
        threshold: 1,
        cooldown_turns: 4,
      },
    ],
  };
  const history = [{ text: "a b" }];
  // watcher is in cooldown; second SKILL should still match.
  const result = resolve("...", idx, {
    history,
    freq_cooldowns: { watcher: 3 },
  });
  assert.equal(result?.ref.name, "second");
});

// ---------- Integration with SessionStore ----------

test("SessionStore.updateFreqCooldowns ticks + records new cooldowns", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-freq-"));
  // Set up an org dir structure so the store has somewhere to write.
  const orgDir = path.join(ws, "acme");
  fs.mkdirSync(orgDir, { recursive: true });

  const store = new SessionStore(ws);
  store.ensure("acme", "user1");

  // Pre-seed cooldowns.
  store.updateFreqCooldowns("acme", "user1", {
    start: { skillName: "alpha", turns: 3 },
  });
  let rec = store.read("acme", "user1");
  assert.deepEqual(rec?.freqCooldowns, { alpha: 3 });

  // Tick one turn → 2.
  store.updateFreqCooldowns("acme", "user1", { tick: true });
  rec = store.read("acme", "user1");
  assert.deepEqual(rec?.freqCooldowns, { alpha: 2 });

  // Add a second SKILL on the same tick.
  store.updateFreqCooldowns("acme", "user1", {
    tick: true,
    start: { skillName: "beta", turns: 4 },
  });
  rec = store.read("acme", "user1");
  // alpha: 2 → 1 after tick. beta added after tick = 4.
  assert.deepEqual(rec?.freqCooldowns, { alpha: 1, beta: 4 });

  // Tick twice more — alpha should drop out, beta stays.
  store.updateFreqCooldowns("acme", "user1", { tick: true });
  store.updateFreqCooldowns("acme", "user1", { tick: true });
  rec = store.read("acme", "user1");
  assert.deepEqual(rec?.freqCooldowns, { beta: 2 });
});

test("SessionStore drops empty freqCooldowns object from disk", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-freq-"));
  fs.mkdirSync(path.join(ws, "acme"), { recursive: true });

  const store = new SessionStore(ws);
  store.ensure("acme", "u");
  store.updateFreqCooldowns("acme", "u", { start: { skillName: "x", turns: 1 } });
  store.updateFreqCooldowns("acme", "u", { tick: true });
  const rec = store.read("acme", "u");
  assert.equal(rec?.freqCooldowns, undefined);
});
