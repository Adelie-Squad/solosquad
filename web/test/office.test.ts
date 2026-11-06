import { describe, expect, it } from 'vitest';
import { lookOf } from '../src/characters/roster';
import { emptyLive, reduce } from '../src/live/LiveProvider';
import { islandSize, layoutOffice } from '../src/office/layout';
import { ease, REST, STILL, target } from '../src/office/motion';
import { agentStatus, agentStatuses, DONE_MS, ERROR_MS, nextChange, TYPING_MS, type StatusInput } from '../src/office/state';

const T0 = 1_000_000;

function input(over: Partial<StatusInput> = {}): StatusInput {
  return {
    agents: [
      { name: 'chief', working_on: [] },
      { name: 'researcher', working_on: [] },
    ],
    approvals: [],
    activity: {},
    outcomes: {},
    now: T0,
    ...over,
  };
}

describe('office state adapter (DESIGN 상태 표)', () => {
  it('idle when nothing runs', () => {
    expect(agentStatus('chief', input())).toBe('idle');
  });

  it('thinking while a run waits on the model, typing while text or steps stream in', () => {
    const busy = input({ agents: [{ name: 'chief', working_on: [{}] }] });
    expect(agentStatus('chief', busy)).toBe('thinking');
    expect(agentStatus('chief', { ...busy, activity: { chief: T0 - 1000 } })).toBe('typing');
    expect(agentStatus('chief', { ...busy, activity: { chief: T0 - TYPING_MS - 1 } })).toBe('thinking');
  });

  it('waiting beats everything when the agent asked for an approval', () => {
    const s = input({ agents: [{ name: 'chief', working_on: [{}] }], approvals: [{ card: { agent: 'chief' } }] });
    expect(agentStatus('chief', s)).toBe('waiting');
    expect(agentStatus('researcher', s)).toBe('idle');
  });

  it('done for ten seconds after success, then idle', () => {
    const s = input({ outcomes: { chief: { kind: 'done', at: T0 - 2000 } } });
    expect(agentStatus('chief', s)).toBe('done');
    expect(agentStatus('chief', { ...s, now: T0 - 2000 + DONE_MS + 1 })).toBe('idle');
  });

  it('error after a failure, until it works again or the minute is up', () => {
    const s = input({ outcomes: { chief: { kind: 'error', at: T0 - 5000 } } });
    expect(agentStatus('chief', s)).toBe('error');
    expect(agentStatus('chief', { ...s, activity: { chief: T0 - 100 } })).toBe('idle');
    expect(agentStatus('chief', { ...s, now: T0 - 5000 + ERROR_MS + 1 })).toBe('idle');
    expect(agentStatus('chief', { ...s, agents: [{ name: 'chief', working_on: [{}] }] })).toBe('thinking');
  });

  it('maps every agent and knows when the answer changes by time alone', () => {
    const s = input({ activity: { chief: T0 - 1000 }, outcomes: { researcher: { kind: 'done', at: T0 } } });
    expect(agentStatuses(s)).toEqual({ chief: 'idle', researcher: 'done' });
    expect(nextChange(s)).toBe(T0 - 1000 + TYPING_MS);
    expect(nextChange(input())).toBeNull();
  });

  it('is fed by the event stream: speaking marks activity, the run end marks the outcome', () => {
    let s = reduce(emptyLive, { ts: 1, event: 'run.message', run_id: 'r1', thread_id: 't', agent: 'researcher', text: 'hi' }, 10);
    expect(s.activity.researcher).toBe(10);
    expect(s.runAgent.r1).toBe('researcher');
    s = reduce(s, { ts: 2, event: 'run.update', run_id: 'r1', thread_id: 't', node: 'pm', summary: { active_agent: 'chief' } }, 20);
    expect(s.activity.chief).toBe(20);
    s = reduce(s, { ts: 3, event: 'run.failed', run_id: 'r1', thread_id: 't', error: 'x' }, 30);
    expect(s.outcomes.chief).toEqual({ kind: 'error', at: 30 });
    s = reduce(s, { ts: 4, event: 'run.completed', run_id: 'r2', thread_id: 'u' }, 40);
    expect(Object.keys(s.outcomes)).toEqual(['chief']); // unknown run: nobody to credit
  });
});

