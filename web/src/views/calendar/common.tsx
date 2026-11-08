// Pieces the calendar screens share (decision 60 · DESIGN.md `### 일정`): the side sheet, the
// colour dot, label lookups, and the agent-access choice (also in Settings › My account).
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { calendarApi, calendarKeys, useAction, useAgentAccess } from '../../api/queries';
import type { CalendarAgentAccess, CalendarItem, CalendarLabel } from '../../api/types.gen';
import { useScrollLock } from '../../components/scrollLock';
import { errorText } from '../../api/errors';
import { useI18n, type MessageKey } from '../../i18n';
import { ICON } from '../../icons';
import type { PaletteKey } from '../../lib/calendar';

/** A small colour dot — the 구분's palette key (DESIGN.md `## 색` 일정 구분 색). Decorative. */
export function Dot({ color, personal }: { color: PaletteKey; personal?: boolean }) {
  return <span className={`cal-dot ${personal ? 'is-personal' : ''}`} data-color={color} aria-hidden />;
}

/** The right-hand sheet the item detail opens in (a full-screen sheet on a phone). Esc, the close
 * button or a press on the scrim close it; the page behind does not scroll (scrollLock). */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useScrollLock();
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    const back = opener.current;
    return () => {
      setTimeout(() => {
        if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
  return createPortal(
    <div className="command-overlay is-modal cal-sheet-overlay" onMouseDown={onClose}>
      <aside className="cal-sheet" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn cal-sheet-close" aria-label={t('common.close')} title={t('common.close')} onClick={onClose} autoFocus>
          <ICON.close size={18} />
        </button>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

export function useLabelMaps(labels: CalendarLabel[] | undefined) {
  return useMemo(() => {
    const all = labels ?? [];
    const byId = new Map(all.map((l) => [l.id, l]));
    /** Labels an entry may use: its org's (work) or the person's own (personal). */
    const forItem = (item: Pick<CalendarItem, 'kind' | 'org'>, type: 'category' | 'tag', keep?: string[]) =>
      all.filter(
        (l) =>
          l.type === type &&
          (item.kind === 'personal' ? l.scope_kind === 'user' : l.scope_kind === 'org' && l.scope === item.org) &&
          (!l.archived || keep?.includes(l.id)),
      );
    return { byId, forItem, all };
  }, [labels]);
}

export const STATUS_KEYS: Record<CalendarItem['status'], MessageKey> = {
  planned: 'calendar.status.planned',
  active: 'calendar.status.active',
  done: 'calendar.status.done',
  canceled: 'calendar.status.canceled',
};

const LEVELS: { id: CalendarAgentAccess['level']; label: MessageKey; hint: MessageKey }[] = [
  { id: 'off', label: 'calendar.agentAccess.off', hint: 'calendar.agentAccess.offHint' },
  { id: 'busy', label: 'calendar.agentAccess.busy', hint: 'calendar.agentAccess.busyHint' },
  { id: 'full', label: 'calendar.agentAccess.full', hint: 'calendar.agentAccess.fullHint' },
];

/** How much agents may read of my personal events (decision 60 rev): off (default) · busy/free
 * only · everything. People never see them either way — the line under it says so. */
export function AgentAccessPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const q = useAgentAccess();
  const save = useAction(calendarApi.setAgentAccess, [calendarKeys.agentAccess, calendarKeys.all]);
  const level = save.variables ?? q.data?.level ?? 'off';
  const hint = LEVELS.find((l) => l.id === level)?.hint ?? 'calendar.agentAccess.offHint';
  return (
    <section className={compact ? 'cal-agent-access' : 'panel cal-agent-access'} aria-labelledby="cal-agent-access-title" data-testid="agent-access">
      <h2 className="panel-title" id="cal-agent-access-title">
        {t('calendar.agentAccess')}
      </h2>
      <div className="segmented" role="radiogroup" aria-label={t('calendar.agentAccess')}>
        {LEVELS.map((l) => (
          <button
            key={l.id}
            role="radio"
            aria-checked={level === l.id}
            className={level === l.id ? 'is-active' : ''}
            disabled={q.isPending}
            onClick={() => level !== l.id && save.mutate(l.id)}
          >
            {t(l.label)}
          </button>
        ))}
      </div>
      <p className="hint">{t(hint)}</p>
      <p className="hint">{t('calendar.agentAccess.people')}</p>
      {save.error && (
        <p className="form-error" role="alert">
          {errorText(save.error, t)}
        </p>
      )}
    </section>
  );
}
