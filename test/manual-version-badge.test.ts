import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inspect, rewrite, readVersion } from "../scripts/sync-manual-version.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const badge = (v: string) =>
  `<h1>SoloSquad <span style="font-size: 0.6em; color: #64748b; font-weight: 400;">v${v}</span></h1>`;

test("badge matching v1.4.3 is ok", () => {
  assert.deepEqual(inspect(badge("1.4.3"), "1.4.3"), { status: "ok" });
});

test("stale badge is reported as drift with the found version", () => {
  assert.deepEqual(inspect(badge("1.2.9"), "1.4.3"), {
    status: "drift",
    found: "1.2.9",
  });
});

test("absent badge is reported as missing", () => {
  assert.deepEqual(inspect("<h1>SoloSquad</h1>", "1.4.3"), {
    status: "missing",
  });
});

test("rewrite updates the badge and leaves in-body feature badges alone", () => {
  const html = [
    badge("1.2.9"),
    `<li>Application ID <span class="badge now">v1.2.9</span> — auto-detected.</li>`,
  ].join("\n");
  const out = rewrite(html, "1.4.3");
  assert.ok(out.includes(badge("1.4.3")), "sidebar badge bumped");
  assert.ok(
    out.includes(`<span class="badge now">v1.2.9</span>`),
    "feature-landed badge preserved — it records history, not the current version",
  );
});

test("rewrite is idempotent", () => {
  const once = rewrite(badge("1.2.9"), "1.4.3");
  assert.equal(rewrite(once, "1.4.3"), once);
});

// The real gate: the shipped manuals must match package.json. This is what
// went stale for eleven releases behind a passing docs-check.
test("shipped manuals carry the current package.json version", () => {
  const want = readVersion(repoRoot);
  for (const rel of [
    "manual/master-guide_ko.html",
    "manual/master-guide_en.html",
  ]) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    assert.deepEqual(
      inspect(fs.readFileSync(abs, "utf-8"), want),
      { status: "ok" },
      `${rel} sidebar badge is not v${want} — run \`npm run sync-version\``,
    );
  }
});
