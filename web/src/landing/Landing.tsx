import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../api/queries';
import { LOGIN, officeHref, signedIn } from '../auth/next';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { readable } from '../lib/names';
import { hasWebGL, isMobile, prefersReducedMotion, webglForcedOff } from '../office/OfficeStage';
import { useTheme } from '../theme';
import { AGENT_COUNT, TEAMS } from './catalog';
import type { Pointer } from './MascotCanvas';
import { MascotStage } from './MascotStage';
import { ApprovalPreview, LivePreview, PnlPreview } from './Previews';
import { PromptTyper } from './PromptTyper';
import { clipForSection, sectionAnchor, sectionIndex, SECTIONS, type SectionId } from './sections';
import { TeamStrip } from './TeamStrip';
import '../styles/landing.css';

export type LandingMode = 'live' | 'static';

/** 3D when WebGL works and motion is welcome; otherwise the 2D penguin and still sections. */
export function landingMode(): LandingMode {
  return webglForcedOff() || prefersReducedMotion() || !hasWebGL() ? 'static' : 'live';
}

/** Where the page is: the section under the middle of the viewport and how far through it. */
function useScrollPosition(enabled: boolean) {
  const [where, setWhere] = useState<{ id: SectionId; progress: number }>({ id: 'hero', progress: 0 });
  const scroll = useRef(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      const doc = document.documentElement;
      scroll.current = Math.min(1, Math.max(0, window.scrollY / Math.max(1, doc.scrollHeight - vh)));
      const mid = vh / 2;
      for (const s of SECTIONS) {
        const el = document.getElementById(sectionAnchor(s.id));
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top <= mid && r.bottom > mid) {
          const progress = Math.round(((mid - r.top) / r.height) * 20) / 20;
          setWhere((w) => (w.id === s.id && w.progress === progress ? w : { id: s.id, progress }));
          return;
        }
      }
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return { ...where, scroll };
}

function SectionHead({ id, title, lead, as = 'h2', titleId }: { id: SectionId; title: string; lead?: string; as?: 'h1' | 'h2'; titleId: string }) {
  const H = as;
  return (
    <>
      <p className="landing-mono landing-index">
        <span>{sectionIndex(id)}</span>
        <span className="landing-index-total">/ {String(SECTIONS.length).padStart(2, '0')}</span>
      </p>
      <H id={titleId} className={as === 'h1' ? 'landing-display' : 'landing-title'}>
        {title}
      </H>
      {lead && <p className="landing-lead">{lead}</p>}
    </>
  );
}

const STEPS: { title: MessageKey; body: MessageKey }[] = [
  { title: 'landing.what.step1.title', body: 'landing.what.step1.body' },
  { title: 'landing.what.step2.title', body: 'landing.what.step2.body' },
  { title: 'landing.what.step3.title', body: 'landing.what.step3.body' },
];

const POINTS: { icon: keyof typeof ICON; title: MessageKey; body: MessageKey }[] = [
  { icon: 'artifacts', title: 'landing.control.point1.title', body: 'landing.control.point1.body' },
  { icon: 'person', title: 'landing.control.point2.title', body: 'landing.control.point2.body' },
  { icon: 'back', title: 'landing.control.point3.title', body: 'landing.control.point3.body' },
];

/**
 * The landing (`/`, outside the shell — DESIGN.md `## 랜딩`): five sections scroll past one
 * penguin that stays in the middle of the viewport and changes what it does per section. The
 * button goes to `/login`, or to the person's office when already signed in; it never
 * redirects on its own. Native scroll only.
 */
