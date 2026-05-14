import fs from "fs";
import path from "path";
import type { Ledger, LedgerEntry, ClassificationLabel } from "./ledger.js";
import { PENDING_KEY, getPendingV06 } from "./ledger.js";
import type { Classification } from "./classifier.js";
import type { WorkflowMatchResult } from "./workflow-matcher.js";

/**
 * v0.5 §6.1 — renders the Markdown analysis report.
 *
 * Pure function over (ledger + classifications + workflow match). The CLI
 * wrapper saves the output to `<repo>/.solosquad/analysis/<date>-<slug>.md`.
 */

export interface RenderReportInput {
  repo_label: string;
  ledger: Ledger;
  classifications: Classification[];
  workflow_match: WorkflowMatchResult;
  scan_summary: {
    total_files: number;
    new_files: number;
    modified_files: number;
    unchanged_files: number;
    removed_files: number;
  };
  generated_at: string;
}

export function renderReport(input: RenderReportInput): string {
  const lines: string[] = [];
  lines.push(`# Analyze Report — ${input.repo_label}`);
  lines.push("");
  lines.push(`> Generated: ${input.generated_at}`);
  lines.push(`> Model: ${input.ledger.model.fingerprint}`);
  lines.push("");

  // Scan summary
  lines.push("## Scan Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Total skill files | ${input.scan_summary.total_files} |`);
  lines.push(`| New (this run) | ${input.scan_summary.new_files} |`);
  lines.push(`| Modified (this run) | ${input.scan_summary.modified_files} |`);
  lines.push(`| Unchanged (cached) | ${input.scan_summary.unchanged_files} |`);
  lines.push(`| Removed (orphaned ledger entries) | ${input.scan_summary.removed_files} |`);
  lines.push("");

  // Label distribution
  const dist = countLabels(input.ledger.analyzed);
  lines.push("## 4-Label Distribution");
  lines.push("");
  lines.push("| Label | Count |");
  lines.push("|---|---|");
  for (const label of ["codebase-fact", "domain", "workflow", "role"] as const) {
    lines.push(`| ${label} | ${dist[label] ?? 0} |`);
  }
  lines.push("");

  // Per-file classification
  lines.push("## Per-file Classification");
  lines.push("");
  lines.push("| Path | Label | Confidence | Destination | Ambiguous | pending_v0.6 |");
  lines.push("|---|---|---|---|---|---|");
  for (const entry of input.ledger.analyzed) {
    const amb = entry.ambiguous ? "yes" : "—";
    const pending = getPendingV06(entry) ? "yes" : "no";
    lines.push(
      `| \`${entry.path}\` | ${entry.classification} | ${entry.confidence.toFixed(2)} | ${escapeCell(entry.destination)} | ${amb} | ${pending} |`
    );
  }
  lines.push("");

  // Workflow match
  lines.push("## Workflow Match");
  lines.push("");
  if (input.workflow_match.no_match) {
    lines.push(
      "**No template match.** Best cover_rate < 0.5 — recommend authoring a custom workflow via `solosquad agent add` / messenger author loop."
    );
    lines.push("");
  }
  lines.push("| Template | Cover Rate | Matched Paths |");
  lines.push("|---|---|---|");
  for (const m of input.workflow_match.matches) {
    lines.push(
      `| ${m.template} | ${m.cover_rate.toFixed(2)} | ${m.matched_paths.length} |`
    );
  }
  lines.push("");

  // Recommended actions
  lines.push("## Recommended Actions");
  lines.push("");
  const ambiguous = input.classifications.filter((c) => c.ambiguous);
  const roleAndDomain = input.ledger.analyzed.filter((e) =>
    e.classification === "role" || e.classification === "domain"
  );
  if (ambiguous.length === 0 && roleAndDomain.length === 0 && input.workflow_match.no_match === false) {
    lines.push("- All files classified above threshold and a workflow template matched. Apply with `solosquad add repo <path> --from-report <this-file>`.");
  } else {
    lines.push(`- Review the ${ambiguous.length} ambiguous item${ambiguous.length === 1 ? "" : "s"} below before applying.`);
    if (roleAndDomain.length > 0) {
      lines.push(
        `- ${roleAndDomain.length} role/domain item${roleAndDomain.length === 1 ? "" : "s"} will be marked \`${PENDING_KEY}: true\` and re-destinated by the v0.6 migration.`
      );
    }
    if (input.workflow_match.no_match) {
      lines.push("- No template matched ≥ 0.5 — author a custom workflow or accept the closest match manually.");
    }
  }
  lines.push("");

  // Ambiguous items requiring human review
  lines.push("## Ambiguous Items (human review)");
  lines.push("");
  if (ambiguous.length === 0) {
    lines.push("_None._");
  } else {
    for (const a of ambiguous) {
      lines.push(`- \`${a.path}\` → primary guess: **${a.label}** (${a.confidence.toFixed(2)})`);
      const sorted = a.raw.slice().sort((x, y) => y.confidence - x.confidence);
      const tail = sorted
        .slice(1, 4)
        .map((s) => `${s.label} ${s.confidence.toFixed(2)}`)
        .join(", ");
      if (tail) lines.push(`  - Runner-up: ${tail}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function countLabels(entries: LedgerEntry[]): Record<ClassificationLabel, number> {
  const out: Record<ClassificationLabel, number> = {
    "codebase-fact": 0,
    domain: 0,
    workflow: 0,
    role: 0,
  };
  for (const e of entries) {
    out[e.classification] = (out[e.classification] ?? 0) + 1;
  }
  return out;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------------------
// Helpers for writing the rendered report to disk.
// ---------------------------------------------------------------------------

export function slugifyForReport(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "report"
  );
}

export function defaultReportPath(
  repoRoot: string,
  generatedAt: Date,
  slug: string
): string {
  const date = generatedAt.toISOString().slice(0, 10);
  return path.join(
    repoRoot,
    ".solosquad",
    "analysis",
    `${date}-${slugifyForReport(slug)}.md`
  );
}

export function writeReport(reportPath: string, body: string): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, body, "utf-8");
}
