import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { rotateArchive } from "../src/memory/archive-rotate.js";
import { getStats } from "../src/memory/archive-search.js";
import { recordRouteHit, recordRouteMiss } from "../src/memory/route-event-sink.js";

/**
 * v0.6 §4.7 — getStats() drives `solosquad memory stats [--disk]`.
 */

function makeWorkspace(): { workspace: string; orgSlug: string; memoryDir: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-arch-stats-"));
  const orgSlug = "demo";
  const memoryDir = path.join(workspace, orgSlug, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  return { workspace, orgSlug, memoryDir };
}

test("getStats: empty archive returns zero counts + null timestamps", () => {
  const { workspace, orgSlug } = makeWorkspace();
  const stats = getStats({ workspace, orgSlug });
  assert.equal(stats.totalRows, 0);
  assert.equal(stats.oldestIso, null);
  assert.equal(stats.newestIso, null);
  assert.deepEqual(stats.perEventType, {});
  assert.equal(stats.diskBytes, 0);
});

test("getStats: perEventType counts each kind + oldest/newest reflect data", () => {
  const { workspace, orgSlug } = makeWorkspace();
  recordRouteHit({
    workspace,
    orgSlug,
    now: "2024-01-01T00:00:00.000Z",
    message: "first hit",
    agent: "x",
    team: "strategy",
    channel: "keyword",
    matched: "x",
  });
  recordRouteHit({
    workspace,
    orgSlug,
    now: "2024-06-15T00:00:00.000Z",
    message: "mid hit",
    agent: "x",
    team: "strategy",
    channel: "keyword",
    matched: "x",
  });
  recordRouteMiss({
    workspace,
    orgSlug,
    now: "2024-03-10T00:00:00.000Z",
    message: "missed it",
  });
  rotateArchive({ workspace, orgSlug, now: "2026-05-14T00:00:00.000Z", retentionDays: 10_000 });

  const stats = getStats({ workspace, orgSlug });
  assert.equal(stats.totalRows, 3);
  assert.equal(stats.perEventType.route_hit, 2);
  assert.equal(stats.perEventType.route_miss, 1);
  assert.ok(stats.oldestIso && stats.oldestIso.startsWith("2024-01-01"));
  assert.ok(stats.newestIso && stats.newestIso.startsWith("2024-06-15"));
});

test("getStats: diskBytes reflects the SQLite file size (non-zero after rotate)", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  const file = path.join(memoryDir, "signals.jsonl");
  fs.writeFileSync(
    file,
    [
      { timestamp: "2024-01-01T00:00:00.000Z", content: "row 1" },
      { timestamp: "2024-02-01T00:00:00.000Z", content: "row 2" },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
    "utf-8"
  );
  rotateArchive({ workspace, orgSlug, now: "2026-05-14T00:00:00.000Z", retentionDays: 10_000 });

  const stats = getStats({ workspace, orgSlug });
  assert.ok(stats.diskBytes > 0, "archive.sqlite should have non-zero size after rotation");
  assert.equal(stats.totalRows, 2);
});
