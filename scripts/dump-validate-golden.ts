/**
 * v2.0.0 — golden snapshot of what the v1.4.3 `validateSkill` gate reports, so the
 * Python port (python/src/solosquad/assets/validate.py) keeps the same codes and
 * severities. Inputs: every bundled agent/skill (as `agent validate --all` checks
 * them: dir_name + strict_name) plus synthetic cases that trip each rule.
 *
 *   npx tsx scripts/dump-validate-golden.ts > python/tests/golden/validate-v1.4.3.json
 */

import fs from "fs";
import path from "path";
import { parseSkillMd, validateSkill } from "../src/bot/skill-parser.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function skillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
    .map((e) => path.join(dir, e.name, "SKILL.md"))
    .sort();
}

type Codes = { errors: string[]; warnings: string[] };

function codes(raw: string, rel: string, dirName: string | undefined, strict: boolean, freq?: number): Codes {
  const spec = parseSkillMd(raw, rel);
  const r = validateSkill(spec, { dir_name: dirName, strict_name: strict, freq_skill_count: freq });
  return { errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code) };
}

const bundle: Record<string, Codes> = {};
for (const f of [
  ...skillFiles(path.join(root, "agents", "main")),
  ...skillFiles(path.join(root, "agents", "specialists")),
  ...skillFiles(path.join(root, "skills")),
]) {
  const rel = path.relative(root, f).split(path.sep).join("/");
  bundle[rel] = codes(fs.readFileSync(f, "utf8"), rel, path.basename(path.dirname(f)), true);
}

const ok = "schema_version: 1\ndescription: Builds reports. 사용 시점 — 보고서가 필요할 때";
const cases: Record<string, { front: string; dir?: string; strict?: boolean; freq?: number; body?: string }> = {
  clean: { front: `name: a\n${ok}` },
  stateful: { front: `name: a\n${ok}\nstateful: true` },
  slash: { front: `name: a\n${ok}\ntriggers:\n  slash: [x, /plan, /pla, /build-it, /mine]` },
  freq: { front: `name: a\n${ok}\ntriggers:\n  freq:\n    keywords: [k]\n    window_turns: 0\n    threshold: 0\n    cooldown_turns: -1` },
  freq_cap: { front: `name: a\n${ok}\ntriggers:\n  freq:\n    keywords: [k]`, freq: 20 },
  loop_unknown: { front: `name: a\n${ok}\nloop_mode:\n  kind: forever` },
  loop_nostop: { front: `name: a\n${ok}\nloop_mode:\n  kind: spec-gate` },
  budget: { front: `name: a\n${ok}\nbudget:\n  per_call_usd: -1\n  daily_usd: -2` },
  confidence: { front: `name: a\n${ok}\nconfidence: 1.5` },
  min_approaches: { front: `name: a\n${ok}\npm_conventions:\n  minimum_approaches: 0` },
  min_approaches_float: { front: `name: a\n${ok}\npm_conventions:\n  minimum_approaches: 1.5` },
  category: { front: `name: a\n${ok}\ncategory: Planning Stuff` },
  no_schema: { front: "name: a\ndescription: Builds reports. use when you need one" },
  bad_schema: { front: "name: a\nschema_version: 0\ndescription: Builds reports. use when you need one" },
  merge_auto: { front: `name: a\n${ok}\ndev_capability: true\ndev_permissions:\n  merge:\n    auto: true` },
  perms_no_cap: { front: `name: a\n${ok}\ndev_permissions:\n  merge:\n    auto: false` },
  strict_name: { front: `name: My_Claude_Skill\n${ok}`, strict: true, dir: "other" },
  long_name: { front: `name: ${"a".repeat(70)}\n${ok}`, strict: true },
  dir_mismatch: { front: `name: a\n${ok}`, dir: "b" },
  desc_long: { front: `name: a\nschema_version: 1\ndescription: ${"x".repeat(1100)} use when needed` },
  desc_first_person: { front: "name: a\nschema_version: 1\ndescription: I will help. use when needed" },
  desc_vague: { front: "name: a\nschema_version: 1\ndescription: helps with reports. 할 때" },
  desc_vague_ko: { front: "name: a\nschema_version: 1\ndescription: 보고서를 도와줍니다" },
  long_body: { front: `name: a\n${ok}`, body: "line\n".repeat(600) },
};
const synthetic: Record<string, Codes> = {};
for (const [k, c] of Object.entries(cases)) {
  const raw = `---\n${c.front}\n---\n${c.body ?? "body\n"}`;
  synthetic[k] = codes(raw, `case/${k}`, c.dir, c.strict ?? false, c.freq);
}

process.stdout.write(JSON.stringify({ bundle, synthetic, cases }, null, 2) + "\n");
