// Server state = query cache + mutations (PRD v2.1.0 I8). The engine is the only truth;
// the event stream (live/LiveProvider) only tells the cache what to refetch.
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from './client';
import type {
  AccessPolicy,
  Agent,
  ApprovalItem,
  ApprovalPolicyRow,
  Artifact,
  Budget,
  ConnectionOut,
  Me,
  OrgChart,
  PublicUser,
  Run,
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
} from './types.gen';

export const keys = {
  me: ['me'] as const,
  threads: ['threads'] as const,
  thread: (tid: string) => ['thread', tid] as const,
  runs: ['runs'] as const,
  agents: ['agents'] as const,
  teams: ['teams'] as const,
  orgChart: ['org-chart'] as const,
  approvals: ['approvals'] as const,
  approvalPolicy: ['approval-policy'] as const,
  connections: ['connections'] as const,
  budget: ['budget'] as const,
  workflows: ['workflows'] as const,
  workflowRuns: (name?: string) => (name ? (['workflow-runs', name] as const) : (['workflow-runs'] as const)),
  workflowState: (tid: string) => ['workflow-state', tid] as const,
  uploads: ['uploads'] as const,
  artifacts: ['artifacts'] as const,
  artifact: (id: string) => ['artifacts', 'one', id] as const,
  screen: (name: string) => ['screen', name] as const,
  users: ['users'] as const,
  access: ['access'] as const,
  settings: ['settings'] as const,
  health: ['health'] as const,
  passkeys: ['passkeys'] as const,
  profile: ['profile'] as const,
  snapshot: ['snapshot'] as const,
};

const enabledFor = (on: boolean) => ({ enabled: on });

export const useThreads = () => useQuery({ queryKey: keys.threads, queryFn: () => api.get<Thread[]>('/threads') });
export const useThreadState = (tid: string | undefined) =>
  useQuery({
    queryKey: keys.thread(tid ?? ''),
    queryFn: () => api.get<ThreadState>(`/threads/${tid}/state`),
    ...enabledFor(!!tid),
  });
export const useRuns = (query: { status?: string; thread_id?: string; limit?: number } = {}, on = true) =>
  useQuery({ queryKey: [...keys.runs, query], queryFn: () => api.get<Run[]>('/runs', query), ...enabledFor(on) });
export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: () => api.get<Agent[]>('/agents') });
export const useTeams = () => useQuery({ queryKey: keys.teams, queryFn: () => api.get<Team[]>('/teams') });
export const useOrgChart = () => useQuery({ queryKey: keys.orgChart, queryFn: () => api.get<OrgChart>('/org-chart') });
export const useApprovals = () =>
  useQuery({ queryKey: keys.approvals, queryFn: () => api.get<ApprovalItem[]>('/approvals') });
export const useApprovalPolicy = () =>
  useQuery({ queryKey: keys.approvalPolicy, queryFn: () => api.get<ApprovalPolicyRow[]>('/approval-policy') });
export const useConnections = () =>
  useQuery({ queryKey: keys.connections, queryFn: () => api.get<ConnectionOut[]>('/connections') });
export const useBudget = () => useQuery({ queryKey: keys.budget, queryFn: () => api.get<Budget>('/budget') });
export const useWorkflows = () =>
  useQuery({ queryKey: keys.workflows, queryFn: () => api.get<WorkflowList>('/workflows') });
export const useWorkflowRuns = (name?: string) =>
  useQuery({
    queryKey: keys.workflowRuns(name),
    queryFn: () => api.get<Run[]>('/workflow-runs', { workflow: name, limit: 20 }),
  });
export const useWorkflowState = (tid: string | undefined) =>
  useQuery({
    queryKey: keys.workflowState(tid ?? ''),
    queryFn: () => api.get<WorkflowThreadState>(`/workflow-threads/${tid}/state`),
    ...enabledFor(!!tid),
  });
export const useArtifacts = (query: { kind?: string; limit?: number } = {}) =>
  useQuery({ queryKey: [...keys.artifacts, query], queryFn: () => api.get<Artifact[]>('/artifacts', query) });
export const useArtifact = (id: string | undefined) =>
  useQuery({
    queryKey: keys.artifact(id ?? ''),
    queryFn: () => api.get<Artifact>(`/artifacts/${id}`),
    ...enabledFor(!!id),
  });
export const useScreen = (name: string) =>
  useQuery({ queryKey: keys.screen(name), queryFn: () => api.get<ScreenResponse>(`/screens/${name}`) });
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
export const useUploads = () => useQuery({ queryKey: keys.uploads, queryFn: () => api.get<Upload[]>('/uploads') });

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
export function decide(item: Pick<ApprovalItem, 'source' | 'thread_id'>, value: Decision) {
  const base = item.source === 'workflow' ? '/workflow-threads' : '/threads';
  return api.post<{ run_id: string }>(`${base}/${item.thread_id}/resume`, { value });
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<Me>('/me'),
    retry: false,
    staleTime: 60_000,
  });
}
