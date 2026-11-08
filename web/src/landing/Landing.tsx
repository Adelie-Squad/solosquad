import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../api/queries';
import { LOGIN, officeHref, signedIn } from '../auth/next';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { hasWebGL, isMobile, prefersReducedMotion, webglForcedOff } from '../office/OfficeStage';
import { useTheme } from '../theme';
import { AGENT_COUNT, TEAMS } from './catalog';
import { LandingOrgChart } from './LandingOrgChart';
import type { Pointer } from './MascotCanvas';
import { MascotStage } from './MascotStage';
import { ApprovalPreview, LivePreview, PnlPreview } from './Previews';
import { PromptTyper } from './PromptTyper';
import { clipForSection, sectionAnchor, sectionIndex, SECTIONS, stepAt, THINK_SECONDS, type SectionId } from './sections';
import '../styles/landing.css';

export type LandingMode = 'live' | 'static';

/** Shorter than this, a slide does not fit one screen — the page stacks its sections instead. */
export const MIN_STAGE_HEIGHT = 600;

/**
 * Pinned slides with the 3D penguin when WebGL works, motion is welcome and the screen is tall
 * enough; otherwise the sections stacked with the 2D penguin.
 */
export function landingMode(): LandingMode {
  const short = typeof window !== 'undefined' && window.innerHeight > 0 && window.innerHeight < MIN_STAGE_HEIGHT;
  return webglForcedOff() || prefersReducedMotion() || short || !hasWebGL() ? 'static' : 'live';
}

/**
 * Which slide is up: the snap stop nearest the scroll position (`stepAt`). Native scroll only —
 * the stops are `scroll-snap-align` targets, so the wheel, a swipe, PageDown · Space · the arrow
 * keys and the progress links all land on one; this only reads where the page is.
 */
function useStep(enabled: boolean) {
  const [step, setStep] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      setScrolled(window.scrollY > 4);
      if (!enabled) return;
      const stops = SECTIONS.map((s) => document.getElementById(sectionAnchor(s.id))).map((el) => (el ? el.getBoundingClientRect().top + window.scrollY : 0));
      setStep(stepAt(window.scrollY, stops));
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
  return { step, scrolled };
}

/** Seconds since the slide came in, ticking only where the clip changes over time. */
function useSlideClock(id: SectionId) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (id !== 'what') return;
    const timer = window.setTimeout(() => setLate(true), THINK_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [id]);
  return late ? THINK_SECONDS : 0;
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

/** The n-th thing the penguin presents — staggered in step with its wing (landing.css `--i`). */
const at = (i: number) => ({ '--i': i }) as CSSProperties;

/**
 * The landing (`/`, outside the shell — DESIGN.md `## 랜딩`): a pinned stage, one screen high, with
 * the 3D penguin fixed in its middle, following the cursor with its head. Each step of scroll brings
 * the next slide: the message on the left, and on the right what the penguin presents — it turns
 * and lifts a wing as the content comes in beside it. Reduced motion, no WebGL and short screens
 * get the same sections stacked, with the 2D penguin. The only buttons out are the login (top bar)
 * and the last slide's; they go to `/login`, or to the office when signed in, never on their own.
 */
