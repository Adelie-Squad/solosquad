import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { scrollLocked } from '../components/scrollLock';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { hasWebGL, isMobile, prefersReducedMotion, webglForcedOff } from '../office/OfficeStage';
import { useTheme } from '../theme';
import { CompanyAct, PricingAct, PromptAct, ScrollAct, SignAct, WorkflowAct } from './Acts';
import { keyStep, ownsKeys, SETTLE_MS, Stepper, wheelPixels } from './dwell';
import { useInquiry } from '../marketing/Inquiry';
import '../marketing/messages';
import { useTeamModal } from './LandingOrgChart';
import type { Pointer } from './MascotCanvas';
import { MascotStage } from './MascotStage';
import { PersonFace } from './people';
import { firstStop, SECTIONS, sectionAnchor, stepAt, STOPS, type SectionId } from './sections';
import { WORKFLOW_EXAMPLES } from './workflows';
import '../styles/landing.css';

export type LandingMode = 'live' | 'static';

/** The marketing site's pages (MarketingApp). */
export const LOGIN = '/login';
export const DEMO = '/demo';

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

const stopOffsets = () => STOPS.map((s) => document.getElementById(s.anchor)).map((el) => (el ? el.getBoundingClientRect().top + window.scrollY : 0));

/** Which stop is up: the one nearest the scroll position (`stepAt`) — native scroll is the truth. */
function useStep(enabled: boolean) {
  const [step, setStep] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      setScrolled(window.scrollY > 4);
      if (enabled) setStep(stepAt(window.scrollY, stopOffsets()));
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

const inDialog = (target: EventTarget | null) => target instanceof Element && !!target.closest('[role="dialog"], [role="alertdialog"]');
/** Space on a focused button or link presses it — never a page step. */
const pressable = (target: EventTarget | null) => target instanceof Element && !!target.closest('button, a, summary, [role="button"]');

/**
 * The step controller on the live landing (dwell.ts): one wheel or touch gesture = one stop,
 * then a hold; the keyboard and the progress links go through it too. `?landing-debug` keeps a log
 * of the steps at `window.__landingLog`.
 */
function useStepper(enabled: boolean) {
  const stepper = useRef<Stepper | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const debug = new URLSearchParams(window.location.search).has('landing-debug');
    const log: string[] = [];
    if (debug) (window as unknown as { __landingLog?: string[] }).__landingLog = log;
    const s = new Stepper({
      now: () => performance.now(),
      scrollY: () => window.scrollY,
      scrollTo: (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }),
      frame: (cb) => requestAnimationFrame(cb),
      cancel: (id) => cancelAnimationFrame(id),
      stops: stopOffsets,
      locked: scrollLocked,
      onLog: debug ? (line) => log.push(line) : undefined,
    });
    stepper.current = s;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || inDialog(e.target) || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (debug) log.push(`${Math.round(performance.now())}ms wheel ${Math.round(e.deltaY)}`);
      if (s.wheel(wheelPixels(e, window.innerHeight)) && e.cancelable) e.preventDefault();
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || inDialog(e.target)) return s.touchEnd();
      s.touchStart(e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (s.touchMove(e.touches[0].clientY) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = () => s.touchEnd();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || scrollLocked() || ownsKeys(e.target)) return;
      if ((e.key === ' ' || e.key === 'Spacebar') && pressable(e.target)) return;
      const to = keyStep(e, s.current(), STOPS.length - 1);
      if (to === null) return;
      e.preventDefault();
      s.go(to, 'key');
    };
    let settle = 0;
    const onScroll = () => {
      window.clearTimeout(settle);
      if (!s.gliding()) settle = window.setTimeout(() => s.settle(), SETTLE_MS);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.clearTimeout(settle);
      s.stop();
      stepper.current = null;
    };
  }, [enabled]);
  return stepper;
}

const POINTS: { icon: keyof typeof ICON; title: MessageKey; body: MessageKey }[] = [
  { icon: 'artifacts', title: 'landing.control.point1.title', body: 'landing.control.point1.body' },
  { icon: 'person', title: 'landing.control.point2.title', body: 'landing.control.point2.body' },
  { icon: 'back', title: 'landing.control.point3.title', body: 'landing.control.point3.body' },
];

/**
 * The landing (`/`, outside the shell — DESIGN.md `## 랜딩`, PRD v2.1.0 §3.5): a pinned stage, one
 * screen high, the section names at the left edge. Six sections (decision 61): 시작 (the company
 * card — what is sold: a team of agents built on the company's server) · 맡기기 (a request to Chief,
 * split among the agents) · 조직도 (agents and team members on one chart) · 워크플로우 (three example
 * workflows, one stop each — what runs on its own and where it stops for approval) · 가격 (from
 * ₩6,000,000 for a 3-month build, the call free, an exact quote on request) · 문의 (the last card).
 * Each section is the message on one side and, on the other, the section's content centred in its
 * scene; the 3D penguin walks to a spot by the content and acts on it (waves from behind the company
 * card, pretends to type over the prompt, peeks over the scroll, stamps each workflow's owner
 * approval from the card's corner, points at the build price, waves from behind the last card). One
 * wheel or swipe moves one stop and the page holds there a moment. Reduced motion, no WebGL and short
 * screens get the same sections stacked (the three workflows one under another) with the 2D penguin
 * and native scroll. The landing is the marketing site's only (decision 62 — customer servers open
 * on their login): 데모 체험하기 (primary, `/demo`) and 로그인 (`/login`, the login router) in the top
 * bar (beside the language select, no label), the first section and the last; the price section's
 * button and the line under the last card open the request modal. No arrows.
 */
