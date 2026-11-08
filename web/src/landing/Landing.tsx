import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../api/queries';
import { LOGIN, officeHref, signedIn } from '../auth/next';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { scrollLocked } from '../components/scrollLock';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { hasWebGL, isMobile, prefersReducedMotion, webglForcedOff } from '../office/OfficeStage';
import { useTheme } from '../theme';
import { PromptAct, ScrollAct, SignAct, StampAct, StepsAct } from './Acts';
import { AGENT_COUNT, TEAMS } from './catalog';
import { keyStep, ownsKeys, SETTLE_MS, Stepper, wheelPixels } from './dwell';
import { useTeamModal } from './LandingOrgChart';
import type { Pointer } from './MascotCanvas';
import { MascotStage } from './MascotStage';
import { sectionAnchor, sectionIndex, SECTIONS, stepAt, type SectionId } from './sections';
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

const stopOffsets = () => SECTIONS.map((s) => document.getElementById(sectionAnchor(s.id))).map((el) => (el ? el.getBoundingClientRect().top + window.scrollY : 0));

/** Which slide is up: the stop nearest the scroll position (`stepAt`) — native scroll is the truth. */
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
 * The step controller on the live landing (dwell.ts): one wheel or touch gesture = one section,
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
      const to = keyStep(e, s.current(), SECTIONS.length - 1);
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
 * The landing (`/`, outside the shell — DESIGN.md `## 랜딩`): a pinned stage, one screen high. Each
 * section is the message on one side and, on the other, the 3D penguin with the section's content
 * in front of it — the penguin acts on the content (types on the prompt, turns the step cards, unrolls
 * the org chart, stamps the approval, holds up the last button). One wheel or swipe moves one
 * section and the page holds there a moment. Reduced motion, no WebGL and short screens get the same
 * sections stacked with the 2D penguin and native scroll. The only buttons out are the login (top
 * bar) and the last section's; they go to `/login`, or to the office when signed in.
 */
export function Landing() {
  const { t } = useI18n();
  const me = useMe();
  const inside = signedIn(me.data) ? me.data : undefined;
  const { theme } = useTheme();
  const [mode, setMode] = useState<LandingMode>(landingMode);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [mobile, setMobile] = useState(isMobile);
  const [ready, setReady] = useState(false);
  const [touch] = useState(() => !!window.matchMedia?.('(hover: none)').matches);
  const live = mode === 'live';
  const acting = live && ready;
  const { step, scrolled } = useStep(live);
  const active: SectionId = live ? SECTIONS[step].id : 'hero';
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
  // readers) brings that slide up through the step controller
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (!live || !el) return;
    const onFocus = (e: FocusEvent) => {
      const slide = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
      const i = SECTIONS.findIndex((s) => s.id === slide?.dataset.slide);
      if (i < 0 || i === step) return;
      if (stepper.current) stepper.current.go(i, 'focus');
      else document.getElementById(sectionAnchor(SECTIONS[i].id))?.scrollIntoView({ block: 'start' });
    };
    el.addEventListener('focusin', onFocus);
    return () => el.removeEventListener('focusin', onFocus);
  }, [live, step, stepper]);

  const onProgress = (i: number) => (e: MouseEvent<HTMLAnchorElement>) => {
    const s = stepper.current;
    if (!s || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.history.pushState(null, '', `#${sectionAnchor(SECTIONS[i].id)}`);
    s.go(i, 'link');
  };

  const cta = (cls: string) => (
    <Link className={cls} to={inside ? officeHref(inside) : LOGIN}>
      {t(inside ? 'landing.goOffice' : 'auth.login')}
    </Link>
  );

  const slide = (id: SectionId, copy: ReactNode, act: ReactNode) => {
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
        <PromptAct on={isOn('hero')} acting={acting} still={reduced} />
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
      <StepsAct on={isOn('what')} acting={acting} />,
    ),
    slide(
      'team',
      <>
        <h2 id="landing-team-title" className="landing-title">
          {t('landing.team.title', { n: AGENT_COUNT, teams: TEAMS.length })}
        </h2>
        <p className="landing-lead">{t('landing.team.lead')}</p>
        <button type="button" className="btn landing-org-all" onClick={() => team.open(null)}>
          <ICON.team />
          {t('landing.team.all')}
        </button>
      </>,
      <ScrollAct on={isOn('team')} acting={acting} onOpen={team.open} />,
    ),
    slide(
      'control',
      <>
        <h2 id="landing-control-title" className="landing-title">
          {t('landing.control.title')}
        </h2>
        <p className="landing-lead">{t('landing.control.lead')}</p>
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
      </>,
      <StampAct on={isOn('control')} acting={acting} />,
    ),
    slide(
      'start',
      <>
        <h2 id="landing-start-title" className="landing-title">
          {t('landing.start.title')}
        </h2>
        <p className="landing-lead">{t(inside ? 'landing.start.in' : 'landing.start.out')}</p>
      </>,
      <SignAct cta={cta('btn is-primary is-large landing-final-cta')} />,
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
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${sectionAnchor(s.id)}`}
                onClick={onProgress(i)}
                aria-current={active === s.id && live ? 'step' : undefined}
                className={active === s.id && live ? 'is-on' : ''}
              >
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
