/**
 * v0.5 S5 — one-shot helper that prepends YAML frontmatter to the 25 bundled
 * `agents/{main,specialists}/{agent}/SKILL.md` files.
 *
 * Idempotent: if a SKILL.md already starts with `---\n`, the file is skipped.
 * The migration script (`src/migrations/scripts/0.4.0-to-0.5.0.ts`) reuses the
 * same logic on user workspaces — the keyword mapping lives in the shared
 * `CANONICAL_KEYWORDS` constant exported from this file.
 *
 * Run once during S5 development:
 *
 *   npx tsx scripts/backfill-bundled-frontmatter.ts
 *
 * The resulting files are committed so `solosquad init` on a fresh workspace
 * produces a frontmatter-complete agent set.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildBackfillFrontmatter,
  hasFrontmatter,
  CANONICAL_KEYWORDS,
} from "../src/migrations/skill-frontmatter-backfill.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// v1.3.1: canonical bundle roster moved to top-level agents/ (main/ +
// specialists/, flat). The old team-nested assets/agents/ was removed.
const BUNDLE_AGENTS_DIR = path.resolve(__dirname, "..", "agents");

interface BackfillReport {
  skipped: string[];
  backfilled: string[];
  errors: { file: string; reason: string }[];
}

function main(): void {
  if (!fs.existsSync(BUNDLE_AGENTS_DIR)) {
    console.error(`agents directory not found at ${BUNDLE_AGENTS_DIR}`);
    process.exit(1);
  }

  const report: BackfillReport = { skipped: [], backfilled: [], errors: [] };

  for (const teamEntry of fs.readdirSync(BUNDLE_AGENTS_DIR, { withFileTypes: true })) {
    if (!teamEntry.isDirectory()) continue;
    if (teamEntry.name.startsWith("_")) continue;
    const teamDir = path.join(BUNDLE_AGENTS_DIR, teamEntry.name);

    for (const agentEntry of fs.readdirSync(teamDir, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const skillPath = path.join(teamDir, agentEntry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      const raw = fs.readFileSync(skillPath, "utf-8");
      if (hasFrontmatter(raw)) {
        report.skipped.push(skillPath);
        continue;
      }

      const key = `${teamEntry.name}/${agentEntry.name}`;
      const keywords = CANONICAL_KEYWORDS[key];
      if (!keywords) {
        report.errors.push({
          file: skillPath,
          reason: `no canonical keyword mapping for "${key}"`,
        });
        continue;
      }

      try {
        const frontmatter = buildBackfillFrontmatter({
          name: agentEntry.name,
          team: teamEntry.name,
          body: raw,
          keywords,
        });
        const newContent = `---\n${frontmatter}\n---\n${raw}`;
        fs.writeFileSync(skillPath, newContent, "utf-8");
        report.backfilled.push(skillPath);
      } catch (e) {
        report.errors.push({
          file: skillPath,
          reason: (e as Error).message,
        });
      }
    }
  }

  console.log(`Backfilled: ${report.backfilled.length}`);
  for (const f of report.backfilled) console.log(`  + ${path.relative(process.cwd(), f)}`);

  if (report.skipped.length > 0) {
    console.log(`Skipped (already have frontmatter): ${report.skipped.length}`);
    for (const f of report.skipped) console.log(`  · ${path.relative(process.cwd(), f)}`);
  }

  if (report.errors.length > 0) {
    console.error(`Errors: ${report.errors.length}`);
    for (const e of report.errors) {
      console.error(`  ! ${path.relative(process.cwd(), e.file)} — ${e.reason}`);
    }
    process.exit(1);
  }

  console.log(`\nDone. Run \`solosquad agent validate --all\` to confirm coverage.`);
}

main();
