import type { ReactNode } from 'react';
import type { CategoryId } from '../data/dummy';
import { boxFaces, faceX, faceY, faceZ, project, type Pt } from '../lib/iso';
import './IsoOffice.css';

export type StationState = 'working' | 'waiting' | 'idle' | 'locked';

/** 외형 — 마스터(하루) 또는 부서 */
export type Look = 'master' | CategoryId;

export interface StationView {
  category: CategoryId;
  state: StationState;
  /** 머리 위 이름표 — 이름 · 확인 필요 아이콘 · 진행률 바 */
  tag: ReactNode;
  onSelect?: () => void;
}

interface Props {
  stations: StationView[];
  master: { state: StationState; tag: ReactNode };
}

// ── 색 — 면 3단계(윗 · 왼 · 오른). 선은 CSS 에서 공통 ─────────────────

type Tone = readonly [string, string, string];

const T = {
  floor: ['#f4e8d6', '#e6d5bd', '#d8c4a7'],
  wall: ['#f8f2ea', '#f3ebe0', '#e9dfd1'],
  wood: ['#f1e2c8', '#e2cdab', '#d3b98f'],
  chair: ['#7a685b', '#63544a', '#524539'],
  robot: ['#fffaf3', '#efe5d8', '#e2d3c0'],
  dark: ['#4a3f38', '#3a2e26', '#2f2520'],
  laptop: ['#ecebe7', '#d9d6d0', '#c6c1ba'],
  kraft: ['#e8cfa6', '#d8bb8b', '#c8a874'],
  pot: ['#dca58a', '#c98f73', '#b67c61'],
  sofa: ['#d9c7b2', '#c7b39c', '#b49f88'],
  // 직무별 옷
  suit: ['#5b6b8c', '#4a5875', '#3d4962'],
  cardigan: ['#a9c2a0', '#93ad8a', '#809a77'],
  vest: ['#f1cf63', '#e0bb48', '#cda838'],
  hoodie: ['#b48bb5', '#9e769f', '#88628a'],
} satisfies Record<string, Tone>;

const outfit: Record<Look, Tone> = { master: T.suit, finance: T.cardigan, sourcing: T.vest, marketing: T.hoodie };

function Box({ x, y, z, w, d, h, tone = T.robot }: { x: number; y: number; z: number; w: number; d: number; h: number; tone?: Tone }) {
  const f = boxFaces(x, y, z, w, d, h);
  return (
    <g>
      <polygon points={f.left} style={{ fill: tone[1] }} />
      <polygon points={f.right} style={{ fill: tone[2] }} />
      <polygon points={f.top} style={{ fill: tone[0] }} />
    </g>
  );
}

function Line({ a, b, className = 'iso-line' }: { a: Pt; b: Pt; className?: string }) {
  return <line className={className} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
}

function Leaves({ x, y, z }: { x: number; y: number; z: number }) {
  const c = project(x, y, z);
  return (
    <g className="iso-leaves">
      <circle cx={c[0] - 7} cy={c[1] + 2} r={8} />
      <circle cx={c[0] + 7} cy={c[1] + 1} r={8} />
      <circle cx={c[0]} cy={c[1] - 8} r={9} />
    </g>
  );
}

// ── 에이전트 — 의자에 앉아 책상 앞에서 일한다. 얼굴은 화면, 옷 · 소품으로 직무가 보인다 ──

