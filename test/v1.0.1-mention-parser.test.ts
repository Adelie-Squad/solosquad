import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMentions } from "../src/bot/mention-parser.js";

/**
 * v1.0.1 — `@<slug>` mention parser tests.
 *
 * Contract: scan `input` for `@<slug>` tokens, resolve against the
 * registered repo list, and prefix the forward text with a stable
 * `[target_repo:<slug>]` marker when one resolves (or `[target_repos:…]`
 * when many). Discord user pings (`<@123456789>`) and unknown handles
 * must not poison the marker. Multiple identical mentions dedupe.
 */

const REPOS = ["landing-site", "product-app", "data-pipeline"];

test("v1.0.1 — no mention → pass-through unchanged", () => {
  const r = parseMentions("빌드 한 번 돌려줘", REPOS);
  assert.deepEqual(r.mentioned, []);
  assert.deepEqual(r.unknown, []);
  assert.equal(r.forwardText, "빌드 한 번 돌려줘");
});

test("v1.0.1 — single resolved mention → [target_repo:<slug>] prefix", () => {
  const r = parseMentions("@landing-site 히어로 카피 수정", REPOS);
  assert.deepEqual(r.mentioned, ["landing-site"]);
  assert.deepEqual(r.unknown, []);
  assert.equal(r.forwardText, "[target_repo:landing-site] @landing-site 히어로 카피 수정");
});

test("v1.0.1 — multiple resolved mentions → [target_repos:a,b] prefix, in order, deduped", () => {
  const r = parseMentions(
    "@product-app 의 API 호출을 @landing-site 에서 쓰도록. @product-app 쪽 먼저",
    REPOS,
  );
  assert.deepEqual(r.mentioned, ["product-app", "landing-site"]);
  assert.equal(
    r.forwardText,
    "[target_repos:product-app,landing-site] " +
      "@product-app 의 API 호출을 @landing-site 에서 쓰도록. @product-app 쪽 먼저",
  );
});

test("v1.0.1 — unknown @handle (typo / Discord username) does not produce a marker", () => {
  const r = parseMentions("@somebody 그거 해줘", REPOS);
  assert.deepEqual(r.mentioned, []);
  assert.deepEqual(r.unknown, ["somebody"]);
  assert.equal(r.forwardText, "@somebody 그거 해줘");
});

test("v1.0.1 — Discord user-ping format <@123456> is ignored (not a valid slug token)", () => {
  const r = parseMentions("<@123456789> 봐줘", REPOS);
  assert.deepEqual(r.mentioned, []);
  assert.equal(r.forwardText, "<@123456789> 봐줘");
});

test("v1.0.1 — mixed: one resolved + one unknown → marker for resolved only", () => {
  const r = parseMentions("@landing-site 와 @unknown-repo 둘 다", REPOS);
  assert.deepEqual(r.mentioned, ["landing-site"]);
  assert.deepEqual(r.unknown, ["unknown-repo"]);
  assert.equal(
    r.forwardText,
    "[target_repo:landing-site] @landing-site 와 @unknown-repo 둘 다",
  );
});

test("v1.0.1 — empty registered list → all mentions go to unknown, no marker", () => {
  const r = parseMentions("@landing-site 빌드", []);
  assert.deepEqual(r.mentioned, []);
  assert.deepEqual(r.unknown, ["landing-site"]);
  assert.equal(r.forwardText, "@landing-site 빌드");
});

test("v1.0.1 — same mention repeated dedupes in `mentioned` and emits singular marker", () => {
  const r = parseMentions("@product-app 빌드. @product-app 한 번 더.", REPOS);
  assert.deepEqual(r.mentioned, ["product-app"]);
  assert.ok(r.forwardText.startsWith("[target_repo:product-app] "));
});
