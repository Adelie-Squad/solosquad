/**
 * v1.3.2 §10.3 — map an external/adopted agent onto the SoloSquad taxonomy
 * (team + tier). Deterministic heuristic-first pass (this module); the LLM
 * fallback for genuinely ambiguous actors is a follow-up. The ETL default-
 * fallback pattern: known frontmatter wins, else keyword heuristic, else a
 * `default` team flagged low-confidence for human review.
 */

export type SsTeam = "product" | "engineering" | "design" | "marketing" | "chief";
export type SsTier = "leader" | "member";

export interface AgentMapping {
  team: SsTeam;
  tier: SsTier;
  /** high when frontmatter declared it or the name matched; low otherwise. */
  confidence: "high" | "low";
  source: "frontmatter" | "heuristic" | "default" | "llm";
}

export interface AgentMapInput {
  name: string;
  frontmatterTeam?: string;
  frontmatterTier?: string;
  description?: string;
}

const KNOWN_TEAMS: ReadonlySet<string> = new Set([
  "product",
  "engineering",
  "design",
  "marketing",
  "chief",
]);

/** Ordered: a name token matching an earlier team wins ties deterministically. */
const TEAM_KEYWORDS: ReadonlyArray<[SsTeam, string[]]> = [
  ["design", ["design", "ui", "ux", "research", "visual", "figma", "prototyp"]],
  ["marketing", ["market", "growth", "gtm", "brand", "content", "seo", "campaign", "ads", "advertis"]],
  ["product", ["product", "pm", "pmf", "feature", "roadmap", "discovery", "strategy", "business", "policy", "analyst", "scope"]],
  ["engineering", ["engineer", "backend", "frontend", "fde", "data", "devops", "cloud", "security", "qa", "architect", "api", "infra"]],
  ["chief", ["chief", "orchestrat", "supervisor"]],
];

const LEADER_HINTS = ["lead", "manager", "orchestrat", "supervisor", "chief", "head"];

function matchTeam(text: string): SsTeam | null {
  for (const [team, kws] of TEAM_KEYWORDS) {
    if (kws.some((k) => text.includes(k))) return team;
  }
  return null;
}

export function mapAgentToTaxonomy(input: AgentMapInput): AgentMapping {
  const fmTeam = input.frontmatterTeam?.trim().toLowerCase();
  const name = input.name.toLowerCase();
  const desc = (input.description ?? "").toLowerCase();

  // tier — frontmatter wins, else leader hint in name, else member
  let tier: SsTier = "member";
  if (input.frontmatterTier === "leader" || input.frontmatterTier === "member") {
    tier = input.frontmatterTier;
  } else if (LEADER_HINTS.some((h) => name.includes(h))) {
    tier = "leader";
  }

  // team — frontmatter (if a known team) > name keyword > description keyword > default
  if (fmTeam && KNOWN_TEAMS.has(fmTeam)) {
    return { team: fmTeam as SsTeam, tier, confidence: "high", source: "frontmatter" };
  }
  const byName = matchTeam(name);
  if (byName) return { team: byName, tier, confidence: "high", source: "heuristic" };
  const byDesc = matchTeam(desc);
  if (byDesc) return { team: byDesc, tier, confidence: "low", source: "heuristic" };

  return { team: "engineering", tier, confidence: "low", source: "default" };
}

// ---------------------------------------------------------------------------
// §10.3 LLM fallback — escalate *only* the genuinely ambiguous actors (those
// the heuristic could place nowhere → `source: "default"`). The deterministic
// heuristic stays the default everywhere (the read-only dry-run never calls an
// LLM); a caller is injected opt-in (`solosquad adopt --classify`). The pattern
// mirrors classifier.ts's `ClassifierCaller`: an interface + `call_count` so
// tests assert exactly when (and whether) the model was consulted.
// ---------------------------------------------------------------------------

export interface AgentTeamCaller {
  /** Classify one actor; return null to defer to the heuristic default. */
  classify(input: AgentMapInput): Promise<{ team: SsTeam; tier?: SsTier } | null>;
  /** Diagnostic — incremented per invocation. Tests assert 0 for confident actors. */
  call_count?: number;
}

export interface MapAgentOpts {
  /** When set, actors the heuristic left at `default` are escalated to this caller. */
  caller?: AgentTeamCaller;
}

/**
 * Heuristic-first map with an optional LLM escalation for ambiguous actors.
 * Confident actors (frontmatter/name/description match) never reach the caller,
 * so the model is consulted at most once per genuinely-unknown actor. A caller
 * error or an unrecognized team silently falls back to the heuristic default —
 * adoption is never blocked on the LLM.
 */
export async function mapAgentTeam(input: AgentMapInput, opts: MapAgentOpts = {}): Promise<AgentMapping> {
  const heuristic = mapAgentToTaxonomy(input);
  if (heuristic.source !== "default" || !opts.caller) return heuristic;
  try {
    const r = await opts.caller.classify(input);
    if (r && KNOWN_TEAMS.has(r.team)) {
      return {
        team: r.team,
        // declared tier still wins; otherwise take the LLM's, else the heuristic's.
        tier: r.tier === "leader" || r.tier === "member" ? r.tier : heuristic.tier,
        // an LLM guess beats a blind default but is still unverified → keep it
        // flagged for review, just labelled so the report can say "llm-suggested".
        confidence: "low",
        source: "llm",
      };
    }
  } catch {
    /* model unavailable / bad reply → heuristic default below */
  }
  return heuristic;
}

/** Parse a team-classification reply (tolerant of prose around the JSON). */
export function parseTeamReply(raw: string): { team: SsTeam; tier?: SsTier } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const team = typeof o.team === "string" ? o.team.trim().toLowerCase() : "";
    if (!KNOWN_TEAMS.has(team)) return null;
    const tier = o.tier === "leader" || o.tier === "member" ? (o.tier as SsTier) : undefined;
    return { team: team as SsTeam, tier };
  } catch {
    return null;
  }
}

/**
 * Claude-backed caller. Constructed only when the user opts in
 * (`adopt --classify`); `runClaude` is imported lazily so the deterministic
 * path never pulls in the process runner.
 */
export function createClaudeAgentTeamCaller(cwd: string, timeoutMs = 30_000): AgentTeamCaller {
  const caller: AgentTeamCaller = {
    call_count: 0,
    async classify(input) {
      caller.call_count = (caller.call_count ?? 0) + 1;
      const { runClaude } = await import("../bot/claude-runner.js");
      const prompt =
        `Classify this AI agent into exactly one SoloSquad team and tier.\n` +
        `Teams: product, engineering, design, marketing, chief.\n` +
        `Tiers: leader (orchestrates others) or member.\n\n` +
        `Agent name: ${input.name}\n` +
        (input.description ? `Description: ${input.description}\n` : "") +
        (input.frontmatterTeam ? `Declared team (unrecognized): ${input.frontmatterTeam}\n` : "") +
        `\nRespond with ONLY a JSON object, no prose: {"team": "<team>", "tier": "<tier>"}`;
      const out = await runClaude(prompt, cwd, timeoutMs);
      return parseTeamReply(out);
    },
  };
  return caller;
}
