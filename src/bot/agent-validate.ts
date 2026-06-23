import {
  detectCycles,
  findUnreachable,
  maxDepth,
  type GraphEdge,
  type GraphNode,
} from "../util/graph.js";
import { KEBAB_RE, hasReservedWord } from "../util/naming.js";
import type { AgentSpec } from "./agent-spec.js";

/**
 * v1.3.2 §5 — `validateAgent`: static validation of the actor collaboration graph.
 *
 * Mirrors `skill-parser`'s `validateSkill` finding shape ({code, message,
 * field}) and adds `agent` (the node id) for graph-scoped findings. The graph
 * algorithms come from the shared core (`util/graph`, §9.2) so
 * `validateWorkflow` reuses the same cycle/reachability primitives.
 *
 * Decision record (PRD §5):
 *   1. EMPIRICALLY CORRECTED — running on the live bundle showed
 *      `collaborators`/`used_by` are a PEER mesh (specialists consult each
 *      other), not a delegation/spawn tree. The Chief spawns specialists
 *      (agents-as-tools); specialists do not recursively spawn one another, so
 *      a collaborator cycle is NOT an infinite-delegation bug. We therefore
 *      check referential integrity + self-references, and report multi-node
 *      cycles as a single informational warning, not errors. (The shared
 *      detectCycles core remains the error-grade check for workflow-manager,
 *      where `depends_on` IS a true acyclic DAG.)
 *   2. Scope is caller-assembled: pass bundle + a single org's actors for the
 *      adopt gate / runtime; pass the bundle subset for the CI ship check.
 */

export interface AgentFinding {
  code: string;
  message: string;
  /** node id "<team>/<name>" when the finding is scoped to one actor. */
  agent?: string;
  field?: string;
}

export interface AgentValidationResult {
  ok: boolean;
  errors: AgentFinding[];
  warnings: AgentFinding[];
}

export interface ValidateAgentsOptions {
  /** Known skill names — when set, `skills_used` refs are resolved against it. */
  knownSkills?: Set<string>;
  /** Collaboration depth warning threshold. Default 5 (Claude subagent precedent). */
  maxDelegationDepth?: number;
  /** Reachability roots for orphan detection. Default: every `tier: leader`. */
  roots?: string[];
}

const NAME_RE = KEBAB_RE;

