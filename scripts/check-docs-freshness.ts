#!/usr/bin/env tsx
/**
 * v0.8.5 §2.3 — Pre-publish documentation freshness gate.
 *
 * Reads the current `package.json` version and verifies that all three
 * release-critical docs mention it:
 *   - docs/plan/product-roadmap.md  (synergy/role/vision)
 *   - docs/plan/architecture.md     (§13.x version section)
 *   - docs/manual/master-guide.html (user-facing manual)
 *
 * Wired into `npm run prepublishOnly` so a stale doc blocks `npm publish`.
 * Matches the user memory rule `feedback_three_docs_pre_publish.md`.
 *
 * Exit codes:
 *   0 — all three docs mention the version
 *   1 — at least one doc is stale
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"),
) as { version: string };
const version = pkg.version;

const targets = [
  "docs/plan/product-roadmap.md",
  "docs/plan/architecture.md",
  "docs/manual/master-guide_ko.html",
  "docs/manual/master-guide_en.html",
];

let failed = 0;
for (const rel of targets) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    console.error(`✗ ${rel} — file not found`);
    failed++;
    continue;
  }
  const body = fs.readFileSync(abs, "utf-8");
  if (body.includes(version)) {
    console.log(`✓ ${rel} mentions ${version}`);
  } else {
    console.error(`✗ ${rel} does not mention ${version}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(
    `\ndocs-check: ${failed}/${targets.length} stale. Update the release-` +
      `critical docs (product-roadmap / architecture / master-guide ko+en) ` +
      `before publishing.`,
  );
  process.exit(1);
}
console.log(`\ndocs-check: all ${targets.length} docs mention ${version}.`);
