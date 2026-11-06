// The 2D penguin (DESIGN.md `## 에이전트 캐릭터`): front · upper body, the role's prop,
// a ring in the team colour. Sizes 20 / 28 / 40. The mascot is the same penguin with no prop.
import { useId, type ReactNode } from 'react';
import { PENGUIN_2D as C, teamColor } from './colors';
import { lookOf, type Prop } from './roster';

export type IconSize = 20 | 28 | 40 | 64;

const L = C.line;
const SW = 0.9;

/** Heart face = a lower ellipse + two brow circles (the 3D body shader's SDF, flattened). */
const FACE = 'M20 35.5c-6.6 0-11-3.6-11-9.2 0-3.4 1.6-6 3.9-7.6-.6-.9-.9-1.9-.9-3 0-2.9 2.2-5 5-5 1.2 0 2.2.4 3 1 .8-.6 1.8-1 3-1 2.8 0 5 2.1 5 5 0 1.1-.3 2.1-.9 3 2.3 1.6 3.9 4.2 3.9 7.6 0 5.6-4.4 9.2-11 9.2z';

function PropArt({ prop, accent }: { prop: Prop; accent: string }): ReactNode {
  switch (prop) {
    case 'crown-bowtie':
      return (
        <>
          <path d="M14.5 8.2l1.6-4 2.3 2.6L20 3l1.6 3.8 2.3-2.6 1.6 4z" fill={C.gold} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M16.6 33.4l3.4 1.7 3.4-1.7v3.4L20 35.1l-3.4 1.7z" fill={accent} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
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
          <circle cx="16.4" cy="18.6" r="2.8" fill="none" stroke={frame} strokeWidth={1.1} />
          <circle cx="23.6" cy="18.6" r="2.8" fill="none" stroke={frame} strokeWidth={1.1} />
          <path d="M19.2 18.4h1.6" stroke={frame} strokeWidth={1.1} />
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

/** The penguin itself. `prop` none = the mascot. */
export function Penguin({
  size = 40,
  prop = null,
  team = null,
  ring = true,
  label,
  className,
}: {
  size?: number;
  prop?: Prop | null;
  team?: string | null;
  ring?: boolean;
  label?: string;
  className?: string;
}) {
  const clip = useId();
  const accent = teamColor(team);
  const decorative = !label;
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
      <clipPath id={clip}>
        <circle cx="20" cy="20" r={ring ? 18.6 : 20} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {/* body: a plump keyring silhouette, cut at the chest */}
        <path d="M20 5c8 0 12.5 6.4 12.5 15.5 0 7.8-1.4 13-1.8 19.5H9.3C8.9 33.5 7.5 28.3 7.5 20.5 7.5 11.4 12 5 20 5z" fill={C.body} stroke={L} strokeWidth={SW} />
        <path d="M7.9 25c-1.6 2.5-2.2 6-1.8 9.5l3.6-1.6z M32.1 25c1.6 2.5 2.2 6 1.8 9.5l-3.6-1.6z" fill={C.bodyTop} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
        <path d={FACE} fill={C.face} stroke={L} strokeWidth={SW} />
        <path d={FACE} fill="none" stroke={C.stitch} strokeWidth={0.5} strokeDasharray="0.9 0.9" transform="translate(20 23) scale(.9) translate(-20 -23)" />
        <ellipse cx="16.4" cy="18.6" rx="1.35" ry="1.8" fill={C.eye} />
        <ellipse cx="23.6" cy="18.6" rx="1.35" ry="1.8" fill={C.eye} />
        <ellipse cx="13.6" cy="22.6" rx="1.7" ry="1.1" style={{ fill: 'var(--cheek)' }} />
        <ellipse cx="26.4" cy="22.6" rx="1.7" ry="1.1" style={{ fill: 'var(--cheek)' }} />
        <path d="M18.4 21.3h3.2L20 23.4z" fill={C.beak} stroke={L} strokeWidth={0.7} strokeLinejoin="round" />
        {prop && <PropArt prop={prop} accent={accent} />}
      </g>
      {ring && <circle cx="20" cy="20" r="18.8" fill="none" stroke={accent} strokeWidth={2.2} />}
    </svg>
  );
}

/** An agent's icon — prop from the roster, ring in its team colour. */
export function AgentIcon({ agent, team, size = 28, label }: { agent: string; team?: string | null; size?: IconSize; label?: string }) {
  const look = lookOf(agent, team);
  return <Penguin size={size} prop={look.prop} team={look.team} label={label ?? agent} />;
}

/** The mascot — the plain penguin (login, empty states). */
export function Mascot({ size = 72 }: { size?: number }) {
  return <Penguin size={size} ring={false} className="mascot" />;
}
