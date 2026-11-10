// The 2D penguin (DESIGN.md `## 에이전트 캐릭터`): front view, the role's prop, a ring in the team
// colour. Icon sizes 20 / 28 / 40 (64 in a modal head) show the upper body inside the ring; the
// mascot is the same penguin, whole (feet included) and with no prop. Shape: ./penguinShape.ts.
import { useId, type ReactNode } from 'react';
import { PENGUIN_2D as C, teamColor } from './colors';
import { BEAK_PATH, BEAK_SEAM, BODY, CHEEKS, EYES, FEET, FLIPPERS, FRONT, FRONT_STITCH, FULL_VIEW } from './penguinShape';
import { lookOf, type Prop } from './roster';

export type IconSize = 20 | 28 | 40 | 64;

const L = C.line;
const SW = 0.9;

/**
 * How the stitch is drawn at a size. From 40px up it is a dashed seam; below that a dash would be
 * a sub-pixel speck, so it becomes one thin continuous line (it still reads as the seam and keeps
 * the white beak's edge visible on the white front).
 */
export function stitchStyle(size: number): { width: number; dash?: string; beakWidth: number; beakDash?: string } {
  if (size >= 40) return { width: 0.5, dash: '0.9 0.7', beakWidth: 0.45, beakDash: '0.62 0.45' };
  return { width: 0.55, beakWidth: size <= 20 ? 0.75 : 0.6 };
}

function PropArt({ prop, accent }: { prop: Prop; accent: string }): ReactNode {
  switch (prop) {
    case 'crown-bowtie':
      return (
        <>
          <path d="M14.5 8.2l1.6-4 2.3 2.6L20 3l1.6 3.8 2.3-2.6 1.6 4z" fill={C.gold} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M16.6 27.6l3.4 1.7 3.4-1.7v3.4L20 29.3l-3.4 1.7z" fill={accent} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
        </>
      );
    case 'clipboard':
      return (
        <g transform="rotate(-12 30 31)">
          <rect x="26" y="26" width="8" height="10" rx="1" fill={C.paper} stroke={L} strokeWidth={SW} />
          <rect x="28" y="25" width="4" height="2" rx=".5" fill={accent} stroke={L} strokeWidth={SW} />
        </g>
      );
    case 'beret':
      return <path d="M10.5 11.5c1-4 5-6 9.5-6 5 0 9 2.3 9.5 5.6.1.8-.6 1.4-1.4 1.2-5-1.2-10.5-1.2-16.6.4-.7.2-1.2-.5-1-1.2z" fill={accent} stroke={L} strokeWidth={SW} />;
    case 'round-glasses':
    case 'gold-glasses': {
      const frame = prop === 'gold-glasses' ? C.gold : L;
      return (
        <>
          <circle cx={EYES[0].cx} cy={EYES[0].cy} r="2.9" fill="none" stroke={frame} strokeWidth={1.1} />
          <circle cx={EYES[1].cx} cy={EYES[1].cy} r="2.9" fill="none" stroke={frame} strokeWidth={1.1} />
          <path d="M19.1 18.2h1.8" stroke={frame} strokeWidth={1.1} />
          {prop === 'gold-glasses' && (
            <g>
              <rect x="27" y="27" width="7" height="9" rx="1" fill={C.metal} stroke={L} strokeWidth={SW} />
              <rect x="28.2" y="28.2" width="4.6" height="2" fill={C.paper} />
            </g>
          )}
        </>
      );
    }
    case 'chart':
      return (
        <g>
          <rect x="26" y="26" width="9" height="9" rx="1" fill={C.paper} stroke={L} strokeWidth={SW} />
          <path d="M28 33v-2.5M30.5 33v-5M33 33v-3.5" stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
        </g>
      );
    case 'beanie':
      return (
        <>
          <path d="M11 13c0-5 4-8 9-8s9 3 9 8z" fill={accent} stroke={L} strokeWidth={SW} />
          <rect x="10.5" y="11.6" width="19" height="2.8" rx="1.2" fill={accent} stroke={L} strokeWidth={SW} />
          <circle cx="20" cy="4.6" r="1.6" fill={C.paper} stroke={L} strokeWidth={SW} />
        </>
      );
    case 'headset':
      return (
        <>
          <path d="M9.5 18c0-7 4.7-11 10.5-11s10.5 4 10.5 11" fill="none" stroke={L} strokeWidth={1.6} />
          <rect x="7.6" y="16" width="3.6" height="6" rx="1.4" fill={accent} stroke={L} strokeWidth={SW} />
          <rect x="28.8" y="16" width="3.6" height="6" rx="1.4" fill={accent} stroke={L} strokeWidth={SW} />
          <path d="M10 22c0 3 2.5 4.5 5.5 4.5" fill="none" stroke={L} strokeWidth={1} />
        </>
      );
    case 'cube':
      return (
        <g>
          <path d="M30.5 25l4 2v4.4l-4 2-4-2V27z" fill={accent} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M26.5 27l4 2 4-2M30.5 29v4.4" fill="none" stroke={L} strokeWidth={SW} />
        </g>
      );
    case 'hardhat':
      return (
        <>
          <path d="M11.5 12.5c0-4.6 3.8-7.6 8.5-7.6s8.5 3 8.5 7.6z" fill={C.helmet} stroke={L} strokeWidth={SW} />
          <rect x="9.5" y="11.8" width="21" height="2" rx="1" fill={C.helmet} stroke={L} strokeWidth={SW} />
          <path d="M26 28h6v3.5c0 2-1.4 3.4-3 4-1.6-.6-3-2-3-4z" fill={accent} stroke={L} strokeWidth={SW} />
        </>
      );
    case 'magnifier':
      return (
        <>
          <circle cx="30" cy="27.5" r="3.6" fill={C.lens} stroke={L} strokeWidth={1.2} />
          <path d="M27.6 30.2l-3 3.6" stroke={L} strokeWidth={1.8} strokeLinecap="round" />
        </>
      );
    case 'tie':
      return <path d="M18.6 29.5h2.8l-.5 1.5 1.3 4.5-2.2 1.8-2.2-1.8 1.3-4.5z" fill={accent} stroke={L} strokeWidth={SW} strokeLinejoin="round" />;
    case 'card':
      return (
        <g transform="rotate(-10 30 30)">
          <rect x="25.5" y="27" width="9" height="6" rx="1" fill={C.paper} stroke={L} strokeWidth={SW} />
          <path d="M27 29.2h4M27 31h2.6" stroke={accent} strokeWidth={1} />
        </g>
      );
    case 'megaphone':
      return (
        <g>
          <path d="M26 28.5l7-3.5v9l-7-3.5z" fill={accent} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
          <rect x="24" y="28" width="2.4" height="3" fill={C.paper} stroke={L} strokeWidth={SW} />
        </g>
      );
    case 'brush':
      return (
        <g transform="rotate(35 30 30)">
          <rect x="29" y="24" width="2" height="9" fill={C.metal} stroke={L} strokeWidth={SW} />
          <path d="M28.6 33h2.8l-.4 3.2-1 1-1-1z" fill={accent} stroke={L} strokeWidth={SW} />
        </g>
      );
    case 'scarf':
      return (
        <>
          <path d="M11 31.5c5.6 2.6 12.4 2.6 18 0v2.8c-5.6 2.6-12.4 2.6-18 0z" fill={accent} stroke={L} strokeWidth={SW} />
          <path d="M25 33.4l1.4 5 2.6-.6-1-5.2z" fill={accent} stroke={L} strokeWidth={SW} />
        </>
      );
  }
}

