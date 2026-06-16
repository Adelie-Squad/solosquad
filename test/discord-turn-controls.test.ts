import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildStopButtonId,
  parseStopButtonId,
} from "../src/messenger/discord-turn-controls.js";

test("buildStopButtonId / parseStopButtonId round-trip", () => {
  const id = buildStopButtonId("acme-corp", "1234567890");
  assert.equal(id, "chief:stop:acme-corp:1234567890");
  assert.deepEqual(parseStopButtonId(id), {
    orgSlug: "acme-corp",
    userId: "1234567890",
  });
});

test("parseStopButtonId — userId is split on the LAST colon (slug-safe)", () => {
  // Defensive: even if a slug ever contained a colon, the snowflake userId
  // (always the trailing segment) is recovered correctly.
  assert.deepEqual(parseStopButtonId("chief:stop:weird:slug:999"), {
    orgSlug: "weird:slug",
    userId: "999",
  });
});

test("parseStopButtonId — returns null for other handlers' customIds", () => {
  assert.equal(parseStopButtonId("chief:onboard:auto"), null);
  assert.equal(parseStopButtonId("chief:onboard:manual"), null);
  assert.equal(parseStopButtonId("something-else"), null);
});

test("parseStopButtonId — returns null when org or user segment is empty", () => {
  assert.equal(parseStopButtonId("chief:stop:"), null);
  assert.equal(parseStopButtonId("chief:stop:onlyorg"), null);
  assert.equal(parseStopButtonId("chief:stop::1234"), null);
  assert.equal(parseStopButtonId("chief:stop:org:"), null);
});
