import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionStore } from "../src/bot/session-store.js";
import { archiveOrgChiefSessions } from "../src/migrations/archive-sessions.js";

/**
 * v1.4.0 (§5.7) — spawn-change migration session reset helper.
 *
 * archiveOrgChiefSessions rotates every org's Chief session (clean slate for
 * spawn-affecting releases). Guards: every session-id changes, the old id is
 * archived with the reason, cumulative cost is preserved, and it spans all orgs.
 */

function makeWorkspace(orgs: string[]): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-archive-"));
  for (const org of orgs) {
    const orgDir = path.join(ws, org);
    fs.mkdirSync(orgDir, { recursive: true });
    // listOrganizations() requires a .org.yaml per org dir.
    fs.writeFileSync(
      path.join(orgDir, ".org.yaml"),
      `slug: ${org}\nname: ${org}\ncreated_at: 2026-06-27T00:00:00Z\n`,
      "utf-8",
    );
  }
  return ws;
}

test("§5.7 — rotates every Chief session across all orgs, preserving cost", () => {
  const ws = makeWorkspace(["acme", "globex"]);
  const store = new SessionStore(ws);

  // Seed sessions with a known id + accumulated cost.
  store.write({
    userId: "U1", orgSlug: "acme", sessionId: "old-acme-u1",
    createdAt: "2026-06-01T00:00:00Z", lastInteractionAt: "2026-06-26T00:00:00Z",
    totalCostUsd: 1.23,
  });
  store.write({
    userId: "U2", orgSlug: "globex", sessionId: "old-globex-u2",
    createdAt: "2026-06-01T00:00:00Z", lastInteractionAt: "2026-06-26T00:00:00Z",
    totalCostUsd: 4.56,
  });

  const rotated = archiveOrgChiefSessions(ws, "post-v9.9.9-spawn-change");

  assert.equal(rotated.length, 2, "one rotation per (org,user) session");

  const acme = store.read("acme", "U1")!;
  assert.notEqual(acme.sessionId, "old-acme-u1", "session-id must change");
  assert.equal(acme.totalCostUsd, 1.23, "cumulative cost is preserved");
  assert.ok(
    acme.archived?.some((a) => a.sessionId === "old-acme-u1" && a.reason === "post-v9.9.9-spawn-change"),
    "old id archived with the reason",
  );

  const globex = store.read("globex", "U2")!;
  assert.notEqual(globex.sessionId, "old-globex-u2");
  assert.equal(globex.totalCostUsd, 4.56);
});

test("§5.7 — no sessions → no-op (safe on a fresh workspace)", () => {
  const ws = makeWorkspace(["acme"]);
  const rotated = archiveOrgChiefSessions(ws, "reason");
  assert.deepEqual(rotated, []);
});
