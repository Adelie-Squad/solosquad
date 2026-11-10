// The dashboard's number row and its lists are one thing (DESIGN.md `### 대시보드`, 2026-11-10):
// 진행 예정 · 진행 중 · 승인 대기 · 오늘 완료 are tabs; the list of the chosen one opens right under
// the row. 승인 대기 is 과제's 내가 할 일 (cards I may answer, inline) + 다른 사람 차례 (folded);
// 진행 예정 is the old 다음 실행 plus the coming 일정 and 할 일.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalItem, Artifact, WorkEntry } from '../../api/types.gen';
import { ApprovalCard } from '../../components/ApprovalCard';
import { Loading } from '../../components/Status';
import { useI18n } from '../../i18n';
import { ICON } from '../../icons';
import { ReviewCard, WorkRow } from '../TasksView';
import { From, WsScope, type WsRef } from './WsScope';

export type TabKey = 'upcoming' | 'running' | 'waiting' | 'done';
export const TABS: TabKey[] = ['upcoming', 'running', 'waiting', 'done'];

export interface Upcoming {
  key: string;
  /** Epoch seconds — the list is soonest first. */
  at: number;
  when: string;
  whenTitle?: string;
  title: string;
  kind: string;
  meta: ReactNode;
  to?: string;
  color?: string;
  personal?: boolean;
}

export interface Lists {
  upcoming: Upcoming[];
  running: { r: WsRef; w: WorkEntry }[];
  mine: { r: WsRef; a: ApprovalItem }[];
  reviews: { r: WsRef; a: Artifact }[];
  others: { r: WsRef; a: ApprovalItem }[];
  done: { r: WsRef; w: WorkEntry }[];
}

/** Which tab opens first: what waits for me, else what is going on, else what is coming. */
export function defaultTab(l: Pick<Lists, 'mine' | 'reviews' | 'running'>): TabKey {
  if (l.mine.length + l.reviews.length > 0) return 'waiting';
  if (l.running.length > 0) return 'running';
  return 'upcoming';
}

const UPCOMING_SHOWN = 10;

export function WorkTabs({ lists, selected, onSelect, ready }: { lists: Lists; selected: TabKey; onSelect: (k: TabKey) => void; ready: boolean }) {
  const { t, fmt } = useI18n();
  const refs = useRef<Record<TabKey, HTMLButtonElement | null>>({ upcoming: null, running: null, waiting: null, done: null });
  const mine = lists.mine.length + lists.reviews.length;
  const cells: Record<TabKey, { label: string; value: number; note: string | null; live?: boolean; attention?: boolean }> = {
    upcoming: { label: t('stats.upcoming'), value: lists.upcoming.length, note: null },
    running: { label: t('stats.running'), value: lists.running.length, note: null, live: lists.running.length > 0 },
    waiting: { label: t('stats.waiting'), value: mine + lists.others.length, note: mine > 0 ? t('stats.mine', { n: mine }) : null, attention: mine > 0 },
    done: { label: t('stats.doneToday'), value: lists.done.length, note: null },
  };

  const move = (e: KeyboardEvent, from: TabKey) => {
    const i = TABS.indexOf(from);
    const to = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null;
    if (!to) return;
    e.preventDefault();
    onSelect(to);
    refs.current[to]?.focus();
  };

  return (
    <section className="panel dash-work" data-testid="work-tabs">
      <div className="dash-stats" role="tablist" aria-label={t('dashboard.workTabs')} data-testid="stats">
        {TABS.map((k) => {
          const c = cells[k];
          const on = k === selected;
          return (
            <button
              key={k}
              ref={(el) => {
                refs.current[k] = el;
              }}
              type="button"
              role="tab"
              id={`dash-tab-${k}`}
              aria-selected={on}
              aria-controls="dash-tab-panel"
              tabIndex={on ? 0 : -1}
              className={`dash-stat ${on ? 'is-selected' : ''} ${c.attention ? 'is-attention' : ''}`}
              onClick={() => onSelect(k)}
              onKeyDown={(e) => move(e, k)}
              data-testid={`stat-${k}`}
            >
              <span className="dash-stat-label">
                {c.live && <span className="live-dot" aria-hidden />}
                {c.label}
              </span>
              <span className="dash-stat-value">{ready ? fmt.number(c.value) : '–'}</span>
              {c.note && <span className="dash-stat-note">{c.note}</span>}
            </button>
          );
        })}
      </div>
      <div className="dash-tab-panel" role="tabpanel" id="dash-tab-panel" aria-labelledby={`dash-tab-${selected}`} data-testid={`tab-${selected}`}>
        {!ready ? <Loading /> : <TabBody k={selected} lists={lists} />}
      </div>
    </section>
  );
}

