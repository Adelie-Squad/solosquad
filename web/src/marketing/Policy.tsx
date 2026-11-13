// `/policy` on the marketing site — the privacy policy (개인정보처리방침, 2026-11-14). `/privacy`, the
// old address, redirects here (MarketingApp, and the Worker answers it with a 301). The text is
// messages/policy.ts: Korean is authoritative, en · zh-CN say so at the top. Draft pending legal
// review — tracked in marketing/README.md, never shown on the page.
import { Link } from 'react-router-dom';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n } from '../i18n';
import { policyFor, type PolicyBlock } from './messages/policy';
import { SITE } from './messages/site';
import { SiteFooter } from './SiteFooter';

const anchor = (id: string) => `policy-${id}`;

function Block({ block }: { block: PolicyBlock }) {
  if ('p' in block) return <p>{block.p}</p>;
  if ('ul' in block)
    return (
      <ul>
        {block.ul.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  const { head, rows } = block.table;
  return (
    <table className="site-policy-table">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, i) => (
              <td key={i} data-label={head[i]}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Policy() {
  const { t, locale } = useI18n();
  const policy = policyFor(locale);
  return (
    <div className="site-policy-page">
      <header className="site-policy-top">
        <Link className="site-policy-brand" to="/">
          {SITE.brand}
        </Link>
        <LocalePicker />
      </header>
      <main className="site-policy">
        <article className="panel" lang={locale}>
          <h1>{t('policy.title')}</h1>
          <p className="site-policy-meta">{t('policy.effective', { date: SITE.policyEffective })}</p>
          {locale !== 'ko' && <p className="site-policy-prevails">{t('policy.prevails')}</p>}
          <p className="site-policy-intro">{policy.intro}</p>
          <nav className="site-policy-toc" aria-label={t('policy.contents')}>
            <ol>
              {policy.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${anchor(s.id)}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          </nav>
          {policy.sections.map((s) => (
            <section key={s.id} id={anchor(s.id)} aria-labelledby={`${anchor(s.id)}-title`}>
              <h2 id={`${anchor(s.id)}-title`}>{s.title}</h2>
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
          <div className="site-policy-foot">
            <Link to="/">{t('policy.back')}</Link>
          </div>
        </article>
      </main>
      <SiteFooter compact />
    </div>
  );
}
