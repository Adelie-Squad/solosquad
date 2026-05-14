/**
 * v0.6 S6.B §11.5 — Lightweight markdown lint for `<org>/core/*.md`.
 *
 * Core files (`PRINCIPLES.md`, `VOICE.md`) are injected into every spawn via
 * the 8-layer assembler. An empty or malformed file would silently poison
 * every agent in the org. We catch two specific problems here:
 *
 *   1. Empty / whitespace-only files.
 *   2. First non-blank line is not a Markdown heading (#, ##, …) — this is
 *      a soft contract from `assets/templates/core/PRINCIPLES.md` and is
 *      what makes the file useful as a heading-indexable context block.
 *
 * `<org>/domain/*.md` files are explicitly free-form (per §11.5) so they are
 * NOT run through this linter — their conflict check lives in
 * `domain-overlap.ts`.
 *
 * The linter is intentionally minimal — we don't try to validate semantic
 * correctness, only the structural minimums that prevent silent failure.
 */
import { normalizeLine } from "../../src/util/platform.js";

export interface MarkdownLintIssue {
  severity: "error" | "warning";
  line?: number;
  message: string;
}

export interface MarkdownLintResult {
  ok: boolean;
  issues: MarkdownLintIssue[];
}

export function lintCoreMarkdown(raw: string): MarkdownLintResult {
  const issues: MarkdownLintIssue[] = [];

  const text = normalizeLine(raw);
  const stripped = text.trim();

  if (stripped.length === 0) {
    issues.push({
      severity: "error",
      message: "file is empty or whitespace-only — core/*.md is injected into every spawn",
    });
    return { ok: false, issues };
  }

  // First non-blank line should be a Markdown heading.
  const lines = text.split("\n");
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstIdx = i;
      break;
    }
  }

  if (firstIdx === -1) {
    // Should be unreachable given the stripped check above, but defensive.
    issues.push({
      severity: "error",
      message: "no non-blank lines found",
    });
    return { ok: false, issues };
  }

  const firstLine = lines[firstIdx];
  if (!/^#{1,6}\s/.test(firstLine)) {
    issues.push({
      severity: "error",
      line: firstIdx + 1,
      message:
        "first non-blank line must be a Markdown heading (`# Title`) — core/*.md is consumed as a heading-indexed context block",
    });
  }

  const ok = !issues.some((i) => i.severity === "error");
  return { ok, issues };
}
