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
  source: "frontmatter" | "heuristic" | "default";
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
