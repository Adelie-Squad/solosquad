import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import {
  expectedChannelNamesFor,
  listKnownChannels,
  resolveBotIdentity,
} from "../src/bot/channel-bootstrap.js";
import {
  saveUserYaml,
  type UserYaml,
} from "../src/bot/user-registry.js";
import {
  broadcastEnabled,
  handoverBroadcast,
  isDesignatedBroadcaster,
  loadMessengerSection,
} from "../src/messenger/broadcast.js";

function tempWorkspace(...orgs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-chbootstrap-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    yaml.dump({
      version: "0.8.0",
      display_name: "test",
      created_at: new Date().toISOString(),
      messenger: {
        broadcast_enabled: false,
        broadcast_owner_handle: null,
        broadcast_channel: "solosquad-broadcast",
      },
    }),
  );
  for (const org of orgs) {
    fs.mkdirSync(path.join(dir, org), { recursive: true });
    fs.writeFileSync(
      path.join(dir, org, ".org.yaml"),
      yaml.dump({
        name: org,
        slug: org,
        provider: "local",
        created_at: new Date().toISOString(),
      }),
    );
  }
  return dir;
}

function userDoc(handle: string, botUserId: string): UserYaml {
  return {
    schema_version: 1,
    handle,
    messenger: "discord",
    bot_user_id: botUserId,
    joined_at: "2026-05-15T10:00:00Z",
    channels: { command: `command-${handle}`, works: `works-${handle}` },
  };
}

test("expectedChannelNamesFor derives the canonical triple (v1.2.9 Part B adds git)", () => {
  assert.deepEqual(expectedChannelNamesFor("alice"), {
    command: "command-alice",
    works: "works-alice",
    git: "git-alice",
  });
});

test("resolveBotIdentity matches the yaml whose bot_user_id matches the live id", () => {
  const ws = tempWorkspace("alpha");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  saveUserYaml("alpha", userDoc("bob", "id-2"), ws);

  const identity = resolveBotIdentity({ workspace: ws, botUserId: "id-2" });
  assert.ok(identity);
  assert.equal(identity!.orgSlug, "alpha");
  assert.equal(identity!.user.handle, "bob");
  assert.equal(identity!.channels.command, "command-bob");
});

test("resolveBotIdentity returns null when no yaml matches — bot must not silently steal another user's channels", () => {
  const ws = tempWorkspace("alpha");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  const identity = resolveBotIdentity({ workspace: ws, botUserId: "id-unknown" });
  assert.equal(identity, null);
});

test("resolveBotIdentity scans every org under the workspace", () => {
  const ws = tempWorkspace("alpha", "beta");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  saveUserYaml("beta", userDoc("bob", "id-2"), ws);
  const identity = resolveBotIdentity({ workspace: ws, botUserId: "id-2" });
  assert.equal(identity!.orgSlug, "beta");
});

test("listKnownChannels enumerates every (org, handle, command, works) tuple", () => {
  const ws = tempWorkspace("alpha", "beta");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  saveUserYaml("beta", userDoc("bob", "id-2"), ws);
  const known = listKnownChannels(ws);
  assert.equal(known.length, 2);
  const map = Object.fromEntries(known.map((k) => [k.handle, k]));
  assert.equal(map.alice.orgSlug, "alpha");
  assert.equal(map.alice.command, "command-alice");
  assert.equal(map.bob.works, "works-bob");
  // v1.2.9 Part B — git channel is derived even for pre-migration yamls
  // (userDoc here has no channels.git → fallback to git-<handle>).
  assert.equal(map.alice.git, "git-alice");
  assert.equal(map.bob.git, "git-bob");
});

test("resolveBotIdentity falls back to git-<handle> for pre-v1.2.9 yamls (no channels.git)", () => {
  const ws = tempWorkspace("alpha");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  const identity = resolveBotIdentity({ workspace: ws, botUserId: "id-1" });
  assert.ok(identity);
  assert.equal(identity!.channels.git, "git-alice");
});

test("broadcast defaults are off — isDesignatedBroadcaster returns false", () => {
  const ws = tempWorkspace("alpha");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  assert.equal(broadcastEnabled(ws), false);
  assert.equal(isDesignatedBroadcaster("alice", ws), false);
});

test("broadcast handover sets owner handle and only the designated bot can push", () => {
  const ws = tempWorkspace("alpha");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  saveUserYaml("alpha", userDoc("bob", "id-2"), ws);

  const result = handoverBroadcast({
    toHandle: "alice",
    workspace: ws,
    enable: true,
  });
  assert.equal(result.previous, null);
  assert.equal(result.next, "alice");
  assert.equal(result.enabled, true);

  // Only alice may push to the broadcast channel; bob must skip.
  assert.equal(isDesignatedBroadcaster("alice", ws), true);
  assert.equal(isDesignatedBroadcaster("bob", ws), false);

  // Reload the workspace.yaml fresh and confirm the section is persisted.
  const sec = loadMessengerSection(ws);
  assert.equal(sec.broadcast_enabled, true);
  assert.equal(sec.broadcast_owner_handle, "alice");
});

test("broadcast handover is idempotent — second call with same handle is a no-op", () => {
  const ws = tempWorkspace("alpha");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  handoverBroadcast({ toHandle: "alice", workspace: ws, enable: true });
  const second = handoverBroadcast({
    toHandle: "alice",
    workspace: ws,
    enable: true,
  });
  assert.equal(second.previous, "alice");
  assert.equal(second.next, "alice");
  assert.equal(second.enabled, true);
});

test("§5.4 regression: only the designated bot pushes broadcast (no N-way duplicates)", () => {
  const ws = tempWorkspace("alpha");
  saveUserYaml("alpha", userDoc("alice", "id-1"), ws);
  saveUserYaml("alpha", userDoc("bob", "id-2"), ws);
  saveUserYaml("alpha", userDoc("carol", "id-3"), ws);
  handoverBroadcast({ toHandle: "carol", workspace: ws, enable: true });

  // 3 bots boot — only carol passes the designated-broadcaster gate.
  const decisions = ["alice", "bob", "carol"].map((h) => ({
    handle: h,
    canPush: isDesignatedBroadcaster(h, ws),
  }));
  const pushers = decisions.filter((d) => d.canPush).map((d) => d.handle);
  assert.deepEqual(pushers, ["carol"]);
});
