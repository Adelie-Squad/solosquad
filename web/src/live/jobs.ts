import { useLinks } from '../scope';
import { useQueries } from '@tanstack/react-query';

import { useKeys, useRuns, useScopedApi, useThreads, useWorkflowRuns, useWorkflows } from '../api/queries';
import type { Run, WorkflowThreadState } from '../api/types.gen';
import type { Job } from '../components/JobList';
import { useI18n } from '../i18n';
import { useAgentName } from '../lib/agentNames';
import { teamName } from '../lib/names';
import { useLive } from './LiveProvider';

const ACTIVE = new Set(['pending', 'running', 'interrupted']);

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
}

function status(run: Run): Job['status'] {
  if (run.status === 'running') return 'running';
  if (run.status === 'interrupted') return 'waiting';
  if (run.status === 'pending') return 'queued';
  return 'done';
}

/** The office's live work: company runs and workflow runs, newest first, with live notes. */
export function useJobs(): { jobs: Job[]; doneToday: number; loading: boolean } {
  const keys = useKeys();
  const { w: toWs } = useLinks();
  const { ws: wsApi } = useScopedApi();
  const { t } = useI18n();
  const nameOf = useAgentName();
  const live = useLive();
  const runs = useRuns({ limit: 50 });
  const threads = useThreads();
  const wfRuns = useWorkflowRuns();
  const workflows = useWorkflows();
  const today = startOfToday();

  const activeWf = (wfRuns.data ?? []).filter((r) => ACTIVE.has(r.status));
  // one state read per running workflow (few at a time) — it knows the workflow and its step
  const states = useQueries({
    queries: activeWf.map((r) => ({
      queryKey: keys.workflowState(r.thread_id),
      queryFn: () => wsApi.get<WorkflowThreadState>(`/workflow-threads/${r.thread_id}/state`),
    })),
  });

  const titles = new Map((threads.data ?? []).map((th) => [th.id, th.title ?? '']));
  const company: Job[] = (runs.data ?? [])
    .filter((r) => ACTIVE.has(r.status))
    .map((r) => ({
      id: r.id,
      agent: live.runAgent[r.id] ?? 'chief',
      title: titles.get(r.thread_id) || t('chat.untitled'),
      who: live.current[r.id] ? nameOf(live.current[r.id]) : t('office.company'),
      status: status(r),
      startedAt: r.started ?? r.created,
      steps: [],
      stepIndex: 0,
      log: live.logs[r.id] ?? [],
      link: toWs(`/chat/${r.thread_id}`),
    }));

  const defs = new Map((workflows.data?.workflows ?? []).map((w) => [w.name, w]));
  const flows: Job[] = activeWf.map((r, i) => {
    const values = states[i]?.data?.values;
    const def = values?.workflow ? defs.get(values.workflow) : undefined;
    return {
      id: r.id,
      agent: 'workflow',
      team: def?.team ?? null,
      title: def?.title ?? values?.workflow ?? t('nav.workflows'),
      who: def?.team ? t('office.team', { team: teamName(def.team, t) }) : t('nav.workflows'),
      status: status(r),
      startedAt: r.started ?? r.created,
      steps: def?.steps.map((s) => s.title) ?? [],
      stepIndex: values?.step ?? 0,
      log: live.logs[r.id] ?? [],
      link: def ? toWs(`/workflows/${def.name}/runs/${r.thread_id}`) : undefined,
    };
  });

  const doneToday = [...(runs.data ?? []), ...(wfRuns.data ?? [])].filter(
    (r) => r.status === 'success' && (r.ended ?? 0) >= today,
  ).length;
  const jobs = [...company, ...flows].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return { jobs, doneToday, loading: runs.isPending };
}
