import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.2 — Discord author-guard removal regression catcher.
 *
 * v1.0.2 removed the Discord adapter's call to `isAuthorizedAuthor` because
 * it false-positived on any user whose Discord username diverged from their
 * SoloSquad handle charset (e.g. `seungw1n.` — trailing dot, channel names
 * can't include `.`). Discord channel ACL is now the sole permission
 * boundary; author identity is logged for audit but never gated.
 *
 * The Slack adapter still uses author-guard (v1.0.3 will remove that too),
 * so `src/bot/author-guard.ts` and `test/author-guard.test.ts` stay.
 *
 * These tests assert the Discord adapter source no longer calls the guard
 * AND that an audit log line exists in its place — if someone re-introduces
 * `isAuthorizedAuthor(channelName, ...)` in the Discord adapter, the v1.0.2
 * fix has regressed and the `seungw1n.`-class incident will return.
 */

const ADAPTER_PATH = path.resolve(process.cwd(), "src/messenger/discord-adapter.ts");

test("v1.0.2 — discord-adapter does not import author-guard helpers", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  assert.equal(
    /from\s+["']\.\.\/bot\/author-guard\.js["']/.test(src),
    false,
    "discord-adapter must not import from ../bot/author-guard.js (v1.0.2 removed the gate)",
  );
});

test("v1.0.2 — discord-adapter does not call isAuthorizedAuthor", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  assert.equal(
    /\bisAuthorizedAuthor\s*\(/.test(src),
    false,
    "discord-adapter must not call isAuthorizedAuthor — author identity is no longer gated, only logged",
  );
});

test("v1.0.2 — discord-adapter does not send unauthorizedAuthorMessage DM", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  assert.equal(
    /\bunauthorizedAuthorMessage\s*\(/.test(src),
    false,
    "discord-adapter must not send the unauthorizedAuthorMessage DM — that was the false-positive surface for username/handle mismatch",
  );
});

test("v1.0.2 — discord-adapter logs author identity for audit", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // Must log both author id and username (post-hoc audit trail, no gating)
  assert.match(
    src,
    /message\.author\.id/,
    "discord-adapter must log message.author.id for audit (post-hoc trail when ACL fails)",
  );
  assert.match(
    src,
    /message\.author\.username/,
    "discord-adapter must log message.author.username for audit",
  );
});

test("v1.0.2 — historical note: author-guard.ts file deletion deferred to v1.0.4", () => {
  // v1.0.2 left src/bot/author-guard.ts in place because src/messenger/
  // slack-adapter.ts still depended on it. v1.0.4 removed both the Slack
  // callsite and the file itself. The catcher is preserved (inverted from
  // its v1.0.2-era assertion) so the historical fact that file deletion
  // was *deferred* one release stays visible in the test record.
  const exists = fs.existsSync(path.resolve(process.cwd(), "src/bot/author-guard.ts"));
  assert.equal(
    exists,
    false,
    "author-guard.ts must be gone after v1.0.4 (Slack callsite + file deleted together)",
  );
});
