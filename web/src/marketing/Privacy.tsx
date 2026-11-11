// `/privacy` on the marketing site — a placeholder privacy policy for the inquiry form, marked as
// a draft that needs legal review (PRD §3.5 — 동의 문구 `[검토 필요]`, storage region L4).
import { Link } from 'react-router-dom';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n, type MessageKey } from '../i18n';

const PARTS = ['collect', 'purpose', 'keep', 'refuse', 'where'] as const;
const KEYS: Record<(typeof PARTS)[number], [MessageKey, MessageKey]> = {
  collect: ['privacy.collect.title', 'privacy.collect.body'],
  purpose: ['privacy.purpose.title', 'privacy.purpose.body'],
  keep: ['privacy.keep.title', 'privacy.keep.body'],
  refuse: ['privacy.refuse.title', 'privacy.refuse.body'],
  where: ['privacy.where.title', 'privacy.where.body'],
};

export function Privacy() {
  const { t } = useI18n();
  return (
    <main className="site-privacy">
      <article className="panel">
        <p className="chip is-warn">{t('privacy.review')}</p>
        <h1>{t('privacy.title')}</h1>
        {PARTS.map((p) => (
          <section key={p}>
            <h2>{t(KEYS[p][0])}</h2>
            <p>{t(KEYS[p][1])}</p>
          </section>
        ))}
        <div className="site-privacy-foot">
          <Link to="/">{t('privacy.back')}</Link>
          <LocalePicker />
        </div>
      </article>
    </main>
  );
}
