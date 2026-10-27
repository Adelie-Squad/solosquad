import type { ReactNode } from 'react';
import type { CategoryId } from '../data/dummy';
import { boxFaces, faceX, faceY, faceZ, project, type Pt } from '../lib/iso';
import './IsoOffice.css';

export type StationState = 'working' | 'waiting' | 'idle' | 'locked';

export interface StationView {
  category: CategoryId;
  state: StationState;
  label: ReactNode;
  onSelect?: () => void;
}

interface Props {
  stations: StationView[];
  hubWorking: boolean;
  hubLabel: ReactNode;
}

// 월드 배치 — 하루 허브가 위쪽 가운데, 스테이션 3곳이 허브의 x 축 · y 축 · 대각선 끝에 놓인다
const HUB = { x: 180, y: 180, w: 120 };
const STATION = 96;
const layout: Record<CategoryId, { x: number; y: number; lane: [Pt, Pt][]; flow: [number, number, number, number]; offset: Pt; side: 'left' | 'right' }> = {
  sourcing: {
    x: 390,
    y: 192,
    lane: [
      [[300, 226], [390, 226]],
      [[300, 254], [390, 254]],
    ],
    flow: [300, 234, 378, 234],
    offset: [104, -72],
    side: 'right',
  },
  marketing: {
    x: 192,
    y: 390,
    lane: [
      [[226, 300], [226, 390]],
      [[254, 300], [254, 390]],
    ],
    flow: [234, 300, 234, 378],
    offset: [-96, 128],
    side: 'left',
  },
  finance: {
    x: 390,
    y: 390,
    lane: [
      [[310, 290], [400, 380]],
      [[290, 310], [380, 400]],
    ],
    flow: [294, 294, 380, 380],
    offset: [190, 112],
    side: 'right',
  },
};

// viewBox — 라벨 카드가 들어갈 자리까지 넉넉히
const VB = { x: -530, y: 36, w: 1060, h: 548 };

function Box({ x, y, z, w, d, h, className = '' }: { x: number; y: number; z: number; w: number; d: number; h: number; className?: string }) {
  const f = boxFaces(x, y, z, w, d, h);
  return (
    <g className={`iso-box ${className}`}>
      <polygon className="iso-face-left" points={f.left} />
      <polygon className="iso-face-right" points={f.right} />
      <polygon className="iso-face-top" points={f.top} />
    </g>
  );
}

function Packet({ flow, index }: { flow: [number, number, number, number]; index: number }) {
  const [x0, y0, x1, y1] = flow;
  const a = project(x0, y0);
  const b = project(x1, y1);
  return (
    <g
      className="iso-packet"
      style={{
        ['--dx' as string]: `${b[0] - a[0]}px`,
        ['--dy' as string]: `${b[1] - a[1]}px`,
        animationDelay: `${index * 0.8}s`,
      }}
    >
      <Box x={x0} y={y0} z={0} w={12} d={12} h={12} className="is-accent" />
    </g>
  );
}

