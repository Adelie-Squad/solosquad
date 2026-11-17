// 형식 A — "3단 레터박스 + 짧은 컷 몽타주"
//   상단: 고정 2줄 타이틀(썸네일 역할) · 가운데: 정사각 창, 2~3초 하드컷 + Ken Burns · 하단: 내레이션 1줄 자막
// 레퍼런스의 구조만 가져오고 문구·이미지·색은 스펙에서 받는다.

import { loadFont as loadDisplay } from '@remotion/google-fonts/BlackHanSans';
import { loadFont as loadBody } from '@remotion/google-fonts/NotoSansKR';
import { AbsoluteFill, Audio, Img, Series, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Cut, Focus, Spec } from './spec';

const { fontFamily: display } = loadDisplay();
const { fontFamily: body } = loadBody('normal', { weights: ['700', '900'], subsets: ['korean'] });

const TOP = 330;
const WINDOW = 1080;
const CAPTION_Y = TOP + WINDOW + 56;

const origin: Record<Focus, string> = { left: '30% 50%', center: '50% 50%', right: '70% 50%' };

function KenBurns({ cut, index }: { cut: Cut; index: number }) {
  const frame = useCurrentFrame();
  const t = frame / cut.durationInFrames;
  // 짝수 컷은 밀고 들어가고, 홀수 컷은 살짝 당겨 나온다 — 같은 움직임이 반복되지 않게
  const scale = index % 2 === 0 ? interpolate(t, [0, 1], [1.04, 1.16]) : interpolate(t, [0, 1], [1.16, 1.06]);
  const drift = interpolate(t, [0, 1], [0, index % 2 === 0 ? -18 : 18]);
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#222' }}>
      {cut.image ? (
        <Img
          src={staticFile(cut.image)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `translateX(${drift}px) scale(${scale})`,
            transformOrigin: origin[cut.focus ?? 'center'],
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}

function Caption({ text, last }: { text: string; last: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 220 }, durationInFrames: 8 });
  return (
    <div
      style={{
        position: 'absolute',
        top: CAPTION_Y,
        left: 60,
        right: 60,
        textAlign: 'center',
        fontFamily: body,
        fontWeight: 900,
        fontSize: last ? 54 : 60,
        lineHeight: 1.25,
        color: '#fff',
        letterSpacing: -1,
        transform: `scale(${0.92 + pop * 0.08})`,
        opacity: pop,
        wordBreak: 'keep-all',
      }}
    >
      {text}
    </div>
  );
}

function LinkPill({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 4) * 0.035;
  return (
    <div style={{ position: 'absolute', top: CAPTION_Y + 120, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          fontFamily: body,
          fontWeight: 900,
          fontSize: 40,
          color: '#111',
          background: accent,
          padding: '16px 40px',
          borderRadius: 999,
          transform: `scale(${pulse})`,
        }}
      >
        프로필 링크에서 구매하기 →
      </div>
    </div>
  );
}

export function FormatA({ spec }: { spec: Spec }) {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* 가운데 창 — 컷이 바뀌는 곳 */}
      <div style={{ position: 'absolute', top: TOP, left: 0, width: 1080, height: WINDOW, overflow: 'hidden' }}>
        <Series>
          {spec.cuts.map((cut, i) => (
            <Series.Sequence key={cut.id} durationInFrames={cut.durationInFrames}>
              <KenBurns cut={cut} index={i} />
            </Series.Sequence>
          ))}
        </Series>
      </div>

      {/* 상단 고정 타이틀 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          height: TOP,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          fontFamily: display,
          fontSize: 92,
          lineHeight: 1.12,
          paddingTop: 24,
        }}
      >
        <div style={{ color: '#fff' }}>{spec.title[0]}</div>
        <div style={{ color: spec.accent }}>{spec.title[1]}</div>
      </div>

      {/* 자막 + 내레이션 */}
      <Series>
        {spec.cuts.map((cut, i) => {
          const last = i === spec.cuts.length - 1;
          return (
            <Series.Sequence key={cut.id} durationInFrames={cut.durationInFrames}>
              <Caption text={cut.caption} last={last} />
              {last ? <LinkPill accent={spec.accent} /> : null}
              {cut.audio ? <Audio src={staticFile(cut.audio)} /> : null}
            </Series.Sequence>
          );
        })}
      </Series>

      {/* 하단 도메인 표기 */}
      <div
        style={{
          position: 'absolute',
          top: CAPTION_Y + 250,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: body,
          fontWeight: 700,
          fontSize: 30,
          color: 'rgba(255,255,255,0.55)',
          letterSpacing: 1,
        }}
      >
        {spec.footer}
      </div>
    </AbsoluteFill>
  );
}
