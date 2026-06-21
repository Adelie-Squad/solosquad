import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUserCrons } from "../src/scheduler/user-crons.js";
import type { UserYaml } from "../src/bot/user-registry.js";

function user(handle: string, over: Partial<UserYaml> = {}): UserYaml {
  return {
    schema_version: 2,
    handle,
    messenger: "discord",
    bot_user_id: "b",
    joined_at: "2026-01-01",
    channels: { command: `command-${handle}`, works: `works-${handle}` },
    ...over,
  };
}

const defaults = { tz: "Asia/Seoul", times: { "morning-brief": "08:00", "evening-brief": "18:00" } };

test("a user with a crons block gets both briefs in their works channel", () => {
  const r = resolveUserCrons([{ slug: "acme", users: [user("alice", { crons: { "morning-brief": {} } })] }], defaults);
  assert.equal(r.length, 2, "both briefs personalized when opted in");
  const m = r.find((c) => c.cronId === "morning-brief")!;
  assert.equal(m.channel, "works-alice");
  assert.equal(m.expr, "0 8 * * *");
  assert.equal(m.timezone, "Asia/Seoul");
});

test("timezone-only opt-in personalizes at the user's tz with default times", () => {
  const r = resolveUserCrons([{ slug: "acme", users: [user("bob", { timezone: "America/Los_Angeles" })] }], defaults);
  assert.equal(r.length, 2);
  assert.ok(r.every((c) => c.timezone === "America/Los_Angeles"));
  assert.ok(r.every((c) => c.channel === "works-bob"));
});

test("every user gets both briefs in their works channel (no opt-in gate)", () => {
  // v1.3.4 §F2 — there is no org-common brief; a plain user still gets both
  // briefs in works-<handle> at the workspace default tz/time.
  const r = resolveUserCrons([{ slug: "acme", users: [user("carol")] }], defaults);
  assert.equal(r.length, 2);
  assert.ok(r.every((c) => c.channel === "works-carol"));
  assert.ok(r.every((c) => c.timezone === "Asia/Seoul"));
});

test("a brief disabled at the workspace (omitted default time) is skipped for all", () => {
  // registerUserBriefs omits a disabled brief's default time → resolveUserCrons skips it.
  const r = resolveUserCrons(
    [{ slug: "acme", users: [user("carol")] }],
    { tz: "Asia/Seoul", times: { "morning-brief": "08:00" } },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].cronId, "morning-brief");
});

test("a brief can be individually disabled; custom time wins", () => {
  const r = resolveUserCrons(
    [{ slug: "acme", users: [user("dave", { crons: { "morning-brief": { time: "06:30" }, "evening-brief": { enabled: false } } })] }],
    defaults,
  );
  assert.equal(r.length, 1, "evening disabled");
  assert.equal(r[0].cronId, "morning-brief");
  assert.equal(r[0].expr, "30 6 * * *"); // 06:30 → "30 6 * * *"
});

test("custom time produces the right cron expression", () => {
  const r = resolveUserCrons(
    [{ slug: "acme", users: [user("erin", { crons: { "morning-brief": { time: "06:30" } } })] }],
    defaults,
  );
  const m = r.find((c) => c.cronId === "morning-brief")!;
  assert.equal(m.expr, "30 6 * * *");
});

test("multiple orgs and users expand independently", () => {
  const r = resolveUserCrons(
    [
      { slug: "acme", users: [user("alice", { timezone: "Asia/Seoul" }), user("bob", {})] },
      { slug: "beta", users: [user("carol", { crons: { "evening-brief": {} } })] },
    ],
    defaults,
  );
  // v1.3.4: every user gets both briefs — alice 2 + bob 2 + carol 2 = 6.
  assert.equal(r.length, 6);
  assert.ok(r.some((c) => c.orgSlug === "beta" && c.handle === "carol"));
  assert.ok(r.some((c) => c.handle === "bob" && c.channel === "works-bob"));
});
