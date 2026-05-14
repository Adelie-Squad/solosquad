import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { rotateArchive } from "../src/memory/archive-rotate.js";
import { searchArchive, sanitizeFts5Query } from "../src/memory/archive-search.js";

/**
 * v0.6 §4.3 — FTS5 search precision + ranking + event_type filter.
 */

function makeWorkspace(): { workspace: string; orgSlug: string; memoryDir: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-arch-search-"));
  const orgSlug = "demo";
  const memoryDir = path.join(workspace, orgSlug, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  return { workspace, orgSlug, memoryDir };
}

function seedAndRotate(memoryDir: string, workspace: string, orgSlug: string): void {
  const file = path.join(memoryDir, "decisions.jsonl");
  fs.writeFileSync(
    file,
    [
      { timestamp: "2024-01-01T00:00:00.000Z", content: "decided to launch PMF survey" },
      { timestamp: "2024-02-01T00:00:00.000Z", content: "rejected pricing experiment" },
      { timestamp: "2024-03-01T00:00:00.000Z", content: "pivoted away from PMF survey path", event_type: "spawn_decision" },
      { timestamp: "2024-04-01T00:00:00.000Z", content: "kicked off onboarding redesign", event_type: "route_miss" },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
    "utf-8"
  );
  rotateArchive({ workspace, orgSlug, now: "2026-05-14T00:00:00.000Z", retentionDays: 10_000 });
}

test("searchArchive: matches by full-text query and returns expected rows", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  seedAndRotate(memoryDir, workspace, orgSlug);

  const hits = searchArchive({ workspace, orgSlug, query: "PMF survey" });
  assert.ok(hits.length >= 2);
  for (const h of hits) {
    assert.match(h.snippet, /PMF|survey/i);
  }
});

test("searchArchive: results are ordered by FTS5 rank (lower = better)", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  seedAndRotate(memoryDir, workspace, orgSlug);

  const hits = searchArchive({ workspace, orgSlug, query: "PMF survey", limit: 5 });
  assert.ok(hits.length >= 2);
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i].rank >= hits[i - 1].rank, "rank must be non-decreasing");
  }
});

test("searchArchive: event_type filter restricts to matching rows", () => {
  const { workspace, orgSlug, memoryDir } = makeWorkspace();
  seedAndRotate(memoryDir, workspace, orgSlug);

  const allHits = searchArchive({ workspace, orgSlug, query: "pivoted onboarding" });
  const filtered = searchArchive({
    workspace,
    orgSlug,
    query: "pivoted onboarding",
    eventType: "spawn_decision",
  });
  assert.ok(allHits.length >= filtered.length);
  for (const h of filtered) {
    assert.equal(h.event_type, "spawn_decision");
  }
});

test("searchArchive: returns [] for archive that does not exist yet", () => {
  const { workspace, orgSlug } = makeWorkspace();
  const hits = searchArchive({ workspace, orgSlug, query: "anything" });
  assert.deepEqual(hits, []);
});

test("sanitizeFts5Query: strips quotes + control chars, tokenizes safely", () => {
  // Bare token list — joined with OR + quoted to make them literal.
  assert.equal(sanitizeFts5Query("PMF survey"), '"PMF" OR "survey"');
  assert.equal(sanitizeFts5Query('"strange" \\input'), '"strange" OR "input"');
  // Single short token below 2 chars is dropped (FTS5 fragility).
  assert.equal(sanitizeFts5Query("a"), "");
});