function Agent({ X, Y, look, state }: { X: number; Y: number; look: Look; state: StationState }) {
  const cloth = outfit[look];
  const front = Y + 32; // 몸통 앞면
  const face = Y + 33; // 머리 앞면
  const working = state === 'working';
  const waiting = state === 'waiting';

  return (
    <g className={`iso-agent is-${state}`}>
      {/* 의자 */}
      <Box x={X + 33} y={Y + 18} z={0} w={8} d={8} h={18} tone={T.chair} />
      <Box x={X + 18} y={Y + 8} z={18} w={38} d={30} h={6} tone={T.chair} />
      <Box x={X + 18} y={Y + 4} z={24} w={38} d={6} h={38} tone={T.chair} />

      {/* 몸통 + 옷 */}
      {look === 'marketing' && <Box x={X + 25} y={Y + 10} z={48} w={24} d={6} h={10} tone={T.hoodie} />}
      <Box x={X + 23} y={Y + 14} z={24} w={28} d={18} h={30} tone={cloth} />
      {look === 'master' && (
        <>
          <polygon className="iso-shirt" points={[project(X + 31, front, 54), project(X + 43, front, 54), project(X + 37, front, 42)].join(' ')} />
          <polygon className="iso-tie" points={[project(X + 36, front, 51), project(X + 38, front, 51), project(X + 39.5, front, 34), project(X + 34.5, front, 34)].join(' ')} />
        </>
      )}
      {look === 'finance' && (
        <>
          <polygon className="iso-shirt" points={[project(X + 32, front, 54), project(X + 42, front, 54), project(X + 37, front, 44)].join(' ')} />
          {[42, 37, 32].map((z) => {
            const [cx, cy] = project(X + 37, front, z);
            return <circle key={z} className="iso-button" cx={cx} cy={cy} r={1.3} />;
          })}
        </>
      )}
      {look === 'sourcing' && (
        <>
          <polygon className="iso-stripe" points={faceY(front, X + 23, X + 51, 36, 39.5)} />
          <polygon className="iso-stripe" points={faceX(X + 51, Y + 14, front, 36, 39.5)} />
        </>
      )}
      {look === 'marketing' && <polygon className="iso-pocket" points={faceY(front, X + 30, X + 44, 29, 36)} />}

      {/* 머리 — 흰 로봇 머리 + 검은 얼굴 화면 */}
      <Box x={X + 26} y={Y + 15} z={54} w={22} d={18} h={20} />
      <polygon className="iso-face" points={faceY(face, X + 28.5, X + 45.5, 57, 71)} />
      <polygon className="iso-eye" points={faceY(face, X + 31.5, X + 35, 61, 66)} />
      <polygon className="iso-eye" points={faceY(face, X + 39, X + 42.5, 61, 66)} />

      {look === 'finance' && (
        <g className="iso-glasses">
          <polygon points={faceY(face, X + 30.2, X + 36.3, 59.8, 67.2)} />
          <polygon points={faceY(face, X + 37.7, X + 43.8, 59.8, 67.2)} />
          <Line a={project(X + 36.3, face, 64)} b={project(X + 37.7, face, 64)} className="iso-glasses-bridge" />
        </g>
      )}
      {look === 'sourcing' && (
        <>
          <Box x={X + 24} y={Y + 13} z={74} w={26} d={24} h={3} tone={T.vest} />
          <Box x={X + 27} y={Y + 16} z={77} w={20} d={16} h={7} tone={T.vest} />
        </>
      )}
      {look === 'marketing' && (
        <>
          <Box x={X + 24.5} y={Y + 21} z={74} w={25} d={4} h={4} tone={T.dark} />
          <Box x={X + 23.2} y={Y + 19} z={60} w={3} d={9} h={12} tone={T.dark} />
          <Box x={X + 47.8} y={Y + 19} z={60} w={3} d={9} h={12} tone={T.dark} />
        </>
      )}
      {(look === 'finance' || look === 'master') && (
        <>
          <Line a={project(X + 37, Y + 24, 74)} b={project(X + 37, Y + 24, 82)} />
          {look === 'master' ? (
            <path
              className="iso-crown"
              d={(() => {
                const [cx, cy] = project(X + 37, Y + 24, 86);
                return `M${cx - 8} ${cy + 3} L${cx - 6} ${cy - 5} L${cx - 2} ${cy - 1} L${cx} ${cy - 7} L${cx + 2} ${cy - 1} L${cx + 6} ${cy - 5} L${cx + 8} ${cy + 3} Z`;
              })()}
            />
          ) : (
            <circle className="iso-antenna" cx={project(X + 37, Y + 24, 85)[0]} cy={project(X + 37, Y + 24, 85)[1]} r={3.2} />
          )}
        </>
      )}

      {/* 승인 대기 — 오른손을 든다 */}
      {waiting && (
        <>
          <Box x={X + 51} y={Y + 18} z={50} w={6} d={7} h={24} tone={cloth} />
          <Box x={X + 51} y={Y + 18} z={74} w={6} d={7} h={6} />
        </>
      )}

      {/* 책상 */}
      <Box x={X + 8} y={Y + 40} z={0} w={4} d={30} h={26} tone={T.wood} />
      <Box x={X + 72} y={Y + 40} z={0} w={4} d={30} h={26} tone={T.wood} />
      <Box x={X + 6} y={Y + 38} z={26} w={72} d={34} h={6} tone={T.wood} />

      {/* 팔 — 일할 때 타이핑 */}
      <g className="iso-arm is-left">
        <Box x={X + 19} y={Y + 28} z={32} w={7} d={16} h={6} tone={cloth} />
        <Box x={X + 19} y={Y + 44} z={32} w={7} d={4} h={5} />
      </g>
      {!waiting && (
        <g className="iso-arm is-right">
          <Box x={X + 48} y={Y + 28} z={32} w={7} d={16} h={6} tone={cloth} />
          <Box x={X + 48} y={Y + 44} z={32} w={7} d={4} h={5} />
        </g>
      )}

      {/* 직무 소품 */}
      {look === 'finance' && (
        <>
          <Box x={X + 10} y={Y + 46} z={32} w={18} d={14} h={7} />
          <Box x={X + 10} y={Y + 62} z={32} w={13} d={8} h={3} tone={T.dark} />
        </>
      )}
      {look === 'sourcing' && (
        <>
          <Box x={X + 9} y={Y + 46} z={32} w={18} d={16} h={13} tone={T.kraft} />
          <Box x={X + 82} y={Y + 42} z={0} w={24} d={22} h={20} tone={T.kraft} />
          <Box x={X + 85} y={Y + 45} z={20} w={18} d={16} h={14} tone={T.kraft} />
        </>
      )}
      {look === 'marketing' && (
        <>
          <Box x={X + 15} y={Y + 54} z={32} w={4} d={4} h={14} tone={T.dark} />
          <Box x={X + 10} y={Y + 50} z={46} w={14} d={11} h={9} tone={T.dark} />
          {(() => {
            const [cx, cy] = project(X + 17, Y + 61, 50.5);
            return <circle className="iso-lens" cx={cx} cy={cy} r={3.2} />;
          })()}
        </>
      )}
      {look === 'master' && (
        <>
          <Box x={X + 11} y={Y + 46} z={32} w={11} d={11} h={9} tone={T.pot} />
          <Leaves x={X + 16} y={Y + 51} z={49} />
          <Box x={X + 30} y={Y + 62} z={32} w={6} d={6} h={7} />
        </>
      )}

      {/* 노트북 — 일하는 중이면 로고가 켜진다 */}
      <Box x={X + 46} y={Y + 44} z={32} w={26} d={14} h={2} tone={T.laptop} />
      <Box x={X + 46} y={Y + 58} z={34} w={26} d={2} h={15} tone={T.laptop} />
      <polygon className={`iso-logo ${working ? 'is-on' : ''}`} points={faceY(Y + 60, X + 56, X + 62, 39, 45)} />

      {/* 승인 대기 깃발 */}
      {waiting && (
        <>
          <Line a={project(X + 76, Y + 40, 32)} b={project(X + 76, Y + 40, 74)} />
          <polygon className="iso-flag-cloth" points={faceY(Y + 40, X + 76, X + 96, 60, 74)} />
        </>
      )}
    </g>
  );
}

