/**
 * v0.6 S6.B §11 — Markdown comment renderer for the PR review bot.
 *
 * One comment per PR. The body has four sections:
 *
 *   1. Header (✅ all-green or ❌ N issues) + marker comment so subsequent
 *      runs can detect & replace the previous bot comment.
 *   2. Frontmatter diff tables — one per changed SKILL.md.
 *   3. Keyword conflicts — one bulleted line each, ⚠ for warning, ❌ for error.
 *   4. v0.6 asset checks — agent-profile / core / domain overlap issues.
 *
 * Format choice for diff: **markdown table** (per spec — "표 형식"). For pure-add
 * or pure-remove files we fall back to a yaml code block since there's no
 * "before vs after" pair to tabulate.
 */
import type { FrontmatterDiff, FieldChange } from "./frontmatter-diff.js";
import type { KeywordConflict } from "./keyword-conflict.js";
import type { ProfileValidationIssue } from "./profile-validator.js";
import type { MarkdownLintIssue } from "./markdown-lint.js";
import type { DomainOverlap } from "./domain-overlap.js";

/** Unique marker — used to find & update the previous comment on re-runs. */
export const COMMENT_MARKER = "<!-- solosquad-skill-pr-review-v0.6 -->";

export interface ProfileFileResult {
  path: string;
  issues: ProfileValidationIssue[];
}

export interface CoreFileResult {
  path: string;
  issues: MarkdownLintIssue[];
}

export interface CommentInput {
  diffs: FrontmatterDiff[];
  keywordConflicts: KeywordConflict[];
  profileResults: ProfileFileResult[];
  coreResults: CoreFileResult[];
  domainOverlaps: DomainOverlap[];
}

function formatValue(value: unknown): string {
  if (value === undefined) return "_(unset)_";
  if (value === null) return "`null`";
  if (typeof value === "string") {
    // Avoid breaking the table — escape pipes, render multi-line as inline JSON.
    if (value.includes("\n") || value.includes("|")) return `\`${JSON.stringify(value)}\``;
    return `\`${value}\``;
  }
  if (typeof value === "number" || typeof value === "boolean") return `\`${value}\``;
  const json = JSON.stringify(value);
  // Keep tables tidy — escape pipes in the rendered JSON.
  return `\`${json.replace(/\|/g, "\\|")}\``;
}

