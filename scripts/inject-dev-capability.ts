/**
 * v0.8.2 §3.2 — one-shot helper that adds `dev_capability` (+
 * `dev_permissions` for true entries) to every bundled
 * `agents/{main,specialists}/{agent}/SKILL.md` frontmatter.
 *
 * Idempotent: re-running on an already-injected file leaves it untouched.
 *
 *   npx tsx scripts/inject-dev-capability.ts
 *
 * Matrix (per v0.8.2 §3.2 박제):
 *   - engineering 5 → `dev_capability: true` with a sane bash allowlist:
 *       backend-developer, fde, api-developer, creative-frontend, qa-engineer
 *   - everything else (20 SKILLs incl. engineering 5 advice-only +
 *     strategy 7 + growth 4 + experience 4) → `dev_capability: false`
 *   - `_meta/workflow-manager` is treated as non-dev (false) because the meta
 *     SKILL only drafts other SKILLs — it should not push code itself.
 *
 * Per v0.5 skill-parser forward-compat, unknown fields land in `extra` if the
 * parser hasn't yet learned them. v0.8.2 promotes `dev_capability` +
 * `dev_permissions` to typed fields in `skill-parser.ts`, so the round-trip
 * matters — we inject the fields at the *end* of the frontmatter block to
 * keep upstream byte ordering stable for the `anthropics/skills` corpus
 * regression test.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeLine } from "../src/util/platform.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// v1.3.1: canonical bundle roster moved to top-level agents/ (flat).
const BUNDLE_AGENTS_DIR = path.resolve(__dirname, "..", "agents");

/**
 * Engineering SKILLs allowed to perform end-to-end dev actions. Order is the
 * §3.2 matrix order — used only for human-readable report output.
 */
export const DEV_CAPABLE_SKILLS: ReadonlySet<string> = new Set([
  "engineering/backend-developer",
  "engineering/fde",
  "engineering/api-developer",
  "engineering/creative-frontend",
  "engineering/qa-engineer",
]);

/** Per-SKILL bash allowlist — kept minimal, user can extend in their org. */
export const DEFAULT_DEV_BASH_ALLOWED: readonly string[] = [
  "git",
  "gh",
  "npm",
  "node",
  "npx",
  "tsc",
  "pytest",
  "go",
  "cargo",
];

export const DEFAULT_DEV_BASH_DENIED: readonly string[] = [
  "rm -rf /",
  "sudo",
  "chmod 777",
];

interface InjectionReport {
  injectedTrue: string[];
  injectedFalse: string[];
  alreadySet: string[];
  errors: { file: string; reason: string }[];
}

/**
 * Inject dev_capability + dev_permissions block into a SKILL.md frontmatter
 * when absent. Returns the new content or `null` if already declared.
 *
 * Exported for unit tests.
 */
export function injectDevCapability(
  raw: string,
  capable: boolean,
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

  // Already declared? Idempotent skip — we don't try to "fix" any partial
  // declarations; that's a human review job.
  if (/^dev_capability:\s*\S+/m.test(fmText)) {
    return null;
  }

  const block = capable ? renderTrueBlock() : "dev_capability: false";
  const fmTrimmed = fmText.replace(/\n+$/, "");
  const newFm = `${fmTrimmed}\n${block}`;
  return `---\n${newFm}${afterFm}`;
}

function renderTrueBlock(): string {
  const allowed = DEFAULT_DEV_BASH_ALLOWED.map((s) => `      - ${s}`).join("\n");
  const denied = DEFAULT_DEV_BASH_DENIED.map((s) => `      - ${quote(s)}`).join("\n");
  return [
    "dev_capability: true",
    "dev_permissions:",
    "  bash:",
    "    allowed:",
    allowed,
    "    denied:",
    denied,
    "  network: false",
    "  push_targets:",
    "    requires_confirmation: true",
    "  merge:",
    "    auto: false",
  ].join("\n");
}

function quote(s: string): string {
  // YAML-quote when the value would otherwise be ambiguous (slashes, leading
  // whitespace, `*`, etc.). The handful of denied patterns all need quoting.
  return `"${s.replace(/"/g, '\\"')}"`;
}

function keyFor(team: string, agent: string): string {
  return `${team}/${agent}`;
}

function main(): void {
  if (!fs.existsSync(BUNDLE_AGENTS_DIR)) {
    console.error(`agents directory not found at ${BUNDLE_AGENTS_DIR}`);
    process.exit(1);
  }

  const report: InjectionReport = {
    injectedTrue: [],
    injectedFalse: [],
    alreadySet: [],
    errors: [],
  };

  for (const teamEntry of fs.readdirSync(BUNDLE_AGENTS_DIR, { withFileTypes: true })) {
    if (!teamEntry.isDirectory()) continue;
    // `_meta/` is the workflow-manager meta-skill — out of the 25-SKILL matrix.
    if (teamEntry.name.startsWith("_")) continue;
    const teamDir = path.join(BUNDLE_AGENTS_DIR, teamEntry.name);

    for (const agentEntry of fs.readdirSync(teamDir, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const skillPath = path.join(teamDir, agentEntry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      const raw = fs.readFileSync(skillPath, "utf-8");
      const capable = DEV_CAPABLE_SKILLS.has(keyFor(teamEntry.name, agentEntry.name));

      try {
        const next = injectDevCapability(raw, capable);
        if (next === null) {
          report.alreadySet.push(skillPath);
        } else {
          fs.writeFileSync(skillPath, next, "utf-8");
          if (capable) report.injectedTrue.push(skillPath);
          else report.injectedFalse.push(skillPath);
        }
      } catch (e) {
        report.errors.push({
          file: skillPath,
          reason: (e as Error).message,
        });
      }
    }
  }

  console.log(`dev_capability: true  injected: ${report.injectedTrue.length}`);
  for (const f of report.injectedTrue) console.log(`  + ${path.relative(process.cwd(), f)}`);
  console.log(`dev_capability: false injected: ${report.injectedFalse.length}`);
  for (const f of report.injectedFalse) console.log(`  + ${path.relative(process.cwd(), f)}`);

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

const isMain = process.argv[1] === __filename;
if (isMain) {
  main();
}
