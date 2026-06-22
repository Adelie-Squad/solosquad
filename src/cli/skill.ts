import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getWorkspaceRoot, getSkillsDir, getBundledSkillsDir } from "../util/paths.js";
import { parseSkillMd, validateSkill } from "../bot/skill-parser.js";

/**
 * v1.3.5 §3.9 B-D4 — the `solosquad skill` command group. Skills were the only
 * first-class asset without a dedicated CLI group (they were reachable only via
 * the `asset` facade), breaking the "every asset exposes list/show/validate/new"
 * floor. This group closes that gap. The conversational create/review/refine
 * path stays the Chief (skill-manager skill); `new` here is a deterministic,
 * no-LLM scaffold.
 */

function workspaceSkillsWriteDir(): string {
  return path.join(getWorkspaceRoot(), ".solosquad", "skills");
}

const SKELETON = (name: string, description: string): string =>
  `---
name: ${name}
description: ${JSON.stringify(description)}
schema_version: 2
tier: leader
team: _skill
category: general
used_by: ["chief", "pm"]
dev_capability: false
triggers:
  keyword: ["${name}"]
---

# ${name}

> TODO: one-line purpose.

## When to use

TODO: the trigger situation.

## Process

1. TODO: step one.
2. TODO: step two.

## Output

TODO: what this skill produces.
`;

/** `solosquad skill new <name>` — scaffold `.solosquad/skills/<name>/SKILL.md`. */
export async function skillNewCommand(name: string | undefined, opts: { description?: string } = {}): Promise<void> {
  const { isKebabCase } = await import("../util/naming.js");
  if (!name || !isKebabCase(name)) {
    console.error(chalk.red("error: provide a kebab-case name — `solosquad skill new <name>`"));
    process.exitCode = 2;
    return;
  }
  const dir = path.join(workspaceSkillsWriteDir(), name);
  const dest = path.join(dir, "SKILL.md");
  if (fs.existsSync(dest)) {
    console.error(chalk.red(`✗ ${dest} already exists — edit it directly`));
    process.exitCode = 1;
    return;
  }
  const description = (opts.description ?? `${name} — TODO: describe what this skill does`).trim();
  const content = SKELETON(name, description);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dest, content, "utf-8");
  console.log(chalk.green(`✓ scaffolded ${dest}`));

  // Validate-then-trust: surface the skeleton's validation state immediately.
  const spec = parseSkillMd(content, dest);
  const result = validateSkill(spec);
  if (!result.ok) {
    console.log(chalk.red(`  ✗ ${result.errors.length} error(s):`));
    for (const e of result.errors) console.log(chalk.red(`    - ${e.code}: ${e.message}`));
    process.exitCode = 1;
  } else {
    console.log(chalk.dim("  Edit the body + triggers, then `solosquad skill validate`."));
  }
}

/** Collect skill names from a dir (each `<name>/SKILL.md`). */
function skillsIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

/** `solosquad skill list` — bundled skills (+ workspace overrides). */
export async function skillListCommand(): Promise<void> {
  const bundled = skillsIn(getBundledSkillsDir());
  console.log(chalk.bold(`Bundled skills (${bundled.length}):`));
  for (const s of bundled) console.log(`  🔧 ${chalk.cyan(s)}`);
  const ws = skillsIn(workspaceSkillsWriteDir()).filter((s) => !bundled.includes(s));
  if (ws.length) {
    console.log(chalk.bold(`\nWorkspace skills (${ws.length}):`));
    for (const s of ws) console.log(`  🔧 ${chalk.cyan(s)}`);
  }
}

/** `solosquad skill show <name>` — resolve + print the SKILL.md path. */
export async function skillShowCommand(name: string): Promise<void> {
  // Resolution mirrors getSkillsDir (workspace override → top-level → bundle).
  const candidates = [
    path.join(getSkillsDir(), name, "SKILL.md"),
    path.join(workspaceSkillsWriteDir(), name, "SKILL.md"),
    path.join(getBundledSkillsDir(), name, "SKILL.md"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    console.error(chalk.red(`✗ no skill "${name}". Try \`solosquad skill list\`.`));
    process.exitCode = 1;
    return;
  }
  const spec = parseSkillMd(fs.readFileSync(found, "utf-8"), found);
  console.log(chalk.bold(`🔧 ${spec.name}`));
  console.log(chalk.dim(`  ${found}`));
  if (spec.description) console.log(`  ${spec.description}`);
}

/**
 * `solosquad skill validate` — delegates to the shared static gate
 * (`agent validate --all`), which validates every bundled + workspace SKILL.md
 * (skills and agents share the SKILL.md parser/validator).
 */
export async function skillValidateCommand(): Promise<void> {
  const { agentValidateCommand } = await import("./agent.js");
  await agentValidateCommand(undefined, { all: true });
}
