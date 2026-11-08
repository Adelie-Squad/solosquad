import { useEffect, useRef, type CSSProperties } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { teamColor } from '../characters/colors';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName, agentSummary } from '../lib/agentNames';
import { teamName } from '../lib/names';
import { TEAMS } from './catalog';

/**
 * The bundled team as a horizontal strip of cards, grouped by team — the body of the landing's
 * team modal. Native horizontal scroll with snap: a trackpad swipes it, the arrow keys scroll it
 * once it has focus, and a plain mouse wheel (vertical) is turned into a sideways scroll while the
 * strip can still move that way — at either end the wheel is left alone. The two buttons scroll
 * by about a screen. `start` opens it at a team.
 */
export function TeamStrip({ start }: { start?: string | null }) {
  const { t, locale } = useI18n();
  const strip = useRef<HTMLDivElement>(null);
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const by = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    el.scrollBy?.({ left: dir * el.clientWidth * 0.8, behavior: reduced() ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    const el = strip.current;
    if (!el || !start) return;
    const team = el.querySelector<HTMLElement>(`[data-team="${start}"]`);
    if (team) el.scrollLeft = team.offsetLeft; // the strip is the offset parent (position: relative)
  }, [start]);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.ctrlKey) return;
      const room = e.deltaY > 0 ? el.scrollWidth - el.clientWidth - el.scrollLeft : el.scrollLeft;
      if (room <= 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="landing-strip-wrap">
      <div className="landing-strip" ref={strip} role="list" aria-label={t('landing.team.list')} tabIndex={0} data-testid="landing-strip">
        {TEAMS.map((group) => (
          <div className="landing-strip-team" role="listitem" key={group.team} data-team={group.team} style={{ '--team': teamColor(group.team) } as CSSProperties}>
            <p className="landing-strip-head">
              <span className="landing-dot" aria-hidden="true" />
              {teamName(group.team, t)}
              <span className="landing-strip-count">{t('org.deptCount', { n: group.agents.length })}</span>
            </p>
            <ul className="landing-strip-cards" aria-label={teamName(group.team, t)}>
              {group.agents.map((a) => (
                <li className="landing-card" key={a.id}>
                  <AgentIcon agent={a.id} team={a.team} size={40} label="" />
                  <h3>{agentName(a.id, locale, a)}</h3>
                  <p>{agentSummary(locale, a)}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="landing-strip-controls">
        <button type="button" className="btn landing-icon-btn" onClick={() => by(-1)} aria-label={t('landing.team.prev')} title={t('landing.team.prev')}>
          <ICON.back />
        </button>
        <button type="button" className="btn landing-icon-btn" onClick={() => by(1)} aria-label={t('landing.team.next')} title={t('landing.team.next')}>
          <ICON.forward />
        </button>
      </div>
    </div>
  );
}