export function Landing() {
  const { t } = useI18n();
  const me = useMe();
  const inside = signedIn(me.data) ? me.data : undefined;
  const { theme } = useTheme();
  const [mode, setMode] = useState<LandingMode>(landingMode);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [mobile] = useState(isMobile);
  const live = mode === 'live';
  const where = useScrollPosition(live);
  const clip = clipForSection(where.id, where.progress);
  const fail = useCallback(() => setMode('static'), []);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const on = () => {
      setReduced(!!mq?.matches);
      if (mq?.matches) setMode('static');
    };
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);

  const pointer = useRef<Pointer>({ x: 0, y: 0 });
  useEffect(() => {
    if (!live) return;
    const on = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pointer.current = {
        x: Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1)),
        y: Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1)),
      };
    };
    const reset = () => (pointer.current = { x: 0, y: 0 });
    window.addEventListener('pointermove', on, { passive: true });
    document.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', on);
      document.removeEventListener('pointerleave', reset);
    };
  }, [live]);

  const cta = (cls: string) =>
    inside ? (
      <Link className={cls} to={officeHref(inside)}>
        {t('landing.goOffice')}
        <ICON.forward />
      </Link>
    ) : (
      <Link className={cls} to={LOGIN}>
        {t('auth.login')}
        <ICON.forward />
      </Link>
    );

  return (
    <main className="landing" data-mode={mode} data-section={where.id}>
      <div className="landing-grid" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      <header className="landing-top">
        <p className="landing-brand">SoloSquad</p>
        <div className="landing-top-actions">
          <LocalePicker />
          {cta('btn with-icon landing-top-cta')}
        </div>
      </header>

      {live && <MascotStage section={where.id} clip={clip} theme={theme} mobile={mobile} pointer={pointer} scroll={where.scroll} onFail={fail} />}

      <nav className="landing-progress" aria-label={t('landing.nav')}>
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${sectionAnchor(s.id)}`} aria-current={where.id === s.id ? 'step' : undefined} className={where.id === s.id ? 'is-on' : ''}>
                <span className="landing-progress-label">{t(s.label)}</span>
                <span className="landing-progress-index">{sectionIndex(s.id)}</span>
                <span className="landing-progress-tick" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section id={sectionAnchor('hero')} className="landing-section is-hero" aria-labelledby="landing-hero-title">
        <div className="landing-side is-left">
          <p className="landing-mono landing-eyebrow">{t('landing.eyebrow')}</p>
          <SectionHead id="hero" as="h1" titleId="landing-hero-title" title={t('landing.title')} lead={t('landing.lead')} />
          {cta('btn is-primary is-large with-icon')}
        </div>
        {!live && (
          <div className="landing-static-mascot" aria-hidden="true" data-testid="landing-static-mascot">
            <Mascot size={200} />
          </div>
        )}
        <div className="landing-side is-right">
          <PromptTyper still={reduced} />
          <div className="landing-crew">
            <p className="landing-mono landing-crew-title">{t('landing.crew')}</p>
            <ul>
              {TEAMS.filter((g) => g.team !== 'core').map((g) => (
                <li key={g.team} className="landing-mono">
                  <span>{readable(g.team)}</span>
                  <span>{t('landing.team.count', { n: g.agents.length })}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="landing-mono landing-scroll" aria-hidden="true">
          {t('landing.scroll')}
          <ICON.expand />
        </p>
      </section>

      <section id={sectionAnchor('what')} className="landing-section is-what" aria-labelledby="landing-what-title">
        <div className="landing-side is-left">
          <SectionHead id="what" titleId="landing-what-title" title={t('landing.what.title')} lead={t('landing.what.lead')} />
        </div>
        <div className="landing-side is-right">
          <ol className="landing-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="landing-mono landing-step-n">{String(i + 1).padStart(2, '0')}</span>
                <h3>{t(s.title)}</h3>
                <p>{t(s.body)}</p>
              </li>
            ))}
          </ol>
          <LivePreview />
        </div>
      </section>

      <section id={sectionAnchor('team')} className="landing-section is-team" aria-labelledby="landing-team-title">
        <div className="landing-side is-left">
          <SectionHead id="team" titleId="landing-team-title" title={t('landing.team.title', { n: AGENT_COUNT, teams: TEAMS.length })} lead={t('landing.team.lead')} />
        </div>
        <div className="landing-wide">
          <TeamStrip />
        </div>
      </section>

      <section id={sectionAnchor('control')} className="landing-section is-control" aria-labelledby="landing-control-title">
        <div className="landing-side is-left">
          <SectionHead id="control" titleId="landing-control-title" title={t('landing.control.title')} lead={t('landing.control.lead')} />
          <ul className="landing-points">
            {POINTS.map((p) => {
              const Icon = ICON[p.icon];
              return (
                <li key={p.title}>
                  <Icon />
                  <span>
                    <b>{t(p.title)}</b>
                    {t(p.body)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="landing-side is-right">
          <ApprovalPreview />
          <PnlPreview />
        </div>
        <p className="landing-statement landing-wide">{t('landing.statement')}</p>
      </section>

      <section id={sectionAnchor('start')} className="landing-section is-start" aria-labelledby="landing-start-title">
        <div className="landing-side is-left">
          <SectionHead id="start" titleId="landing-start-title" title={t('landing.start.title')} lead={t(inside ? 'landing.start.in' : 'landing.start.out')} />
          {cta('btn is-primary is-large with-icon')}
        </div>
        <footer className="landing-foot landing-wide landing-mono">SoloSquad</footer>
      </section>
    </main>
  );
}
