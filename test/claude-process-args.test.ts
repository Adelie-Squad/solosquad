import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildArgs,
  inputLineToText,
  singleUserMessage,
  type ClaudeInvocation,
} from "../src/bot/claude-process.js";

/**
 * v1.3.10 §3.1 — regression guard for the claude-code `--add-dir` /
 * `--input-format stream-json` incompatibility. Claude Code 2.1.x silently
 * ignores `--add-dir` when input arrives as stream-json over stdin, so the bot
 * must NOT pass `--input-format stream-json` and must feed the message as plain
 * text. These tests pin both invariants so a future edit can't reintroduce the
 * bug that blocked Chief from reading registered external repos.
 */

function baseInv(overrides: Partial<ClaudeInvocation> = {}): ClaudeInvocation {
  return {
    sessionId: "11111111-1111-1111-1111-111111111111",
    cwd: "/ws/org",
    resume: true,
    input: singleUserMessage("hi"),
    ...overrides,
  };
}

test("buildArgs never passes --input-format stream-json (would void --add-dir)", () => {
  const args = buildArgs(baseInv({ addDirs: ["/repos/a", "/repos/b"] }));
  assert.equal(args.includes("--input-format"), false, "must not set --input-format");
});

test("buildArgs keeps --output-format stream-json for live output streaming", () => {
  const args = buildArgs(baseInv());
  const i = args.indexOf("--output-format");
  assert.ok(i >= 0 && args[i + 1] === "stream-json", "output stays stream-json");
});

test("buildArgs emits --add-dir with every registered path", () => {
  const args = buildArgs(baseInv({ addDirs: ["C:\\Dev\\a", "C:\\Dev\\b"] }));
  const i = args.indexOf("--add-dir");
  assert.ok(i >= 0, "--add-dir present");
  assert.equal(args[i + 1], "C:\\Dev\\a");
  assert.equal(args[i + 2], "C:\\Dev\\b");
});

test("buildArgs uses --append-system-prompt-file (not inline) so newlines stay off the cmd line", () => {
  const args = buildArgs(
    baseInv({ appendSystemPrompt: "line1\n\nline2", addDirs: ["C:\\Dev\\a"] }),
    "C:\\tmp\\sysprompt.txt",
  );
  assert.equal(args.includes("--append-system-prompt"), false, "no inline multi-line prompt");
  const i = args.indexOf("--append-system-prompt-file");
  assert.ok(i >= 0, "uses --append-system-prompt-file");
  assert.equal(args[i + 1], "C:\\tmp\\sysprompt.txt");
  // --add-dir must still be emitted (it follows the prompt in the arg order)
  assert.ok(args.includes("--add-dir"), "--add-dir survives alongside the prompt file");
});

test("buildArgs falls back to inline --append-system-prompt when no file is given", () => {
  const args = buildArgs(baseInv({ appendSystemPrompt: "hi" }));
  const i = args.indexOf("--append-system-prompt");
  assert.ok(i >= 0 && args[i + 1] === "hi");
});

test("inputLineToText renders string content as plain text (no JSON wrapper)", async () => {
  for await (const line of singleUserMessage("read the readme")) {
    const text = inputLineToText(line);
    assert.equal(text, "read the readme");
    assert.equal(text.includes("{"), false, "must not be JSON-stringified");
  }
});

test("inputLineToText concatenates text blocks for array content", () => {
  const text = inputLineToText({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    },
  });
  assert.equal(text, "ab");
});