// ── 배치 ────────────────────────────────────────────────────────

const FLOOR = { w: 460, d: 360 };
const WALL_H = 150;

const seats: Record<Look, { x: number; y: number }> = {
  master: { x: 190, y: 50 },
  finance: { x: 70, y: 170 },
  sourcing: { x: 300, y: 160 },
  marketing: { x: 190, y: 250 },
};

/** 이름표를 붙이는 높이 — 왕관 · 안전모 바로 위 */
const TAG_Z = 98;

// 방 + 머리 위 이름표만 들어가면 된다 (라벨 카드가 빠져 좌우 여백이 줄었다)
const VB = { x: -325, y: -162, w: 735, h: 584 };

function Room() {
  return (
    <g className="iso-room">
      {/* 바닥 · 마루 */}
      <Box x={0} y={0} z={-10} w={FLOOR.w} d={FLOOR.d} h={10} tone={T.floor} />
      {Array.from({ length: Math.floor(FLOOR.d / 36) }, (_, i) => (i + 1) * 36).map((y) => (
        <Line key={y} a={project(0, y)} b={project(FLOOR.w, y)} className="iso-plank" />
      ))}

      {/* 벽 두 면 */}
      <Box x={-8} y={0} z={0} w={8} d={FLOOR.d} h={WALL_H} tone={T.wall} />
      <Box x={0} y={-8} z={0} w={FLOOR.w} d={8} h={WALL_H} tone={T.wall} />
      <Box x={-8} y={-8} z={0} w={8} d={8} h={WALL_H} tone={T.wall} />

      {/* 창문 */}
      {[
        [36, 126],
        [150, 240],
        [264, 324],
      ].map(([a, b]) => (
        <g key={a}>
          <polygon className="iso-glass" points={faceY(0, a, b, 56, 128)} />
          <Line a={project((a + b) / 2, 0, 56)} b={project((a + b) / 2, 0, 128)} />
          <Line a={project(a, 0, 92)} b={project(b, 0, 92)} />
        </g>
      ))}

      {/* 화이트보드 + 포스트잇 */}
      <polygon className="iso-board" points={faceX(0, 40, 160, 62, 120)} />
      {[
        [56, 104, '#f6d77a'],
        [76, 108, '#f3a98b'],
        [98, 100, '#a9c2a0'],
        [120, 106, '#b48bb5'],
        [64, 86, '#f3a98b'],
        [108, 84, '#f6d77a'],
      ].map(([y, z, c]) => (
        <polygon key={`${y}-${z}`} className="iso-note" style={{ fill: c as string }} points={faceX(0, y as number, (y as number) + 14, (z as number) - 12, z as number)} />
      ))}

      {/* 커피 바 + 상부장 */}
      <polygon className="iso-cabinet" points={faceY(0, 344, 452, 100, 132)} />
      <Box x={344} y={0} z={0} w={108} d={30} h={40} tone={T.wood} />
      <Box x={358} y={6} z={40} w={20} d={16} h={22} tone={T.dark} />
      <Box x={390} y={10} z={40} w={6} d={6} h={7} />
      <Box x={402} y={10} z={40} w={6} d={6} h={7} />

      {/* 라운지 러그 · 소파 · 테이블 */}
      <polygon className="iso-rug" points={faceZ(0.3, 12, 236, 150, 352)} />
    </g>
  );
}

