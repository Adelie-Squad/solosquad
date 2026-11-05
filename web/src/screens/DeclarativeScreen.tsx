import { useParams } from 'react-router-dom';
import { useScreen } from '../api/queries';
import type { ScreenResponse } from '../api/types.gen';
import { Loading, Placeholder, QueryError } from '../components/Status';
import { useI18n, type MessageKey, type Translate } from '../i18n';
import { screenSupported, WidgetSlot } from './registry';

const NAMES: Record<string, MessageKey> = { home: 'nav.home', artifacts: 'nav.artifacts' };

/** A screen the org defines in `orgs/<org>/screens/<name>.yaml` (I30) — home and artifacts. */
export function DeclarativeScreen({ name: fixed }: { name?: string }) {
  const { name: param } = useParams<{ name: string }>();
  const name = fixed ?? param ?? 'home';
  const { t } = useI18n();
  const q = useScreen(name);
  return (
    <div className="view">
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
        </div>
      </header>
      {!screenSupported(screen) ? (
        <Placeholder title={t('screen.badFormat', { version: screen.format_version })} detail={t('screen.placeholderHint')} />
      ) : (
        <div className="widget-grid">
          {screen.widgets.map((spec, i) => (
            <WidgetSlot key={`${spec.widget}-${i}`} spec={spec} t={t} />
          ))}
        </div>
      )}
    </>
  );
}
