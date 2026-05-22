import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.4 — Slack author-guard removal regression catcher.
 *
 * v1.0.2 removed the Discord adapter's author-guard call but had to leave
 * `src/bot/author-guard.ts` in place because the Slack adapter still
 * imported it. v1.0.4 finishes the cleanup: the Slack callsite is gone,
 * the file is deleted, and the unit test for the old helper functions is
 * deleted too. Same rationale as Discord side — comparing a free-form
 * Slack `user.name` against the channel-derived handle universally
 * false-positives when the two charsets/identities diverge.
 */

const SLACK_ADAPTER_PATH = path.resolve(process.cwd(), "src/messenger/slack-adapter.ts");

test("v1.0.4 — slack-adapter no longer imports from ../bot/author-guard", () => {
  const src = fs.readFileSync(SLACK_ADAPTER_PATH, "utf-8");
  assert.equal(
    /from\s+["']\.\.\/bot\/author-guard\.js["']/.test(src),
    false,
    "slack-adapter must not import from ../bot/author-guard.js (v1.0.4 removed the gate)",
  );
});

test("v1.0.4 — slack-adapter no longer calls isAuthorizedAuthor", () => {
  const src = fs.readFileSync(SLACK_ADAPTER_PATH, "utf-8");
  assert.equal(
    /\bisAuthorizedAuthor\s*\(/.test(src),
    false,
    "slack-adapter must not call isAuthorizedAuthor (author identity is no longer gated, only logged)",
  );
});

test("v1.0.4 — slack-adapter no longer sends unauthorizedAuthorMessage DM", () => {
  const src = fs.readFileSync(SLACK_ADAPTER_PATH, "utf-8");
  assert.equal(
    /\bunauthorizedAuthorMessage\s*\(/.test(src),
    false,
    "slack-adapter must not send the unauthorizedAuthorMessage ephemeral",
  );
});

test("v1.0.4 — slack-adapter logs author identity for audit", () => {
  const src = fs.readFileSync(SLACK_ADAPTER_PATH, "utf-8");
  assert.match(
    src,
    /\[Slack Bot\] message in/,
    "slack-adapter must log a '[Slack Bot] message in ...' line for post-hoc audit",
  );
});

test("v1.0.4 — src/bot/author-guard.ts is deleted", () => {
  const exists = fs.existsSync(path.resolve(process.cwd(), "src/bot/author-guard.ts"));
  assert.equal(
    exists,
    false,
    "src/bot/author-guard.ts must be removed in v1.0.4 (Slack was its last consumer)",
  );
});

test("v1.0.4 — test/author-guard.test.ts is deleted", () => {
  const exists = fs.existsSync(path.resolve(process.cwd(), "test/author-guard.test.ts"));
  assert.equal(
    exists,
    false,
    "test/author-guard.test.ts must be removed in v1.0.4 (target functions are gone)",
  );
});