function Lounge() {
  return (
    <g>
      <Box x={10} y={246} z={0} w={40} d={96} h={18} tone={T.sofa} />
      <Box x={10} y={246} z={18} w={12} d={96} h={26} tone={T.sofa} />
      <Box x={10} y={246} z={18} w={40} d={10} h={14} tone={T.sofa} />
      <Box x={10} y={332} z={18} w={40} d={10} h={14} tone={T.sofa} />
      <Box x={76} y={270} z={0} w={48} d={52} h={16} tone={T.wood} />
      <Box x={96} y={290} z={16} w={6} d={6} h={7} />
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <Box x={x} y={y} z={0} w={22} d={22} h={26} tone={T.pot} />
      <Leaves x={x + 11} y={y + 11} z={44} />
      <Leaves x={x + 8} y={y + 8} z={58} />
    </g>
  );
}

/**
 * 사무실 장면 — 공유 오피스. 벽 두 면(창문 · 화이트보드 · 커피 바)과 라운지 사이에
 * 하루(마스터)와 부서 에이전트 3명이 의자에 앉아 일한다. 이름표는 HTML 로 머리 위에 얹는다.
 * 장면은 비율을 지킨 채 주어진 칸(가로 · 세로)에 맞춰 커지고 줄어든다.
 */
export function IsoOffice({ stations, master }: Props) {
  const toPct = ([sx, sy]: Pt) => ({ left: `${((sx - VB.x) / VB.w) * 100}%`, top: `${((sy - VB.y) / VB.h) * 100}%` });

  const people: { look: Look; state: StationState; onSelect?: () => void; tag: ReactNode }[] = [
    { look: 'master', state: master.state, tag: master.tag },
    ...stations.map((s) => ({ look: s.category as Look, state: s.state, onSelect: s.onSelect, tag: s.tag })),
  ];

  // 화가 알고리즘 — 뒤(x + y 가 작은 것)부터 그린다
  const things: { key: string; depth: number; node: ReactNode }[] = [
    { key: 'plant-a', depth: 226, node: <Plant x={14} y={190} /> },
    { key: 'plant-b', depth: 500, node: <Plant x={428} y={44} /> },
    { key: 'lounge', depth: 320, node: <Lounge /> },
    ...people.map((p) => {
      const s = seats[p.look];
      return {
        key: p.look,
        depth: s.x + 50 + s.y + 40,
        node: (
          <g
            className={p.onSelect && p.state !== 'locked' ? 'iso-seat is-clickable' : 'iso-seat'}
            onClick={p.state === 'locked' ? undefined : p.onSelect}
          >
            <polygon className="iso-pad" points={faceZ(0.5, s.x, s.y, s.x + 110, s.y + 76)} />
            <Agent X={s.x} Y={s.y} look={p.look} state={p.state} />
          </g>
        ),
      };
    }),
  ].sort((a, b) => a.depth - b.depth);

  return (
    <div className="iso-stage">
      <div className="iso-canvas">
        <svg viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} className="iso-svg" aria-hidden>
          <Room />
          {things.map((t) => (
            <g key={t.key}>{t.node}</g>
          ))}
        </svg>

        {people.map((p) => {
          const s = seats[p.look];
          return (
            <div key={`tag-${p.look}`} className="iso-tag-slot" style={toPct(project(s.x + 37, s.y + 24, TAG_Z))}>
              {p.tag}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 에이전트 카드 머리에 쓰는 작은 그림 — 책상에 앉은 그 에이전트 */
export function IsoAgentIcon({ look, state, size = 96 }: { look: Look; state: StationState; size?: number }) {
  return (
    <svg className="iso-icon" width={size} height={size * 0.95} viewBox="-62 -72 160 150" aria-hidden>
      <Agent X={0} Y={0} look={look} state={state} />
    </svg>
  );
}
