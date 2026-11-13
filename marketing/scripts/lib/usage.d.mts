export const WORKFLOW_IDS: readonly ('finance' | 'sourcing' | 'sns')[];
export interface WorkflowRuns {
  started: number;
  finished: number;
  approved: number;
  declined: number;
  per: Record<'finance' | 'sourcing' | 'sns', { started: number; finished: number }>;
}
export function workflowRuns(events: { kind: string; detail: string | null; n: number }[] | null | undefined): WorkflowRuns;
export function workflowRunsLine(events: { kind: string; detail: string | null; n: number }[] | null | undefined): string;
