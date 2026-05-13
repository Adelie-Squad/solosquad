/**
 * v1.2.5 — slash command bot-side parsing.
 *
 * The PM SKILL.md already instructs the model to recognize 5 slash prefixes
 * (`/think /plan /build /review /ship`) and act differently for each. This
 * module gives the bot a tiny pre-processor so it can:
 *   1. Validate that the prefix is a recognized command (typo detection)
 *   2. Optionally enrich the forwarded user text with a structured wrapper
 *      (`[SLASH /plan] <topic>`) so the PM has a stable parse signal even
 *      when the user types it informally.
 *   3. Print a help message in #owner-command for unknown slashes.
 *
 * We do NOT execute slash commands ourselves — the PM remains in charge of
 * what `/plan` actually means. This keeps the slash semantics in prompt
 * land, where iteration is cheap.
 */

export const KNOWN_SLASHES = new Set([
  "/think",
  "/plan",
  "/build",
  "/review",
  "/ship",
  "/help",
]);

export interface SlashCommand {
  command: string; // "/think"
  args: string;    // the rest after the command
}

/** Parse the leading slash command from a user message, if any. */
export function parseSlash(input: string): SlashCommand | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const match = trimmed.match(/^(\/[A-Za-z][A-Za-z0-9_-]*)(\s+([\s\S]*))?$/);
  if (!match) return null;
  return { command: match[1], args: match[3]?.trim() ?? "" };
}

export interface SlashHandlingResult {
  /** Text to forward to PM (possibly wrapped). May differ from input. */
  forwardText: string;
  /** Optional message to reply to the user directly (e.g. /help, unknown). */
  directReply?: string;
  /** If true, do not forward to PM (only directReply matters). */
  shortCircuit?: boolean;
}

/**
 * Normalize a user message for PM consumption. If the message begins with a
 * recognized slash, wrap it in a clear marker so PM SKILL.md can act on it
 * deterministically. Unknown slashes are reported back with a help hint.
 */
export function handleSlashIfAny(input: string): SlashHandlingResult {
  const slash = parseSlash(input);
  if (!slash) return { forwardText: input };

  if (slash.command === "/help") {
    return {
      forwardText: input,
      shortCircuit: true,
      directReply: helpText(),
    };
  }

  if (!KNOWN_SLASHES.has(slash.command)) {
    return {
      forwardText: input,
      shortCircuit: true,
      directReply:
        `Unknown command: ${slash.command}. Known: /think, /plan, /build, /review, /ship. ` +
        `Send /help for usage.`,
    };
  }

  // Wrap with a structured marker so PM has a stable parse target.
  return {
    forwardText: `[SLASH ${slash.command}] ${slash.args}`.trim(),
  };
}

function helpText(): string {
  return [
    "*Slash commands (v0.3.1+)*",
    "/think <topic>     — pre-PRD exploration. Hypotheses, signals, options.",
    "/plan <topic>      — write a PRD + decompose into stages.",
    "/build [stage-id]  — spawn the next ready stage (or the named one).",
    "/review            — synthesize completed stages, flag blockers.",
    "/ship              — release / deploy routine (v0.4 autonomous engine).",
    "",
    "Any other message goes through PM as natural language.",
  ].join("\n");
}
