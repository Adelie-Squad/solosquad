// Server state = query cache + mutations (PRD v2.1.0 I8). The engine is the only truth;
// the event stream (live/LiveProvider) only tells the cache what to refetch.
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from './client';
import { useContext } from 'react';
import { apiPath, findWorkspace, useScope, type Scope } from '../scope';
import { SessionContext } from '../session';
import type {
  AccessPolicy,
  Agent,
  ApprovalItem,
  ApprovalPolicyRow,
  Artifact,
  Budget,
  ConnectionOut,
  Me,
  OrgPerson,
  OrgChart,
  PublicUser,
  Run,
  ScheduleList,
  ScreenResponse,
  Team,
  Thread,
  ThreadState,
  Upload,
  WebSettings,
  Health,
  Passkey,
  ProfileResponse,
  SnapshotSettings,
  WorkflowList,
  WorkflowThreadState,
  WorkList,
  CalendarAgentAccess,
  CalendarAgentView,
  CalendarDetail,
  CalendarItem,
  CalendarLabel,
  CalendarLabels,
  CalendarList,
  CalendarTodoOut,
  Digest,
  DigestAck,
} from './types.gen';

/** Customer-level keys — the same whatever org or workspace is open. */
export const keys = {
  me: ['me'] as const,
  users: ['users'] as const,
  access: ['access'] as const,
  settings: ['settings'] as const,
  health: ['health'] as const,
  passkeys: ['passkeys'] as const,
  profile: ['profile'] as const,
  snapshot: ['snapshot'] as const,
  /** 자리를 비운 동안 — the account's digest (`GET /api/me/digest`). */
  digest: ['digest'] as const,
};

/** Every org or workspace key starts with its scope, so two scopes never share a cache entry
 * and leaving one scope can drop all of it at once (`scopePrefix`). */
export function scopedKeys(s: Pick<Scope, 'org' | 'ws'>) {
  const o = ['o', s.org] as const;
  const w = ['o', s.org, 'w', s.ws] as const;
  return {
    ...keys,
    org: o,
    workspace: w,
    teams: [...o, 'teams'] as const,
    orgChart: [...o, 'org-chart'] as const,
    people: [...o, 'people'] as const,
    approvalPolicy: [...o, 'approval-policy'] as const,
    connections: [...o, 'connections'] as const,
    orgWorkflows: [...o, 'workflows'] as const,
    screen: (name: string) => [...o, 'screen', name] as const,
    threads: [...w, 'threads'] as const,
    thread: (tid: string) => [...w, 'thread', tid] as const,
    runs: [...w, 'runs'] as const,
    agents: [...w, 'agents'] as const,
    approvals: [...w, 'approvals'] as const,
    budget: [...w, 'budget'] as const,
    workflows: [...w, 'workflows'] as const,
    workflowRuns: (name?: string) => (name ? ([...w, 'workflow-runs', name] as const) : ([...w, 'workflow-runs'] as const)),
    workflowState: (tid: string) => [...w, 'workflow-state', tid] as const,
    uploads: [...w, 'uploads'] as const,
    artifacts: [...w, 'artifacts'] as const,
    artifact: (id: string) => [...w, 'artifacts', 'one', id] as const,
    wsAccess: [...w, 'access'] as const,
    schedules: [...w, 'schedules'] as const,
    work: [...w, 'work'] as const,
  };
}

export type ScopedKeys = ReturnType<typeof scopedKeys>;

