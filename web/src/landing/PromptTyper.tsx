import { useEffect, useRef, useState } from 'react';
import { agentName } from '../lib/agentNames';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { byId } from './catalog';

/** Example requests to Chief and how Chief splits each one: three agents, a piece of work each. */
export const PROMPTS: { text: MessageKey; split: { agent: string; work: MessageKey }[] }[] = [
  {
    text: 'landing.delegate.prompt.1',
    split: [
      { agent: 'finance', work: 'landing.delegate.prompt.1.a' },
      { agent: 'data-analyst', work: 'landing.delegate.prompt.1.b' },
      { agent: 'researcher', work: 'landing.delegate.prompt.1.c' },
    ],
  },
  {
    text: 'landing.delegate.prompt.2',
    split: [
      { agent: 'researcher', work: 'landing.delegate.prompt.2.a' },
      { agent: 'data-analyst', work: 'landing.delegate.prompt.2.b' },
      { agent: 'sales', work: 'landing.delegate.prompt.2.c' },
    ],
  },
  {
    text: 'landing.delegate.prompt.3',
    split: [
      { agent: 'marketer', work: 'landing.delegate.prompt.3.a' },
      { agent: 'creative', work: 'landing.delegate.prompt.3.b' },
      { agent: 'marketer', work: 'landing.delegate.prompt.3.c' },
    ],
  },
];

export const TYPE_MS = 90;
export const HOLD_TYPED_MS = 700;
/** Once typed, the split rows come in one at a time this far apart, lit while they come in. */
export const SPLIT_STEP_MS = 650;
/** All three in, done: held this long before the next example. */
export const HOLD_ANSWER_MS = 2200;

type Phase = 'typing' | 'split';

export type SplitRow = 'waiting' | 'on' | 'done';
/** Row `i` when `shown` rows have come in (0 … 3) during the split. */
export const splitRow = (i: number, shown: number, all: boolean): SplitRow => (all || i < shown - 1 ? 'done' : i === shown - 1 ? 'on' : 'waiting');

/**
 * The prompt to Chief (맡기기): a small box that types an example request, then "Chief split it up"
 * and the three agents who took a piece of it, one after another (accent ring = coming in, ok check
 * = taken — the app's colours), then the next example. The three rows' room is kept from the start,
 * so nothing moves while they come in (the penguin's spot is read from the whole block). Reduced
 * motion / not acting: the first example, whole and still, split. The box is decoration for sighted
 * readers; screen readers get the examples as a plain list. `onTyping` hears whether the box is
 * typing right now (the landing penguin patters above the keys while it is — Acts.tsx `PromptAct`).
 */
export function PromptTyper({ still, onTyping }: { still: boolean; onTyping?: (typing: boolean) => void }) {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const [rows, setRows] = useState(0);
  const prompt = PROMPTS[index];
  const chars = Array.from(t(prompt.text));

  useEffect(() => {
    if (still) return;
    let id: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (shown < chars.length) id = setTimeout(() => setShown((n) => n + 1), TYPE_MS);
      else
        id = setTimeout(() => {
          setPhase('split');
          setRows(0);
        }, HOLD_TYPED_MS);
    } else if (rows <= prompt.split.length + 1) {
      id = setTimeout(() => setRows((n) => n + 1), rows === 0 ? 300 : SPLIT_STEP_MS);
    } else {
      id = setTimeout(() => {
        setIndex((i) => (i + 1) % PROMPTS.length);
        setShown(0);
        setRows(0);
        setPhase('typing');
      }, HOLD_ANSWER_MS);
    }
    return () => clearTimeout(id);
  }, [still, phase, shown, rows, chars.length, prompt.split.length]);

  // a language switch starts the current example again
  useEffect(() => {
    setShown(0);
    setRows(0);
    setPhase('typing');
  }, [locale]);

  const heard = useRef(onTyping);
  heard.current = onTyping;
  const typing = !still && phase === 'typing';
  useEffect(() => {
    heard.current?.(typing);
  }, [typing]);
  useEffect(() => () => heard.current?.(false), []);

  const text = still ? chars.join('') : chars.slice(0, shown).join('');
  const split = still || phase === 'split';
  // rows: 1 = the "split it up" line, 2 … 4 = the agents come in, 5 = all taken
  const agents = still ? prompt.split.length : Math.min(prompt.split.length, Math.max(0, rows - 1));
  const all = still || rows > prompt.split.length + 1;

  return (
    <div className="landing-prompt">
      <div className="landing-prompt-box" aria-hidden="true" data-testid="landing-prompt">
        <p className="landing-mono landing-prompt-to">
          <ICON.ask />
          {t('landing.prompt.to')}
        </p>
        <p className="landing-prompt-text">
          {text}
          {!still && !split && <span className="landing-caret" />}
        </p>
        <p className="landing-prompt-bar">
          <span className="landing-mono">{t('landing.prompt.hint')}</span>
          <span className="landing-prompt-send">
            <ICON.ask />
          </span>
        </p>
      </div>
      <div className={`landing-split ${split && (still || rows > 0) ? 'is-on' : ''}`} aria-hidden="true" data-testid="landing-split">
        <p className="landing-split-head">
          <AgentIcon agent="chief" team="core" size={20} label="" />
          {t('landing.delegate.split')}
        </p>
        <ol className="landing-split-rows">
          {prompt.split.map((s, i) => {
            const state = split ? splitRow(i, agents, all) : 'waiting';
            return (
              <li key={`${index}-${i}`} className={`landing-split-row is-${state}`} data-state={state}>
                <AgentIcon agent={s.agent} size={20} label="" />
                <b>{agentName(s.agent, locale, byId(s.agent))}</b>
                <span>{t(s.work)}</span>
                <span className="landing-split-mark">{state === 'done' && <ICON.check />}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <ul className="sr-only" aria-label={t('landing.prompt.examples')}>
        {PROMPTS.map((p) => (
          <li key={p.text}>
            {t(p.text)} — {t('landing.delegate.split')}: {p.split.map((s) => `${agentName(s.agent, locale, byId(s.agent))} · ${t(s.work)}`).join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
