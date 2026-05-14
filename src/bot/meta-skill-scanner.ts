import fs from "fs";
import path from "path";

import { getAgentsDir } from "../util/paths.js";
import {
  parseSkillMd,
  validateSkill,
  SkillParseError,
  type SkillSpec,
} from "./skill-parser.js";

/**
 * v0.5 §7 — meta-skill scanner.
 *
 * `_meta/` is intentionally segregated from the regular agent roster so that
 * orchestration-layer SKILLs (workflow-maker, recipe-replay, etc.) never get
 * surfaced through the 3 ambient channels (slash / keyword / freq). Letting
 * a meta-skill ride one of those channels would invert the v0.3 control
 * model — meta-skills must be invoked *by the PM* (explicit only) so they
 * stay out of the user's typing surface and out of the freq-loader budget
 * (see §13 cap on freq-enabled SKILLs).
 *
 * The general roster scanner (`listSourceAgents()` in `agents-builder.ts`)
 * already skips any directory whose name starts with `_`, so `_meta/` stays
 * out of the normal Task-tool fanout. This module is the *opposite* side:
 * it scans **only** `_meta/` and enforces the inverse policy — accept ONLY
 * `triggers.explicit: true`, reject every other channel.
 *
 * Rejection (rather than throw) is deliberate. A malformed meta-skill must
 * not poison the rest of the workspace; the caller (PM bootstrap, doctor)
 * surfaces the `rejected[]` list as a warning and continues.
 */

export interface MetaSkillRef {
  name: string;
  source_path: string;
  spec: SkillSpec;
}

export interface MetaSkillRejection {
  path: string;
  reason: string;
}

export interface MetaSkillScanResult {
  ok: MetaSkillRef[];
  rejected: MetaSkillRejection[];
}

export function listMetaSkills(agentsDir?: string): MetaSkillScanResult {
  const root = agentsDir ?? getAgentsDir();
  const result: MetaSkillScanResult = { ok: [], rejected: [] };

  const metaDir = path.join(root, "_meta");
  if (!fs.existsSync(metaDir)) return result;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(metaDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(metaDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;

    const raw = fs.readFileSync(skillPath, "utf8");

    let spec: SkillSpec;
    try {
      spec = parseSkillMd(raw, skillPath);
    } catch (e) {
      const msg =
        e instanceof SkillParseError
          ? e.message
          : `parse error: ${(e as Error).message}`;
      result.rejected.push({ path: skillPath, reason: msg });
      continue;
    }

    const validation = validateSkill(spec);
    if (!validation.ok) {
      const summary = validation.errors
        .map((err) => `${err.code}${err.field ? ` (${err.field})` : ""}: ${err.message}`)
        .join("; ");
      result.rejected.push({
        path: skillPath,
        reason: `validation failed — ${summary}`,
      });
      continue;
    }

    const triggers = spec.triggers;
    const forbidden: string[] = [];
    if (triggers?.slash && triggers.slash.length > 0) forbidden.push("slash");
    if (triggers?.keyword && triggers.keyword.length > 0) forbidden.push("keyword");
    if (triggers?.freq) forbidden.push("freq");

    if (forbidden.length > 0) {
      result.rejected.push({
        path: skillPath,
        reason: `meta-skill must not register ambient channels (found: ${forbidden.join(
          ", ",
        )}) — only triggers.explicit is allowed (v0.5 §7)`,
      });
      continue;
    }

    if (triggers?.explicit !== true) {
      result.rejected.push({
        path: skillPath,
        reason:
          "meta-skill must declare triggers.explicit: true — meta-skills are PM-invoked only (v0.5 §7)",
      });
      continue;
    }

    result.ok.push({
      name: spec.name,
      source_path: skillPath,
      spec,
    });
  }

  return result;
}