export function Landing() {
  const { t } = useI18n();
  const openInquiry = useInquiry();
  const { theme } = useTheme();
  const [mode, setMode] = useState<LandingMode>(landingMode);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [mobile, setMobile] = useState(isMobile);
  const [ready, setReady] = useState(false);
  const [touch] = useState(() => !!window.matchMedia?.('(hover: none)').matches);
  const live = mode === 'live';
  const acting = live && ready;
  const { step, scrolled } = useStep(live);
  const stop = live ? STOPS[step] : STOPS[0];
  const active: SectionId = stop.section;
  const fail = useCallback(() => setMode('static'), []);
  const onReady = useCallback(() => setReady(true), []);
  const stepper = useStepper(live);
  const team = useTeamModal();

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

  const pointer = useRef<Pointer | null>(null);
  useEffect(() => {
    if (!live) return;
    const on = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      // client px — the canvas measures it from wherever the penguin's head is
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    const reset = () => (pointer.current = null);
    window.addEventListener('pointermove', on, { passive: true });
    document.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', on);
      document.removeEventListener('pointerleave', reset);
    };
  }, [live]);

  // Tab into a slide that is not up (its content stays in the page for keyboards and screen
  // readers) brings that slide up through the step controller — at its first stop
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (!live || !el) return;
    const onFocus = (e: FocusEvent) => {
      const slide = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
      const id = slide?.dataset.slide as SectionId | undefined;
      if (!id || id === active) return;
      const i = firstStop(id);
      if (i < 0) return;
      if (stepper.current) stepper.current.go(i, 'focus');
      else document.getElementById(STOPS[i].anchor)?.scrollIntoView({ block: 'start' });
    };
    el.addEventListener('focusin', onFocus);
    return () => el.removeEventListener('focusin', onFocus);
  }, [live, active, stepper]);

  /** To stop `i` through the step controller (the progress links, the workflow tabs). */
  const goTo = useCallback(
    (i: number) => {
      const s = stepper.current;
      if (!s) return;
      window.history.pushState(null, '', `#${STOPS[i].anchor}`);
      s.go(i, 'link');
    },
    [stepper],
  );
  const onProgress = (i: number) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!stepper.current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goTo(i);
  };
  const workflowsAt = firstStop('workflows');

  // the two buttons (PRD §3.5.2 rev10): 데모 체험하기 (primary → /demo) · 로그인 (→ the login router),
  // in the top bar, the first section and the last one, in that order
  const demo = (cls: string) => (
    <Link className={cls} to={DEMO}>
      {t('landing.cta.demo')}
    </Link>
  );
  const login = (cls: string) => (
    <Link className={cls} to={LOGIN}>
      {t('landing.cta.login')}
    </Link>
  );

  const slide = (id: SectionId, copy: ReactNode, act: ReactNode) => {
    const on = !live || active === id;
    const passed = live && SECTIONS.findIndex((s) => s.id === id) < SECTIONS.findIndex((s) => s.id === active);
    return (
      <section
        key={id}
        id={live ? undefined : sectionAnchor(id)}
        data-slide={id}
        className={`landing-slide is-${id} ${on ? 'is-on' : ''} ${passed ? 'is-passed' : ''}`}
        aria-labelledby={`landing-${id}-title`}
      >
        <div className="landing-copy">{copy}</div>
        <div className="landing-scene" data-testid={`landing-scene-${id}`}>
          {act}
        </div>
      </section>
    );
  };

  const isOn = (id: SectionId) => live && active === id;
  const slides = [
    slide(
      'hero',
      <>
        <p className="landing-mono landing-eyebrow">{t('landing.hero.eyebrow')}</p>
        <h1 id="landing-hero-title" className="landing-display">
          {t('landing.hero.title')}
        </h1>
        <p className="landing-lead">{t('landing.hero.lead')}</p>
        <div className="landing-ctas">
          {demo('btn is-primary landing-cta')}
          {login('btn landing-cta')}
        </div>
      </>,
      <>
        {!live && (
          <div className="landing-static-mascot" aria-hidden="true" data-testid="landing-static-mascot">
            <Mascot size={160} />
          </div>
        )}
        <CompanyAct on={isOn('hero')} acting={acting} />
      </>,
    ),
    slide(
      'delegate',
      <>
        <h2 id="landing-delegate-title" className="landing-title">
          {t('landing.delegate.title')}
        </h2>
        <p className="landing-lead">{t('landing.delegate.lead')}</p>
        <p className="landing-aside">
          <ICON.messenger />
          {t('landing.delegate.where')}
        </p>
      </>,
      <PromptAct on={isOn('delegate')} acting={acting} still={reduced || !acting} />,
    ),
    slide(
      'org',
      <>
        <h2 id="landing-org-title" className="landing-title">
          {t('landing.org.title')}
        </h2>
        <p className="landing-lead">{t('landing.org.lead')}</p>
        <ul className="landing-legend">
          <li>
            <Mascot size={20} />
            {t('landing.org.legend.agent')}
          </li>
          <li>
            <PersonFace size={20} />
            {t('landing.org.legend.person')}
          </li>
        </ul>
        <p className="landing-aside">{t('landing.org.note')}</p>
        <button type="button" className="btn landing-org-all" onClick={() => team.open(null)}>
          <ICON.team />
          {t('landing.team.all')}
        </button>
      </>,
      <ScrollAct on={isOn('org')} acting={acting} onOpen={team.open} />,
    ),
    slide(
      'workflows',
      <>
        <h2 id="landing-workflows-title" className="landing-title">
          {t('landing.workflows.title')}
        </h2>
        <p className="landing-lead">{t('landing.workflows.lead')}</p>
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
        <p className="landing-aside">{t('landing.workflows.note')}</p>
      </>,
      <WorkflowAct on={isOn('workflows')} acting={acting} at={active === 'workflows' ? stop.sub : 0} stacked={!live} onPick={(i) => goTo(workflowsAt + i)} />,
    ),
    slide(
      'pricing',
      <>
        <h2 id="landing-pricing-title" className="landing-title">
          {t('landing.pricing.title')}
        </h2>
        <p className="landing-lead">{t('landing.pricing.lead')}</p>
        <div className="landing-ctas">
          <button type="button" className="btn is-primary landing-cta" onClick={() => openInquiry({ source: 'pricing', requests: ['consult'] })}>
            {t('landing.pricing.cta')}
          </button>
        </div>
      </>,
      <PricingAct on={isOn('pricing')} acting={acting} />,
    ),
    slide(
      'contact',
      <>
        <h2 id="landing-contact-title" className="landing-title">
          {t('landing.start.title')}
        </h2>
        <p className="landing-lead">{t('landing.start.lead')}</p>
      </>,
      <SignAct
        on={isOn('contact')}
        acting={acting}
        cta={
          <div className="landing-final">
            <div className="landing-final-actions">
              {demo('btn is-primary is-large landing-final-cta')}
              {login('btn is-large landing-final-login')}
            </div>
            <button type="button" className="landing-apply-link" onClick={() => openInquiry({ source: 'landing_start' })}>
              {t('landing.apply.open')}
            </button>
          </div>
        }
      />,
    ),
  ];

  return (
    <main className="landing" data-mode={mode} data-section={active}>
      <header className={`landing-top ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="landing-top-inner">
          <p className="landing-brand">SoloSquad</p>
          <div className="landing-top-actions">
            <LocalePicker />
            {demo('btn is-primary landing-top-cta')}
            {login('btn landing-top-cta')}
          </div>
        </div>
      </header>

      <nav className="landing-progress" aria-label={t('landing.nav')}>
        <ol>
          {SECTIONS.map((s) => {
            const i = firstStop(s.id);
            const on = live && active === s.id;
            return (
              <li key={s.id}>
                <a href={`#${STOPS[i].anchor}`} onClick={onProgress(i)} aria-current={on ? 'step' : undefined} className={on ? 'is-on' : ''}>
                  <span className="landing-progress-mark" aria-hidden="true" />
                  <span className="landing-progress-label">{t(s.label)}</span>
                </a>
                {s.id === 'workflows' && (
                  <ol className="landing-progress-stops">
                    {WORKFLOW_EXAMPLES.map((w, sub) => {
                      const here = on && stop.sub === sub;
                      return (
                        <li key={w.id}>
                          <a
                            href={`#${STOPS[i + sub].anchor}`}
                            onClick={onProgress(i + sub)}
                            aria-label={t(w.name)}
                            aria-current={here ? 'step' : undefined}
                            className={here ? 'is-on' : ''}
                          >
                            <span className="landing-progress-dot" aria-hidden="true" />
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {live ? (
        <div className="landing-track" style={{ '--steps': STOPS.length } as CSSProperties}>
          {STOPS.map((s, i) => (
            <span key={s.anchor} id={s.anchor} className="landing-stop" style={{ '--n': i } as CSSProperties} data-testid={`landing-stop-${s.anchor.slice('landing-'.length)}`} />
          ))}
          <div className={`landing-pin ${acting ? 'is-acting' : ''}`} ref={stage}>
            <div className="landing-grid" aria-hidden="true">
              <span />
              <span />
            </div>
            <MascotStage section={active} acting={acting} theme={theme} mobile={mobile} pointer={pointer} touch={touch} pin={stage} onReady={onReady} onFail={fail} />
            {slides}
          </div>
        </div>
      ) : (
        <div className="landing-stack">
          {slides}
          <footer className="landing-foot landing-mono">SoloSquad</footer>
        </div>
      )}
      {team.modal}
    </main>
  );
}