export function validateAgents(
  specs: AgentSpec[],
  opts: ValidateAgentsOptions = {},
): AgentValidationResult {
  const errors: AgentFinding[] = [];
  const warnings: AgentFinding[] = [];
  const depthCap = opts.maxDelegationDepth ?? 5;

  // --- resolution index: alias key -> canonical id(s) ---
  const byId = new Map<string, AgentSpec>();
  const alias = new Map<string, Set<string>>();
  const addAlias = (key: string, id: string): void => {
    if (!alias.has(key)) alias.set(key, new Set());
    alias.get(key)!.add(id);
  };
  for (const s of specs) {
    byId.set(s.id, s);
    addAlias(s.id, s.id); // "<team>/<name>"
    addAlias(`${s.bucket}/${s.name}`, s.id); // "main/pm" | "specialists/architect"
    addAlias(s.name, s.id); // bare "pm"
  }
  const resolve = (ref: string): string | null => {
    const cands = alias.get(ref);
    if (!cands || cands.size === 0) return null;
    return [...cands][0]; // names are unique in practice; first match wins
  };

  // --- per-actor static checks ---
  for (const s of specs) {
    if (!NAME_RE.test(s.name)) {
      errors.push({
        code: "AGENT_NAME_MALFORMED",
        agent: s.id,
        field: "name",
        message: `name "${s.name}" must be kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)`,
      });
    }
    if (s.name !== s.dir) {
      errors.push({
        code: "AGENT_DIR_MISMATCH",
        agent: s.id,
        field: "name",
        message: `name "${s.name}" does not match directory "${s.dir}"`,
      });
    }
    // v1.3.6 §3.2 — brand-reserved words (anthropic/claude) are forbidden.
    if (hasReservedWord(s.name)) {
      errors.push({
        code: "AGENT_NAME_RESERVED_WORD",
        agent: s.id,
        field: "name",
        message: `name "${s.name}" contains a reserved word (anthropic/claude)`,
      });
    }
    if (s.tier && s.tier !== "leader" && s.tier !== "member") {
      warnings.push({
        code: "AGENT_TIER_UNKNOWN",
        agent: s.id,
        field: "tier",
        message: `tier "${s.tier}" is neither "leader" nor "member"`,
      });
    }
    if (s.tier === "leader" && s.bucket === "specialists") {
      warnings.push({
        code: "AGENT_TIER_BUCKET_MISMATCH",
        agent: s.id,
        field: "tier",
        message: `tier:leader but located under specialists/`,
      });
    }
    if (s.tier === "member" && s.bucket === "main") {
      warnings.push({
        code: "AGENT_TIER_BUCKET_MISMATCH",
        agent: s.id,
        field: "tier",
        message: `tier:member but located under main/`,
      });
    }
    if (opts.knownSkills) {
      for (const sk of s.skillsUsed) {
        if (!opts.knownSkills.has(sk)) {
          warnings.push({
            code: "AGENT_SKILL_UNRESOLVED",
            agent: s.id,
            field: "skills_used",
            message: `skills_used "${sk}" is not a known workspace skill`,
          });
        }
      }
    }
  }

  // --- build the collaboration graph (collaborators + used_by -> A->B edges) ---
  // See decision 1 above: this is a peer mesh. We resolve refs (integrity),
  // flag self-references, and treat the `*` wildcard ("any context") as valid.
  const nodes: GraphNode[] = specs.map((s) => ({ id: s.id }));
  const edgeMap = new Map<string, GraphEdge>();
  const addEdge = (from: string, to: string, field: string): void => {
    edgeMap.set(`${from} ${to}`, { from, to, field });
  };
  const resolveRef = (
    s: AgentSpec,
    ref: string,
    field: "collaborators" | "used_by",
  ): string | null => {
    if (ref === "*") return null; // wildcard: "any context" — valid, no concrete edge
    const id = resolve(ref);
    if (!id) {
      errors.push({
        code: "AGENT_REF_UNRESOLVED",
        agent: s.id,
        field,
        message: `${field} "${ref}" does not resolve to a known agent`,
      });
      return null;
    }
    if (id === s.id) {
      warnings.push({
        code: "AGENT_SELF_REF",
        agent: s.id,
        field,
        message: `${field} references itself ("${ref}")`,
      });
      return null;
    }
    return id;
  };
  for (const s of specs) {
    for (const ref of s.collaborators) {
      const to = resolveRef(s, ref, "collaborators");
      if (to) addEdge(s.id, to, "collaborators");
    }
    for (const ref of s.usedBy) {
      const from = resolveRef(s, ref, "used_by");
      if (from) addEdge(from, s.id, "used_by");
    }
  }
  const edges = [...edgeMap.values()];

  // --- peer-mesh cycles: informational only (one summary, not per-cycle noise) ---
  const cycles = detectCycles(nodes, edges);
  if (cycles.length > 0) {
    warnings.push({
      code: "AGENT_PEER_CYCLES",
      field: "collaborators",
      message: `${cycles.length} cyclic peer relationship(s) in the collaboration mesh (expected for peer collaboration, not delegation). Example: ${cycles[0].join(" -> ")}`,
    });
  }

  const roots = opts.roots ?? defaultRoots(specs, edges);

  // --- depth cap: only meaningful on an acyclic graph (peer mesh => skip) ---
  if (cycles.length === 0) {
    const d = maxDepth(roots, nodes, edges);
    if (Number.isFinite(d) && d > depthCap) {
      warnings.push({
        code: "AGENT_DEPTH_EXCEEDS",
        field: "collaborators",
        message: `max collaboration depth ${d} exceeds cap ${depthCap}`,
      });
    }
  }

  // --- orphans: actors unreachable from any root ---
  const rootSet = new Set(roots);
  for (const id of findUnreachable(roots, nodes, edges)) {
    if (rootSet.has(id)) continue;
    warnings.push({
      code: "AGENT_ORPHAN",
      agent: id,
      field: "used_by",
      message: `agent "${id}" is unreachable from any leader (orphan)`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Roots = every `tier: leader`; fall back to nodes with no inbound edge. */
function defaultRoots(specs: AgentSpec[], edges: GraphEdge[]): string[] {
  const leaders = specs.filter((s) => s.tier === "leader").map((s) => s.id);
  if (leaders.length > 0) return leaders;
  const hasInbound = new Set(edges.map((e) => e.to));
  return specs.filter((s) => !hasInbound.has(s.id)).map((s) => s.id);
}
