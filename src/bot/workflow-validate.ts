import {
  detectCycles,
  findUnreachable,
  type GraphEdge,
  type GraphNode,
} from "../util/graph.js";
import { GUARDRAIL_KEYS, hasAnyGuardrail } from "../util/guardrails.js";
import { KEBAB_RE } from "../util/naming.js";

/**
 * v1.3.2 §6 — `validateWorkflow`: static validation of a `workflow.yaml`
 * template/instance. Shares the graph core (`util/graph`, §9.2) with
 * `validateAgents` — but here a cycle is an ERROR: a static workflow is a true
 * acyclic DAG (handoff_to / depends_on form precedence edges), so a cycle is a
 * genuine infinite-loop bug, unlike the agent peer mesh.
 *
 * Finding shape mirrors `validateSkill`/`validateAgents` ({code, message,
 * field}) plus `stage` for stage-scoped findings.
 */

export interface WorkflowFinding {
  code: string;
  message: string;
  /** stage id when the finding is scoped to one stage. */
  stage?: string;
  field?: string;
}

export interface WorkflowValidationResult {
  ok: boolean;
  errors: WorkflowFinding[];
  warnings: WorkflowFinding[];
}

export interface ValidateWorkflowOptions {
  /** Canonical agent ids ("<team>/<name>") — when set, agent refs are resolved. */
  knownAgents?: Set<string>;
}

interface RawStage {
  id?: unknown;
  agent?: unknown;
  handoff_to?: unknown;
  depends_on?: unknown;
  exit_criteria?: unknown;
  hard_gate?: unknown;
  target_repo?: unknown;
  mode?: unknown;
  guardrails?: unknown;
}

