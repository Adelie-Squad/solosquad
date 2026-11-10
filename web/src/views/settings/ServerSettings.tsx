// 서버 (user 2026-11-11 — "회사 프로필은 '서버'로 바꾸고 서버만 남기고 … 서버는 해당 서버의 정보가
// 자동으로 기입되게 할거임. 로컬일 때는 로컬"). Read-only: what the engine detected about itself
// (`GET /api/server`), with whatever the builder wrote in core/server.yaml as the override.
import { useServerFacts } from '../../api/queries';
import type { ServerFacts } from '../../api/types.gen';
import { Loading, QueryError } from '../../components/Status';
import { useI18n, type MessageKey } from '../../i18n';

const WHERE: Record<ServerFacts['where'], MessageKey> = {
  local: 'server.where.local',
  intranet: 'server.where.intranet',
  cloud: 'server.where.cloud',
};

export function ServerSettings() {
  const { t } = useI18n();
  const q = useServerFacts();
  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  const f = q.data;
  const unknown = t('server.unknown');
  const set = (key: string) => (f.sources[key] === 'override' ? <span className="chip is-quiet">{t('server.override')}</span> : null);
  const rows: [MessageKey, string, string][] = [['server.where', t(WHERE[f.where]), 'where']];
  if (f.where !== 'local') {
    rows.push(['server.cloud', f.cloud ? f.cloud.toUpperCase() : unknown, 'cloud']);
    rows.push(['server.region', f.region ?? unknown, 'region']);
  }
  rows.push(['server.country', f.country ?? unknown, 'country']);
  rows.push(['server.os', f.os, 'os']);
  rows.push(['server.version', f.version, 'version']);
  return (
    <section className="panel settings-body" aria-labelledby="server-title">
      <h2 id="server-title" className="panel-title">
        {t('settings.server')}
      </h2>
      <p className="settings-hint">{t('server.lead')}</p>
      <dl className="server-facts">
        {rows.map(([label, value, key]) => (
          <div key={key} className="server-fact">
            <dt>{t(label)}</dt>
            <dd>
              <span className={key === 'os' || key === 'version' || key === 'region' ? 'is-id' : undefined}>{value}</span>
              {set(key)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="dash-hint">{f.country ? t('server.countryHint') : f.where === 'local' ? t('server.localCountry') : t('server.countryHint')}</p>
    </section>
  );
}
