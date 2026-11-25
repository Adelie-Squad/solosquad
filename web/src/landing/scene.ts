// Each section's pinned scene (DESIGN.md `## 랜딩`, 2026-11-25): a block `len` screens tall with its
// scene sticky inside — the scene holds the screen while the page scrolls through the block. Between
// two scenes the penguin walks from one to the other by how far the next one has come in
// (`handover`), measured from both scenes' live boxes every frame — it never waits behind. The acts
// themselves run on time (clock.ts, 2026-11-26): this file has how long each one is. Plain numbers.
import { RELAY, UNROLL_MS, WAVE_MS } from './acting';
import type { SectionId } from './sections';

/** How many screens of scroll each section's block is (the scene holds the screen for `len − 1`). */
export const SCENE_LEN: Record<SectionId, number> = {
  // 2026-11-26: the acts run on time, not on scroll distance — a hold long enough to feel deliberate
  hero: 1.8,
  problem: 2.2,
  now: 2.4,
  org: 2.2,
  workflows: 4.6,
  pricing: 2,
  contact: 1.6,
};

/** 문제: the question and the general AI's answer come in first (ms), then the penguin points at the undone steps. */
export const ASK_MS = 1200;

/** 왜 지금: the two lines and the bracket draw in first (ms), then the penguin points at the gap. */
export const GAP_DRAW_MS = 1200;
/** The pointing, out and back (ms — relayHand). */
export const POINT_MS = RELAY.reach + 350 + RELAY.release + 800;
export const WAVE_TOTAL_MS = WAVE_MS + 500;

/** How long each scene's act is (ms — the workflows play one example per third, each flow.ts long). */
export const SCENE_MS: Record<Exclude<SectionId, 'workflows'>, number> = {
  hero: WAVE_TOTAL_MS,
  problem: ASK_MS + POINT_MS,
  now: GAP_DRAW_MS + POINT_MS,
  org: UNROLL_MS + 200,
  pricing: POINT_MS,
  contact: WAVE_TOTAL_MS,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** How far through its block the page is: 0 = the scene has just reached the top, 1 = it is about to leave. */
export function progressOf(block: { top: number; height: number }, screen: number): number {
  const run = block.height - screen;
  if (run <= 0) return block.top <= 0 ? 1 : 0;
  return clamp01(-block.top / run);
}

/**
 * The workflows' three examples: which one is up — a third of the block each (the example's own
 * motion runs on time, clock.ts). `local` = how far through its third (kept for the tests).
 */
export function workflowAt(progress: number, examples: number): { at: number; local: number } {
  const x = clamp01(progress) * examples;
  // (a hair of slack: a stop anchor sits exactly on a third, and the progress is rounded)
  const at = Math.min(examples - 1, Math.floor(x + 0.005));
  return { at, local: clamp01((x - at - 0.04) / 0.7) };
}

/**
 * Which scene the penguin is with: the block at the top of the screen (`i`), and how far the next
 * one has come in (`handover` 0 … 1 — the next block's top from the bottom of the screen to the top).
 * `blocks` = each block's box on the screen, in page order.
 */
export function sceneAt(blocks: { top: number; height: number }[], screen: number): { i: number; handover: number } {
  if (!blocks.length) return { i: 0, handover: 0 };
  let i = blocks.findIndex((b) => b.top <= 0 && b.top + b.height > 0);
  if (i < 0) i = blocks[0].top > 0 ? 0 : blocks.length - 1;
  const next = blocks[i + 1];
  if (!next) return { i, handover: 0 };
  return { i, handover: clamp01((screen - next.top) / screen) };
}
