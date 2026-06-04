import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parsePushCommand,
  formatPushNotification,
  isGitEventsEnabled,
  notifyGitPush,
  type PushEvent,
} from "../src/bot/git-event-notify.js";

test("parsePushCommand defaults remote/branch when omitted", () => {
  assert.deepEqual(parsePushCommand("git push"), {
    remote: "(default)",
    branch: "(default)",
  });
});

test("parsePushCommand reads positional remote + branch", () => {
  assert.deepEqual(parsePushCommand("git push origin main"), {
    remote: "origin",
    branch: "main",
  });
});

test("parsePushCommand ignores flags when locating positionals", () => {
  assert.deepEqual(parsePushCommand("git push -u origin feat/x"), {
    remote: "origin",
    branch: "feat/x",
  });
  assert.deepEqual(parsePushCommand("git push --force origin main"), {
    remote: "origin",
    branch: "main",
  });
});

test("isGitEventsEnabled defaults ON; only explicit false disables", () => {
  assert.equal(isGitEventsEnabled(undefined), true);
  assert.equal(isGitEventsEnabled({}), true);
  assert.equal(isGitEventsEnabled({ git_events: {} }), true);
  assert.equal(isGitEventsEnabled({ git_events: { enabled: true } }), true);
  assert.equal(isGitEventsEnabled({ git_events: { enabled: false } }), false);
});

test("formatPushNotification renders the approval line + meta", () => {
  const ev: PushEvent = {
    repoSlug: "myapp",
    remote: "origin",
    branch: "main",
    userHandle: "alice",
    ts: "2026-06-04T10:00:00Z",
  };
  const out = formatPushNotification(ev);
  assert.match(out, /✅ Push 승인: `myapp` · `main` → `origin`/);
  assert.match(out, /by @alice · 2026-06-04T10:00:00Z/);
});

test("formatPushNotification appends commit summary lines when present", () => {
  const ev: PushEvent = {
    repoSlug: "myapp",
    remote: "origin",
    branch: "main",
    userHandle: "alice",
    ts: "2026-06-04T10:00:00Z",
    commits: ["abc123 fix bug", "def456 add test"],
  };
  const out = formatPushNotification(ev);
  assert.match(out, /• abc123 fix bug/);
  assert.match(out, /• def456 add test/);
});

test("notifyGitPush sends to git-<handle> when enabled", async () => {
  const calls: Array<{ channel: string; text: string }> = [];
  const adapter = {
    async sendToChannel(
      _cfg: Record<string, unknown>,
      channelName: string,
      text: string,
    ): Promise<boolean> {
      calls.push({ channel: channelName, text });
      return true;
    },
  };
  const ev: PushEvent = {
    repoSlug: "myapp",
    remote: "origin",
    branch: "main",
    userHandle: "alice",
    ts: "2026-06-04T10:00:00Z",
  };
  const ok = await notifyGitPush(adapter, { guild_id: "g" }, "alice", ev, undefined);
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "git-alice");
  assert.match(calls[0].text, /Push 승인/);
});

test("notifyGitPush is a no-op when git_events disabled", async () => {
  let called = false;
  const adapter = {
    async sendToChannel(): Promise<boolean> {
      called = true;
      return true;
    },
  };
  const ev: PushEvent = {
    repoSlug: "myapp",
    remote: "origin",
    branch: "main",
    userHandle: "alice",
    ts: "2026-06-04T10:00:00Z",
  };
  const ok = await notifyGitPush(adapter, {}, "alice", ev, {
    git_events: { enabled: false },
  });
  assert.equal(ok, false);
  assert.equal(called, false);
});

test("notifyGitPush swallows adapter errors (best-effort)", async () => {
  const adapter = {
    async sendToChannel(): Promise<boolean> {
      throw new Error("network down");
    },
  };
  const ev: PushEvent = {
    repoSlug: "myapp",
    remote: "origin",
    branch: "main",
    userHandle: "alice",
    ts: "2026-06-04T10:00:00Z",
  };
  const ok = await notifyGitPush(adapter, {}, "alice", ev, undefined);
  assert.equal(ok, false);
});
