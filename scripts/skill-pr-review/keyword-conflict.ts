/**
 * v0.6 S6.B §11 — Keyword conflict detection across SKILL files in a PR.
 *
 * v0.5 router uses *case-insensitive substring* keyword matching (see
 * `src/bot/agent-router.ts` line 175-178). So a SKILL declaring keyword
 * "deploy" hijacks any message containing "deploy production", "redeploy",
 * etc. The conflict rule we enforce in PR review is two-sided:
 *
 *   1. Substring overlap — `kw_new` is a substring of `kw_existing`, or
 *      vice versa. Either direction is a routing ambiguity (the longer
 *      keyword wins on insertion order in the route index, which is fragile).
 *   2. Reserved prefix — v0.5 slash prefix conflict rule from
 *      `skill-parser.validateSkill` (RESERVED_SLASHES). Slash conflicts are
 *      already caught by the `validate` job; we re-check them in the PR
 *      comment so the reviewer sees the *why* without digging into the
 *      validate log.
 *
 * Same-SKILL re-declaration (a SKILL adds a keyword it already had) is not
 * a conflict — it's a no-op.
 *
 * Exact-equality matches between *different* SKILLs are the worst case and
 * get severity "error" instead of "warning".
 */

export type ConflictSeverity = "error" | "warning";

export interface KeywordConflict {
  severity: ConflictSeverity;
  /** SKILL declaring the new/changed keyword (in this PR). */
  skill: string;
  keyword: string;
  /** SKILL the keyword conflicts with (an existing one, or another in the same PR). */
  conflictsWith: string;
  conflictsWithKeyword: string;
  /** Human-readable reason. */
  reason: string;
}

export interface SkillKeywordSet {
  /** SKILL name (frontmatter `name` field, NOT path). */
  name: string;
  keywords: string[];
}

function norm(k: string): string {
  return k.trim().toLowerCase();
}

function isSubstringConflict(a: string, b: string): boolean {
  if (a === b) return false; // exact match handled separately
  return a.includes(b) || b.includes(a);
}

/**
 * Check `incoming` (new or changed keyword entries from the PR) against
 * `existing` (pre-PR baseline set). Two SKILLs introducing colliding
 * keywords in the *same* PR also get flagged.
 */
export function detectKeywordConflicts(
  incoming: SkillKeywordSet[],
  existing: SkillKeywordSet[],
): KeywordConflict[] {
  const out: KeywordConflict[] = [];

  // Build existing index: keyword (normalized) → [skill names].
  const existingIndex = new Map<string, string[]>();
  for (const e of existing) {
    for (const kRaw of e.keywords) {
      const k = norm(kRaw);
      if (!k) continue;
      const arr = existingIndex.get(k) ?? [];
      arr.push(e.name);
      existingIndex.set(k, arr);
    }
  }

  for (const inc of incoming) {
    for (const kwRaw of inc.keywords) {
      const kw = norm(kwRaw);
      if (!kw) continue;

      // 1. Exact match against a different existing SKILL.
      const exact = existingIndex.get(kw);
      if (exact) {
        for (const otherSkill of exact) {
          if (otherSkill === inc.name) continue;
          out.push({
            severity: "error",
            skill: inc.name,
            keyword: kwRaw,
            conflictsWith: otherSkill,
            conflictsWithKeyword: kwRaw,
            reason: `exact keyword collision — both "${inc.name}" and "${otherSkill}" register "${kw}"`,
          });
        }
      }

      // 2. Substring overlap against all existing keywords.
      for (const [otherKw, owners] of existingIndex.entries()) {
        if (otherKw === kw) continue; // exact already handled
        if (!isSubstringConflict(kw, otherKw)) continue;
        for (const owner of owners) {
          if (owner === inc.name) continue;
          out.push({
            severity: "warning",
            skill: inc.name,
            keyword: kwRaw,
            conflictsWith: owner,
            conflictsWithKeyword: otherKw,
            reason: `keyword "${kw}" has substring overlap with existing "${otherKw}" (owner: ${owner}) — router uses case-insensitive substring match`,
          });
        }
      }
    }
  }

  // 3. Cross-PR conflicts — incoming vs incoming.
  for (let i = 0; i < incoming.length; i++) {
    for (let j = i + 1; j < incoming.length; j++) {
      const a = incoming[i];
      const b = incoming[j];
      if (a.name === b.name) continue;
      for (const akwRaw of a.keywords) {
        const akw = norm(akwRaw);
        if (!akw) continue;
        for (const bkwRaw of b.keywords) {
          const bkw = norm(bkwRaw);
          if (!bkw) continue;
          if (akw === bkw) {
            out.push({
              severity: "error",
              skill: a.name,
              keyword: akwRaw,
              conflictsWith: b.name,
              conflictsWithKeyword: bkwRaw,
              reason: `this PR adds the same keyword "${akw}" to two SKILLs (${a.name}, ${b.name})`,
            });
          } else if (isSubstringConflict(akw, bkw)) {
            out.push({
              severity: "warning",
              skill: a.name,
              keyword: akwRaw,
              conflictsWith: b.name,
              conflictsWithKeyword: bkwRaw,
              reason: `this PR introduces substring-overlapping keywords ("${akw}" vs "${bkw}") on ${a.name} and ${b.name}`,
            });
          }
        }
      }
    }
  }

  return out;
}
