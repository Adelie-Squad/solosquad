import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AdoptionReport, AdoptionItem } from "./adoption-report.js";

/**
 * v1.3.2 §10 — apply an adoption (the write half). ADDITIVE: copies each
 * non-error asset into the workspace override dirs (`.solosquad/{agents,skills,
 * crons}`, already materialized from the bundle by `init`). New ids are
 * added; id collisions are namespaced by source-repo label; re-runs are
 * idempotent (matching content → skip). It never touches the bundle, and never
 * overwrites an existing asset — so it cannot lose the built-in roster.
 *
 * This is NOT v1.5.0's edit-merge: adoption only adds new ids, it never
 * reconciles two edits to the *same* file.
 */

export interface ApplyTargets {
  agentsDir: string;
  skillsDir: string;
  schedulesDir: string;
  /** workflow templates live alongside the workflow-maker skill assets. */
  workflowsDir: string;
}

export interface ApplyOutcome {
  kind: AdoptionItem["kind"];
  id: string;
  /** final id written (may be namespaced). */
  finalId: string;
  dest: string;
  action: "written" | "namespaced" | "skipped";
  reason?: string;
}

export interface ApplyResult {
  outcomes: ApplyOutcome[];
  writtenCount: number;
  skippedCount: number;
}

function sanitizeLabel(repoRoot: string): string {
  const base = path.basename(path.resolve(repoRoot)).toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ext";
}

function hashFile(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 12);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/** The on-disk "unit" to copy for an asset, plus the file whose hash identifies it. */
function sourceUnit(
  repoRoot: string,
  item: AdoptionItem,
): { kind: "dir" | "files"; primary: string; dir?: string; files?: string[] } {
  const full = path.join(repoRoot, item.path.split("/").join(path.sep));
  if (item.kind === "cron") {
    const promptMd = path.join(path.dirname(full), `${item.id}.md`);
    const files = [full, ...(fs.existsSync(promptMd) ? [promptMd] : [])];
    return { kind: "files", primary: full, files };
  }
  // workflow — copy the <id>/ dir containing workflow.yaml.
  if (item.kind === "workflow") {
    return { kind: "dir", primary: full, dir: path.dirname(full) };
  }
  // skill / agent — SKILL.md (or a single .md). Copy its parent dir if the file
  // is the conventional <id>/SKILL.md, else just the file.
  if (path.basename(full) === "SKILL.md") {
    return { kind: "dir", primary: full, dir: path.dirname(full) };
  }
  return { kind: "files", primary: full, files: [full] };
}

function agentBucket(item: AdoptionItem): string {
  return item.mapping?.tier === "leader" ? "main" : "specialists";
}

export function applyAdoption(
  repoRoot: string,
  report: AdoptionReport,
  targets: ApplyTargets,
): ApplyResult {
  const label = sanitizeLabel(repoRoot);
  const outcomes: ApplyOutcome[] = [];

  for (const item of report.items) {
    if (item.status === "error") {
      outcomes.push({ kind: item.kind, id: item.id, finalId: item.id, dest: "", action: "skipped", reason: "validation error" });
      continue;
    }
    const unit = sourceUnit(repoRoot, item);
    const srcHash = hashFile(unit.primary);

    // Candidate destinations: original id, then namespaced.
    const baseDir =
      item.kind === "skill"
        ? targets.skillsDir
        : item.kind === "cron"
          ? targets.schedulesDir
          : item.kind === "workflow"
            ? targets.workflowsDir
            : path.join(targets.agentsDir, agentBucket(item));

    const destFor = (id: string): { destDir: string; primaryDest: string } => {
      if (item.kind === "cron") {
        return { destDir: baseDir, primaryDest: path.join(baseDir, `${id}.yaml`) };
      }
      const primaryName = item.kind === "workflow" ? "workflow.yaml" : "SKILL.md";
      return { destDir: path.join(baseDir, id), primaryDest: path.join(baseDir, id, primaryName) };
    };

    const candidates = [item.id, `${label}-${item.id}`];
    let done = false;
    for (const cand of candidates) {
      const { destDir, primaryDest } = destFor(cand);
      if (fs.existsSync(primaryDest)) {
        // idempotent: same content already adopted → skip
        if (hashFile(primaryDest) === srcHash) {
          outcomes.push({ kind: item.kind, id: item.id, finalId: cand, dest: primaryDest, action: "skipped", reason: "already adopted (identical)" });
          done = true;
          break;
        }
        continue; // occupied by something else → try next candidate
      }
      // write into this free candidate
      if (item.kind === "cron") {
        fs.mkdirSync(baseDir, { recursive: true });
        for (const f of unit.files ?? []) {
          const ext = path.extname(f);
          const isYaml = ext === ".yaml" || ext === ".yml";
          fs.copyFileSync(f, path.join(baseDir, `${cand}${isYaml ? ".yaml" : ".md"}`));
        }
      } else if (unit.kind === "dir" && unit.dir) {
        copyDir(unit.dir, destDir);
      } else {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(unit.primary, primaryDest);
      }
      outcomes.push({
        kind: item.kind,
        id: item.id,
        finalId: cand,
        dest: primaryDest,
        action: cand === item.id ? "written" : "namespaced",
      });
      done = true;
      break;
    }
    if (!done) {
      outcomes.push({ kind: item.kind, id: item.id, finalId: item.id, dest: "", action: "skipped", reason: "all candidate names occupied" });
    }
  }

  const writtenCount = outcomes.filter((o) => o.action !== "skipped").length;
  const skippedCount = outcomes.filter((o) => o.action === "skipped").length;
  return { outcomes, writtenCount, skippedCount };
}
