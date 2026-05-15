import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAuthorizedAuthor,
  unauthorizedAuthorMessage,
} from "../src/bot/author-guard.js";

test("author === channel owner is authorized", () => {
  assert.equal(isAuthorizedAuthor("command-alice", "alice"), true);
  assert.equal(isAuthorizedAuthor("works-alice", "alice"), true);
});

test("author !== channel owner is rejected", () => {
  assert.equal(isAuthorizedAuthor("command-alice", "bob"), false);
  assert.equal(isAuthorizedAuthor("works-alice", "bob"), false);
});

test("authorHandle is normalized (trim + lowercase) before comparing", () => {
  assert.equal(isAuthorizedAuthor("command-alice", "  Alice  "), true);
  assert.equal(isAuthorizedAuthor("command-alice", "ALICE"), true);
});

test("unrelated channels (broadcast, system, legacy) pass through", () => {
  // Broadcast is push-only, but the guard must not block other messages either.
  assert.equal(isAuthorizedAuthor("solosquad-broadcast", "alice"), true);
  // Legacy v0.7 channels should not be matched by the (command|works) regex.
  assert.equal(isAuthorizedAuthor("owner-command", "bob"), true);
  assert.equal(isAuthorizedAuthor("workflow", "bob"), true);
  // Empty / nonsense channel
  assert.equal(isAuthorizedAuthor("", "anyone"), true);
});

test("unauthorizedAuthorMessage names the channel owner and suggests the author's own channel", () => {
  const msg = unauthorizedAuthorMessage("command-alice", "bob");
  assert.match(msg, /alice/);
  assert.match(msg, /command-bob/);
});

test("§5.3 regression: alice in alice's channel passes; bob in alice's fails; alice in works-alice passes", () => {
  // Spec: docs/plan/v0.8-multiuser-messenger.md §5.3
  assert.equal(isAuthorizedAuthor("command-alice", "alice"), true);
  assert.equal(isAuthorizedAuthor("command-alice", "bob"), false);
  assert.equal(isAuthorizedAuthor("works-alice", "alice"), true);
});