function renderDiffTable(diff: FrontmatterDiff): string {
  const lines: string[] = [];
  lines.push(`### \`${diff.path}\``);

  if (diff.parseErrors.length > 0) {
    lines.push("");
    lines.push("> ⚠ Parse error(s):");
    for (const e of diff.parseErrors) lines.push(`> - ${e}`);
  }

  if (diff.added) {
    lines.push("");
    lines.push("_New file._ Full frontmatter:");
    lines.push("");
    lines.push("```yaml");
    lines.push(diff.afterRaw ?? "(unparseable)");
    lines.push("```");
    return lines.join("\n");
  }

  if (diff.removed) {
    lines.push("");
    lines.push("_File removed._ Previous frontmatter:");
    lines.push("");
    lines.push("```yaml");
    lines.push(diff.beforeRaw ?? "(unparseable)");
    lines.push("```");
    return lines.join("\n");
  }

  if (diff.changes.length === 0) {
    lines.push("");
    lines.push("_No frontmatter changes._ (Body-only edit.)");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("| Field | Kind | Before | After |");
  lines.push("|---|---|---|---|");
  for (const c of diff.changes) {
    lines.push(
      `| \`${c.field}\` | ${badge(c.kind)} | ${formatValue(c.before)} | ${formatValue(c.after)} |`,
    );
  }
  return lines.join("\n");
}

function badge(kind: FieldChange["kind"]): string {
  switch (kind) {
    case "added":
      return "+ added";
    case "removed":
      return "− removed";
    case "modified":
      return "~ modified";
  }
}

function renderKeywordConflicts(conflicts: KeywordConflict[]): string {
  if (conflicts.length === 0) return "";
  const lines: string[] = [];
  lines.push("## Keyword conflicts");
  lines.push("");
  for (const c of conflicts) {
    const sigil = c.severity === "error" ? "❌" : "⚠";
    lines.push(
      `- ${sigil} **${c.skill}** keyword \`${c.keyword}\` vs **${c.conflictsWith}** keyword \`${c.conflictsWithKeyword}\` — ${c.reason}`,
    );
  }
  return lines.join("\n");
}

function renderProfileIssues(results: ProfileFileResult[]): string {
  if (results.length === 0) return "";
  const lines: string[] = [];
  lines.push("## `agent-profile.yaml` validation");
  lines.push("");
  for (const r of results) {
    if (r.issues.length === 0) {
      lines.push(`- ✅ \`${r.path}\` — schema valid`);
      continue;
    }
    lines.push(`- \`${r.path}\``);
    for (const i of r.issues) {
      const sigil = i.severity === "error" ? "❌" : "⚠";
      const field = i.field ? ` (\`${i.field}\`)` : "";
      lines.push(`    - ${sigil}${field} ${i.message}`);
    }
  }
  return lines.join("\n");
}

function renderCoreIssues(results: CoreFileResult[]): string {
  if (results.length === 0) return "";
  const lines: string[] = [];
  lines.push("## `<org>/core/*.md` lint");
  lines.push("");
  for (const r of results) {
    if (r.issues.length === 0) {
      lines.push(`- ✅ \`${r.path}\``);
      continue;
    }
    lines.push(`- \`${r.path}\``);
    for (const i of r.issues) {
      const sigil = i.severity === "error" ? "❌" : "⚠";
      const at = i.line ? ` (line ${i.line})` : "";
      lines.push(`    - ${sigil}${at} ${i.message}`);
    }
  }
  return lines.join("\n");
}

function renderDomainOverlaps(overlaps: DomainOverlap[]): string {
  if (overlaps.length === 0) return "";
  const lines: string[] = [];
  lines.push("## `<org>/domain/*.md` term overlap");
  lines.push("");
  for (const o of overlaps) {
    const files = o.occurrences.map((occ) => `\`${occ.file}\` (L${occ.line})`).join(", ");
    lines.push(`- ⚠ \`${o.term}\` defined in: ${files}`);
  }
  return lines.join("\n");
}

export interface CommentBuildResult {
  body: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
}

export function buildComment(input: CommentInput): CommentBuildResult {
  let errorCount = 0;
  let warningCount = 0;

  for (const d of input.diffs) {
    errorCount += d.parseErrors.length;
  }
  for (const c of input.keywordConflicts) {
    if (c.severity === "error") errorCount++;
    else warningCount++;
  }
  for (const p of input.profileResults) {
    for (const i of p.issues) {
      if (i.severity === "error") errorCount++;
      else warningCount++;
    }
  }
  for (const c of input.coreResults) {
    for (const i of c.issues) {
      if (i.severity === "error") errorCount++;
      else warningCount++;
    }
  }
  warningCount += input.domainOverlaps.length;

  const ok = errorCount === 0;
  const header = ok
    ? `## ✅ SKILL PR review — all checks passed${warningCount > 0 ? ` (${warningCount} warning${warningCount === 1 ? "" : "s"})` : ""}`
    : `## ❌ SKILL PR review — ${errorCount} error${errorCount === 1 ? "" : "s"}, ${warningCount} warning${warningCount === 1 ? "" : "s"}`;

  const parts: string[] = [COMMENT_MARKER, header];

  if (input.diffs.length > 0) {
    parts.push("");
    parts.push("## Frontmatter diff");
    for (const d of input.diffs) {
      parts.push("");
      parts.push(renderDiffTable(d));
    }
  }

  const kwBlock = renderKeywordConflicts(input.keywordConflicts);
  if (kwBlock) {
    parts.push("");
    parts.push(kwBlock);
  }

  const profileBlock = renderProfileIssues(input.profileResults);
  if (profileBlock) {
    parts.push("");
    parts.push(profileBlock);
  }

  const coreBlock = renderCoreIssues(input.coreResults);
  if (coreBlock) {
    parts.push("");
    parts.push(coreBlock);
  }

  const domainBlock = renderDomainOverlaps(input.domainOverlaps);
  if (domainBlock) {
    parts.push("");
    parts.push(domainBlock);
  }

  if (
    input.diffs.length === 0 &&
    input.keywordConflicts.length === 0 &&
    input.profileResults.length === 0 &&
    input.coreResults.length === 0 &&
    input.domainOverlaps.length === 0
  ) {
    parts.push("");
    parts.push("_No SKILL/profile/core/domain changes detected in this PR._");
  }

  return {
    body: parts.join("\n") + "\n",
    ok,
    errorCount,
    warningCount,
  };
}
