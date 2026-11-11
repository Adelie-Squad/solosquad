import { useEffect, useRef, useState } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { ICON, type LucideIcon } from '../icons';
import { useDemo } from '../demo/demo';

export interface Suggestion {
  id: string;
  icon: LucideIcon;
  text: MessageKey;
}

/** Starter requests — the web's own words, so they are translated; what Chief replies is not. */
export const SUGGESTIONS: Suggestion[] = [
  { id: 's1', icon: ICON.today, text: 'suggest.today' },
  { id: 's2', icon: ICON.report, text: 'suggest.pnl' },
  { id: 's3', icon: ICON.explore, text: 'suggest.team' },
  { id: 's4', icon: ICON.draft, text: 'suggest.draft' },
];

/**
 * One row of suggestion chips, as wide as the input. The side that hides chips fades out;
 * a vertical wheel scrolls it sideways (ported from the prototype).
 */
const DEMO_ICONS = [ICON.report, ICON.explore, ICON.draft];

export function SuggestionStrip({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n();
  const demo = useDemo();
  const ref = useRef<HTMLDivElement>(null);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  const updateFades = () => {
    const el = ref.current;
    if (!el) return;
    setFadeLeft(el.scrollLeft > 1);
    setFadeRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateFades();
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateFades) : null;
    el.addEventListener('wheel', onWheel, { passive: false });
    resize?.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      resize?.disconnect();
    };
  }, []);

  const fadeClass = [fadeLeft && 'fade-left', fadeRight && 'fade-right'].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={`suggestions ${fadeClass}`} onScroll={updateFades} aria-label={t('chat.suggestions')}>
      {demo.on && demo.info
        ? // a demo server's suggested requests — each runs its scenario (engine words, as sent)
          demo.info.suggestions.map((text, i) => {
            const Icon = DEMO_ICONS[Math.floor(i / 2) % DEMO_ICONS.length];
            return (
              <button key={text} type="button" className="suggestion" onClick={() => onPick(text)}>
                <Icon />
                {text}
              </button>
            );
          })
        : SUGGESTIONS.map((p) => (
            <button key={p.id} type="button" className="suggestion" onClick={() => onPick(t(p.text))}>
              <p.icon />
              {t(p.text)}
            </button>
          ))}
    </div>
  );
}
