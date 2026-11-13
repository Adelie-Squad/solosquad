// The workflow runs in one demo account's usage (2026-11-14 — the KPI "logged-in demo accounts that
// ran a workflow to the end"): `workflow_started:<id>` and `workflow_done:<id>:<outcome>` action
// events (marketing/src/demo.ts allows only those names). Used by `inquiry.mjs demo usage`.

export const WORKFLOW_IDS = ['finance', 'sourcing', 'sns'];

/**
 * From grouped events [{kind, detail, n}] → {started, finished, approved, declined, per: {id: {started, finished}}}.
 */
export function workflowRuns(events) {
  const per = Object.fromEntries(WORKFLOW_IDS.map((id) => [id, { started: 0, finished: 0 }]));
  const out = { started: 0, finished: 0, approved: 0, declined: 0, per };
  for (const e of events ?? []) {
    if (e?.kind !== 'action' || typeof e.detail !== 'string') continue;
    const n = Number(e.n) || 0;
    const [what, id, outcome] = e.detail.split(':');
    if (!per[id]) continue;
    if (what === 'workflow_started') {
      per[id].started += n;
      out.started += n;
    } else if (what === 'workflow_done' && (outcome === 'approved' || outcome === 'declined')) {
      per[id].finished += n;
      out.finished += n;
      out[outcome] += n;
    }
  }
  return out;
}

/** One line: `workflow runs: started 3 · finished 2 (approved 1 · declined 1) · finance 1/1 · sourcing 1/0 · sns 1/1`. */
export function workflowRunsLine(events) {
  const r = workflowRuns(events);
  const each = WORKFLOW_IDS.map((id) => `${id} ${r.per[id].started}/${r.per[id].finished}`).join(' · ');
  return `workflow runs: started ${r.started} · finished ${r.finished} (approved ${r.approved} · declined ${r.declined}) · ${each} (started/finished)`;
}
