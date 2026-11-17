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
  /** 형식별 화면 정보 — B 안: 카드 종류 · 체크 번호 · 노랑 강조어 */
  meta?: CutMeta | null;
};

export type CutMeta = {
  kind?: 'hook' | 'preview' | 'item' | 'cta';
  /** item 의 체크리스트 번호(1부터) */
  n?: number;
  highlight?: string[];
};

export type Spec = {
  /** 상단 고정 타이틀 2줄 — 둘째 줄은 강조색 */
  title: [string, string];
  accent: string;
  footer: string;
  /** 형식 B 체크리스트 항목명 */
  labels?: string[];
  /** 대본 한 번 읽기(voice.mode = script) — 있으면 컷별 audio 대신 이 한 트랙을 튼다 */
  narration?: { src: string; startFrame: number } | null;
  cuts: Cut[];
};

export const FPS = 30;

/** name: 'spec'(형식 A) · 'spec-b'(형식 B) */
export async function loadSpec(name = 'spec'): Promise<Spec> {
  for (const file of [`local/${name}.json`, `example/${name}.json`]) {
    const res = await fetch(staticFile(file));
    if (res.ok) return (await res.json()) as Spec;
  }
  throw new Error('spec.json 이 없습니다 — npm run assets 를 먼저 돌리세요');
}

export const totalFrames = (spec: Spec) => spec.cuts.reduce((sum, c) => sum + c.durationInFrames, 0);