function Station({ view }: { view: StationView }) {
  const { x: X, y: Y } = layout[view.category];
  const working = view.state === 'working';
  return (
    <g
      className={`iso-station is-${view.state}`}
      onClick={view.state === 'locked' ? undefined : view.onSelect}
      role="presentation"
    >
      <polygon className="iso-pad" points={faceZ(0, X - 8, Y - 8, X + STATION + 8, Y + STATION + 8)} />
      <Box x={X} y={Y} z={0} w={STATION} d={STATION} h={26} />
      {/* 역할 타일 3개 — 일할 때 주황으로 켜진다 */}
      {[0, 1, 2].map((i) => (
        <Box key={i} x={X + 10 + i * 28} y={Y + 70} z={26} w={22} d={16} h={3} className={working ? 'is-accent is-tile' : 'is-tile'} />
      ))}
      {/* 모니터 */}
      <Box x={X + 66} y={Y + 14} z={26} w={8} d={42} h={30} />
      <polygon className={`iso-screen ${working ? 'is-on' : ''}`} points={faceX(X + 74, Y + 18, Y + 52, 31, 52)} />
      {/* 워커 에이전트 — 몸 · 머리 · 얼굴 화면 · 눈 · 안테나 */}
      <g className="iso-robot">
        <Box x={X + 24} y={Y + 24} z={26} w={30} d={30} h={20} />
        <Box x={X + 18} y={Y + 18} z={46} w={42} d={42} h={26} />
        <polygon className="iso-face" points={faceY(Y + 60, X + 23, X + 55, 51, 68)} />
        <polygon className="iso-eye" points={faceY(Y + 60, X + 30, X + 36, 56, 63)} />
        <polygon className="iso-eye" points={faceY(Y + 60, X + 42, X + 48, 56, 63)} />
        <line className="iso-line" x1={project(X + 39, Y + 39, 72)[0]} y1={project(X + 39, Y + 39, 72)[1]} x2={project(X + 39, Y + 39, 84)[0]} y2={project(X + 39, Y + 39, 84)[1]} />
        <circle className="iso-antenna" cx={project(X + 39, Y + 39, 87)[0]} cy={project(X + 39, Y + 39, 87)[1]} r={3.6} />
      </g>
      {/* 승인 대기 깃발 */}
      {view.state === 'waiting' && (
        <g className="iso-flag">
          <line className="iso-line" x1={project(X + 8, Y + 8, 26)[0]} y1={project(X + 8, Y + 8, 26)[1]} x2={project(X + 8, Y + 8, 104)[0]} y2={project(X + 8, Y + 8, 104)[1]} />
          <polygon className="iso-flag-cloth" points={faceY(Y + 8, X + 8, X + 34, 86, 104)} />
        </g>
      )}
    </g>
  );
}

/** 에이전트 카드 머리에 쓰는 작은 워커 로봇 */
export function IsoAgentIcon({ working, size = 72 }: { working: boolean; size?: number }) {
  return (
    <svg className={`iso-icon ${working ? 'is-working' : ''}`} width={size} height={size} viewBox="-44 -70 88 116" aria-hidden>
      <g className="iso-robot">
        <Box x={6} y={6} z={0} w={30} d={30} h={20} />
        <Box x={0} y={0} z={20} w={42} d={42} h={26} />
        <polygon className="iso-face" points={faceY(42, 5, 37, 25, 42)} />
        <polygon className="iso-eye" points={faceY(42, 12, 18, 30, 37)} />
        <polygon className="iso-eye" points={faceY(42, 24, 30, 30, 37)} />
        <line className="iso-line" x1={project(21, 21, 46)[0]} y1={project(21, 21, 46)[1]} x2={project(21, 21, 58)[0]} y2={project(21, 21, 58)[1]} />
        <circle className="iso-antenna" cx={project(21, 21, 61)[0]} cy={project(21, 21, 61)[1]} r={3.6} />
      </g>
    </svg>
  );
}

/**
 * 사무실 장면 — 크림색 바닥 위 아이소메트릭 선화. 하루 허브에서 부서 스테이션으로
 * 점선 작업 경로가 이어지고, 일하는 부서로 작업 큐브가 흘러간다. 글자는 HTML 라벨 카드로 얹는다.
 */
