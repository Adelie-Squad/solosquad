import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildInviteUrl,
  DEFAULT_PERMISSIONS,
  DEFAULT_PERMISSIONS_BITFIELD,
} from "../src/messenger/discord-invite-url.js";

test("DEFAULT_PERMISSIONS_BITFIELD is the sum of every named bit (v1.2 §4.2)", () => {
  const expected = Object.values(DEFAULT_PERMISSIONS).reduce(
    (a, b) => a + b,
    0n,
  );
  assert.equal(DEFAULT_PERMISSIONS_BITFIELD, expected);
});

test("DEFAULT_PERMISSIONS_BITFIELD enumerates exactly the v1.2 §4.2 perms", () => {
  // Sentinel — if anyone changes the permission list we want to force a
  // PRD touch-up too. v1.2 §4.2 names 10 permissions explicitly. The
  // exact numeric sum is a Discord-defined value but mismatch with the
  // PRD's intent is what the test guards against.
  assert.equal(Object.keys(DEFAULT_PERMISSIONS).length, 10);
  assert.ok(DEFAULT_PERMISSIONS.ManageChannels === 16n);
  assert.ok(DEFAULT_PERMISSIONS.UseApplicationCommands === 2147483648n);
});

test("DEFAULT_PERMISSIONS deliberately excludes verification-trigger perms (v1.2 §4.2)", () => {
  const dangerous = [
    "Administrator",
    "ManageGuild",
    "ManageRoles",
    "Kick",
    "Ban",
    "MentionEveryone",
  ];
  for (const name of dangerous) {
    assert.equal(
      DEFAULT_PERMISSIONS[name],
      undefined,
      `${name} must not be in DEFAULT_PERMISSIONS — Discord verification trigger risk`,
    );
  }
});

test("buildInviteUrl synthesizes the canonical OAuth path", () => {
  const url = buildInviteUrl({ applicationClientId: "1234567890" });
  assert.ok(url.startsWith("https://discord.com/oauth2/authorize?"));
  assert.match(url, /client_id=1234567890/);
  assert.match(url, /scope=bot\+applications\.commands/);
  assert.match(url, /permissions=\d+/);
});

test("buildInviteUrl trims surrounding whitespace from client_id", () => {
  const url = buildInviteUrl({ applicationClientId: "  1234567890  " });
  assert.match(url, /client_id=1234567890&/);
});

test("buildInviteUrl rejects malformed client_id (non-digits)", () => {
  assert.throws(
    () => buildInviteUrl({ applicationClientId: "not-a-snowflake" }),
    /Invalid Discord application_client_id/,
  );
});

test("buildInviteUrl rejects empty client_id", () => {
  assert.throws(
    () => buildInviteUrl({ applicationClientId: "" }),
    /Invalid Discord application_client_id/,
  );
});

test("buildInviteUrl rejects suspiciously short ids (< 10 digits)", () => {
  assert.throws(
    () => buildInviteUrl({ applicationClientId: "12345" }),
    /Invalid Discord application_client_id/,
  );
});

test("buildInviteUrl honors a custom scopes array (test-only)", () => {
  const url = buildInviteUrl({
    applicationClientId: "1234567890",
    scopes: ["bot"],
  });
  assert.match(url, /scope=bot&/);
});

test("buildInviteUrl honors a permissions override (regression on bigint cast)", () => {
  const url = buildInviteUrl({
    applicationClientId: "1234567890",
    permissions: 42n,
  });
  assert.match(url, /permissions=42$/);
});
