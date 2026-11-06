import { useParams } from 'react-router-dom';
import { useScreen } from '../api/queries';
import type { ScreenResponse, WidgetSpec } from '../api/types.gen';
import { Loading, Placeholder, QueryError } from '../components/Status';
import { useI18n, type MessageKey, type Translate } from '../i18n';
import { screenSupported, WidgetSlot } from './registry';

const NAMES: Record<string, MessageKey> = { dashboard: 'nav.dashboard', home: 'nav.dashboard', artifacts: 'widget.artifacts' };

/** Widgets that take the whole width of the grid — a number strip, the cost area, a long list. */
export const WIDE = new Set(['stats', 'budget', 'artifact-list']);

/** The widgets a screen shows. The dashboard always ends with the cost area: the cost screen
 * moved into it (2026-11-07), so an org file without `budget` (an old home.yaml) still has it. */
export function widgetsOf(name: string, widgets: WidgetSpec[]): WidgetSpec[] {
  if (name !== 'dashboard' || widgets.some((w) => w.widget === 'budget')) return widgets;
  return [...widgets, { widget: 'budget', version: 1 }];
}

/** A screen the org defines in `orgs/<org>/screens/<name>.yaml` (I30) — the dashboard and artifacts. */
export function DeclarativeScreen({ name: fixed }: { name?: string }) {
  const { name: param } = useParams<{ name: string }>();
  const name = fixed ?? param ?? 'dashboard';
  const { t } = useI18n();
  const q = useScreen(name);
  return (
    <div className={`view screen-${name}`}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : <ScreenBody res={q.data} t={t} fallbackTitle={NAMES[name] ? t(NAMES[name]) : name} />}
    </div>
  );
}

export function ScreenBody({ res, t, fallbackTitle }: { res: ScreenResponse; t: Translate; fallbackTitle: string }) {
  const screen = res.screen;
  if (!screen) {
    return (
      <>
        <header className="view-header">
          <h1>{fallbackTitle}</h1>
        </header>
        <Placeholder title={t('screen.unreadable', { name: res.name })} detail={res.error ?? undefined} />
      </>
    );
  }
  return (
    <>
      <header className="view-header">
        <div>
          {/* the FDE's title is customer content — shown as written, not translated */}
          <h1>{screen.title || fallbackTitle}</h1>
          {res.name === 'dashboard' && <p>{t('dashboard.lead')}</p>}
        </div>
      </header>
      {!screenSupported(screen) ? (
        <Placeholder title={t('screen.badFormat', { version: screen.format_version })} detail={t('screen.placeholderHint')} />
      ) : (
        <div className="widget-grid">
          {widgetsOf(res.name, screen.widgets).map((spec, i) => (
            <div key={`${spec.widget}-${i}`} className={`widget-cell ${WIDE.has(spec.widget) ? 'is-wide' : ''}`} data-widget={spec.widget}>
              <WidgetSlot spec={spec} t={t} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
