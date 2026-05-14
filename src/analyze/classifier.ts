import type { ClassificationLabel } from "./ledger.js";

/**
 * v0.5 §6.2 — 4-label classifier with priority `codebase-fact > domain >
 * workflow > role`. Real Anthropic API integration is deferred; the
 * `ClassifierCaller` interface lets tests inject a mock and lets a future
 * sprint plug in `@anthropic-ai/sdk` without touching call sites.
 *
 * Priority resolution: when the caller returns multiple labels with
 * comparable confidence the most *concrete* wins. This is the inverse of
 * how an LLM would rank by salience — codebase facts are concrete enough
 * that they should stay in the repo even if the file *also* reads like
 * domain knowledge.
 *
 * Ambiguity: when max-confidence label scores < 0.7, mark `ambiguous: true`
 * so the report routes the file to human review.
 */

export const AMBIGUITY_THRESHOLD = 0.7;
export const DEFAULT_BATCH_SIZE = 8;

const PRIORITY: Record<ClassificationLabel, number> = {
  "codebase-fact": 4,
  domain: 3,
  workflow: 2,
  role: 1,
};

export interface ClassifierInput {
  path: string;
  body: string;
}

export interface RawScore {
  label: ClassificationLabel;
  confidence: number;
}

/** A caller returns one or more candidate labels per file, ordered freely. */
export interface ClassifierCaller {
  classify(batch: ClassifierInput[]): Promise<RawScore[][]>;
  /** Diagnostic — incremented by each batch invocation. Tests assert == 0 for cached runs. */
  call_count?: number;
}

export interface Classification {
  path: string;
  label: ClassificationLabel;
  confidence: number;
  ambiguous: boolean;
  raw: RawScore[];
}

export interface ClassifyOpts {
  caller: ClassifierCaller;
  batch_size?: number;
  /** Override for tests of the ambiguity gate. */
  ambiguity_threshold?: number;
}

export async function classifyBatch(
  skills: ClassifierInput[],
  opts: ClassifyOpts
): Promise<Classification[]> {
  if (skills.length === 0) return [];
  const batchSize = opts.batch_size ?? DEFAULT_BATCH_SIZE;
  const threshold = opts.ambiguity_threshold ?? AMBIGUITY_THRESHOLD;
  const results: Classification[] = [];

  for (let i = 0; i < skills.length; i += batchSize) {
    const slice = skills.slice(i, i + batchSize);
    const scores = await opts.caller.classify(slice);
    if (scores.length !== slice.length) {
      throw new Error(
        `classifier returned ${scores.length} scores for ${slice.length} inputs`
      );
    }
    for (let j = 0; j < slice.length; j++) {
      const winner = pickWinner(scores[j]);
      const ambiguous = winner.confidence < threshold;
      results.push({
        path: slice[j].path,
        label: winner.label,
        confidence: winner.confidence,
        ambiguous,
        raw: scores[j],
      });
    }
  }
  return results;
}

/**
 * Priority-resolve a list of raw scores. The caller may return multiple
 * candidates; we pick by `confidence`, tie-break by priority weight (codebase-
 * fact wins ties over domain, etc.).
 */
export function pickWinner(scores: RawScore[]): RawScore {
  if (scores.length === 0) {
    throw new Error("classifier returned 0 scores for an input");
  }
  let best = scores[0];
  for (const s of scores.slice(1)) {
    if (s.confidence > best.confidence) {
      best = s;
    } else if (
      s.confidence === best.confidence &&
      PRIORITY[s.label] > PRIORITY[best.label]
    ) {
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Simple keyword-based fallback caller — useful for fixtures and as a
// deterministic baseline before the real Anthropic SDK lands.
// ---------------------------------------------------------------------------

const ROLE_HINTS = ["act as", "you are", "persona", "voice", "tone", "style"];
const WORKFLOW_HINTS = ["stage", "handoff", "phase", "→", "->", "pipeline", "step 1"];
const FACT_HINTS = ["deploy", "build", "src/", "lib/", "package.json", "Dockerfile", "ci/"];
const DOMAIN_HINTS = ["domain", "business rule", "policy", "glossary", "terminology"];

export function createHeuristicCaller(): ClassifierCaller {
  const caller: ClassifierCaller = {
    call_count: 0,
    async classify(batch) {
      caller.call_count = (caller.call_count ?? 0) + 1;
      return batch.map((b) => scoreHeuristic(b.body));
    },
  };
  return caller;
}

function scoreHeuristic(body: string): RawScore[] {
  const lower = body.toLowerCase();
  const role = count(lower, ROLE_HINTS);
  const workflow = count(lower, WORKFLOW_HINTS);
  const fact = count(lower, FACT_HINTS);
  const domain = count(lower, DOMAIN_HINTS);
  const total = Math.max(1, role + workflow + fact + domain);
  return [
    { label: "role", confidence: role / total },
    { label: "workflow", confidence: workflow / total },
    { label: "codebase-fact", confidence: fact / total },
    { label: "domain", confidence: domain / total },
  ];
}

function count(text: string, needles: string[]): number {
  let n = 0;
  for (const w of needles) {
    const lower = w.toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(lower, pos)) !== -1) {
      n++;
      pos += lower.length;
    }
  }
  return n;
}
