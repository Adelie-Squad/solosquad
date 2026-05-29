#!/usr/bin/env tsx
/**
 * v1.2.8 §A.11 — Pre-publish ESM purity gate.
 *
 * The package ships as `"type": "module"` in package.json. Any
 * remaining CommonJS-style `require(` call in the compiled `dist/`
 * output explodes at runtime with `ReferenceError: require is not
 * defined`. v1.2.7 shipped with exactly that bug — the surrounding
 * `try/catch` swallowed the error, `addDirs` came back empty, and the
 * `--add-dir` flag never made it to the spawn. Every existing gate
 * (`tsc --noEmit`, 728 tests, `docs-check`) missed it because the
 * `require` was type-cast as `as typeof import("...")` and no test
 * exercised the helper in an actual ESM-runtime context.
 *
 * This script greps every `.js` file under `dist/` for `require(` and
 * exits non-zero on any match. Wired into `prepublishOnly` so the
 * v1.2.7-class bug can't slip past again.
 *
 * Intentionally lightweight (raw text scan, not AST). False positives
 * are acceptable — they're easy to triage and fix at publish time,
 * which is cheaper than a broken release.
 *
 * Exit codes:
 *   0 — no `require(` calls in compiled output
 *   1 — at least one `require(` found, or dist/ missing
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distRoot = path.join(repoRoot, "dist");

if (!fs.existsSync(distRoot)) {
  console.error(`✗ dist/ not found at ${distRoot}. Run \`npm run build\` first.`);
  process.exit(1);
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

const hits: Hit[] = [];

function walk(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const body = fs.readFileSync(full, "utf-8");
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip JSDoc / block-comment continuation lines (`  * ...`).
      if (/^\s*\*(?!\/)/.test(line)) continue;
      // Skip single-line `//` comments.
      if (/^\s*\/\//.test(line)) continue;

      const match = line.match(/\brequire\(/);
      if (!match) continue;

      // Skip the legitimate ESM bridge — `createRequire(import.meta.url)`.
      // The chief-runner regression was bare `require("fs")` at the
      // call-site, not via createRequire.
      if (line.includes("createRequire")) continue;

      // Skip when `require(` appears INSIDE a string literal. Cheap
      // heuristic — if the run of text before the match has an odd
      // count of unescaped quotes, we're in a string.
      const before = line.slice(0, match.index);
      const dq = (before.match(/(?<!\\)"/g) || []).length;
      const sq = (before.match(/(?<!\\)'/g) || []).length;
      const bq = (before.match(/(?<!\\)`/g) || []).length;
      if (dq % 2 === 1 || sq % 2 === 1 || bq % 2 === 1) continue;

      hits.push({
        file: path.relative(repoRoot, full),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
}

walk(distRoot);

if (hits.length === 0) {
  console.log("✓ ESM purity check passed: no bare `require(` calls in dist/");
  process.exit(0);
}

console.error(
  `✗ ESM purity check FAILED: ${hits.length} bare \`require(\` call(s) in compiled dist/.`,
);
console.error(
  "  Package.json has `\"type\": \"module\"` — `require` is undefined at runtime.",
);
console.error(
  "  Replace with top-level `import` statements or `createRequire(import.meta.url)`.",
);
console.error("");
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}`);
  console.error(`    ${hit.text}`);
}
process.exit(1);