describe('office layout — one island per team, Chief in the middle', () => {
  const agents = [
    { name: 'chief', team: 'core' },
    ...['product-manager', 'product-designer', 'researcher', 'data-analyst'].map((name) => ({ name, team: 'product' })),
    ...['frontend-engineer', 'backend-engineer'].map((name) => ({ name, team: 'engineering' })),
    { name: 'marketer', team: 'brand' },
  ];
  const islands = layoutOffice(agents);

  it('gives each team its own island and Chief the centre one', () => {
    expect(islands.map((i) => i.key)).toEqual(['chief', 'brand', 'engineering', 'product']);
    const chief = islands[0];
    const others = islands.slice(1);
    const dist = (i: { x: number; z: number }) => Math.hypot(i.x, i.z);
    expect(others.every((o) => dist(o) >= dist(chief))).toBe(true);
    expect(chief.desks.map((d) => d.agent)).toEqual(['chief']);
  });

  it('sizes islands by headcount, with no seat limit', () => {
    expect(islandSize(1)).toMatchObject({ cols: 1, rows: 1 });
    expect(islandSize(4)).toMatchObject({ cols: 3, rows: 2 });
    expect(islandSize(10)).toMatchObject({ cols: 4, rows: 3 });
    const product = islands.find((i) => i.key === 'product')!;
    expect(product.desks).toHaveLength(4);
    const many = layoutOffice(Array.from({ length: 30 }, (_, i) => ({ name: `a${i}`, team: `t${i % 5}` })));
    expect(many.flatMap((i) => i.desks)).toHaveLength(30);
  });

  it('keeps desks on their island and apart from each other', () => {
    for (const island of islands) {
      for (const d of island.desks) {
        expect(Math.abs(d.x - island.x)).toBeLessThan(island.w / 2);
        expect(Math.abs(d.z - island.z)).toBeLessThan(island.d / 2);
      }
    }
    const all = islands.flatMap((i) => i.desks);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThan(2);
  });
});

describe('penguin props and motion', () => {
  it('reads the prop from the role table, with renamed ids and a scarf for strangers', () => {
    expect(lookOf('chief').prop).toBe('crown-bowtie');
    expect(lookOf('infra').prop).toBe('hardhat');
    expect(lookOf('infra-security').prop).toBe('hardhat');
    expect(lookOf('creative-designer')).toEqual({ team: 'brand', prop: 'brush' });
    expect(lookOf('qa').prop).toBe('magnifier');
    expect(lookOf('quality-assurance').prop).toBe('magnifier');
    expect(lookOf('frontend').prop).toBe('beanie');
    expect(lookOf('noodle-chef', 'kitchen')).toEqual({ team: 'kitchen', prop: 'scarf' });
  });

  it('raises a wing while waiting, leans in while typing, dozes at night', () => {
    expect(target('waiting', 1, 0, false).wr).toBeGreaterThan(2);
    expect(target('typing', 1, 0, false).lean).toBeGreaterThan(0.05);
    const nod = [0, 0.8, 1.6, 2.4].map((t) => target('idle', t, 0, true).lean);
    expect(Math.max(...nod) - Math.min(...nod)).toBeGreaterThan(0.05);
    expect(target('idle', 1, 0, false).lean).toBe(0);
  });

  it('has a still pose per state for reduced motion, and eases without jumping', () => {
    expect(STILL.waiting.wr).toBeGreaterThan(2);
    expect(STILL.typing.lean).toBeGreaterThan(0);
    expect(STILL.error.lean).toBeGreaterThan(0.1);
    const half = ease(REST, STILL.waiting, 0.016);
    expect(half.wr).toBeGreaterThan(REST.wr);
    expect(half.wr).toBeLessThan(STILL.waiting.wr);
  });
});
