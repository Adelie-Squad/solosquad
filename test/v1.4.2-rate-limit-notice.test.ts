import { test } from "node:test";
import assert from "node:assert/strict";

import { RateLimitNotifier } from "../src/bot/rate-limit-notice.js";

/**
 * v1.4.2 — rate-limit notice de-dupe. A `warning` (approaching limit) must be
 * announced once per reset window, not on every reply; `exceeded` is urgent.
 */

test("no rate-limit info → silent", () => {
  const n = new RateLimitNotifier();
  assert.equal(n.decide("U1", undefined), null);
});

test("warning is announced once per reset window, then silent", () => {
  const n = new RateLimitNotifier();
  const first = n.decide("U1", { status: "warning", resetsAt: 1000 });
  assert.match(first ?? "", /근접/);
  // same window → suppressed on subsequent turns
  assert.equal(n.decide("U1", { status: "warning", resetsAt: 1000 }), null);
  assert.equal(n.decide("U1", { status: "warning", resetsAt: 1000 }), null);
});

test("a new reset window re-announces the warning", () => {
  const n = new RateLimitNotifier();
  assert.ok(n.decide("U1", { status: "warning", resetsAt: 1000 }));
  assert.equal(n.decide("U1", { status: "warning", resetsAt: 1000 }), null);
  // window rolled over → announce again
  assert.ok(n.decide("U1", { status: "warning", resetsAt: 2000 }));
});

test("warning → exceeded transition re-announces (different severity)", () => {
  const n = new RateLimitNotifier();
  assert.match(n.decide("U1", { status: "warning", resetsAt: 1000 }) ?? "", /근접/);
  const exceeded = n.decide("U1", { status: "exceeded", resetsAt: 1000 });
  assert.match(exceeded ?? "", /초과/);
  // repeated exceeded same window → suppressed
  assert.equal(n.decide("U1", { status: "exceeded", resetsAt: 1000 }), null);
});

test("de-dupe is per user", () => {
  const n = new RateLimitNotifier();
  assert.ok(n.decide("U1", { status: "warning", resetsAt: 1000 }));
  // a different user still gets their first notice for the same window
  assert.ok(n.decide("U2", { status: "warning", resetsAt: 1000 }));
});
