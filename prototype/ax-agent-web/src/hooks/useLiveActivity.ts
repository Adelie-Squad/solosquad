import { useEffect, useState } from 'react';
import { jobPool, type JobTemplate } from '../data/dummy';

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
  steps: string[];
  status: JobStatus;
  progress: number;
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
    steps: template.steps,
    status,
    progress,
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

function advance(jobs: Job[]): Job[] {
  const now = new Date().toISOString();
  let next = jobs.map((job) => {
    if (job.status !== 'running') return job;
    const before = currentStep(job);
    const progress = Math.min(100, job.progress + 3 + Math.random() * 9);
    const updated: Job = { ...job, progress };
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
  const done = next.filter((j) => j.status === 'done').slice(-DONE_VISIBLE);
  return [...active, ...done];
}

export function useLiveActivity(): Job[] {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);

  useEffect(() => {
    const timer = setInterval(() => setJobs(advance), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return jobs;
}
