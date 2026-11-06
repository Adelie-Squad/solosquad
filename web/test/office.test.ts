import { describe, expect, it } from 'vitest';
import { lookOf } from '../src/characters/roster';
import { emptyLive, reduce } from '../src/live/LiveProvider';
import { ROLE_PROPS } from '../src/office/contract';
import { layoutOffice, podSize, PROP_SPOTS, propPlace, roomFor, roomTiles, TILE } from '../src/office/layout';
import { clipFor, phaseOf } from '../src/office/motion';
import { ROSTER } from '../src/characters/roster';
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

describe('office layout — one desk pod per team, Chief in the middle, a tiled room', () => {
  const agents = [
    { name: 'chief', team: 'core' },
    ...['product-manager', 'product-designer', 'researcher', 'data-analyst'].map((name) => ({ name, team: 'product' })),
    ...['frontend-engineer', 'backend-engineer'].map((name) => ({ name, team: 'engineering' })),
    { name: 'marketer', team: 'brand' },
  ];
  const desk = { w: 1.2, d: 1.4 };
  const pods = layoutOffice(agents, { desk, chiefDesk: { w: 1.6, d: 1.4 } });

  it('gives each team its own pod and Chief the centre desk', () => {
    expect(pods.map((i) => i.key)).toEqual(['chief', 'brand', 'engineering', 'product']);
    const chief = pods[0];
    const dist = (i: { x: number; z: number }) => Math.hypot(i.x, i.z);
    expect(pods.slice(1).every((o) => dist(o) >= dist(chief))).toBe(true);
    expect(chief.desks).toEqual([expect.objectContaining({ agent: 'chief', chief: true })]);
    expect(pods.slice(1).flatMap((p) => p.desks).every((d) => !d.chief)).toBe(true);
  });

  it('sizes pods by headcount, with no seat limit', () => {
    expect(podSize(1)).toMatchObject({ cols: 1, rows: 1 });
    expect(podSize(4)).toMatchObject({ cols: 3, rows: 2 });
    expect(podSize(10)).toMatchObject({ cols: 4, rows: 3 });
    expect(pods.find((i) => i.key === 'product')!.desks).toHaveLength(4);
    const many = layoutOffice(Array.from({ length: 30 }, (_, i) => ({ name: `a${i}`, team: `t${i % 5}` })));
    expect(many.flatMap((i) => i.desks)).toHaveLength(30);
  });

  it('keeps desks in their pod and their footprints apart', () => {
    for (const pod of pods) {
      for (const d of pod.desks) {
        expect(Math.abs(d.x - pod.x)).toBeLessThan(pod.w / 2);
        expect(Math.abs(d.z - pod.z)).toBeLessThan(pod.d / 2);
      }
    }
    const all = pods.flatMap((i) => i.desks);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const apart = Math.abs(all[i].x - all[j].x) >= desk.w || Math.abs(all[i].z - all[j].z) >= desk.d;
        expect(apart, `${all[i].agent} / ${all[j].agent}`).toBe(true);
      }
  });

  it('grows the room by whole 2 m tiles around the pods, walls on the left and back', () => {
    const room = roomFor(pods);
    expect(TILE).toBe(2);
    expect((room.maxX - room.minX) / TILE).toBe(room.cols);
    expect((room.maxZ - room.minZ) / TILE).toBe(room.rows);
    for (const p of pods) {
      expect(p.x - p.w / 2).toBeGreaterThan(room.minX);
      expect(p.x + p.w / 2).toBeLessThan(room.maxX);
      expect(p.z - p.d / 2).toBeGreaterThan(room.minZ);
      expect(p.z + p.d / 2).toBeLessThan(room.maxZ);
    }
    const tiles = roomTiles(room);
    expect(tiles.floor).toHaveLength(room.cols * room.rows);
    expect(tiles.wallLeft.every((w) => w.x === room.minX)).toBe(true);
    expect(tiles.wallBack.every((w) => w.z === room.minZ)).toBe(true);
    const bigger = roomFor(layoutOffice(Array.from({ length: 40 }, (_, i) => ({ name: `a${i}`, team: `t${i % 6}` }))));
    expect(bigger.cols * bigger.rows).toBeGreaterThan(room.cols * room.rows);
  });

  it('puts the same shared props against the walls, whatever the headcount', () => {
    const room = roomFor(pods);
    expect(PROP_SPOTS.map((s) => s.module).sort()).toEqual(['prop.coffee_bar', 'prop.plant', 'prop.shelf', 'prop.sofa', 'prop.whiteboard']);
    for (const spot of PROP_SPOTS) {
      const at = propPlace(spot, room, { w: 1.2, d: 0.5 });
      expect(at.x).toBeGreaterThan(room.minX);
      expect(at.z).toBeGreaterThan(room.minZ);
      expect(at.x).toBeLessThan(room.maxX);
      expect(at.z).toBeLessThan(room.maxZ);
      if (spot.wall === 'back') expect(at.z - 0.25).toBeLessThan(room.minZ + 0.2);
      else expect(at.x - 0.25).toBeLessThan(room.minX + 0.2);
    }
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

  it('has a contract prop entry for every role of the roster', () => {
    expect(Object.keys(ROLE_PROPS).sort()).toEqual(Object.keys(ROSTER).sort());
  });

  it('plays the state clip, the doze for an evening idle', () => {
    expect(clipFor('typing', false)).toBe('typing');
    expect(clipFor('idle', false)).toBe('idle');
    expect(clipFor('idle', true)).toBe('idle_doze');
    expect(clipFor('idle', true, (c) => c !== 'idle_doze')).toBe('idle');
    expect(clipFor('waiting', true)).toBe('waiting');
  });

  it('starts each agent at its own phase', () => {
    const phases = ['chief', 'researcher', 'sales', 'marketer'].map((n, i) => phaseOf(n, i));
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBe(4);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
    expect(phaseOf('chief', 0)).toBe(phaseOf('chief', 0));
  });
});
