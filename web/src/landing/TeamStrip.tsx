import { useRef, type CSSProperties } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { teamColor } from '../characters/colors';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName, agentSummary } from '../lib/agentNames';
import { readable } from '../lib/names';
import { TEAMS } from './catalog';

/**
 * The bundled team as a horizontal strip of cards, grouped by team. Native horizontal scroll
 * (with snap) — the page's vertical scroll is never taken over; the two buttons only scroll the
 * strip by about a screen.
 */
export function TeamStrip() {
  const { t, locale } = useI18n();
  const strip = useRef<HTMLDivElement>(null);
  const by = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy?.({ left: dir * el.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
  };
  return (
    <div className="landing-strip-wrap">
      <div className="landing-strip-controls">
        <button type="button" className="btn landing-icon-btn" onClick={() => by(-1)} aria-label={t('landing.team.prev')} title={t('landing.team.prev')}>
          <ICON.back />
        </button>
        <button type="button" className="btn landing-icon-btn" onClick={() => by(1)} aria-label={t('landing.team.next')} title={t('landing.team.next')}>
          <ICON.forward />
        </button>
      </div>
      <div className="landing-strip" ref={strip} role="list" aria-label={t('landing.team.list')} tabIndex={0}>
        {TEAMS.map((group) => (
          <div className="landing-strip-team" role="listitem" key={group.team} style={{ '--team': teamColor(group.team) } as CSSProperties}>
            <p className="landing-mono landing-strip-head">
              <span className="landing-dot" aria-hidden="true" />
              {readable(group.team)}
              <span className="landing-strip-count">{t('landing.team.count', { n: group.agents.length })}</span>
            </p>
            <ul className="landing-strip-cards" aria-label={readable(group.team)}>
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
    </div>
  );
}
