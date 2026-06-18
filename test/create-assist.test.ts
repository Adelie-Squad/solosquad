import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildAssistPrompt, stripFences, type AssistCaller } from "../src/bot/create-assist.js";
import { agentAddCommand } from "../src/cli/agent.js";

test("buildAssistPrompt: per-kind ask + brief, no fences requested", () => {
  const p = buildAssistPrompt({ kind: "schedule", name: "weekly-digest", brief: "summarize PRs" });
  assert.match(p, /SoloSquad schedule/);
  assert.match(p, /weekly-digest/);
  assert.match(p, /summarize PRs/);
  assert.match(p, /no code fences/i);
});

test("stripFences: removes a wrapping code fence", () => {
  assert.equal(stripFences("```md\n# Hi\nbody\n```"), "# Hi\nbody");
  assert.equal(stripFences("plain text"), "plain text");
  assert.equal(stripFences("```\nx\n```"), "x");
});

test("agent add --assist: valid draft is used (body from LLM, scaffold frontmatter)", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ss-assist-"));
  const caller: AssistCaller = {
    call_count: 0,
    async draft(input) {
      caller.call_count!++;
      return `# ${input.name}\n\n> drafted blurb\n\n## Process\n\n1. Do the thing\n\n## Inputs\n\n- x\n\n## Outputs\n\n- y`;
    },
  };
  const origLog = console.log;
  console.log = () => {};
  let skillPath = "";
  try {
    const r = await agentAddCommand({
      name: "draft-bot",
      team: "engineering",
      workspace: ws,
      skipRouterReload: true,
      assist: "an agent that drafts things",
      assistCaller: caller,
    });
    skillPath = r.skillPath;
  } finally {
    console.log = origLog;
  }
  assert.equal(caller.call_count, 1);
  const content = fs.readFileSync(skillPath, "utf-8");
  assert.match(content, /source: cli-scaffold-assisted/); // assisted frontmatter
  assert.match(content, /drafted blurb/); // LLM body landed
  assert.match(content, /name: "draft-bot"/); // scaffold frontmatter preserved
});

test("agent add --assist: unusable draft falls back to the plain scaffold", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ss-assist-fb-"));
  const caller: AssistCaller = { call_count: 0, async draft() { caller.call_count!++; return null; } };
  const origLog = console.log;
  console.log = () => {};
  let skillPath = "";
  try {
    const r = await agentAddCommand({
      name: "fallback-bot",
      team: "engineering",
      workspace: ws,
      skipRouterReload: true,
      assist: "whatever",
      assistCaller: caller,
    });
    skillPath = r.skillPath;
  } finally {
    console.log = origLog;
  }
  assert.equal(caller.call_count, 1);
  const content = fs.readFileSync(skillPath, "utf-8");
  assert.match(content, /source: cli-scaffold\b/); // plain scaffold, not assisted
  assert.match(content, /TODO: list required inputs/); // scaffold body
});
