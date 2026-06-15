import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import {
  deriveChannelNames,
  findUserByBotId,
  getUsersDir,
  isValidHandle,
  listAllUsers,
  listUserYamls,
  loadUserYaml,
  normalizeHandle,
  parseChannelName,
  saveUserYaml,
  userYamlExists,
  userYamlPath,
  type UserYaml,
} from "../src/bot/user-registry.js";

function tempWorkspace(orgSlug = "alpha"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-userreg-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.mkdirSync(path.join(dir, orgSlug), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    yaml.dump({
      version: "0.8.0",
      display_name: "test",
      created_at: new Date().toISOString(),
    }),
  );
  fs.writeFileSync(
    path.join(dir, orgSlug, ".org.yaml"),
    yaml.dump({
      name: orgSlug,
      slug: orgSlug,
      provider: "local",
      created_at: new Date().toISOString(),
    }),
  );
  return dir;
}

function sampleUser(handle: string, botUserId = `id-${handle}`): UserYaml {
  return {
    schema_version: 1,
    handle,
    display_name: `${handle} (test)`,
    messenger: "discord",
    bot_user_id: botUserId,
    joined_at: "2026-05-15T10:00:00Z",
    channels: deriveChannelNames(handle),
  };
}

test("normalizeHandle lowercases and replaces non-allowed chars with underscore", () => {
  assert.equal(normalizeHandle("Alice.Founder"), "alice_founder");
  assert.equal(normalizeHandle("  BOB  "), "bob");
  assert.equal(normalizeHandle("user-with-dash"), "user_with_dash");
  assert.equal(normalizeHandle("한글"), "_");
});

test("isValidHandle rejects empty / mixed-case / special characters", () => {
  assert.equal(isValidHandle("alice"), true);
  assert.equal(isValidHandle("alice_99"), true);
  assert.equal(isValidHandle(""), false);
  assert.equal(isValidHandle("Alice"), false);
  assert.equal(isValidHandle("alice-x"), false);
  assert.equal(isValidHandle("a".repeat(65)), false);
});

test("parseChannelName extracts command/works kind + handle, returns null otherwise", () => {
  assert.deepEqual(parseChannelName("command-alice"), {
    kind: "command",
    handle: "alice",
  });
  assert.deepEqual(parseChannelName("works-bob"), { kind: "works", handle: "bob" });
  // v1.2.10 — the git-<handle> feed was dropped; git channels are no longer
  // recognized and route to null like any unrelated channel.
  assert.equal(parseChannelName("git-carol"), null);
  assert.equal(parseChannelName("owner-command"), null);
  assert.equal(parseChannelName("solosquad-broadcast"), null);
  assert.equal(parseChannelName("random"), null);
});

test("deriveChannelNames returns the command/works pair", () => {
  assert.deepEqual(deriveChannelNames("alice"), {
    command: "command-alice",
    works: "works-alice",
  });
});

test("saveUserYaml + loadUserYaml round-trip", () => {
  const ws = tempWorkspace();
  const doc = sampleUser("alice");
  saveUserYaml("alpha", doc, ws);
  const file = userYamlPath("alpha", "alice", ws);
  assert.equal(fs.existsSync(file), true);
  const loaded = loadUserYaml(file);
  assert.ok(loaded);
  assert.equal(loaded!.handle, "alice");
  assert.equal(loaded!.bot_user_id, "id-alice");
  assert.equal(loaded!.channels.command, "command-alice");
  assert.equal(loaded!.channels.works, "works-alice");
});

test("saveUserYaml refuses to clobber when allowOverwrite=false (handle collision §3.5)", () => {
  const ws = tempWorkspace();
  saveUserYaml("alpha", sampleUser("alice"), ws);
  assert.equal(userYamlExists("alpha", "alice", ws), true);
  assert.throws(
    () => saveUserYaml("alpha", sampleUser("alice"), ws),
    /이미 이 워크스페이스에 등록되어/,
  );
});

test("saveUserYaml rejects invalid handles", () => {
  const ws = tempWorkspace();
  assert.throws(
    () =>
      saveUserYaml(
        "alpha",
        { ...sampleUser("alice"), handle: "Alice" },
        ws,
      ),
    /Invalid handle/,
  );
});

test("listUserYamls returns every valid yaml in users dir", () => {
  const ws = tempWorkspace();
  saveUserYaml("alpha", sampleUser("alice", "id-1"), ws);
  saveUserYaml("alpha", sampleUser("bob", "id-2"), ws);
  const users = listUserYamls("alpha", ws);
  assert.equal(users.length, 2);
  const handles = users.map((u) => u.handle).sort();
  assert.deepEqual(handles, ["alice", "bob"]);
});

test("listUserYamls is empty when users dir does not exist", () => {
  const ws = tempWorkspace();
  assert.equal(listUserYamls("alpha", ws).length, 0);
});

test("findUserByBotId matches exact bot_user_id", () => {
  const ws = tempWorkspace();
  saveUserYaml("alpha", sampleUser("alice", "id-alice"), ws);
  saveUserYaml("alpha", sampleUser("bob", "id-bob"), ws);
  const found = findUserByBotId("alpha", "id-bob", ws);
  assert.ok(found);
  assert.equal(found!.handle, "bob");
  assert.equal(findUserByBotId("alpha", "no-such-id", ws), null);
});

test("listAllUsers walks every org folder under the workspace", () => {
  const ws = tempWorkspace("alpha");
  // Add a second org.
  fs.mkdirSync(path.join(ws, "beta"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "beta", ".org.yaml"),
    yaml.dump({ name: "beta", slug: "beta", provider: "local", created_at: "2026-05-15T10:00:00Z" }),
  );
  saveUserYaml("alpha", sampleUser("alice"), ws);
  saveUserYaml("beta", sampleUser("bob"), ws);
  const all = listAllUsers(ws);
  assert.equal(all.length, 2);
  const pairs = all.map((x) => `${x.orgSlug}:${x.user.handle}`).sort();
  assert.deepEqual(pairs, ["alpha:alice", "beta:bob"]);
});

test("getUsersDir matches `<workspace>/<org>/.solosquad/users`", () => {
  const ws = tempWorkspace();
  assert.equal(
    getUsersDir("alpha", ws),
    path.join(ws, "alpha", ".solosquad", "users"),
  );
});
