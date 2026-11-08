import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Run } from '../src/api/types.gen';
import { JobList, type Job } from '../src/components/JobList';
import { translate } from '../src/i18n';
import { openRuns, status } from '../src/live/jobs';
import { renderWith } from './helpers';

function run(over: Partial<Run>): Run {
  return {
    id: 'r1',
    thread_id: 'wf-th',
    status: 'success',
    kind: 'input',
    input: null,
    error: null,
    interrupts: null,
    created: 100,
    started: 100,
    ended: 110,
    source: 'user:boss',
    superseded_by: null,
    ...over,
  };
}

function jobs(runs: Run[]): Job[] {
  return openRuns(runs).map((r) => ({
    id: r.id,
    agent: 'workflow',
    title: '월간 손익',
    who: '재무팀',
    status: status(r),
    startedAt: r.started,
    steps: ['장부 읽기', '손익표 확인', '요약'],
    stepIndex: 3,
    log: [],
  }));
}

describe('live work panel — a finished workflow is not waiting for approval', () => {
  afterEach(cleanup);
  const waiting = translate('ko', 'job.waiting');

  it('drops the approval run the resume answered (superseded)', () => {
    const runs = [
      run({ id: 'r2', kind: 'resume', created: 200, started: 200, ended: 210 }),
      run({ id: 'r1', status: 'superseded', superseded_by: 'r2', interrupts: [{ id: 'i', value: {} }] }),
    ];
    expect(openRuns(runs)).toEqual([]);
    renderWith(<JobList jobs={jobs(runs)} />);
    expect(screen.queryByText(waiting)).toBeNull();
    expect(screen.getByText(translate('ko', 'job.none'))).toBeTruthy();
  });

  it('drops a leftover interrupted run behind a newer run on its thread (an older engine)', () => {
    const runs = [
      run({ id: 'r2', kind: 'resume', created: 200 }),
      run({ id: 'r1', status: 'interrupted', created: 100 }),
    ];
    expect(openRuns(runs)).toEqual([]);
    renderWith(<JobList jobs={jobs(runs)} />);
    expect(screen.queryByText(waiting)).toBeNull();
  });

  it('still shows a workflow that really waits', () => {
    const runs = [run({ id: 'r1', status: 'interrupted', ended: null })];
    renderWith(<JobList jobs={jobs(runs)} />);
    expect(screen.getByText(waiting)).toBeTruthy();
  });
});
