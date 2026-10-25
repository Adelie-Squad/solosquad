import { useEffect, useState } from 'react';
import { jobPool, type CategoryId, type JobTemplate } from '../data/dummy';

// 실시간 작업 시뮬레이터. 실제 에이전트 런타임 대신 setInterval 로 진행률과 로그를 흉내 낸다.

export type JobStatus = 'running' | 'queued' | 'done';

export interface LogLine {
  at: string;
  text: string;
}

export interface Job {
  id: string;
  title: string;
  icon: string;
  category: CategoryId;
  steps: string[];
  status: JobStatus;
  progress: number;
  /** 이 작업이 지금까지 쓴 토큰 */
  tokens: number;
  tokensPerTick: number;
  log: LogLine[];
  startedAt: string;
}

const TICK_MS = 1200;
const MAX_RUNNING = 2;
const DONE_VISIBLE = 3;

let seq = 0;
let poolCursor = 0;

function nextTemplate(): JobTemplate {
  const t = jobPool[poolCursor % jobPool.length];
  poolCursor += 1;
  return t;
}

function createJob(template: JobTemplate, status: JobStatus, progress = 0): Job {
  seq += 1;
  const now = new Date().toISOString();
  return {
    id: `job-${seq}`,
    title: template.title,
    icon: template.icon,
    category: template.category,
    steps: template.steps,
    status,
    progress,
    // 이미 진행된 만큼 토큰도 쓴 상태로 시작 (틱당 평균 진행률 ≈ 7.5%)
    tokens: Math.round((progress / 7.5) * template.tokensPerTick),
    tokensPerTick: template.tokensPerTick,
    log: status === 'running' ? [{ at: now, text: `${template.steps[0]} 시작` }] : [],
    startedAt: now,
  };
}

export function currentStep(job: Job): string {
  if (job.status === 'done') return '완료';
  if (job.status === 'queued') return '대기 중';
  const idx = Math.min(job.steps.length - 1, Math.floor((job.progress / 100) * job.steps.length));
  return job.steps[idx];
}

function initialJobs(): Job[] {
  return [
    createJob(nextTemplate(), 'running', 42),
    createJob(nextTemplate(), 'running', 8),
    createJob(nextTemplate(), 'queued'),
    { ...createJob(nextTemplate(), 'done', 100), log: [{ at: new Date().toISOString(), text: '완료' }] },
  ];
}

export type TokenTally = Partial<Record<CategoryId, number>>;

interface LiveState {
  jobs: Job[];
  /** 목록에서 밀려난 완료 작업의 토큰 — 사용량 합계가 줄어들지 않게 따로 쌓는다 */
  retired: TokenTally;
}

function advance({ jobs, retired }: LiveState): LiveState {
  const now = new Date().toISOString();
  let next = jobs.map((job) => {
    if (job.status !== 'running') return job;
    const before = currentStep(job);
    const progress = Math.min(100, job.progress + 3 + Math.random() * 9);
    const tokens = job.tokens + Math.round(job.tokensPerTick * (0.6 + Math.random() * 0.8));
    const updated: Job = { ...job, progress, tokens };
    if (progress >= 100) {
      return { ...updated, status: 'done' as const, log: [...job.log, { at: now, text: '완료' }] };
    }
    const after = currentStep(updated);
    if (after !== before) {
      updated.log = [...job.log, { at: now, text: `${before} 완료 → ${after}` }];
    }
    return updated;
  });

  // 빈 슬롯이 생기면 대기 작업을 시작시키고, 대기열이 비면 새 작업을 채운다
  const running = next.filter((j) => j.status === 'running').length;
  if (running < MAX_RUNNING) {
    const queued = next.find((j) => j.status === 'queued');
    if (queued) {
      next = next.map((j) =>
        j.id === queued.id
          ? { ...j, status: 'running' as const, startedAt: now, log: [{ at: now, text: `${j.steps[0]} 시작` }] }
          : j,
      );
    }
  }
  if (!next.some((j) => j.status === 'queued')) {
    next = [...next, createJob(nextTemplate(), 'queued')];
  }

  const active = next.filter((j) => j.status !== 'done');
  const allDone = next.filter((j) => j.status === 'done');
  const done = allDone.slice(-DONE_VISIBLE);
  return {
    jobs: [...active, ...done],
    retired: tallyTokens(allDone.slice(0, -DONE_VISIBLE), retired),
  };
}

function tallyTokens(jobs: Job[], base: TokenTally = {}): TokenTally {
  return jobs.reduce<TokenTally>((acc, j) => ({ ...acc, [j.category]: (acc[j.category] ?? 0) + j.tokens }), base);
}

export interface LiveActivity {
  jobs: Job[];
  /** 이번 접속에서 실시간 작업이 쓴 토큰 (카테고리별) */
  sessionTokens: TokenTally;
}

export function useLiveActivity(): LiveActivity {
  const [state, setState] = useState<LiveState>(() => ({ jobs: initialJobs(), retired: {} }));

  useEffect(() => {
    const timer = setInterval(() => setState(advance), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return { jobs: state.jobs, sessionTokens: tallyTokens(state.jobs, state.retired) };
}