export function useKeys(): ScopedKeys {
  const s = useScope();
  return scopedKeys(s);
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** A small API client bound to one prefix — `/o/<org>` or `/o/<org>/w/<ws>`. */
export function boundApi(prefix: string) {
  return {
    get: <T>(path: string, query?: Query) => api.get<T>(`${prefix}${path}`, query),
    post: <T>(path: string, json?: unknown) => api.post<T>(`${prefix}${path}`, json),
    put: <T>(path: string, json?: unknown) => api.put<T>(`${prefix}${path}`, json),
    patch: <T>(path: string, json?: unknown) => api.patch<T>(`${prefix}${path}`, json),
    del: <T>(path: string) => api.del<T>(`${prefix}${path}`),
    upload: <T>(path: string, file: Blob, query: Query) => api.upload<T>(`${prefix}${path}`, file, query),
  };
}

/** The org's and the workspace's API for the scope in the address. */
export function useScopedApi() {
  const s = useScope();
  return { org: boundApi(apiPath.org(s.org, '')), ws: boundApi(apiPath.ws(s, '')), scope: s };
}

const enabledFor = (on: boolean) => ({ enabled: on });

/** `on` = the workspace's runtime is up (`running` in /api/me): a workspace that did not start
 * answers every call with 503, so its screen says so instead of asking (C31). */
function useWs() {
  const s = useScope();
  const session = useContext(SessionContext);
  const on = session ? (findWorkspace(session.me.scopes, s.org, s.ws)?.running ?? true) : true;
  return { k: scopedKeys(s), a: boundApi(apiPath.ws(s, '')), on };
}

function useOrg() {
  const s = useScope();
  return { k: scopedKeys(s), a: boundApi(apiPath.org(s.org, '')) };
}

// -------------------------------------------------------------- workspace scope

export const useThreads = () => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.threads, queryFn: () => a.get<Thread[]>('/threads'), ...enabledFor(on) });
};
export const useThreadState = (tid: string | undefined) => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.thread(tid ?? ''), queryFn: () => a.get<ThreadState>(`/threads/${tid}/state`), ...enabledFor(on && !!tid) });
};
export const useRuns = (query: { status?: string; thread_id?: string; limit?: number } = {}, on = true) => {
  const { k, a, on: running } = useWs();
  return useQuery({ queryKey: [...k.runs, query], queryFn: () => a.get<Run[]>('/runs', query), ...enabledFor(on && running) });
};
/** Who is working now — the workspace's runtime (`working_on`). */
export const useAgents = () => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.agents, queryFn: () => a.get<Agent[]>('/agents'), ...enabledFor(on) });
};
export const useApprovals = () => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.approvals, queryFn: () => a.get<ApprovalItem[]>('/approvals'), ...enabledFor(on) });
};
export const useBudget = () => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.budget, queryFn: () => a.get<Budget>('/budget'), ...enabledFor(on) });
};
/** The workspace's view of the workflows (with its own last run). */
export const useWorkflows = () => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.workflows, queryFn: () => a.get<WorkflowList>('/workflows'), ...enabledFor(on) });
};
export const useWorkflowRuns = (name?: string) => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.workflowRuns(name), queryFn: () => a.get<Run[]>('/workflow-runs', { workflow: name, limit: 20 }), ...enabledFor(on) });
};
export const useWorkflowState = (tid: string | undefined) => {
  const { k, a, on } = useWs();
  return useQuery({
    queryKey: k.workflowState(tid ?? ''),
    queryFn: () => a.get<WorkflowThreadState>(`/workflow-threads/${tid}/state`),
    ...enabledFor(on && !!tid),
  });
};
/** The scheduled runs — workflow schedules and the org's crons (switching = the workflow's PATCH). */
export const useSchedules = () => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.schedules, queryFn: () => a.get<ScheduleList>('/schedules'), ...enabledFor(on) });
};
/** What the agents did and are doing — one row per conversation or workflow run (Task). */
export const useWork = (query: { since?: number; limit?: number } = {}) => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: [...k.work, query], queryFn: () => a.get<WorkList>('/work', query), ...enabledFor(on) });
};
export const useArtifacts = (query: { kind?: string; limit?: number; needs_review?: boolean } = {}) => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: [...k.artifacts, query], queryFn: () => a.get<Artifact[]>('/artifacts', query), ...enabledFor(on) });
};
export const useArtifact = (id: string | undefined) => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.artifact(id ?? ''), queryFn: () => a.get<Artifact>(`/artifacts/${id}`), ...enabledFor(on && !!id) });
};
export const useUploads = () => {
  const { k, a, on } = useWs();
  return useQuery({ queryKey: k.uploads, queryFn: () => a.get<Upload[]>('/uploads'), ...enabledFor(on) });
};

// -------------------------------------------------------------- org scope

export const useTeams = () => {
  const { k, a } = useOrg();
  return useQuery({ queryKey: k.teams, queryFn: () => a.get<Team[]>('/teams') });
};
export const useOrgChart = () => {
  const { k, a } = useOrg();
  return useQuery({ queryKey: k.orgChart, queryFn: () => a.get<OrgChart>('/org-chart') });
};
export const usePeople = (on = true) => {
  const { k, a } = useOrg();
  return useQuery({ queryKey: k.people, queryFn: () => a.get<OrgPerson[]>('/people'), ...enabledFor(on) });
};
export const useApprovalPolicy = () => {
  const { k, a } = useOrg();
  return useQuery({ queryKey: k.approvalPolicy, queryFn: () => a.get<ApprovalPolicyRow[]>('/approval-policy') });
};
export const useConnections = () => {
  const { k, a } = useOrg();
  return useQuery({ queryKey: k.connections, queryFn: () => a.get<ConnectionOut[]>('/connections') });
};
export const useScreen = (name: string) => {
  const { k, a } = useOrg();
  return useQuery({ queryKey: k.screen(name), queryFn: () => a.get<ScreenResponse>(`/screens/${name}`) });
};

// -------------------------------------------------------------- customer scope

export const useUsers = (on: boolean) =>
  useQuery({ queryKey: keys.users, queryFn: () => api.get<PublicUser[]>('/users'), ...enabledFor(on) });
export const useAccess = (on: boolean) =>
  useQuery({ queryKey: keys.access, queryFn: () => api.get<AccessPolicy>('/access'), ...enabledFor(on) });
export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: () => api.get<Health>('/health'), staleTime: 60_000 });
export const usePasskeys = (on = true) =>
  useQuery({ queryKey: keys.passkeys, queryFn: () => api.get<Passkey[]>('/me/passkeys'), ...enabledFor(on) });
