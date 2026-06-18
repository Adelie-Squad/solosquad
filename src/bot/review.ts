/**
 * v1.3.2 §P1 — the manager `review` surface.
 *
 * `validate` catches what static rules can prove (kebab ids, cycles, broken
 * refs). `review` is the complementary LLM pass: it reads a definition (plus
 * its static findings as context) and suggests *quality* improvements a rule
 * set can't see — a vague skill description, an agent with no clear escalation
 * path, a workflow stage whose exit criterion isn't really measurable, a
 * schedule prompt that doesn't match its cadence.
 *
 * Mirrors the injectable-caller pattern used by agent-map (`AgentTeamCaller`)
 * and classifier (`ClassifierCaller`): the core is pure and deterministic; the
 * LLM lives behind `ReviewCaller` so tests drive it with a mock and the runtime
 * only consults a model when the user opts in. `runClaude` is imported lazily.
 */

export type ReviewKind = "skill" | "agent" | "workflow" | "goal" | "schedule";

export interface ReviewInput {
  kind: ReviewKind;
  id: string;
  /** Raw definition text (SKILL.md / workflow.yaml / goal.md / schedule yaml+prompt). */
  body: string;
  /** Static-validation findings, passed as context so review doesn't repeat them. */
  findings?: string[];
}

export type SuggestionSeverity = "blocker" | "improvement" | "nit";

export interface ReviewSuggestion {
  severity: SuggestionSeverity;
  message: string;
}

export interface ReviewResult {
  summary: string;
  suggestions: ReviewSuggestion[];
}

export interface ReviewCaller {
  review(input: ReviewInput): Promise<ReviewResult | null>;
  /** Diagnostic — incremented per invocation. */
  call_count?: number;
}

const PER_KIND_LENS: Record<ReviewKind, string> = {
  skill: "Is the description specific enough to route to (third-person, names the trigger)? Is the process actionable? Is scope single-purpose?",
  agent: "Is the role distinct from its team peers? Is there a clear escalation/handoff path? Are collaborators justified (no over-wiring)?",
  workflow: "Is each stage's exit criterion actually measurable? Is the handoff order sensible? Should any fixed stage be agentic (or vice-versa)?",
  goal: "Is the success metric objective and decidable? Are the guardrails (budget/cycles) proportionate? Is the modifiable-paths scope tight?",
  schedule: "Does the cadence match the prompt's intent? Is the channel right for the kind? Is the prompt self-contained for an unattended run?",
};

/** Build the review prompt (exported for tests + transparency). */
export function buildReviewPrompt(input: ReviewInput): string {
  return (
    `You are reviewing a SoloSquad ${input.kind} definition for quality.\n` +
    `Static validation already ran; do NOT repeat issues it would catch — focus on judgment calls.\n` +
    `Lens for a ${input.kind}: ${PER_KIND_LENS[input.kind]}\n\n` +
    (input.findings && input.findings.length
      ? `Static findings (context, already known):\n${input.findings.map((f) => `- ${f}`).join("\n")}\n\n`
      : "") +
    `--- ${input.id} ---\n${input.body}\n--- end ---\n\n` +
    `Respond with ONLY a JSON object, no prose:\n` +
    `{"summary": "<one sentence>", "suggestions": [{"severity": "blocker|improvement|nit", "message": "<actionable>"}]}`
  );
}

/** Parse a review reply (tolerant of prose around the JSON). */
export function parseReviewReply(raw: string): ReviewResult | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const summary = typeof o.summary === "string" ? o.summary : "";
    const rawSugs = Array.isArray(o.suggestions) ? o.suggestions : [];
    const suggestions: ReviewSuggestion[] = [];
    for (const s of rawSugs) {
      if (!s || typeof s !== "object") continue;
      const obj = s as Record<string, unknown>;
      const sev = obj.severity;
      const msg = obj.message;
      if (typeof msg !== "string" || !msg) continue;
      const severity: SuggestionSeverity =
        sev === "blocker" || sev === "improvement" || sev === "nit" ? sev : "improvement";
      suggestions.push({ severity, message: msg });
    }
    return { summary, suggestions };
  } catch {
    return null;
  }
}

/** Run a review through the injected caller. Returns null if the caller yields nothing. */
export async function reviewAsset(input: ReviewInput, caller: ReviewCaller): Promise<ReviewResult | null> {
  return caller.review(input);
}

/** Claude-backed caller — constructed only when the user opts in. */
export function createClaudeReviewCaller(cwd: string, timeoutMs = 60_000): ReviewCaller {
  const caller: ReviewCaller = {
    call_count: 0,
    async review(input) {
      caller.call_count = (caller.call_count ?? 0) + 1;
      const { runClaude } = await import("./claude-runner.js");
      const out = await runClaude(buildReviewPrompt(input), cwd, timeoutMs);
      return parseReviewReply(out);
    },
  };
  return caller;
}
