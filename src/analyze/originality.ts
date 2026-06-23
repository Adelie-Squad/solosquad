/**
 * v1.3.6 §3.2 — originality gate (anti-reskin).
 *
 * Ported from agency-agents `check-agent-originality.sh`: detect when a new
 * asset's prose is largely a copy of an existing one (a "re-skin" — same role
 * rewritten under a new name). We do this statically, without behavioural eval:
 * neutralize entity names, slice text into N-word shingles, and measure how
 * much of each asset's shingle set also appears in *another* asset.
 *
 *   overlap(A) = max over B≠A of |shingles(A) ∩ shingles(B)| / |shingles(A)|
 *
 * FAIL ≥ 0.40 (likely re-skin / role overlap), WARN ≥ 0.20. Used for both
 * skills and agents (260618 Part D/G2). Pure — no fs, no domain types.
 */

export interface OriginalityItem {
  /** Asset id, e.g. "skill-manager" or "product/product-manager". */
  id: string;
  /** Prose to compare — typically description + SKILL.md body. */
  text: string;
}

export interface OriginalityFinding {
  /** The asset whose text is largely duplicated. */
  id: string;
  /** The other asset it most overlaps with. */
  against: string;
  /** Fraction of `id`'s shingles also present in `against` (0..1). */
  overlap: number;
  level: "fail" | "warn";
}

export interface OriginalityOptions {
  /** Shingle window in words. Default 8 (agency-agents). */
  shingleSize?: number;
  /** ≥ this fraction → fail. Default 0.40. */
  failThreshold?: number;
  /** ≥ this fraction → warn. Default 0.20. */
  warnThreshold?: number;
}

const DEFAULTS = { shingleSize: 8, failThreshold: 0.4, warnThreshold: 0.2 };

/**
 * Neutralize entity-specific tokens so a pure re-skin (identical text except
 * the asset name) reads as near-total overlap. Lowercases, drops the asset's
 * own name segments, strips markdown/punctuation, collapses whitespace.
 */
export function neutralize(text: string, id: string): string {
  const nameTokens = new Set(
    id
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0),
  );
  return text
    .toLowerCase()
    .replace(/[`*_#>|\[\]()~]/g, " ") // markdown punctuation
    .replace(/[^a-z0-9가-힣\s]/g, " ") // keep latin/digits/hangul
    .split(/\s+/)
    .filter((w) => w.length > 0 && !nameTokens.has(w))
    .join(" ");
}

/** Word shingles (sliding window of `size`) for a neutralized string. */
export function shingles(neutralized: string, size: number): Set<string> {
  const words = neutralized.split(" ").filter((w) => w.length > 0);
  const out = new Set<string>();
  if (words.length < size) {
    // Short texts: use the whole thing as one shingle so they still compare.
    if (words.length > 0) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + size <= words.length; i++) {
    out.add(words.slice(i, i + size).join(" "));
  }
  return out;
}

/**
 * Run the originality gate across a corpus. Returns one finding per asset that
 * crosses the warn threshold (its single worst overlap), highest overlap first.
 */
export function checkOriginality(
  items: OriginalityItem[],
  opts: OriginalityOptions = {},
): OriginalityFinding[] {
  const size = opts.shingleSize ?? DEFAULTS.shingleSize;
  const failT = opts.failThreshold ?? DEFAULTS.failThreshold;
  const warnT = opts.warnThreshold ?? DEFAULTS.warnThreshold;

  const sets = items.map((it) => ({ id: it.id, sh: shingles(neutralize(it.text, it.id), size) }));
  const findings: OriginalityFinding[] = [];

  for (const a of sets) {
    if (a.sh.size === 0) continue;
    let best = 0;
    let against = "";
    for (const b of sets) {
      if (b.id === a.id || b.sh.size === 0) continue;
      let shared = 0;
      for (const s of a.sh) if (b.sh.has(s)) shared++;
      const overlap = shared / a.sh.size;
      if (overlap > best) {
        best = overlap;
        against = b.id;
      }
    }
    if (best >= warnT) {
      findings.push({
        id: a.id,
        against,
        overlap: best,
        level: best >= failT ? "fail" : "warn",
      });
    }
  }

  return findings.sort((x, y) => y.overlap - x.overlap);
}
