import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  diffAgainstScan,
  emptyLedger,
  loadLedger,
  makeEntry,
  mergeLedger,
  saveLedger,
  PENDING_KEY,
  getPendingV06,
  setPendingV06,
  pendingV06ForLabel,
  type Ledger,
} from "../src/analyze/ledger.js";
import type { ScannedSkill } from "../src/analyze/scanner.js";

function scan(path: string, hash: string): ScannedSkill {
  return { path, hash, size_bytes: 100, mtime_iso: "2026-05-14T00:00:00.000Z" };
}

test("ledger save/load round-trip preserves all fields including pending_v0.6_redestination", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ledger-"));
  try {
    const lp = path.join(dir, "ledger.yaml");
    const led = emptyLedger("opus-test");
    led.analyzed.push(
      makeEntry(scan(".claude/skills/role.md", "abc123"), "role", 0.84, "<dest>")
    );
    led.analyzed.push(
      makeEntry(
        scan(".claude/skills/deploy.md", "def456"),
        "codebase-fact",
        0.92,
        "(repo)"
      )
    );
    saveLedger(lp, led);
    const loaded = loadLedger(lp);
    assert.ok(loaded);
    assert.equal(loaded!.analyzed.length, 2);
    const role = loaded!.analyzed.find((e) => e.classification === "role");
    const fact = loaded!.analyzed.find(
      (e) => e.classification === "codebase-fact"
    );
    assert.ok(role && fact);
    assert.equal(getPendingV06(role), true);
    assert.equal(getPendingV06(fact), false);
    assert.equal(loaded!.model.fingerprint, "opus-test");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ledger pending flag is true only for role and domain labels", () => {
  assert.equal(pendingV06ForLabel("role"), true);
  assert.equal(pendingV06ForLabel("domain"), true);
  assert.equal(pendingV06ForLabel("workflow"), false);
  assert.equal(pendingV06ForLabel("codebase-fact"), false);
});

test("ledger setPendingV06 writes under the dotted key for v0.6 migrator", () => {
  const entry = makeEntry(
    scan(".claude/skills/x.md", "x"),
    "workflow",
    0.9,
    "<org>/workflows/"
  );
  // workflow → starts false
  assert.equal(getPendingV06(entry), false);
  setPendingV06(entry, true);
  assert.equal(entry[PENDING_KEY], true);
});

test("ledger diff: empty previous → all scanned land in new_files", () => {
  const scanned = [scan("a.md", "h1"), scan("b.md", "h2")];
  const diff = diffAgainstScan(null, scanned);
  assert.equal(diff.new_files.length, 2);
  assert.equal(diff.modified.length, 0);
  assert.equal(diff.unchanged.length, 0);
  assert.equal(diff.removed.length, 0);
});

test("ledger diff: hash match → unchanged; hash diff → modified; vanished → removed", () => {
  const led: Ledger = emptyLedger("m");
  led.analyzed.push(
    makeEntry(scan("a.md", "h1"), "role", 0.9, "")
  );
  led.analyzed.push(
    makeEntry(scan("b.md", "h2"), "workflow", 0.9, "")
  );
  led.analyzed.push(
    makeEntry(scan("c.md", "h3"), "domain", 0.9, "")
  );
  const scanned = [
    scan("a.md", "h1"), // unchanged
    scan("b.md", "h2_new"), // modified
    // c.md vanished
    scan("d.md", "h4"), // new
  ];
  const diff = diffAgainstScan(led, scanned);
  assert.equal(diff.unchanged.length, 1);
  assert.equal(diff.unchanged[0].path, "a.md");
  assert.equal(diff.modified.length, 1);
  assert.equal(diff.modified[0].entry.path, "b.md");
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].path, "c.md");
  assert.equal(diff.new_files.length, 1);
  assert.equal(diff.new_files[0].path, "d.md");
});

test("mergeLedger keeps unchanged, swaps in fresh, drops removed when prune_orphans=true", () => {
  const led: Ledger = emptyLedger("m");
  led.analyzed.push(
    makeEntry(scan("a.md", "h1"), "role", 0.9, "")
  );
  led.analyzed.push(
    makeEntry(scan("b.md", "h2"), "workflow", 0.9, "")
  );
  const scanned = [scan("a.md", "h1"), scan("d.md", "h4")];
  const diff = diffAgainstScan(led, scanned);
  const fresh = [makeEntry(scan("d.md", "h4"), "domain", 0.85, "")];
  const merged = mergeLedger(led, diff, fresh, "m", { prune_orphans: true });
  // Should have a.md (unchanged) + d.md (fresh). b.md removed.
  assert.equal(merged.analyzed.length, 2);
  const names = merged.analyzed.map((e) => e.path).sort();
  assert.deepEqual(names, ["a.md", "d.md"]);
  const dEntry = merged.analyzed.find((e) => e.path === "d.md");
  assert.ok(dEntry);
  assert.equal(getPendingV06(dEntry), true);
});

test("mergeLedger without prune_orphans keeps removed entries for audit", () => {
  const led: Ledger = emptyLedger("m");
  led.analyzed.push(
    makeEntry(scan("a.md", "h1"), "role", 0.9, "")
  );
  const diff = diffAgainstScan(led, []);
  const merged = mergeLedger(led, diff, [], "m");
  assert.equal(merged.analyzed.length, 1);
  assert.equal(merged.analyzed[0].path, "a.md");
});
