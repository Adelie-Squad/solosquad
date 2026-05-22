import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.1 — Discord deprecation regression catcher.
 *
 * discord.js v14.26 renamed `Client#event:ready` → `clientReady` to
 * disambiguate from the gateway READY opcode, and will remove the
 * `ready` alias in v15. v1.0.1 swapped the adapter's listener to the
 * typed `Events.ClientReady` enum so the bot doesn't emit the Node
 * DeprecationWarning on every start AND survives the v15 cutover.
 *
 * This catcher reads the adapter source so it stays valid even when
 * tests can't easily spin up a real Discord client. If the regression
 * trips, somebody re-introduced `client.on("ready", ...)` and the bot
 * will go silent on the v15 upgrade.
 */

test("v1.0.1 — discord adapter listens on Events.ClientReady, not 'ready'", () => {
  const adapter = fs.readFileSync(
    path.resolve(process.cwd(), "src/messenger/discord-adapter.ts"),
    "utf-8",
  );

  // Must import Events from discord.js.
  assert.match(
    adapter,
    /import\s*\{[^}]*\bEvents\b[^}]*\}\s*from\s*["']discord\.js["']/,
    "discord-adapter must import Events from discord.js for typed event enum",
  );

  // Must register the ClientReady listener via the enum.
  assert.match(
    adapter,
    /client\.on\(\s*Events\.ClientReady\s*,/,
    "discord-adapter must call client.on(Events.ClientReady, …)",
  );

  // Must NOT use the deprecated string literal 'ready' as an event name.
  // (Comment text mentioning 'ready' is fine — we look for the call shape.)
  const forbiddenCall = /client\.on\(\s*["']ready["']\s*,/;
  assert.equal(
    forbiddenCall.test(adapter),
    false,
    "discord-adapter must not register a 'ready' listener (deprecated in v14.26, removed in v15)",
  );
});
