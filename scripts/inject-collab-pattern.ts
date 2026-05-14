/**
 * v0.6 S2 §2.4 — one-shot helper that adds a `collab_pattern` field to every
 * bundled `assets/agents/{team}/{agent}/SKILL.md` frontmatter.
 *
 * Idempotent: if a SKILL.md already declares `collab_pattern: <value>`, the
 * file is left untouched. Run once during S2 development:
 *
 *   npx tsx scripts/inject-collab-pattern.ts
 *
 * Three pattern values are assigned per v0.6 plan §2.4 + S2 spec:
 *   - graph   — research ↔ planner ↔ data-analyst type loops
 *   - dynamic — routing-on-output stages (content → brand/paid split)
 *   - hierarchical — the default for every other specialist
 *
 * Per v0.6 plan §11 line 6, the v0.5 skill-parser already accepts unknown
 * frontmatter keys via `extra` (forward-compat). This script only injects
 * the *data*; promoting `collab_pattern` into the typed SkillSpec interface
 * is a follow-up step.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeLine } from "../src/util/platform.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_AGENTS_DIR = path.resolve(__dirname, "..", "assets", "agents");

export type CollabPattern = "hierarchical" | "graph" | "dynamic";

/**
 * Overrides for the 3 agents whose stage shape is *not* a simple PM→specialist
 * handoff. Every other agent inherits the default `hierarchical`.
 *
 * - strategy/data-analyst: graph (research ↔ planner ↔ data-analyst loop)
 * - strategy/feature-planner: graph (gate-driven loop until spec passes)
 * - growth/content-writer: dynamic (next step branches into brand-marketer
 *   or paid-marketer depending on content type)
 */
export const COLLAB_PATTERN_OVERRIDES: Record<string, CollabPattern> = {
  "strategy/data-analyst": "graph",
  "strategy/feature-planner": "graph",
  "growth/content-writer": "dynamic",
};

interface InjectionReport {
  injected: string[];
  alreadySet: string[];
  errors: { file: string; reason: string }[];
}

/**
 * Inject `collab_pattern: <value>` into a SKILL.md frontmatter if absent.
 * Returns the new file content (or `null` if no change needed).
 *
 * Exported for unit tests.
 */
export function injectCollabPattern(
  raw: string,
  pattern: CollabPattern
): string | null {
  const normalized = normalizeLine(raw);
  if (!normalized.startsWith("---\n")) {
    throw new Error("missing YAML frontmatter");
  }
  const closeIdx = normalized.indexOf("\n---", 4);
  if (closeIdx === -1) {
    throw new Error("unterminated YAML frontmatter");
  }
  const fmText = normalized.slice(4, closeIdx);
  const afterFm = normalized.slice(closeIdx); // starts with "\n---"

  // Already declared? — idempotent skip
  if (/^collab_pattern:\s*\S+/m.test(fmText)) {
    return null;
  }

  // Append at the end of the frontmatter block. We keep the rest of the
  // frontmatter byte-identical so v0.5 skill-parser round-trip tests
  // (anthropics/skills corpus) remain stable.
  const fmTrimmed = fmText.replace(/\n+$/, "");
  const newFm = `${fmTrimmed}\ncollab_pattern: ${pattern}`;
  return `---\n${newFm}${afterFm}`;
}

function patternFor(team: string, agent: string): CollabPattern {
  return COLLAB_PATTERN_OVERRIDES[`${team}/${agent}`] ?? "hierarchical";
}

function main(): void {
  if (!fs.existsSync(ASSETS_AGENTS_DIR)) {
    console.error(`assets/agents directory not found at ${ASSETS_AGENTS_DIR}`);
    process.exit(1);
  }

  const report: InjectionReport = { injected: [], alreadySet: [], errors: [] };

  for (const teamEntry of fs.readdirSync(ASSETS_AGENTS_DIR, { withFileTypes: true })) {
    if (!teamEntry.isDirectory()) continue;
    if (teamEntry.name.startsWith("_")) continue;
    const teamDir = path.join(ASSETS_AGENTS_DIR, teamEntry.name);

    for (const agentEntry of fs.readdirSync(teamDir, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const skillPath = path.join(teamDir, agentEntry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      const raw = fs.readFileSync(skillPath, "utf-8");
      const pattern = patternFor(teamEntry.name, agentEntry.name);

      try {
        const next = injectCollabPattern(raw, pattern);
        if (next === null) {
          report.alreadySet.push(skillPath);
        } else {
          fs.writeFileSync(skillPath, next, "utf-8");
          report.injected.push(`${skillPath} (${pattern})`);
        }
      } catch (e) {
        report.errors.push({
          file: skillPath,
          reason: (e as Error).message,
        });
      }
    }
  }

  console.log(`Injected: ${report.injected.length}`);
  for (const f of report.injected) console.log(`  + ${path.relative(process.cwd(), f)}`);

  if (report.alreadySet.length > 0) {
    console.log(`Already set (idempotent skip): ${report.alreadySet.length}`);
    for (const f of report.alreadySet) console.log(`  · ${path.relative(process.cwd(), f)}`);
  }

  if (report.errors.length > 0) {
    console.error(`Errors: ${report.errors.length}`);
    for (const e of report.errors) {
      console.error(`  ! ${path.relative(process.cwd(), e.file)} — ${e.reason}`);
    }
    process.exit(1);
  }

  console.log(`\nDone. Run \`solosquad agent validate --all\` to confirm 25/25 still pass.`);
}

// Only run main when executed directly (not when imported by tests).
const isMain = process.argv[1] === __filename;
if (isMain) {
  main();
}