export const useProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: () => api.get<ProfileResponse>('/profile') });
export const useSnapshot = () =>
  useQuery({ queryKey: keys.snapshot, queryFn: () => api.get<SnapshotSettings>('/snapshot') });
export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: () => api.get<WebSettings>('/settings') });

/** A mutation that refreshes the given queries when it succeeds. */
export function useAction<In, Out>(fn: (input: In) => Promise<Out>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

export type Decision = 'approved' | 'declined';

/** Answer an approval card — company threads and workflow threads have their own route. */
export function decide(scope: Pick<Scope, 'org' | 'ws'>, item: Pick<ApprovalItem, 'source' | 'thread_id'>, value: Decision) {
  const base = item.source === 'workflow' ? '/workflow-threads' : '/threads';
  return api.post<{ run_id: string }>(apiPath.ws(scope, `${base}/${item.thread_id}/resume`), { value });
}

// -------------------------------------------------------------- the account's calendar (decision 60)

export interface CalendarRangeQuery {
  from: string;
  to: string;
  kind?: 'work' | 'personal';
  org?: string;
  workspace?: string;
  category?: string;
  tag?: string;
  done?: boolean;
  undated?: boolean;
}

export const calendarKeys = {
  all: ['calendar'] as const,
  range: (q: CalendarRangeQuery) => ['calendar', 'items', q] as const,
  item: (id: string) => ['calendar', 'item', id] as const,
  labels: ['calendar', 'labels'] as const,
  agentAccess: ['calendar', 'agent-access'] as const,
  agentView: (q: { from: string; to: string }) => ['calendar', 'agent-view', q] as const,
};

export const useCalendar = (q: CalendarRangeQuery, on = true) =>
  useQuery({ queryKey: calendarKeys.range(q), queryFn: () => api.get<CalendarList>('/calendar/items', { ...q }), ...enabledFor(on) });
export const useCalendarItem = (id: string | null) =>
  useQuery({ queryKey: calendarKeys.item(id ?? ''), queryFn: () => api.get<CalendarDetail>(`/calendar/items/${id}`), ...enabledFor(!!id) });
export const useCalendarLabels = () =>
  useQuery({ queryKey: calendarKeys.labels, queryFn: () => api.get<CalendarLabels>('/calendar/labels') });
export const useAgentAccess = (on = true) =>
  useQuery({ queryKey: calendarKeys.agentAccess, queryFn: () => api.get<CalendarAgentAccess>('/calendar/agent-access'), ...enabledFor(on) });
export const useAgentView = (q: { from: string; to: string }, on: boolean) =>
  useQuery({ queryKey: calendarKeys.agentView(q), queryFn: () => api.get<CalendarAgentView>('/calendar/agent-view', q), ...enabledFor(on) });

/** Every calendar write refreshes the whole calendar cache — lists, details, labels. */
export function useCalendarAction<In, Out>(fn: (input: In) => Promise<Out>) {
  return useAction(fn, [calendarKeys.all]);
}

export const calendarApi = {
  createItem: (body: Record<string, unknown>) => api.post<CalendarItem>('/calendar/items', body),
  updateItem: (id: string, body: Record<string, unknown>) => api.patch<CalendarItem>(`/calendar/items/${id}`, body),
  deleteItem: (id: string) => api.del<{ ok: boolean }>(`/calendar/items/${id}`),
  createTodo: (itemId: string, body: Record<string, unknown>) => api.post<CalendarTodoOut>(`/calendar/items/${itemId}/todos`, body),
  updateTodo: (id: string, body: Record<string, unknown>) => api.patch<CalendarTodoOut>(`/calendar/todos/${id}`, body),
  deleteTodo: (id: string) => api.del<{ ok: boolean }>(`/calendar/todos/${id}`),
  createLabel: (body: Record<string, unknown>) => api.post<CalendarLabel>('/calendar/labels', body),
  updateLabel: (id: string, body: Record<string, unknown>) => api.patch<CalendarLabel>(`/calendar/labels/${id}`, body),
  reorder: (type: 'items' | 'todos' | 'labels', ids: string[]) => api.post<{ ok: boolean }>('/calendar/reorder', { type, ids }),
  setAgentAccess: (level: CalendarAgentAccess['level']) => api.put<CalendarAgentAccess>('/calendar/agent-access', { level }),
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<Me>('/me'),
    retry: false,
    staleTime: 60_000,
  });
}

// -------------------------------------------------------------- 자리를 비운 동안 (the digest)

/** What happened since the person was last here. The engine decides the window (the end of
 * their previous visit, or their last 확인했어요), so a reload shows the same digest. */
export const useDigest = (on = true) =>
  useQuery({ queryKey: keys.digest, queryFn: () => api.get<Digest>('/me/digest'), ...enabledFor(on) });

/** 확인했어요 — the digest starts at the `until` the person saw, so nothing that arrived while
 * they read it is skipped. */
export const ackDigest = (until: number) => api.post<DigestAck>('/me/digest/ack', { until });
