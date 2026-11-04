/**
 * v2.0.0 [0] — golden snapshot of how the v1.4.3 TS parsers read the bundled
 * assets. The Python rewrite must parse the same files into the same values
 * (python/tests/test_golden_assets.py); regenerate only when the TS parsers or
 * the bundled assets change on purpose.
 *
 *   npx tsx scripts/dump-asset-golden.ts > python/tests/golden/assets-v1.4.3.json
 */

import fs from "fs";
import path from "path";
import { parseSkillMd } from "../src/bot/skill-parser.js";
import { loadAllCompositions } from "../src/util/composition.js";
import { normalizeLine } from "../src/util/platform.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function skillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
    .map((e) => path.join(dir, e.name, "SKILL.md"))
    .sort();
}

function parseAll(files: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    out[rel] = parseSkillMd(fs.readFileSync(f, "utf8"), rel);
  }
  return out;
}

const agents = parseAll([
  ...skillFiles(path.join(root, "agents", "main")),
  ...skillFiles(path.join(root, "agents", "specialists")),
]);
const skills = parseAll(skillFiles(path.join(root, "skills")));
const teams = loadAllCompositions({ workspaceRoot: root });

const crons: Record<string, unknown> = {};
for (const name of fs.readdirSync(path.join(root, "crons")).filter((n) => n.endsWith(".md")).sort()) {
  const body = normalizeLine(fs.readFileSync(path.join(root, "crons", name), "utf8"));
  const first = body.split("\n")[0] ?? "";
  crons[`crons/${name}`] = {
    name: name.replace(/\.md$/, ""),
    title: first.startsWith("# ") ? first.slice(2).trim() : null,
    body,
  };
}

process.stdout.write(JSON.stringify({ agents, skills, teams, crons }, null, 2) + "\n");