export function Landing() {
  const { t } = useI18n();
  const me = useMe();
  const inside = signedIn(me.data) ? me.data : undefined;
  const { theme } = useTheme();
  const [mode, setMode] = useState<LandingMode>(landingMode);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [mobile, setMobile] = useState(isMobile);
  const [touch] = useState(() => !!window.matchMedia?.('(hover: none)').matches);
  const live = mode === 'live';
  const { step, scrolled } = useStep(live);
  const active: SectionId = live ? SECTIONS[step].id : 'hero';
  const clip = clipForSection(active, useSlideClock(active));
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
  useEffect(() => {
    const on = () => setMobile(isMobile());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const pointer = useRef<Pointer | null>({ x: 0, y: 0 });
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

  // Tab into a slide that is not up (its content stays in the page for keyboards and screen
  // readers) brings that slide up — the browser scrolls to its stop
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (!live || !el) return;
    const onFocus = (e: FocusEvent) => {
      const slide = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
      const id = slide?.dataset.slide as SectionId | undefined;
      if (!id || id === SECTIONS[step].id) return;
      document.getElementById(sectionAnchor(id))?.scrollIntoView({ block: 'start' });
    };
    el.addEventListener('focusin', onFocus);
    return () => el.removeEventListener('focusin', onFocus);
  }, [live, step]);

  const cta = (cls: string) => (
    <Link className={cls} to={inside ? officeHref(inside) : LOGIN}>
      {t(inside ? 'landing.goOffice' : 'auth.login')}
    </Link>
  );

  const slide = (id: SectionId, copy: ReactNode, present: ReactNode) => {
    const on = !live || active === id;
    const passed = live && SECTIONS.findIndex((s) => s.id === id) < step;
    return (
      <section
        key={id}
        id={live ? undefined : sectionAnchor(id)}
        data-slide={id}
        className={`landing-slide is-${id} ${on ? 'is-on' : ''} ${passed ? 'is-passed' : ''}`}
        aria-labelledby={`landing-${id}-title`}
      >
        <div className="landing-copy">{copy}</div>
        <div className="landing-present">{present}</div>
      </section>
    );
  };

  const slides = [
    slide(
      'hero',
      <>
        <p className="landing-mono landing-eyebrow">{t('landing.eyebrow')}</p>
        <h1 id="landing-hero-title" className="landing-display">
          {t('landing.title')}
        </h1>
        <p className="landing-lead">{t('landing.lead')}</p>
      </>,
      <>
        {!live && (
          <div className="landing-static-mascot" aria-hidden="true" data-testid="landing-static-mascot">
            <Mascot size={160} />
          </div>
        )}
        <div className="landing-item" style={at(0)}>
          <PromptTyper still={reduced} />
        </div>
      </>,
    ),
    slide(
      'what',
      <>
        <h2 id="landing-what-title" className="landing-title">
          {t('landing.what.title')}
        </h2>
        <p className="landing-lead">{t('landing.what.lead')}</p>
      </>,
      <>
        <ol className="landing-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="landing-item" style={at(i)}>
              <span className="landing-mono landing-step-n">{String(i + 1).padStart(2, '0')}</span>
              <h3>{t(s.title)}</h3>
              <p>{t(s.body)}</p>
            </li>
          ))}
        </ol>
        <div className="landing-item is-wide-only" style={at(3)}>
          <LivePreview />
        </div>
      </>,
    ),
    slide(
      'team',
      <>
        <h2 id="landing-team-title" className="landing-title">
          {t('landing.team.title', { n: AGENT_COUNT, teams: TEAMS.length })}
        </h2>
        <p className="landing-lead">{t('landing.team.lead')}</p>
      </>,
      <LandingOrgChart style={(i) => at(i)} />,
    ),
    slide(
      'control',
      <>
        <h2 id="landing-control-title" className="landing-title">
          {t('landing.control.title')}
        </h2>
        <p className="landing-lead">{t('landing.control.lead')}</p>
      </>,
      <>
        <ul className="landing-points">
          {POINTS.map((p, i) => {
            const Icon = ICON[p.icon];
            return (
              <li key={p.title} className="landing-item" style={at(i)}>
                <Icon />
                <span>
                  <b>{t(p.title)}</b>
                  {t(p.body)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="landing-previews">
          <div className="landing-item" style={at(3)}>
            <ApprovalPreview />
          </div>
          <div className="landing-item is-wide-only" style={at(4)}>
            <PnlPreview />
          </div>
        </div>
      </>,
    ),
    slide(
      'start',
      <>
        <h2 id="landing-start-title" className="landing-title">
          {t('landing.start.title')}
        </h2>
        <p className="landing-lead">{t(inside ? 'landing.start.in' : 'landing.start.out')}</p>
      </>,
      <>
        <p className="landing-statement landing-item" style={at(0)}>
          {t('landing.statement')}
        </p>
        <div className="landing-item" style={at(1)}>
          {cta('btn is-primary is-large landing-final-cta')}
        </div>
      </>,
    ),
  ];

  return (
    <main className="landing" data-mode={mode} data-section={active}>
      <header className={`landing-top ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="landing-top-inner">
          <p className="landing-brand">SoloSquad</p>
          <div className="landing-top-actions">
            <LocalePicker />
            {cta('btn landing-top-cta')}
          </div>
        </div>
      </header>

      <nav className="landing-progress" aria-label={t('landing.nav')}>
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${sectionAnchor(s.id)}`} aria-current={active === s.id && live ? 'step' : undefined} className={active === s.id && live ? 'is-on' : ''}>
                <span className="landing-progress-label">{t(s.label)}</span>
                <span className="landing-progress-index">{sectionIndex(s.id)}</span>
                <span className="landing-progress-tick" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {live ? (
        <div className="landing-track" style={{ '--steps': SECTIONS.length } as CSSProperties}>
          {SECTIONS.map((s, i) => (
            <span key={s.id} id={sectionAnchor(s.id)} className="landing-stop" style={{ '--n': i } as CSSProperties} data-testid={`landing-stop-${s.id}`} />
          ))}
          <div className="landing-pin" ref={stage}>
            <div className="landing-grid" aria-hidden="true">
              <span />
              <span />
            </div>
            <MascotStage section={active} clip={clip} theme={theme} mobile={mobile} pointer={pointer} touch={touch} side={mobile ? 'down' : 'right'} onFail={fail} />
            {slides}
          </div>
        </div>
      ) : (
        <div className="landing-stack">
          {slides}
          <footer className="landing-foot landing-mono">SoloSquad</footer>
        </div>
      )}
    </main>
  );
}
