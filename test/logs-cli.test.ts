import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseSinceHuman, LOG_TYPES } from "../src/cli/logs.js";

/**
 * v0.8.3 §5.2 — `solosquad logs` CLI tests.
 *
 * The CLI itself bootstraps a workspace + writes to stdout, so most of
 * the surface gets exercised via parseSinceHuman + LOG_TYPES alongside
 * the indirect logger.test.ts coverage. End-to-end exec tests live in
 * the integration harness (out of scope here).
 */

test("LOG_TYPES contains the v0.8.3 §5.2 type whitelist", () => {
  assert.deepEqual(
    [...LOG_TYPES].sort(),
    ["costs", "dev-confirm", "migration", "runtime", "spawn", "stop-hook"],
  );
});

test("parseSinceHuman accepts ISO timestamps", () => {
  const t = parseSinceHuman("2026-05-15T00:00:00Z");
  assert.ok(t !== null);
  assert.equal(typeof t, "number");
});

test("parseSinceHuman handles '1 hour ago' / '30 minutes ago' / '2 days ago'", () => {
  const now = Date.now();
  const oneHour = parseSinceHuman("1 hour ago");
  const thirtyMin = parseSinceHuman("30 minutes ago");
  const twoDays = parseSinceHuman("2 days ago");
  assert.ok(oneHour !== null);
  assert.ok(thirtyMin !== null);
  assert.ok(twoDays !== null);
  assert.ok(Math.abs((now - 3_600_000) - oneHour!) < 5_000);
  assert.ok(Math.abs((now - 1_800_000) - thirtyMin!) < 5_000);
  assert.ok(Math.abs((now - 2 * 86_400_000) - twoDays!) < 5_000);
});

test("parseSinceHuman returns null for unparseable input", () => {
  assert.equal(parseSinceHuman("yesterdayish"), null);
  assert.equal(parseSinceHuman("foo"), null);
});

test("parseSinceHuman handles 'weeks ago' too", () => {
  const t = parseSinceHuman("3 weeks ago");
  assert.ok(t !== null);
  const expected = Date.now() - 3 * 7 * 86_400_000;
  assert.ok(Math.abs(expected - t!) < 5_000);
});

/**
 * Integration sketch: create a tmp workspace with both runtime + costs
 * jsonl, then assert that logsCommand exits zero and prints lines that
 * include the expected source label. We do not assert full ordering
 * because the order of iteration over sources is platform-dependent.
 */
test("logs CLI tolerates a tmp workspace with empty memory dirs", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ss-logs-cli-"));
  try {
    fs.mkdirSync(path.join(ws, ".solosquad"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".solosquad", "workspace.yaml"),
      "version: 0.8.3\ndisplay_name: test\ncreated_at: 2026-05-15T00:00:00Z\n",
    );
    // No orgs registered — listOrganizations() returns []. The runtime
    // dir is also missing, so the command should fall through to the
    // "No log files found" branch.
    const prevCwd = process.cwd();
    process.chdir(ws);
    try {
      const cap: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => cap.push(args.map(String).join(" "));
      try {
        const { logsCommand } = await import("../src/cli/logs.js");
        await logsCommand({ type: ["runtime"] });
        assert.ok(cap.some((l) => l.includes("No log files found")));
      } finally {
        console.log = origLog;
      }
    } finally {
      process.chdir(prevCwd);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
