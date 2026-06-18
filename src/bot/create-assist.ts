/**
 * v1.3.2 §P1 — `create` assist for agent / goal / schedule.
 *
 * `agent add` / `goal new` and the new `schedules new` produce a deterministic
 * scaffold (frontmatter / yaml / placeholders). This adds an opt-in LLM pass
 * that drafts the *free-text body* from a one-line brief — the agent's process
 * steps, a schedule's prompt, a goal's intent prose — while the structured
 * scaffold stays machine-generated. The skill domain already has this (the
 * messenger author loop in skill-manager.ts); this is the CLI-side, single-shot
 * counterpart for the other three managers.
 *
 * Injectable caller (deterministic in tests, Claude-backed when opted in via
 * `--assist`). The caller only ever produces a *draft*; the command re-validates
 * and falls back to the plain scaffold if the draft is unusable — assist can
 * never produce an invalid asset.
 */

export type AssistKind = "agent" | "goal" | "schedule";

export interface AssistInput {
  kind: AssistKind;
  /** The asset id/name being created. */
  name: string;
  /** The user's one-line intent. */
  brief: string;
}

export interface AssistCaller {
  /** Draft the free-text body for the asset; null to fall back to the scaffold. */
  draft(input: AssistInput): Promise<string | null>;
  call_count?: number;
}

const PER_KIND_ASK: Record<AssistKind, string> = {
  agent:
    "Draft the Markdown body for a SoloSquad agent SKILL.md (NO frontmatter — that is generated separately). " +
    "Include a one-line role blurb, a numbered ## Process, ## Inputs, and ## Outputs.",
  schedule:
    "Draft the prompt body (Markdown) that this scheduled run will execute unattended. " +
    "Make it self-contained: what to gather, what to produce, where to post.",
  goal:
    "Draft the goal intent prose: the problem, an objective + measurable success metric, and the in-scope work. " +
    "Keep it concrete and decidable.",
};

export function buildAssistPrompt(input: AssistInput): string {
  return (
    `You are helping create a SoloSquad ${input.kind} named "${input.name}".\n` +
    `${PER_KIND_ASK[input.kind]}\n\n` +
    `Brief from the user: ${input.brief}\n\n` +
    `Respond with ONLY the Markdown body, no code fences, no preamble.`
  );
}

/** Strip a wrapping ``` code fence if the model added one. */
export function stripFences(raw: string): string {
  const t = raw.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(t);
  return (fence ? fence[1] : t).trim();
}

/** Claude-backed caller — constructed only when the user passes --assist. */
export function createClaudeAssistCaller(cwd: string, timeoutMs = 60_000): AssistCaller {
  const caller: AssistCaller = {
    call_count: 0,
    async draft(input) {
      caller.call_count = (caller.call_count ?? 0) + 1;
      const { runClaude } = await import("./claude-runner.js");
      const out = await runClaude(buildAssistPrompt(input), cwd, timeoutMs);
      const body = stripFences(out);
      // runClaude returns its error strings as plain text; guard against them.
      if (!body || /^(Error:|Claude Code is not installed|Response timed out)/.test(body)) return null;
      return body;
    },
  };
  return caller;
}
