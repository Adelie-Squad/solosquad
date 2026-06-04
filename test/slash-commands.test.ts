import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSlash,
  handleSlashIfAny,
  KNOWN_SLASHES,
} from "../src/bot/slash-commands.js";

test("parseSlash returns null for non-slash input", () => {
  assert.equal(parseSlash("hello world"), null);
  assert.equal(parseSlash(""), null);
  assert.equal(parseSlash("  /think with leading spaces")?.command, "/think");
});

test("parseSlash splits command + args", () => {
  const r = parseSlash("/plan landing page redesign");
  assert.equal(r?.command, "/plan");
  assert.equal(r?.args, "landing page redesign");
});

test("parseSlash handles empty args", () => {
  const r = parseSlash("/build");
  assert.equal(r?.command, "/build");
  assert.equal(r?.args, "");
});

test("handleSlashIfAny passes natural language through unchanged", () => {
  const r = handleSlashIfAny("just a regular message");
  assert.equal(r.forwardText, "just a regular message");
  assert.equal(r.shortCircuit, undefined);
});

test("handleSlashIfAny wraps known slashes in [SLASH /xyz] marker", () => {
  const r = handleSlashIfAny("/plan landing page");
  assert.equal(r.forwardText, "[SLASH /plan] landing page");
  assert.equal(r.shortCircuit, undefined);
});

test("handleSlashIfAny short-circuits /help with usage text", () => {
  const r = handleSlashIfAny("/help");
  assert.equal(r.shortCircuit, true);
  assert.match(r.directReply!, /Slash commands/);
  assert.match(r.directReply!, /\/think/);
  assert.match(r.directReply!, /\/plan/);
});

test("handleSlashIfAny flags /cancel for bot-side abort (not forwarded to PM)", () => {
  const r = handleSlashIfAny("/cancel");
  assert.equal(r.cancel, true);
  assert.equal(r.shortCircuit, true);
  assert.equal(r.directReply, undefined);
});

test("handleSlashIfAny flags /grant + /revoke for bot-side dev toggle", () => {
  const g = handleSlashIfAny("/grant");
  assert.equal(g.grant, true);
  assert.equal(g.shortCircuit, true);
  const r = handleSlashIfAny("/revoke");
  assert.equal(r.grant, false);
  assert.equal(r.shortCircuit, true);
});

test("handleSlashIfAny rejects unknown slashes with a hint", () => {
  const r = handleSlashIfAny("/banana foo");
  assert.equal(r.shortCircuit, true);
  assert.match(r.directReply!, /Unknown command/);
  assert.match(r.directReply!, /\/help/);
});

test("KNOWN_SLASHES has exactly the 6 expected entries", () => {
  assert.deepEqual(
    [...KNOWN_SLASHES].sort(),
    ["/build", "/help", "/plan", "/review", "/ship", "/think"]
  );
});
