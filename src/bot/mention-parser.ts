/**
 * v1.0.1 — `@<slug>` mention syntax for multi-repo intent routing.
 *
 * SoloSquad's value prop is "one agent across multiple repos". The PM
 * already infers target_repo from message content via LLM reasoning,
 * but inference is lossy and expensive. This module gives the user a
 * **zero-cost, deterministic override**: any message containing
 * `@<slug>` where `<slug>` matches a registered repo gets a stable
 * marker injected for the PM to honor.
 *
 * Pattern source: GitHub Slack app's `@<repo>` mention + `/github
 * subscribe owner/repo` (see `docs/plan/v1.0.1-discord-ready-deprecation.md`
 * §3 for the alternatives reviewed). Cheap because routing happens at
 * regex time, before any LLM call.
 *
 * Disambiguation from Discord user pings: Discord mentions are
 * `<@123456789>` (numeric id wrapped in angle brackets). Our pattern
 * matches `@<word-chars>` and then *intersects with the registered
 * slug list* — typos and Discord usernames silently drop through and
 * the message reaches the PM as ordinary text. No false positives.
 */

const MENTION_PATTERN = /@([a-zA-Z0-9][a-zA-Z0-9_.-]*)/g;

export interface MentionResult {
  /** Mentioned slugs that match a registered repo, in order of appearance, deduped. */
  mentioned: string[];
  /** Mentions that looked like @something but didn't match any registered slug. */
  unknown: string[];
  /**
   * Text to forward to PM. When one or more mentions resolve, a stable
   * `[target_repo:<slug>]` (single) or `[target_repos:<a>,<b>]` (multi)
   * prefix is prepended so PM SKILL.md can parse it deterministically.
   * Mentions inside the message are left intact for human readability.
   */
  forwardText: string;
}

/**
 * Scan `input` for `@<slug>` tokens and resolve them against the org's
 * `registeredSlugs` list. Caller passes the slug list (cheap directory
 * listing in `bot/index.ts`); this keeps the parser pure and testable.
 *
 * Returns the original text plus a target_repo marker prefix when any
 * mention resolved. When zero mentions resolve, returns input unchanged.
 */
export function parseMentions(
  input: string,
  registeredSlugs: readonly string[],
): MentionResult {
  const slugSet = new Set(registeredSlugs);
  const seen = new Set<string>();
  const mentioned: string[] = [];
  const unknown: string[] = [];

  for (const match of input.matchAll(MENTION_PATTERN)) {
    const candidate = match[1];
    if (slugSet.has(candidate)) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        mentioned.push(candidate);
      }
    } else {
      unknown.push(candidate);
    }
  }

  if (mentioned.length === 0) {
    return { mentioned, unknown, forwardText: input };
  }

  const marker =
    mentioned.length === 1
      ? `[target_repo:${mentioned[0]}]`
      : `[target_repos:${mentioned.join(",")}]`;
  return {
    mentioned,
    unknown,
    forwardText: `${marker} ${input}`,
  };
}
