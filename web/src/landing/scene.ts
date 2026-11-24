// Each section's pinned scene and how far its act has gone, from the scroll position (DESIGN.md
// `## 랜딩`, 2026-11-25 — user: "섹션별로 화면이 멈춰서 애니메이션하는건 유지되어야 함 … 펭귄 캐릭터가 스크롤을
// 너무 늦게 따라와서 화면 밖에 사라졌다가 따라오는데, 밖으로 사라지기 전에 따라와야 함"). A section is a
// block `len` screens tall with its scene sticky inside: while the scene holds the screen, the
// scroll through the block (`progress` 0 … 1) plays its act — by position, not by time, so it
// rewinds. Between two scenes the penguin walks from one to the other by how far the next one has
// come in (`handover`), measured from both scenes' live boxes every frame — it never waits behind.
// Plain numbers; the canvas and the HTML acts read the same functions.
import { RELAY, UNROLL_MS, WAVE_MS } from './acting';
import type { SectionId } from './sections';

/** How many screens of scroll each section's block is (the scene holds the screen for `len − 1`). */
export const SCENE_LEN: Record<SectionId, number> = {
  hero: 1.6,
  problem: 2.2,
  org: 2,
  workflows: 4.6,
  pricing: 1.8,
  contact: 1.4,
};

/** 왜 지금: the two lines and the bracket draw in first (ms), then the penguin points at the gap. */
export const GAP_DRAW_MS = 1200;
/** The pointing, out and back (ms — relayHand). */
export const POINT_MS = RELAY.reach + 350 + RELAY.release + 800;
export const WAVE_TOTAL_MS = WAVE_MS + 500;

/** How long each scene's act is, in act ms (the workflows play their three examples — flow.ts). */
export const SCENE_MS: Record<Exclude<SectionId, 'workflows'>, number> = {
  hero: WAVE_TOTAL_MS,
  problem: GAP_DRAW_MS + POINT_MS,
  org: UNROLL_MS + 200,
  pricing: POINT_MS,
  contact: WAVE_TOTAL_MS,
};

/** The act runs over this part of the scene's hold — a breath before it, a moment after it. */
export const ACT_FROM = 0.06;
export const ACT_TO = 0.88;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** How far through its block the page is: 0 = the scene has just reached the top, 1 = it is about to leave. */
export function progressOf(block: { top: number; height: number }, screen: number): number {
  const run = block.height - screen;
  if (run <= 0) return block.top <= 0 ? 1 : 0;
  return clamp01(-block.top / run);
}

/** The act's ms at `progress` (scaled so the act ends at ACT_TO). */
export const actMs = (total: number, progress: number) => clamp01((progress - ACT_FROM) / (ACT_TO - ACT_FROM)) * total;

/** The scene's own ms at `progress` (not the workflows). */
export const sceneMs = (id: Exclude<SectionId, 'workflows'>, progress: number) => actMs(SCENE_MS[id], progress);

/**
 * The workflows' three examples: which one is up (a third of the block each) and how far through
 * its own timeline (0 … 1 of `flowLength`, ending a little before the next third).
 */
export function workflowAt(progress: number, examples: number): { at: number; local: number } {
  const x = clamp01(progress) * examples;
  // (a hair of slack: a stop anchor sits exactly on a third, and the progress is rounded)
  const at = Math.min(examples - 1, Math.floor(x + 0.005));
  return { at, local: clamp01((x - at - 0.04) / 0.82) };
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
