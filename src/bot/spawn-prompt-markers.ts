/**
 * v0.3.0 — parse stage/workflow markers PM embeds in its Task tool prompts.
 *
 * Convention (documented in assets/orchestrator/SKILL.md): when PM
 * delegates work to a specialist, it prefixes the Task prompt with:
 *
 *   [stage:stage-N-name wf:wf-YYYY-MM-DD-slug]
 *
 * Either field may be present alone. Lines starting with the marker are
 * stripped from the prompt before the specialist sees it, but the values
 * are recorded on the spawn.start event so the WorkflowReconciler can
 * precisely correlate spawns with stages on bot restart.
 *
 * Replaces the v0.3.0 agent-name substring heuristic.
 */

export interface SpawnMarkers {
  stageId?: string;
  workflowId?: string;
}

const MARKER_LINE = /^\s*\[stage:([A-Za-z0-9_-]+)(?:\s+wf:([A-Za-z0-9_.-]+))?\]\s*$/m;
const WF_ONLY_LINE = /^\s*\[wf:([A-Za-z0-9_.-]+)\]\s*$/m;

/** Extract markers from a Task tool prompt. Defensive — always returns an object. */
export function parseSpawnMarkers(prompt: string): SpawnMarkers {
  if (!prompt) return {};
  const combo = prompt.match(MARKER_LINE);
  if (combo) {
    return { stageId: combo[1], workflowId: combo[2] };
  }
  const wfOnly = prompt.match(WF_ONLY_LINE);
  if (wfOnly) {
    return { workflowId: wfOnly[1] };
  }
  return {};
}
