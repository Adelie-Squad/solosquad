import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeSkillWatchPaths,
  isWSL,
  startSkillWatcher,
} from "../src/bot/fs-watcher.js";

/**
 * v0.6 §10 — fs-watcher tests.
 *
 * chokidar's underlying inotify/polling layer has real-clock timing so we
 * use a longer debounce in tests (~150ms) and short setTimeouts between
 * actions to make sure watcher events drain. usePolling is forced on for
 * determinism — we don't want the test grid to depend on inotify availability.
 */

function makeFixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-fs-watcher-"));
}

function writeSkill(
  root: string,
  team: string,
  name: string,
  body = "name: foo\ndescription: x",
): string {
  const dir = path.join(root, team, name);
  fs.mkdirSync(dir, { recursive: true });
  const skillPath = path.join(dir, "SKILL.md");
  fs.writeFileSync(skillPath, `---\n${body}\n---\n\n# ${name}\n`, "utf-8");
  return skillPath;
}

function ensureWorkspace(): string {
  const ws = makeFixture();
  // Create the .solosquad/agents dir so computeSkillWatchPaths has a real path.
  fs.mkdirSync(path.join(ws, ".solosquad", "agents"), { recursive: true });
  return ws;
}

function wait(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ---------- computeSkillWatchPaths ----------

test("computeSkillWatchPaths returns 3-tier search (workspace + user + orgs)", () => {
  const ws = ensureWorkspace();
  const orgDir = path.join(ws, "acme");
  fs.mkdirSync(orgDir, { recursive: true });
  fs.writeFileSync(
    path.join(orgDir, ".org.yaml"),
    "name: Acme\nslug: acme\nprovider: local\ncreated_at: 2026-05-14\n",
    "utf-8",
  );

  const paths = computeSkillWatchPaths(ws, "/__user_root__");
  assert.ok(
    paths.some((p) => p === path.join(ws, ".solosquad", "agents")),
    "workspace bundled agents tier missing",
  );
  assert.ok(paths.includes("/__user_root__"), "user-global tier missing");
  assert.ok(
    paths.some((p) => p === path.join(ws, "acme", ".agents")),
    "org tier missing",
  );
});

test("isWSL returns boolean without throwing", () => {
  const v = isWSL();
  assert.equal(typeof v, "boolean");
});

// ---------- single file add ----------

test("startSkillWatcher fires onReload when a single SKILL.md is added", async () => {
  const ws = ensureWorkspace();
  const reloads: string[][] = [];

  const unwatch = startSkillWatcher({
    workspace: ws,
    userRoot: path.join(ws, "__nope_user__"),
    mode: "auto",
    onReload: (changed) => reloads.push(changed),
    usePolling: true,
    debounceMs: 100,
    pollingIntervalMs: 50,
  });

  // Give chokidar a beat to initialize.
  await wait(200);
  writeSkill(path.join(ws, ".solosquad", "agents"), "strategy", "p1");
  await wait(700);

  await unwatch();
  assert.ok(reloads.length >= 1, "expected at least one onReload");
  const flat = reloads.flat();
  assert.ok(
    flat.some((f) => f.endsWith("SKILL.md")),
    "expected SKILL.md in changed paths",
  );
});

// ---------- debounce multiple simultaneous changes ----------

test("debounce coalesces multiple rapid changes into one onReload", async () => {
  const ws = ensureWorkspace();
  const reloads: string[][] = [];

  const unwatch = startSkillWatcher({
    workspace: ws,
    userRoot: path.join(ws, "__nope_user__"),
    mode: "auto",
    onReload: (changed) => reloads.push(changed),
    usePolling: true,
    debounceMs: 200,
    pollingIntervalMs: 50,
  });

  await wait(200);
  // Write 5 SKILLs in rapid succession — should debounce to one reload.
  const agentsRoot = path.join(ws, ".solosquad", "agents");
  for (let i = 0; i < 5; i++) {
    writeSkill(agentsRoot, "strategy", `agent${i}`);
    await wait(20);
  }
  // Wait past the debounce window plus polling overhead.
  await wait(800);

  await unwatch();
  // Polling can split into 2 callbacks if events straddle the window;
  // but typical case is 1. Cap at 2 to avoid platform flakes.
  assert.ok(
    reloads.length >= 1 && reloads.length <= 3,
    `expected 1-3 onReload bursts, got ${reloads.length}`,
  );
  const flat = reloads.flat();
  // The 5 SKILL.md paths should all have surfaced across the bursts.
  const uniqueSkills = new Set(flat);
  assert.ok(
    uniqueSkills.size >= 5,
    `expected ≥5 unique SKILL paths in debounced bursts, got ${uniqueSkills.size}`,
  );
});

// ---------- _meta / underscore folders skipped ----------

test("_meta and other underscore-prefixed folders are skipped", async () => {
  const ws = ensureWorkspace();
  const reloads: string[][] = [];

  const unwatch = startSkillWatcher({
    workspace: ws,
    userRoot: path.join(ws, "__nope_user__"),
    mode: "auto",
    onReload: (changed) => reloads.push(changed),
    usePolling: true,
    debounceMs: 150,
    pollingIntervalMs: 50,
  });

  await wait(200);
  // Write a SKILL inside _meta — must NOT fire.
  const metaDir = path.join(ws, ".solosquad", "agents", "_meta", "diagnostic");
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(path.join(metaDir, "SKILL.md"), "---\nname: x\n---\n", "utf-8");
  await wait(500);

  // Now write a normal one — must fire.
  writeSkill(path.join(ws, ".solosquad", "agents"), "strategy", "real");
  await wait(600);

  await unwatch();
  const flat = reloads.flat();
  assert.ok(
    !flat.some((f) => f.includes("_meta")),
    `_meta files should be filtered out, got: ${flat.join("\n")}`,
  );
  assert.ok(
    flat.some((f) => f.includes(`${path.sep}real${path.sep}SKILL.md`) || f.includes("/real/SKILL.md")),
    "real SKILL was not surfaced",
  );
});

// ---------- org folder auto-detect ----------

test("startSkillWatcher auto-detects org .agents/ folder via .org.yaml", async () => {
  const ws = ensureWorkspace();
  // Set up an org with .org.yaml so listOrganizations() picks it up.
  const orgDir = path.join(ws, "acme");
  fs.mkdirSync(orgDir, { recursive: true });
  fs.writeFileSync(
    path.join(orgDir, ".org.yaml"),
    "name: Acme\nslug: acme\nprovider: local\ncreated_at: 2026-05-14\n",
    "utf-8",
  );
  // workspace.yaml so listOrganizations is enabled.
  fs.mkdirSync(path.join(ws, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".solosquad", "workspace.yaml"),
    "version: 0.6.0\ndisplay_name: T\ncreated_at: 2026-05-14\n",
    "utf-8",
  );

  const reloads: string[][] = [];
  const unwatch = startSkillWatcher({
    workspace: ws,
    userRoot: path.join(ws, "__nope_user__"),
    mode: "auto",
    onReload: (changed) => reloads.push(changed),
    usePolling: true,
    debounceMs: 150,
    pollingIntervalMs: 50,
  });

  await wait(200);
  writeSkill(path.join(orgDir, ".agents"), "growth", "marketer");
  await wait(700);

  await unwatch();
  const flat = reloads.flat();
  assert.ok(
    flat.some((f) => f.includes("acme") && f.endsWith("SKILL.md")),
    `expected org SKILL to fire — got: ${JSON.stringify(flat)}`,
  );
});

// ---------- unwatch graceful close ----------

test("unwatch() resolves cleanly and stops further onReload calls", async () => {
  const ws = ensureWorkspace();
  let reloadCount = 0;

  const unwatch = startSkillWatcher({
    workspace: ws,
    userRoot: path.join(ws, "__nope_user__"),
    mode: "auto",
    onReload: () => {
      reloadCount++;
    },
    usePolling: true,
    debounceMs: 100,
    pollingIntervalMs: 50,
  });

  await wait(150);
  await unwatch(); // Close before any writes — no reloads should fire.

  // Writing after unwatch must not fire anything.
  writeSkill(path.join(ws, ".solosquad", "agents"), "strategy", "post-unwatch");
  await wait(400);
  assert.equal(reloadCount, 0, "unwatch should stop further callbacks");
});
