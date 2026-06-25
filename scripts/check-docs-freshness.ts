#!/usr/bin/env tsx
/**
 * v1.3.8 §3.5 — Pre-publish documentation freshness gate (repo-scoped).
 *
 * docs·version are REPOSITORY-scoped: this checks the current repo's
 * `package.json` version against this repo's release-bound docs.
 *
 * Checks (PRD docs/prd/v1.3.8_docs-management.md §3.5):
 *   1. A frozen PRD for vN.N.N exists in docs/prd/ (repo layer).
 *   2. Core docs mention vN.N.N: roadmap, architecture, CHANGELOG, README.
 *      - roadmap/architecture accept the promoted path (docs/) OR the legacy
 *        path (docs/prd/) for backward-compat (v1.3.8 promotion).
 *   3. Conditional: manual ko/en mention vN.N.N ONLY if they exist
 *      (manual is omitted for products where users don't read md/html docs —
 *      §3.2 †). Absent manual = skip, not fail.
 *   4. Invariant: package.json `files` must not expose anything under docs/
 *      (internal docs must not leak into the npm package).
 *
 * Wired into `npm run prepublishOnly` so a stale doc blocks `npm publish`.
 * Supersedes the v0.8.5 4-docs gate; aligns with feedback_three_docs_pre_publish.
 *
 * Exit codes: 0 — all green · 1 — at least one failure.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"),
) as { version: string; files?: string[] };
const version = pkg.version;

let failed = 0;
const abs = (rel: string) => path.join(repoRoot, rel);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 1. PRD existence (repo layer, frozen). Accept new `v<ver>_name` and legacy `v<ver>-name`.
const prdDir = abs("docs/prd");
const prdRe = new RegExp(`^v${escapeRe(version)}[_-]`);
const prdHit =
  fs.existsSync(prdDir) && fs.readdirSync(prdDir).some((f) => prdRe.test(f));
if (prdHit) {
  console.log(`✓ docs/prd/ has a PRD for v${version}`);
} else {
  console.error(`✗ no frozen PRD for v${version} in docs/prd/ (v${version}_<name>.md)`);
  failed++;
}

// 2/3. Freshness rows. Pass if the FIRST existing candidate mentions the version.
function checkRow(label: string, candidates: string[], required = true): void {
  const existing = candidates.filter((rel) => fs.existsSync(abs(rel)));
  if (existing.length === 0) {
    if (required) {
      console.error(`✗ ${label} — no file found (${candidates.join(" | ")})`);
      failed++;
    } else {
      console.log(`− ${label} — absent, skipped (conditional doc)`);
    }
    return;
  }
  const hit = existing.find((rel) =>
    fs.readFileSync(abs(rel), "utf-8").includes(version),
  );
  if (hit) {
    console.log(`✓ ${hit} mentions ${version}`);
  } else {
    console.error(`✗ ${label} (${existing.join(", ")}) does not mention ${version}`);
    failed++;
  }
}

// Core (required). roadmap/architecture: promoted path first, legacy fallback.
checkRow("roadmap", ["docs/roadmap.md", "docs/prd/product-roadmap.md"]);
checkRow("architecture", ["docs/architecture.md", "docs/prd/architecture.md"]);
checkRow("CHANGELOG", ["CHANGELOG.md"]);
checkRow("README", ["README.md"]);

// Conditional (manual — only if the product ships a manual).
checkRow("manual(ko)", ["manual/master-guide_ko.html"], false);
checkRow("manual(en)", ["manual/master-guide_en.html"], false);

// 4. Invariant: no docs/ leak into the published package.
const leak = (pkg.files ?? []).filter((f) =>
  /^\.?\/?docs(\/|$)/.test(String(f).trim()),
);
if (leak.length > 0) {
  console.error(`✗ package.json files exposes docs/: ${leak.join(", ")}`);
  failed++;
} else {
  console.log(`✓ package.json files does not leak docs/`);
}

if (failed > 0) {
  console.error(
    `\ndocs-check: ${failed} failure(s). Update release-bound docs ` +
      `(roadmap / architecture / CHANGELOG / README, + manual if present) to ` +
      `mention v${version}, ensure a docs/prd/ PRD exists, and keep docs/ out ` +
      `of package.json files before publishing.`,
  );
  process.exit(1);
}
console.log(`\ndocs-check: all release-bound docs are fresh for v${version}.`);
