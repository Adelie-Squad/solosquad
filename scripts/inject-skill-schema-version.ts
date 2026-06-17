#!/usr/bin/env node
/**
 * v0.8.1 — standalone CLI that injects `schema_version: 1` into bundled
 * SKILL.md frontmatter.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §6.3. The actual logic
 * lives in `src/lifecycle/skill-schema-version.ts` so the same module is
 * reused by the 0.8.0 → 0.8.1 migration. This file is a thin CLI shim.
 *
 * Run with `npx tsx scripts/inject-skill-schema-version.ts [dir] [--dry-run]`.
 * Default directory is `agents/` (v1.3.1: was assets/agents/). The script is idempotent — files
 * that already declare `schema_version` are left untouched.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  injectSchemaVersion,
  listSkillFiles,
} from "../src/lifecycle/skill-schema-version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const root = positional[0] ?? path.resolve(__dirname, "..", "agents");
  const dryRun = args.includes("--dry-run");

  console.log(`scanning ${root}${dryRun ? " (DRY-RUN)" : ""}`);
  const files = listSkillFiles(root);
  let injected = 0;
  let alreadyHad = 0;
  const skipped: { file: string; reason: string }[] = [];

  for (const f of files) {
    const content = fs.readFileSync(f, "utf-8");
    try {
      const updated = injectSchemaVersion(content);
      if (updated === null) {
        alreadyHad++;
      } else {
        if (!dryRun) fs.writeFileSync(f, updated);
        injected++;
        console.log(`  ${dryRun ? "[plan]" : "[ok]"} ${path.relative(root, f)}`);
      }
    } catch (e) {
      skipped.push({ file: f, reason: (e as Error).message });
      console.log(`  [skip] ${path.relative(root, f)}: ${(e as Error).message}`);
    }
  }

  console.log("");
  console.log(`injected   = ${injected}`);
  console.log(`alreadyHad = ${alreadyHad}`);
  console.log(`skipped    = ${skipped.length}`);
}

main();