function TabBody({ k, lists }: { k: TabKey; lists: Lists }) {
  const { t } = useI18n();
  if (k === 'upcoming') {
    if (lists.upcoming.length === 0) return <p className="dash-hint">{t('dashboard.upcomingEmpty')}</p>;
    const shown = lists.upcoming.slice(0, UPCOMING_SHOWN);
    return (
      <>
        <ol className="next-runs">
          {shown.map((u) => (
            <li key={u.key} className="next-run">
              <time className="next-run-when" title={u.whenTitle}>
                {u.when}
              </time>
              <span className="next-run-what">
                {u.to ? (
                  <Link className={u.color ? `cal-chip-line ${u.personal ? 'is-personal' : ''}` : 'next-run-link'} data-color={u.color} to={u.to}>
                    <strong>{u.title}</strong>
                  </Link>
                ) : (
                  <strong>{u.title}</strong>
                )}
                <span className="dash-hint">
                  {u.kind} · {u.meta}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="dash-tab-foot">
          {lists.upcoming.length > shown.length && <span className="dash-hint">{t('digest.more', { n: lists.upcoming.length - shown.length })}</span>}
          <Link className="widget-more" to="/calendar">
            {t('dashboard.openCalendar')}
            <ICON.more size={14} />
          </Link>
        </p>
      </>
    );
  }
  if (k === 'running' || k === 'done') {
    const rows = k === 'running' ? lists.running : lists.done;
    if (rows.length === 0) return <p className="dash-hint">{k === 'running' ? t('tasks.runningNone') : t('dashboard.doneTodayNone')}</p>;
    return (
      <ul className="work-list" aria-live={k === 'running' ? 'polite' : undefined}>
        {rows.map(({ r, w }) => (
          <WsScope key={`${r.org}-${r.ws}-${w.thread_id}`} org={r.org} ws={r.ws}>
            <WorkRow item={w} from={<From r={r} />} />
          </WsScope>
        ))}
      </ul>
    );
  }
  const mine = lists.mine.length + lists.reviews.length;
  return (
    <>
      <h3 className="dash-tab-sub">
        {t('dashboard.mineTurn')}
        {mine > 0 && <span className="chip is-warn">{mine}</span>}
      </h3>
      {mine === 0 ? (
        <p className="dash-hint">{t('dashboard.waitingNone')}</p>
      ) : (
        <div className="stack" data-testid="waiting-mine">
          {lists.mine.map(({ r, a }) => (
            <WsScope key={`${r.org}-${r.ws}-${a.run_id}`} org={r.org} ws={r.ws}>
              <ApprovalCard item={a} compact from={<From r={r} />} />
            </WsScope>
          ))}
          {lists.reviews.map(({ r, a }) => (
            <WsScope key={`${r.org}-${r.ws}-${a.id}`} org={r.org} ws={r.ws}>
              <ReviewCard artifact={a} from={<From r={r} />} />
            </WsScope>
          ))}
        </div>
      )}
      {lists.others.length > 0 && (
        <details className="dash-others" data-testid="waiting-others">
          <summary className="dash-tab-sub">
            <ICON.expand className="dash-others-caret" aria-hidden />
            {t('dashboard.othersTurn', { n: lists.others.length })}
          </summary>
          <p className="dash-hint">{t('tasks.othersLead')}</p>
          <div className="stack">
            {lists.others.map(({ r, a }) => (
              <WsScope key={`${r.org}-${r.ws}-${a.run_id}`} org={r.org} ws={r.ws}>
                <ApprovalCard item={a} compact from={<From r={r} />} />
              </WsScope>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
