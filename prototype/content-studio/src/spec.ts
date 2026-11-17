// 렌더 스펙 — scripts/gen-assets.mjs 가 public/local/spec.json 으로 만든다.
// 로컬 스펙이 없으면(다른 사람의 체크아웃·CI) public/example/spec.json(가상 브랜드)로 돈다.

import { staticFile } from 'remotion';

export type Focus = 'left' | 'center' | 'right';

export type Cut = {
  id: string;
  /** public/ 기준 경로. 없으면 단색 자리표시 */
  image?: string | null;
  caption: string;
  /** public/ 기준 내레이션 mp3 */
  audio?: string | null;
  durationInFrames: number;
  focus?: Focus;
};

export type Spec = {
  /** 상단 고정 타이틀 2줄 — 둘째 줄은 강조색 */
  title: [string, string];
  accent: string;
  footer: string;
  cuts: Cut[];
};

export const FPS = 30;

export async function loadSpec(): Promise<Spec> {
  for (const file of ['local/spec.json', 'example/spec.json']) {
    const res = await fetch(staticFile(file));
    if (res.ok) return (await res.json()) as Spec;
  }
  throw new Error('spec.json 이 없습니다 — npm run assets 를 먼저 돌리세요');
}

export const totalFrames = (spec: Spec) => spec.cuts.reduce((sum, c) => sum + c.durationInFrames, 0);