const ID_RE = KEBAB_RE;
const AGENT_REF_RE = /^[a-z0-9_-]+\/[a-z0-9_-]+$/;
/** measurable ⇒ has a comparison operator or a standalone number. */
const MEASURABLE_RE = /(<=|>=|==|!=|[<>=])|(\b\d+(?:\.\d+)?\b)/;

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export function validateWorkflow(
  doc: unknown,
  opts: ValidateWorkflowOptions = {},
): WorkflowValidationResult {
  const errors: WorkflowFinding[] = [];
  const warnings: WorkflowFinding[] = [];

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      ok: false,
      errors: [{ code: "WF_NOT_AN_OBJECT", message: "workflow.yaml is not a mapping" }],
      warnings,
    };
  }
  const wf = doc as Record<string, unknown>;

  // --- top-level ---
  if (typeof wf.schema_version !== "number") {
    warnings.push({
      code: "WF_SCHEMA_VERSION_MISSING",
      field: "schema_version",
      message: "schema_version is missing or not a number",
    });
  }
  if (typeof wf.id !== "string" || wf.id.length === 0) {
    errors.push({ code: "WF_ID_MISSING", field: "id", message: "top-level id is required" });
  } else if (!ID_RE.test(wf.id)) {
    warnings.push({
      code: "WF_ID_MALFORMED",
      field: "id",
      message: `id "${wf.id}" is not kebab-case`,
    });
  }

  const rawStages = Array.isArray(wf.stages) ? (wf.stages as RawStage[]) : null;
  if (!rawStages || rawStages.length === 0) {
    errors.push({ code: "WF_NO_STAGES", field: "stages", message: "stages must be a non-empty list" });
    return { ok: errors.length === 0, errors, warnings };
  }

  // --- per-stage checks + id index ---
  const stageIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const st of rawStages) {
    const id = typeof st.id === "string" ? st.id : undefined;
    if (!id) {
      errors.push({ code: "WF_STAGE_ID_MISSING", field: "stages[].id", message: "a stage is missing its id" });
      continue;
    }
    if (seenIds.has(id)) {
      errors.push({ code: "WF_STAGE_ID_DUP", stage: id, field: "id", message: `duplicate stage id "${id}"` });
    }
    seenIds.add(id);
    stageIds.add(id);
    if (!ID_RE.test(id)) {
      warnings.push({ code: "WF_STAGE_ID_MALFORMED", stage: id, field: "id", message: `stage id "${id}" is not kebab-case` });
    }
  }

  for (const st of rawStages) {
    const id = typeof st.id === "string" ? st.id : "<unknown>";

    // agent ref
    if (typeof st.agent !== "string" || st.agent.length === 0) {
      errors.push({ code: "WF_AGENT_MISSING", stage: id, field: "agent", message: `stage "${id}" has no agent` });
    } else {
      const ref = st.agent;
      if (!AGENT_REF_RE.test(ref)) {
        warnings.push({ code: "WF_AGENT_REF_MALFORMED", stage: id, field: "agent", message: `agent "${ref}" is not "<team>/<agent>"` });
      } else if (ref.startsWith("_skill/")) {
        // skill stage — resolved against the skill registry, not the actor set
      } else if (opts.knownAgents && !opts.knownAgents.has(ref)) {
        errors.push({ code: "WF_AGENT_UNRESOLVED", stage: id, field: "agent", message: `agent "${ref}" is not a known actor` });
      }
    }

    // handoff_to → existing stage (null = terminal)
    if (typeof st.handoff_to === "string" && st.handoff_to.length > 0) {
      if (!stageIds.has(st.handoff_to)) {
        errors.push({ code: "WF_HANDOFF_UNRESOLVED", stage: id, field: "handoff_to", message: `handoff_to "${st.handoff_to}" is not a known stage` });
      }
    }

    // depends_on → existing stages
    for (const dep of asStringArray(st.depends_on)) {
      if (!stageIds.has(dep)) {
        errors.push({ code: "WF_DEP_UNRESOLVED", stage: id, field: "depends_on", message: `depends_on "${dep}" is not a known stage` });
      }
    }

    // exit_criteria measurability (§6 — soft gate)
    for (const c of asStringArray(st.exit_criteria)) {
      if (!MEASURABLE_RE.test(c)) {
        warnings.push({
          code: "WF_EXIT_CRITERIA_NOT_MEASURABLE",
          stage: id,
          field: "exit_criteria",
          message: `exit_criteria "${c}" is not measurable — prefer measure+operator+threshold (e.g. "score >= 60")`,
        });
      }
    }

    if (st.hard_gate !== undefined && typeof st.hard_gate !== "boolean") {
      warnings.push({ code: "WF_HARD_GATE_TYPE", stage: id, field: "hard_gate", message: `hard_gate must be a boolean` });
    }

    // control-locus (§6): mode declares who decides the work — `fixed` (tools
    // pinned, deterministic) vs `agentic` (LLM picks tools/loops). An agentic
    // stage must carry guardrails (the autonomy needs a brake).
    if (st.mode !== undefined) {
      if (st.mode !== "fixed" && st.mode !== "agentic") {
        warnings.push({ code: "WF_MODE_UNKNOWN", stage: id, field: "mode", message: `mode "${String(st.mode)}" must be "fixed" or "agentic"` });
      } else if (st.mode === "agentic" && !hasAnyGuardrail(st.guardrails)) {
        warnings.push({
          code: "WF_AGENTIC_NO_GUARDRAILS",
          stage: id,
          field: "guardrails",
          message: `mode:agentic stage should declare guardrails (${GUARDRAIL_KEYS.join(" / ")})`,
        });
      }
    }
  }

  // --- precedence graph: handoff_to + depends_on → A→B edges ---
  const nodes: GraphNode[] = [...stageIds].map((id) => ({ id }));
  const edgeMap = new Map<string, GraphEdge>();
  const addEdge = (from: string, to: string, field: string): void => {
    if (stageIds.has(from) && stageIds.has(to)) {
      edgeMap.set(`${from} ${to}`, { from, to, field });
    }
  };
  for (const st of rawStages) {
    const id = typeof st.id === "string" ? st.id : undefined;
    if (!id) continue;
    if (typeof st.handoff_to === "string") addEdge(id, st.handoff_to, "handoff_to");
    for (const dep of asStringArray(st.depends_on)) addEdge(dep, id, "depends_on");
  }
  const edges = [...edgeMap.values()];

  // cycle = ERROR (a static workflow must be a DAG)
  for (const cyc of detectCycles(nodes, edges)) {
    errors.push({
      code: "WF_CYCLE",
      field: "depends_on",
      message: `stage cycle (a static workflow must be acyclic): ${cyc.join(" -> ")}`,
    });
  }

  // unreachable stages (orphans) — only meaningful on a DAG
  if (!errors.some((e) => e.code === "WF_CYCLE") && edges.length > 0) {
    const hasInbound = new Set(edges.map((e) => e.to));
    const roots = [...stageIds].filter((id) => !hasInbound.has(id));
    for (const id of findUnreachable(roots, nodes, edges)) {
      if (roots.includes(id)) continue;
      warnings.push({ code: "WF_STAGE_ORPHAN", stage: id, field: "depends_on", message: `stage "${id}" is unreachable from any entry stage` });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