/** The penguin itself. `prop` none = the mascot. `full` = the whole body (the mascot's framing). */
export function Penguin({
  size = 40,
  prop = null,
  team = null,
  ring = true,
  full = false,
  label,
  className,
}: {
  size?: number;
  prop?: Prop | null;
  team?: string | null;
  ring?: boolean;
  full?: boolean;
  label?: string;
  className?: string;
}) {
  const clip = useId();
  const accent = teamColor(team);
  const decorative = !label;
  const st = stitchStyle(size);
  const body = (
    <>
      {/* body: a tall plush pear, the flippers behind it */}
      <path d={FLIPPERS} fill={C.bodyTop} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
      <path d={BODY} fill={C.body} stroke={L} strokeWidth={SW} />
      {/* the white front, forehead to bottom, and its black stitch */}
      <path d={FRONT} fill={C.face} />
      <path d={FRONT_STITCH} fill="none" stroke={C.stitch} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinecap="round" strokeLinejoin="round" data-part="stitch" />
      {full && FEET.map((f, i) => <ellipse key={i} cx={f.cx} cy={f.cy} rx={f.rx} ry={f.ry} fill={C.feet} stroke={L} strokeWidth={SW} data-part="foot" />)}
      {EYES.map((e, i) => <circle key={i} cx={e.cx} cy={e.cy} r={e.r} fill={C.eye} data-part="eye" />)}
      {CHEEKS.map((c, i) => <circle key={i} cx={c.cx} cy={c.cy} r={c.r} style={{ fill: 'var(--cheek)' }} data-part="cheek" />)}
      {/* white diamond beak, its outer edge sewn in black */}
      <path d={BEAK_PATH} fill={C.beak} data-part="beak" />
      <path d={BEAK_SEAM} stroke={C.faceShade} strokeWidth={0.45} strokeLinecap="round" />
      <path d={BEAK_PATH} fill="none" stroke={C.stitch} strokeWidth={st.beakWidth} strokeDasharray={st.beakDash} strokeLinejoin="round" data-part="beak-stitch" />
    </>
  );
  return (
    <svg
      className={`penguin ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={decorative ? undefined : 'img'}
      aria-label={label}
      aria-hidden={decorative || undefined}
      data-prop={prop ?? 'none'}
    >
      {full ? (
        <g transform={FULL_VIEW}>{body}</g>
      ) : (
        <>
          <clipPath id={clip}>
            <circle cx="20" cy="20" r={ring ? 18.6 : 20} />
          </clipPath>
          <g clipPath={`url(#${clip})`}>
            {body}
            {prop && <PropArt prop={prop} accent={accent} />}
          </g>
          {ring && <circle cx="20" cy="20" r="18.8" fill="none" stroke={accent} strokeWidth={2.2} />}
        </>
      )}
    </svg>
  );
}

/** An agent's icon — prop from the roster, ring in its team colour. */
export function AgentIcon({ agent, team, size = 28, label }: { agent: string; team?: string | null; size?: IconSize; label?: string }) {
  const look = lookOf(agent, team);
  return <Penguin size={size} prop={look.prop} team={look.team} label={label ?? agent} />;
}

/** The mascot — the plain penguin, whole (login, empty states, the landing before 3D draws). */
export function Mascot({ size = 72 }: { size?: number }) {
  return <Penguin size={size} ring={false} full className="mascot" />;
}
