#!/usr/bin/env tsx
/**
 * Keep the manual's sidebar version badge in sync with `package.json`.
 *
 * Why this exists: `check-docs-freshness.ts` passes when a doc mentions the
 * version *anywhere*. The manual's §"현재 버전" paragraph satisfied that while
 * the sidebar `<h1>` badge stayed frozen at v1.2.9 across eleven releases — a
 * false green. The badge is the first thing a reader sees, so it gets its own
 * gate.
 *
 * Modes:
 *   (default)  rewrite the badge to package.json's version, report what changed
 *   --check    verify only; exit 1 on drift (for CI / non-publish paths)
 *
 * Wired into `prepublishOnly` ahead of `docs-check` so every publish ships a
 * correct badge. A rewrite leaves the working tree dirty on purpose — the
 * change belongs in the release commit.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const MANUALS = ["manual/master-guide_ko.html", "manual/master-guide_en.html"];

/**
 * The sidebar badge: `<h1>SoloSquad <span …>v1.2.9</span></h1>`. Anchored on
 * the `<h1>` so the many in-body `<span class="badge now">vX.Y.Z</span>`
 * markers — which correctly record *when a feature landed* — are never touched.
 */
const BADGE_RE =
  /(<h1>SoloSquad\s*<span\b[^>]*>)v\d+\.\d+\.\d+(<\/span><\/h1>)/;

export function readVersion(root = repoRoot): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf-8"),
  ) as { version: string };
  return pkg.version;
}

export type BadgeState =
  | { status: "ok" }
  | { status: "drift"; found: string }
  | { status: "missing" };

/** Pure — exposed for the regression test. */
export function inspect(html: string, want: string): BadgeState {
  const m = BADGE_RE.exec(html);
  if (!m) return { status: "missing" };
  const found = /v(\d+\.\d+\.\d+)/.exec(m[0]);
  if (!found) return { status: "missing" };
  return found[1] === want ? { status: "ok" } : { status: "drift", found: found[1] };
}

export function rewrite(html: string, want: string): string {
  return html.replace(BADGE_RE, `$1v${want}$2`);
}

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const want = readVersion();
  let failed = 0;
  let wrote = 0;

  for (const rel of MANUALS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      console.log(`− ${rel} — absent, skipped (conditional doc)`);
      continue;
    }
    const html = fs.readFileSync(abs, "utf-8");
    const res = inspect(html, want);

    if (res.status === "missing") {
      console.error(`✗ ${rel} — no <h1> version badge found (expected \`<h1>SoloSquad <span …>vX.Y.Z</span></h1>\`)`);
      failed++;
    } else if (res.status === "ok") {
      console.log(`✓ ${rel} badge is v${want}`);
    } else if (checkOnly) {
      console.error(`✗ ${rel} badge is v${res.found}, package.json is v${want}`);
      failed++;
    } else {
      fs.writeFileSync(abs, rewrite(html, want), "utf-8");
      console.log(`↻ ${rel} badge v${res.found} → v${want}`);
      wrote++;
    }
  }

  if (failed > 0) {
    console.error(
      `\nsync-manual-version: ${failed} failure(s). Run \`npm run sync-version\` ` +
        `to rewrite the badge, then commit the change.`,
    );
    process.exit(1);
  }
  if (wrote > 0) {
    console.log(
      `\nsync-manual-version: rewrote ${wrote} badge(s) to v${want} — ` +
        `include the change in the release commit.`,
    );
  } else {
    console.log(`\nsync-manual-version: manual badges are fresh for v${want}.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
