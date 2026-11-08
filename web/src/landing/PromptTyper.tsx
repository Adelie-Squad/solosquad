import { useEffect, useRef, useState } from 'react';
import { agentName } from '../lib/agentNames';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { byId } from './catalog';

/** Example requests to Chief and who takes each one. */
export const PROMPTS: { text: MessageKey; agent: string }[] = [
  { text: 'landing.prompt.1', agent: 'finance' },
  { text: 'landing.prompt.2', agent: 'creative' },
  { text: 'landing.prompt.3', agent: 'data-analyst' },
];

export const TYPE_MS = 55;
export const HOLD_TYPED_MS = 700;
export const HOLD_ANSWER_MS = 2600;

type Phase = 'typing' | 'answer';

/**
 * A small box that types example requests to Chief and says which agent took them, then the
 * next one. Reduced motion: the first example, whole and still. The box is decoration for
 * sighted readers; screen readers get the examples as a plain list. `onType` hears every character
 * as it is typed (the landing penguin taps a key for each one — Acts.tsx `PromptAct`).
 */
export function PromptTyper({ still, onType }: { still: boolean; onType?: (typed: number) => void }) {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const prompt = PROMPTS[index];
  const chars = Array.from(t(prompt.text));

  useEffect(() => {
    if (still) return;
    let id: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (shown < chars.length) id = setTimeout(() => setShown((n) => n + 1), TYPE_MS);
      else id = setTimeout(() => setPhase('answer'), HOLD_TYPED_MS);
    } else {
      id = setTimeout(() => {
        setIndex((i) => (i + 1) % PROMPTS.length);
        setShown(0);
        setPhase('typing');
      }, HOLD_ANSWER_MS);
    }
    return () => clearTimeout(id);
  }, [still, phase, shown, chars.length]);

  // a language switch starts the current example again
  useEffect(() => {
    setShown(0);
    setPhase('typing');
  }, [locale]);

  const heard = useRef(onType);
  heard.current = onType;
  useEffect(() => {
    if (!still && phase === 'typing' && shown > 0) heard.current?.(shown);
  }, [still, phase, shown]);

  const text = still ? chars.join('') : chars.slice(0, shown).join('');
  const answered = still || phase === 'answer';
  const who = agentName(prompt.agent, locale, byId(prompt.agent));

  return (
    <div className="landing-prompt">
      <div className="landing-prompt-box" aria-hidden="true" data-testid="landing-prompt">
        <p className="landing-mono landing-prompt-to">
          <ICON.ask />
          {t('landing.prompt.to')}
        </p>
        <p className="landing-prompt-text">
          {text}
          {!still && !answered && <span className="landing-caret" />}
        </p>
        <p className={`landing-prompt-answer ${answered ? 'is-on' : ''}`} data-testid="landing-answer">
          <AgentIcon agent={prompt.agent} size={20} label="" />
          {t('landing.prompt.assigned', { agent: who })}
        </p>
      </div>
      <ul className="sr-only" aria-label={t('landing.prompt.examples')}>
        {PROMPTS.map((p) => (
          <li key={p.text}>
            {t(p.text)} {t('landing.prompt.assigned', { agent: agentName(p.agent, locale, byId(p.agent)) })}
          </li>
        ))}
      </ul>
    </div>
  );
}
