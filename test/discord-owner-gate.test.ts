import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import {
  decideOwnerGate,
  _resetOwnerGateState,
} from "../src/messenger/discord-owner-gate.js";
import type { UserYaml } from "../src/bot/user-registry.js";

/**
 * Build a temp workspace with a single org + one user.yaml, with the
 * discord workspace policy block writable via `discordPolicy`.
 */
function buildWorkspace(opts: {
  orgSlug: string;
  user: Pick<UserYaml, "handle" | "messenger" | "bot_user_id"> & {
    messenger_user_id?: string;
  };
  discordPolicy: Record<string, unknown>;
}): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-owner-gate-"));
  const cfgDir = path.join(ws, ".solosquad");
  fs.mkdirSync(path.join(cfgDir, "core"), { recursive: true });

  fs.writeFileSync(
    path.join(cfgDir, "workspace.yaml"),
    yaml.dump({
      version: "1.2.0",
      display_name: "test",
      created_at: new Date().toISOString(),
      messenger: { discord: opts.discordPolicy },
    }),
  );

  fs.writeFileSync(
    path.join(cfgDir, "core", "products.json"),
    JSON.stringify([{ name: opts.orgSlug, slug: opts.orgSlug }]),
  );

  const usersDir = path.join(ws, opts.orgSlug, ".solosquad", "users");
  fs.mkdirSync(usersDir, { recursive: true });

  const userYaml: UserYaml & { messenger_user_id?: string } = {
    schema_version: 1,
    handle: opts.user.handle,
    messenger: opts.user.messenger,
    bot_user_id: opts.user.bot_user_id,
    ...(opts.user.messenger_user_id
      ? { messenger_user_id: opts.user.messenger_user_id }
      : {}),
    joined_at: new Date().toISOString(),
    channels: {
      command: `command-${opts.user.handle}`,
      works: `works-${opts.user.handle}`,
    },
  };
  fs.writeFileSync(
    path.join(usersDir, `${opts.user.handle}.yaml`),
    yaml.dump(userYaml),
  );

  // Minimal .org.yaml so loadOrgYaml succeeds (chief name fallback path).
  fs.writeFileSync(
    path.join(ws, opts.orgSlug, ".org.yaml"),
    yaml.dump({
      name: opts.orgSlug,
      slug: opts.orgSlug,
      provider: "local",
      created_at: new Date().toISOString(),
    }),
  );

  return ws;
}

/** Minimal Message-like object — only the fields decideOwnerGate reads. */
function fakeMessage(opts: {
  authorId: string;
  guildId?: string | null;
  channelName?: string;
}): never {
  return {
    author: { id: opts.authorId },
    guild: opts.guildId ? { id: opts.guildId } : null,
    channel: { name: opts.channelName ?? "command-w1n" },
  } as never;
}

beforeEach(() => {
  _resetOwnerGateState();
});

test("owner_only=false → every message allowed (v1.0.2 compat path)", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: {
      handle: "w1n",
      messenger: "discord",
      bot_user_id: "111",
      messenger_user_id: "999",
    },
    discordPolicy: { owner_only: false },
  });

  const decision = decideOwnerGate(
    fakeMessage({ authorId: "stranger-123", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.equal(decision.allow, true);
  assert.equal(decision.ephemeralNotice, undefined);
});

test("owner_only=true + author === owner → allow", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: {
      handle: "w1n",
      messenger: "discord",
      bot_user_id: "111",
      messenger_user_id: "999",
    },
    discordPolicy: { owner_only: true },
  });

  const decision = decideOwnerGate(
    fakeMessage({ authorId: "999", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.equal(decision.allow, true);
});

test("owner_only=true + stranger → block + emit ephemeral notice", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: {
      handle: "w1n",
      messenger: "discord",
      bot_user_id: "111",
      messenger_user_id: "999",
    },
    discordPolicy: { owner_only: true },
  });

  const decision = decideOwnerGate(
    fakeMessage({ authorId: "stranger-123", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.equal(decision.allow, false);
  assert.match(decision.ephemeralNotice ?? "", /only takes commands from <@999>/);
});

test("owner_only=true + repeat stranger within cooldown → block, no second notice", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: {
      handle: "w1n",
      messenger: "discord",
      bot_user_id: "111",
      messenger_user_id: "999",
    },
    discordPolicy: { owner_only: true },
  });

  const first = decideOwnerGate(
    fakeMessage({ authorId: "stranger-123", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.equal(first.allow, false);
  assert.ok(first.ephemeralNotice);

  const second = decideOwnerGate(
    fakeMessage({ authorId: "stranger-123", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.equal(second.allow, false);
  assert.equal(second.ephemeralNotice, undefined);
});

test("owner_only=true + missing messenger_user_id → fail open (don't brick the bot)", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: { handle: "w1n", messenger: "discord", bot_user_id: "111" },
    discordPolicy: { owner_only: true },
  });

  const decision = decideOwnerGate(
    fakeMessage({ authorId: "anyone", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.equal(decision.allow, true);
});

test("missing ownHandle (bot not yet bound) → defer (allow=true, upstream handles it)", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: {
      handle: "w1n",
      messenger: "discord",
      bot_user_id: "111",
      messenger_user_id: "999",
    },
    discordPolicy: { owner_only: true },
  });

  const decision = decideOwnerGate(
    fakeMessage({ authorId: "999", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: null },
  );
  assert.equal(decision.allow, true);
});

test("different guild same stranger → second notice DOES fire (per-guild dedupe)", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: {
      handle: "w1n",
      messenger: "discord",
      bot_user_id: "111",
      messenger_user_id: "999",
    },
    discordPolicy: { owner_only: true },
  });

  const first = decideOwnerGate(
    fakeMessage({ authorId: "stranger-123", guildId: "guild-A" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.ok(first.ephemeralNotice);

  const second = decideOwnerGate(
    fakeMessage({ authorId: "stranger-123", guildId: "guild-B" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.ok(second.ephemeralNotice, "different guild should re-notify");
});

test("notice surfaces the org's chief_name (when set) instead of generic 'Chief'", () => {
  const ws = buildWorkspace({
    orgSlug: "acme",
    user: {
      handle: "w1n",
      messenger: "discord",
      bot_user_id: "111",
      messenger_user_id: "999",
    },
    discordPolicy: { owner_only: true },
  });
  // Overwrite org.yaml with chief_name set.
  fs.writeFileSync(
    path.join(ws, "acme", ".org.yaml"),
    yaml.dump({
      name: "acme",
      slug: "acme",
      provider: "local",
      chief_name: "Hermes",
      created_at: new Date().toISOString(),
    }),
  );

  const decision = decideOwnerGate(
    fakeMessage({ authorId: "stranger", guildId: "g1" }),
    { workspace: ws, orgSlug: "acme", ownHandle: "w1n" },
  );
  assert.match(decision.ephemeralNotice ?? "", /^Hermes only takes commands/);
});
