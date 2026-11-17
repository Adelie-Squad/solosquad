// 형식 B — "상단 모션그래픽 체크리스트 + 하단 제품 컷" 분할 화면
//   hook: 전체 화면 컷 + 큰 노란 제목 · preview: 체크리스트 예고("마지막 건 끝까지")
//   item: 위 절반 체크리스트가 한 줄씩 체크, 아래 절반 제품 컷 · cta: 전체 화면 + 댓글 키워드
// 자막은 2~3어절씩 끊어 띄우고, 강조어는 노랑. 레퍼런스의 구조만 가져오고 문구·이미지·색은 스펙에서.

import { loadFont as loadDisplay } from '@remotion/google-fonts/BlackHanSans';
import { loadFont as loadBody } from '@remotion/google-fonts/NotoSansKR';
import type { CSSProperties } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Series, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Cut, Spec } from './spec';

const { fontFamily: display } = loadDisplay();
const { fontFamily: body } = loadBody('normal', { weights: ['500', '700', '900'], subsets: ['korean'] });

const SPLIT = 1000; // 위 패널 높이
const NAVY = '#12142B';
const PURPLE = '#8B7BFF';

/** 아래 절반 / 전체 화면 제품 컷 — 천천히 밀고 들어간다 */
function Photo({ cut, dim = 0, style }: { cut: Cut; dim?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame / cut.durationInFrames, [0, 1], [1.05, 1.15]);
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', background: '#111', ...style }}>
      {cut.image ? (
        <Img
          src={staticFile(cut.image)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`, transformOrigin: cut.focus === 'left' ? '30% 50%' : cut.focus === 'right' ? '70% 50%' : '50% 50%' }}
        />
      ) : null}
      {dim ? <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} /> : null}
    </div>
  );
}

/** 자막 — 어절 2~3개씩 끊어 말하는 속도(글자 수 비례)로 넘긴다 */
function Chunks({ cut, accent, top, size = 64 }: { cut: Cut; accent: string; top: number; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = cut.caption.split(/\s+/).filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < words.length; ) {
    const take = words.length - i === 4 ? 2 : Math.min(words[i].length <= 2 ? 3 : 2, words.length - i);
    chunks.push(words.slice(i, i + take));
    i += take;
  }
  // 말하는 구간 = 컷 길이에서 숨(약 0.3초)을 뺀 만큼
  const speak = Math.max(1, cut.durationInFrames - Math.round(0.3 * fps));
  const total = chunks.reduce((s, c) => s + c.join('').length, 0);
  let acc = 0;
  let idx = chunks.length - 1;
  let startFrame = 0;
  for (let i = 0; i < chunks.length; i++) {
    const len = (chunks[i].join('').length / total) * speak;
    if (frame < acc + len) {
      idx = i;
      startFrame = acc;
      break;
    }
    acc += len;
    startFrame = acc - len;
  }
  const pop = spring({ frame: frame - startFrame, fps, config: { damping: 12, stiffness: 260 }, durationInFrames: 6 });
  const hl = cut.meta?.highlight ?? [];
  return (
    <div style={{ position: 'absolute', top, left: 40, right: 40, textAlign: 'center' }}>
      <span
        style={{
          display: 'inline-block',
          fontFamily: body,
          fontWeight: 900,
          fontSize: size,
          lineHeight: 1.2,
          letterSpacing: -1,
          color: '#fff',
          WebkitTextStroke: '10px #000',
          paintOrder: 'stroke fill',
          textShadow: '0 6px 18px rgba(0,0,0,0.55)',
          transform: `scale(${0.88 + pop * 0.12})`,
          wordBreak: 'keep-all',
        }}
      >
        {chunks[idx].map((w, i) => (
          <span key={i} style={{ color: hl.some((h) => w.includes(h.replace(/'/g, ''))) ? accent : '#fff' }}>
            {i ? ' ' : ''}
            {w}
          </span>
        ))}
      </span>
    </div>
  );
}

/** 위 패널 — 체크리스트 카드. current: 지금 설명 중인 번호(0 = 예고) */
function Checklist({ labels, current, accent, cut }: { labels: string[]; current: number; accent: string; cut: Cut }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 180 }, durationInFrames: 10 });
  const check = spring({ frame: frame - 8, fps, config: { damping: 11, stiffness: 240 }, durationInFrames: 10 });
  const count = current === 0 ? Math.round(interpolate(frame, [0, cut.durationInFrames * 0.6], [0, labels.length], { extrapolateRight: 'clamp' })) : current;
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: 1080, height: SPLIT, background: NAVY, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 70% 50% at 50% 0%, ${PURPLE}33, transparent 70%)` }} />
      {/* 머리줄 */}
      <div style={{ position: 'absolute', top: 100, left: 70, right: 70, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: body, fontWeight: 700, fontSize: 34, color: '#C9C6FF', background: `${PURPLE}26`, border: `2px solid ${PURPLE}66`, borderRadius: 999, padding: '10px 26px' }}>
          신혼 냄비 체크리스트
        </div>
        {/* 예고에선 '5가지'(개수), 항목에선 '1 / 5'(진행) — 예고에 '5 / 5' 를 띄우면 다 체크된 것처럼 읽힌다 */}
        <div style={{ fontFamily: display, fontSize: 88, color: '#fff', lineHeight: 1 }}>
          {count}
          <span style={{ fontSize: 44, color: '#8E8BB8' }}>{current === 0 ? '가지' : ` / ${labels.length}`}</span>
        </div>
      </div>
      {/* 줄 */}
      <div style={{ position: 'absolute', top: 240, left: 70, right: 70, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {labels.map((label, i) => {
          const n = i + 1;
          const done = current > 0 && n < current;
          const now = n === current;
          const hidden = current === 0 ? n === labels.length : n > current && n === labels.length;
          const rowEnter = spring({ frame: frame - i * 3, fps, config: { damping: 18, stiffness: 200 }, durationInFrames: 10 });
          const nowScale = now ? 1 + 0.03 * enter : 1;
          return (
            <div
              key={n}
              style={{
                height: 126,
                borderRadius: 26,
                display: 'flex',
                alignItems: 'center',
                gap: 28,
                padding: '0 32px',
                background: now ? `linear-gradient(90deg, ${PURPLE}55, ${PURPLE}22)` : 'rgba(255,255,255,0.05)',
                border: now ? `3px solid ${PURPLE}` : '2px solid rgba(255,255,255,0.08)',
                boxShadow: now ? `0 0 40px ${PURPLE}66` : 'none',
                opacity: (done || now ? 1 : 0.42) * rowEnter,
                transform: `translateY(${(1 - rowEnter) * 30}px) scale(${nowScale})`,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 18,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: display,
                  fontSize: 38,
                  color: done || now ? '#111' : '#C9C6FF',
                  background: done || now ? accent : 'rgba(255,255,255,0.1)',
                  transform: now ? `scale(${0.6 + 0.4 * check})` : 'none',
                }}
              >
                {done || (now && check > 0.5) ? '✓' : n}
              </div>
              <div style={{ fontFamily: body, fontWeight: now ? 900 : 700, fontSize: now ? 50 : 44, color: '#fff', letterSpacing: -1, filter: hidden ? 'blur(14px)' : 'none' }}>
                {hidden ? '마지막이 진짜 핵심' : label}
              </div>
              {hidden ? <div style={{ marginLeft: 'auto', fontSize: 44 }}>🔒</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FullTitle({ lines, accent }: { lines: [string, string]; accent: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 200 }, durationInFrames: 12 });
  const style: CSSProperties = { WebkitTextStroke: '14px #111', paintOrder: 'stroke fill', textShadow: '0 10px 30px rgba(0,0,0,0.6)' };
  return (
    <div
      style={{
        position: 'absolute',
        top: 300,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: display,
        fontSize: 128,
        lineHeight: 1.12,
        transform: `scale(${0.7 + 0.3 * pop}) rotate(${(1 - pop) * -4}deg)`,
      }}
    >
      <div style={{ ...style, color: '#fff' }}>{lines[0]}</div>
      <div style={{ ...style, color: accent }}>{lines[1]}</div>
    </div>
  );
}

function CommentPill({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 4) * 0.04;
  return (
    <div style={{ position: 'absolute', top: 1280, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontFamily: body, fontWeight: 900, fontSize: 46, color: '#111', background: accent, padding: '22px 46px', borderRadius: 999, transform: `scale(${pulse})`, boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
        💬 댓글에 "냄비" 남기기
      </div>
    </div>
  );
}

function Scene({ cut, spec, labels }: { cut: Cut; spec: Spec; labels: string[] }) {
  const kind = cut.meta?.kind ?? 'item';
  if (kind === 'hook' || kind === 'cta') {
    return (
      <AbsoluteFill>
        <Photo cut={cut} dim={0.45} style={{ inset: 0 }} />
        {kind === 'hook' ? <FullTitle lines={spec.title} accent={spec.accent} /> : <FullTitle lines={['궁금하면', '댓글 남겨요!']} accent={spec.accent} />}
        <Chunks cut={cut} accent={spec.accent} top={kind === 'hook' ? 1180 : 1080} size={66} />
        {kind === 'cta' ? <CommentPill accent={spec.accent} /> : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <Checklist labels={labels} current={kind === 'preview' ? 0 : cut.meta?.n ?? 0} accent={spec.accent} cut={cut} />
      <Photo cut={cut} style={{ top: SPLIT, left: 0, width: 1080, height: 1920 - SPLIT }} />
      <div style={{ position: 'absolute', top: SPLIT, left: 0, right: 0, height: 6, background: spec.accent }} />
      <Chunks cut={cut} accent={spec.accent} top={1430} />
    </AbsoluteFill>
  );
}

export function FormatB({ spec }: { spec: Spec }) {
  const labels = spec.labels ?? spec.cuts.filter((c) => c.meta?.kind === 'item').map((c) => c.caption);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Series>
        {spec.cuts.map((cut) => (
          <Series.Sequence key={cut.id} durationInFrames={cut.durationInFrames}>
            <Scene cut={cut} spec={spec} labels={labels} />
          </Series.Sequence>
        ))}
      </Series>
      {spec.narration ? (
        <Sequence from={spec.narration.startFrame}>
          <Audio src={staticFile(spec.narration.src)} />
        </Sequence>
      ) : null}
      <div style={{ position: 'absolute', bottom: 70, left: 0, right: 0, textAlign: 'center', fontFamily: body, fontWeight: 700, fontSize: 28, color: 'rgba(255,255,255,0.6)' }}>{spec.footer}</div>
    </AbsoluteFill>
  );
}
