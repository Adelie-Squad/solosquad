/**
 * v0.6 S6.B §11.5 — `<org>/domain/*.md` keyword overlap detection.
 *
 * domain/ files are free-form Markdown (no frontmatter) — they capture org
 * domain knowledge (market, customers, product, glossary, …). The risk is
 * that the *same* domain term gets a definition in two different files, so
 * spawn-time domain injection contradicts itself.
 *
 * The "term" surface for overlap detection:
 *   - Top-level Markdown headings (`# Term`, `## Term`, …).
 *   - Definition-style lines: `- **Term**: …` or `**Term**: …`.
 *
 * These two surfaces cover ~95% of how the v0.6 stub templates suggest
 * structuring a domain file (see `assets/templates/domain/glossary.md`).
 * Mid-paragraph mentions are deliberately ignored — they're describing,
 * not defining.
 *
 * Same-term occurrences inside the *same* file are not a conflict (that's
 * just a sub-section). Cross-file overlap is a warning, not an error —
 * legit cross-references exist; the reviewer decides.
 */
import { normalizeLine } from "../../src/util/platform.js";

export interface DomainTermOccurrence {
  file: string;
  /** Normalized term (lowercased, trimmed). */
  term: string;
  /** Original casing as it appeared in the file. */
  termRaw: string;
  /** 1-indexed line number. */
  line: number;
}

export interface DomainOverlap {
  term: string;
  occurrences: DomainTermOccurrence[];
}

/**
 * Extract definable terms from a single domain/*.md file.
 *
 *   `# Foo`        → term "Foo"
 *   `## Foo Bar`   → term "Foo Bar"
 *   `- **Foo**: x` → term "Foo"
 *   `**Foo**: x`   → term "Foo"
 */
export function extractDomainTerms(raw: string, filePath: string): DomainTermOccurrence[] {
  const lines = normalizeLine(raw).split("\n");
  const out: DomainTermOccurrence[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const termRaw = heading[1].trim();
      // Strip trailing punctuation that wouldn't be part of the term.
      const cleaned = termRaw.replace(/[.,;:!?]+$/, "").trim();
      if (cleaned) {
        out.push({
          file: filePath,
          term: cleaned.toLowerCase(),
          termRaw: cleaned,
          line: i + 1,
        });
      }
      continue;
    }

    // Bold definition pattern — match the *first* bold token on the line
    // followed by ":".  Examples:
    //   - **Customer Segment**: SMB
    //   **API Token**: ...
    const bold = /^\s*(?:[-*]\s+)?\*\*([^*]+)\*\*\s*:/.exec(line);
    if (bold) {
      const termRaw = bold[1].trim();
      if (termRaw) {
        out.push({
          file: filePath,
          term: termRaw.toLowerCase(),
          termRaw,
          line: i + 1,
        });
      }
    }
  }

  return out;
}

/**
 * Cross-file overlap detection. Same term defined in multiple files →
 * one DomainOverlap entry listing all occurrences.
 */
export function detectDomainOverlap(
  files: { path: string; content: string }[],
): DomainOverlap[] {
  const byTerm = new Map<string, DomainTermOccurrence[]>();

  for (const f of files) {
    const terms = extractDomainTerms(f.content, f.path);
    for (const t of terms) {
      const arr = byTerm.get(t.term) ?? [];
      arr.push(t);
      byTerm.set(t.term, arr);
    }
  }

  const overlaps: DomainOverlap[] = [];
  for (const [term, occurrences] of byTerm.entries()) {
    // Same-file repeats are fine — only flag when >1 *distinct* files.
    const distinctFiles = new Set(occurrences.map((o) => o.file));
    if (distinctFiles.size > 1) {
      overlaps.push({ term, occurrences });
    }
  }

  // Stable ordering for deterministic comment output.
  overlaps.sort((a, b) => a.term.localeCompare(b.term));
  return overlaps;
}
