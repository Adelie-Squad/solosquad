import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  encodeCwdForClaudeCode,
  readLastAssistantTurn,
  sessionJsonlPath,
} from "../src/bot/cc-jsonl-reader.js";

function tempJsonl(lines: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-ccjsonl-"));
  const p = path.join(dir, "test.jsonl");
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  return p;
}

test("encodeCwdForClaudeCode replaces / \\ : with -", () => {
  assert.equal(encodeCwdForClaudeCode("C:/Dev/foo"), "C--Dev-foo");
  assert.equal(encodeCwdForClaudeCode("/home/user/x"), "-home-user-x");
  assert.equal(encodeCwdForClaudeCode("C:\\Users\\me\\proj"), "C--Users-me-proj");
});

test("sessionJsonlPath composes ~/.claude/projects/<cwd>/<sid>.jsonl", () => {
  const p = sessionJsonlPath("/home/user/ws", "abc-123");
  assert.match(p, /\.claude[\\/]projects[\\/]-home-user-ws[\\/]abc-123\.jsonl$/);
});

test("readLastAssistantTurn returns null for missing file", () => {
  const result = readLastAssistantTurn("/no/such/file.jsonl");
  assert.equal(result, null);
});

test("readLastAssistantTurn extracts the last assistant text", () => {
  const p = tempJsonl([
    { type: "queue-operation", operation: "enqueue" },
    { type: "user", message: { role: "user", content: "hi" } },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "First reply" }],
        stop_reason: "end_turn",
      },
      uuid: "u1",
      timestamp: "2026-05-12T10:00:00Z",
    },
    { type: "user", message: { role: "user", content: "follow-up" } },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Second reply, the latest one" }],
        stop_reason: "end_turn",
      },
      uuid: "u2",
      timestamp: "2026-05-12T10:01:00Z",
    },
  ]);
  const result = readLastAssistantTurn(p);
  assert.ok(result);
  assert.equal(result!.text, "Second reply, the latest one");
  assert.equal(result!.uuid, "u2");
  assert.equal(result!.stopReason, "end_turn");
});

test("readLastAssistantTurn skips assistant messages without text content", () => {
  const p = tempJsonl([
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Earlier text reply" }],
        stop_reason: "end_turn",
      },
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
        stop_reason: "tool_use",
      },
    },
  ]);
  const result = readLastAssistantTurn(p);
  assert.ok(result);
  assert.equal(result!.text, "Earlier text reply");
});

test("readLastAssistantTurn returns null when no assistant turns exist", () => {
  const p = tempJsonl([
    { type: "user", message: { role: "user", content: "hello" } },
    { type: "queue-operation", operation: "dequeue" },
  ]);
  assert.equal(readLastAssistantTurn(p), null);
});

test("readLastAssistantTurn survives a corrupt line in the middle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-ccjsonl-corrupt-"));
  const p = path.join(dir, "test.jsonl");
  fs.writeFileSync(
    p,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
      "this is not json",
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Still works" }],
          stop_reason: "end_turn",
        },
      }),
    ].join("\n"),
    "utf-8"
  );
  const result = readLastAssistantTurn(p);
  assert.equal(result?.text, "Still works");
});
