/**
 * v2.0.0 — how the v1.4.3 `parseSkillMd` reads hand-picked edge-case SKILL.md files
 * (BOM, CRLF, missing fields, YAML 1.2 scalars, anchors/merge, dates, duplicate keys,
 * malformed triggers …). The bundle golden only covers files we ship; customers write
 * the rest. The Python parser must produce the same JSON or the same failure.
 *
 *   npx tsx scripts/dump-parse-edge-golden.ts > python/tests/golden/parse-edge-v1.4.3.json
 */

import fs from "fs";
import path from "path";
import { parseSkillMd } from "../src/bot/skill-parser.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cases: string[] = JSON.parse(
  fs.readFileSync(path.join(root, "python", "tests", "golden", "parse-edge-cases.json"), "utf8"),
);
const out = cases.map((raw, i) => {
  try {
    return { ok: JSON.parse(JSON.stringify(parseSkillMd(raw, `case/${i}`))) };
  } catch (e) {
    return { error: (e as Error).constructor.name };
  }
});
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
