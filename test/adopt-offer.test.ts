import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { offerAdoption } from "../src/cli/adopt-offer.js";

function tempRepoWithAssets(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-offer-"));
  const w = (rel: string, body: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  w(".claude/skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: does a thing\nschema_version: 1\n---\n# x");
  return dir;
}

test("offerAdoption: non-TTY → prints hint, never prompts, writes nothing", async () => {
  const repo = tempRepoWithAssets();
  const before = JSON.stringify(fs.readdirSync(repo));
  const lines: string[] = [];
  const origLog = console.log;
  const prevTTY = process.stdin.isTTY;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  // force non-interactive
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  try {
    await offerAdoption(repo);
  } finally {
    console.log = origLog;
    Object.defineProperty(process.stdin, "isTTY", { value: prevTTY, configurable: true });
  }
  const out = lines.join("\n");
  assert.match(out, /adoptable asset/);
  assert.match(out, /solosquad adopt/); // the hint
  assert.equal(JSON.stringify(fs.readdirSync(repo)), before, "no files written to the repo");
});

test("offerAdoption: empty repo → silent (no output)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-offer-empty-"));
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await offerAdoption(dir);
  } finally {
    console.log = origLog;
  }
  assert.equal(lines.length, 0);
});
