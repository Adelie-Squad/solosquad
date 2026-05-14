import type { Classification } from "./classifier.js";

/**
 * v0.5 §6.3 — deterministic cover-rate calculator. Given a list of
 * classifications, score how well each of the 4 SoloSquad templates is
 * "covered" by the skills present.
 *
 * The mapping below is keyword-driven (per-template signal words drawn from
 * the actual templates in `assets/templates/prd-*.md` plus the AGENTS.md
 * §"Workflow Types" stage descriptions). cover_rate = (skills whose
 * classification label *and* keyword signal both align with a template) /
 * (total classifications considered — i.e. excluding `codebase-fact` since
 * those are tied to a repo, not a workflow).
 *
 * `no_match` is emitted when the best template scores below 0.5 — the
 * §6.3 threshold for recommending a custom workflow.
 */

export interface TemplateMatch {
  template: string;
  cover_rate: number;
  matched_paths: string[];
}

export interface WorkflowMatchResult {
  matches: TemplateMatch[];
  no_match: boolean;
  /** Highest-scoring template (or null when all are 0). */
  best?: TemplateMatch;
}

interface TemplateSpec {
  template: string;
  keywords: string[];
}

/**
 * One row per SoloSquad workflow template. Keywords are inclusive (any
 * match counts toward cover_rate). Drawn from `prd-pmf.md`, `prd-feature.md`,
 * `prd-experiment.md` + AGENTS.md "Workflow Types" descriptions.
 */
const TEMPLATES: TemplateSpec[] = [
  {
    template: "pmf-discovery",
    keywords: [
      "pmf",
      "product market fit",
      "discovery",
      "user research",
      "validation",
      "research → planning",
      "research-planning",
      "interview",
    ],
  },
  {
    template: "feature-expansion",
    keywords: [
      "feature",
      "expansion",
      "analysis → planning",
      "feature planning",
      "prd",
      "release",
      "rollout",
      "scope",
      "spec",
    ],
  },
  {
    template: "rebranding",
    keywords: [
      "rebrand",
      "brand",
      "tone",
      "voice",
      "marketing",
      "positioning",
      "messaging",
      "copy",
    ],
  },
  {
    template: "rapid-prototype",
    keywords: [
      "prototype",
      "experiment",
      "mvp",
      "spike",
      "rapid",
      "minimum viable",
      "validate",
      "throwaway",
    ],
  },
];

const NO_MATCH_THRESHOLD = 0.5;

/**
 * Compute cover_rate per template. Total = classifications eligible for
 * workflow matching (role / workflow / domain — codebase-fact is excluded
 * because it lives in the repo). When `total === 0` every cover_rate is 0
 * and no_match is true.
 */
export function matchWorkflow(
  classifications: Classification[],
  bodies: Map<string, string>
): WorkflowMatchResult {
  const eligible = classifications.filter(
    (c) => c.label !== "codebase-fact"
  );
  const total = eligible.length;

  const matches: TemplateMatch[] = TEMPLATES.map((t) => ({
    template: t.template,
    cover_rate: 0,
    matched_paths: [],
  }));

  if (total === 0) {
    return { matches, no_match: true };
  }

  for (const cls of eligible) {
    const body = (bodies.get(cls.path) ?? "").toLowerCase();
    for (let i = 0; i < TEMPLATES.length; i++) {
      const t = TEMPLATES[i];
      if (signalsTemplate(body, t.keywords)) {
        matches[i].matched_paths.push(cls.path);
      }
    }
  }

  for (const m of matches) {
    m.cover_rate = m.matched_paths.length / total;
  }

  matches.sort((a, b) => b.cover_rate - a.cover_rate);
  const best = matches[0];
  const noMatch = best.cover_rate < NO_MATCH_THRESHOLD;
  return { matches, no_match: noMatch, best };
}

function signalsTemplate(body: string, keywords: string[]): boolean {
  for (const k of keywords) {
    if (body.includes(k.toLowerCase())) return true;
  }
  return false;
}

export function listTemplates(): string[] {
  return TEMPLATES.map((t) => t.template);
}