export function IsoOffice({ stations, hubWorking, hubLabel }: Props) {
  const toPct = ([sx, sy]: Pt) => ({ left: `${((sx - VB.x) / VB.w) * 100}%`, top: `${((sy - VB.y) / VB.h) * 100}%` });
  const by = (c: CategoryId) => stations.find((s) => s.category === c);
  const stationAnchor = (c: CategoryId): Pt => project(layout[c].x + STATION / 2, layout[c].y + STATION / 2, 108);
  const hubAnchor = project(HUB.x + HUB.w / 2, HUB.y + HUB.w / 2, 84);
  const hubOffset: Pt = [-170, -44];
  const labelPoint = (a: Pt, o: Pt): Pt => [a[0] + o[0], a[1] + o[1]];
  const flowing = stations.filter((s) => s.state === 'working');

  return (
    <div className="iso-stage">
      <svg viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} className="iso-svg" aria-hidden>
        {/* 바닥 */}
        <Box x={150} y={150} z={-12} w={360} d={360} h={12} className="is-floor" />
        <polygon className="iso-guide" points={faceZ(0, 162, 162, 498, 498)} />

        {/* 작업 경로 */}
        {stations.map((s) =>
          layout[s.category].lane.map(([a, b], i) => {
            const p = project(a[0], a[1]);
            const q = project(b[0], b[1]);
            return <line key={`${s.category}-${i}`} className="iso-lane" x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} />;
          }),
        )}

        {/* 허브 뒤에서 나오는 큐브 — 소싱 · 마케팅 */}
        {flowing
          .filter((s) => s.category !== 'finance')
          .map((s) => [0, 1, 2].map((i) => <Packet key={`${s.category}-${i}`} flow={layout[s.category].flow} index={i} />))}

        {(['sourcing', 'marketing'] as const).map((c) => {
          const v = by(c);
          return v ? <Station key={c} view={v} /> : null;
        })}

        {/* 하루 허브 */}
        <g className={`iso-hub ${hubWorking ? 'is-working' : ''}`}>
          <Box x={170} y={170} z={0} w={140} d={140} h={14} />
          <Box x={HUB.x} y={HUB.y} z={14} w={HUB.w} d={HUB.w} h={44} />
          <Box x={194} y={194} z={58} w={92} d={92} h={6} className="is-rim" />
          <polygon className="iso-hub-well" points={faceZ(64, 204, 204, 276, 276)} />
          <Box x={222} y={222} z={64} w={36} d={36} h={16} className="is-core" />
          {[
            [186, 186],
            [294, 186],
            [186, 294],
            [294, 294],
          ].map(([bx, by2]) => {
            const [cx, cy] = project(bx, by2, 58);
            return <circle key={`${bx}-${by2}`} className="iso-bolt" cx={cx} cy={cy} r={3} />;
          })}
          <polygon className="iso-slot" points={faceY(300, 206, 274, 24, 46)} />
          {[0, 1, 2].map((i) => (
            <polygon key={i} className={`iso-light ${hubWorking ? 'is-on' : ''}`} points={faceX(300, 206 + i * 24, 220 + i * 24, 30, 40)} />
          ))}
        </g>

        {flowing
          .filter((s) => s.category === 'finance')
          .map((s) => [0, 1, 2].map((i) => <Packet key={`${s.category}-${i}`} flow={layout.finance.flow} index={i} />))}

        {by('finance') && <Station view={by('finance')!} />}

        {/* 지시선 */}
        {stations.map((s) => {
          const a = stationAnchor(s.category);
          const b = labelPoint(a, layout[s.category].offset);
          return (
            <g key={`leader-${s.category}`} className="iso-leader">
              <circle cx={a[0]} cy={a[1]} r={2.5} />
              <polyline points={`${a[0]},${a[1]} ${a[0] + layout[s.category].offset[0] * 0.35},${b[1]} ${b[0]},${b[1]}`} />
            </g>
          );
        })}
        <g className="iso-leader">
          <circle cx={hubAnchor[0]} cy={hubAnchor[1]} r={2.5} />
          <polyline
            points={`${hubAnchor[0]},${hubAnchor[1]} ${hubAnchor[0] + hubOffset[0] * 0.35},${hubAnchor[1] + hubOffset[1]} ${hubAnchor[0] + hubOffset[0]},${hubAnchor[1] + hubOffset[1]}`}
          />
        </g>
      </svg>

      {stations.map((s) => (
        <div
          key={`label-${s.category}`}
          className={`iso-label-slot is-${layout[s.category].side}`}
          style={toPct(labelPoint(stationAnchor(s.category), layout[s.category].offset))}
        >
          {s.label}
        </div>
      ))}
      <div className="iso-label-slot is-left" style={toPct(labelPoint(hubAnchor, hubOffset))}>
        {hubLabel}
      </div>
    </div>
  );
}
