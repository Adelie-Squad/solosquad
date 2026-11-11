// The demo's org-package work products (decision 62 · W11): payments, a landed-cost
// comparison, a purchase order in the supplier's language, a week of posts and an ad plan.
// Column names are the web's words (translated); every value is the engine's data, shown as
// written — a Chinese order stays Chinese.
import type {
  AdPlanData,
  PayablesData,
  PurchaseOrderData,
  SnsCalendarData,
  SnsPostsData,
  SupplierComparisonData,
} from '../api/types.gen';
import { isLocale, LOCALE_NAMES, useI18n } from '../i18n';
import { ICON } from '../icons';

/** `ko` · `zh-CN` → each language named in itself (as the language picker does). */
function languageName(code: string): string {
  return isLocale(code) ? LOCALE_NAMES[code] : code;
}

function DraftOnly() {
  const { t } = useI18n();
  return (
    <p className="dash-hint with-icon work-draft">
      <ICON.locked size={14} />
      {t('art.draftOnly')}
    </p>
  );
}

export function PayablesView({ data }: { data: PayablesData }) {
  const { t, fmt } = useI18n();
  return (
    <div className="work-product">
      <div className="statement-wrap">
        <table className="statement">
          <thead>
            <tr>
              <th>{t('art.vendor')}</th>
              <th>{t('art.invoice')}</th>
              <th>{t('art.item')}</th>
              <th>{t('art.due')}</th>
              <th>{t('art.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.invoice}>
                <th>{i.vendor}</th>
                <td>{i.invoice}</td>
                <td>{i.item}</td>
                <td>{i.due}</td>
                <td>{fmt.money(i.amount, 'KRW')}</td>
              </tr>
            ))}
            <tr className="is-total">
              <th colSpan={4}>{t('art.total')}</th>
              <td>{fmt.money(data.total, 'KRW')}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="dash-hint">
        {t('art.account')} · {data.account}
      </p>
      <DraftOnly />
    </div>
  );
}

export function SupplierComparisonView({ data }: { data: SupplierComparisonData }) {
  const { t, fmt } = useI18n();
  return (
    <div className="work-product">
      <p className="dash-hint">
        {data.product} · {t('art.retail', { price: fmt.money(data.retail_price, 'KRW') })}
      </p>
      <div className="statement-wrap">
        <table className="statement">
          <thead>
            <tr>
              <th>{t('art.supplier')}</th>
              <th>{t('art.unitPrice')}</th>
              <th>{t('art.shipping')}</th>
              <th>{t('art.duty')}</th>
              <th>{t('art.landed')}</th>
              <th>{t('art.moq')}</th>
              <th>{t('art.lead')}</th>
              <th>{t('art.defect')}</th>
              <th>{t('art.score')}</th>
            </tr>
          </thead>
          <tbody>
            {data.suppliers.map((s) => (
              <tr key={s.supplier} className={s.recommended ? 'is-recommended' : undefined}>
                <th>
                  {s.supplier}
                  {s.recommended && <span className="chip is-ok">{t('art.recommended')}</span>}
                  <span className="dash-hint work-sub">
                    {s.region} · {s.note}
                  </span>
                </th>
                <td>¥{fmt.number(s.unit_price_cny)}</td>
                <td>{fmt.money(s.shipping, 'KRW')}</td>
                <td>{fmt.number(s.duty_rate)}%</td>
                <td>
                  <strong>{fmt.money(s.landed_krw, 'KRW')}</strong>
                </td>
                <td>{fmt.number(s.moq)}</td>
                <td>{t('art.days', { n: s.lead_days })}</td>
                <td>{fmt.number(s.defect_rate, 1)}%</td>
                <td>{fmt.number(s.score, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PurchaseOrderView({ data }: { data: PurchaseOrderData }) {
  const { t, fmt } = useI18n();
  return (
    <div className="work-product">
      <h3 className="dash-panel-title" lang={data.language}>
        {data.title_local} · {data.po_number}
      </h3>
      <p className="dash-hint">
        {t('art.supplier')} · {data.supplier}
      </p>
      <div className="statement-wrap">
        <table className="statement">
          <thead>
            <tr>
              <th>{t('art.sku')}</th>
              <th>{t('art.name')}</th>
              <th>{t('art.qty')}</th>
              <th>{t('art.unitPrice')}</th>
              <th>{t('art.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.sku}>
                <th>{l.sku}</th>
                <td>
                  <span lang={data.language}>{l.name_local}</span>
                  <span className="dash-hint work-sub">{l.name}</span>
                </td>
                <td>{fmt.number(l.qty)}</td>
                <td>¥{fmt.number(l.unit_price)}</td>
                <td>¥{fmt.number(l.amount)}</td>
              </tr>
            ))}
            <tr className="is-total">
              <th colSpan={4}>{t('art.total')}</th>
              <td>{data.total_text}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl className="work-facts">
        <dt>{t('art.delivery')}</dt>
        <dd>{data.delivery}</dd>
        <dt>{t('art.terms')}</dt>
        <dd lang={data.language}>{data.terms_local}</dd>
      </dl>
      <DraftOnly />
    </div>
  );
}

export function SnsCalendarView({ data }: { data: SnsCalendarData }) {
  const { t, fmt } = useI18n();
  return (
    <div className="work-product">
      <p className="dash-hint">{data.week}</p>
      <div className="statement-wrap">
        <table className="statement">
          <thead>
            <tr>
              <th>{t('art.date')}</th>
              <th>{t('art.channel')}</th>
              <th>{t('art.language')}</th>
              <th>{t('art.theme')}</th>
              <th>{t('art.format')}</th>
              <th>{t('art.owner')}</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={`${e.date}-${e.channel}-${e.theme}`}>
                <th>{e.date}</th>
                <td>{e.channel}</td>
                <td>{languageName(e.language)}</td>
                <td>{e.theme}</td>
                <td>{e.format}</td>
                <td>{e.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.last_week.length > 0 && (
        <section className="dash-section">
          <h3 className="dash-panel-title">{t('art.lastWeek')}</h3>
          <div className="statement-wrap">
            <table className="statement">
              <thead>
                <tr>
                  <th>{t('art.post')}</th>
                  <th>{t('art.reached')}</th>
                  <th>{t('art.likes')}</th>
                  <th>{t('art.comments')}</th>
                  <th>{t('art.saves')}</th>
                </tr>
              </thead>
              <tbody>
                {data.last_week.map((r) => (
                  <tr key={r.post}>
                    <th>
                      {r.post}
                      <span className="dash-hint work-sub">{r.channel}</span>
                    </th>
                    <td>{fmt.number(r.reach)}</td>
                    <td>{fmt.number(r.likes)}</td>
                    <td>{fmt.number(r.comments)}</td>
                    <td>{fmt.number(r.saves)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export function SnsPostsView({ data }: { data: SnsPostsData }) {
  const { t } = useI18n();
  return (
    <div className="work-product">
      <ul className="work-posts">
        {data.posts.map((p) => (
          <li key={`${p.date}-${p.channel}-${p.language}`} className="work-post">
            <p className="work-post-head">
              <span className="chip">{p.channel}</span>
              <span className="chip">{languageName(p.language)}</span>
              <span className="dash-hint">{p.date}</span>
            </p>
            <p className="work-post-caption" lang={p.language}>
              {p.caption}
            </p>
            <p className="dash-hint">{p.hashtags.join(' ')}</p>
            <p className="dash-hint with-icon">
              <ICON.draft size={14} />
              {t('art.image')} · {p.image_note}
            </p>
          </li>
        ))}
      </ul>
      <DraftOnly />
    </div>
  );
}

export function AdPlanView({ data }: { data: AdPlanData }) {
  const { t } = useI18n();
  return (
    <div className="work-product">
      <dl className="work-facts">
        <dt>{t('art.channel')}</dt>
        <dd>{data.channel}</dd>
        <dt>{t('art.adSpend')}</dt>
        <dd>
          <strong>{data.budget_text}</strong>
        </dd>
        <dt>{t('art.period')}</dt>
        <dd>
          {data.start} · {t('art.days', { n: data.days })}
        </dd>
        <dt>{t('art.audience')}</dt>
        <dd>{data.audience}</dd>
        <dt>{t('art.reach')}</dt>
        <dd>{data.expected_reach}</dd>
        <dt>{t('art.creative')}</dt>
        <dd>{data.creative}</dd>
      </dl>
      <DraftOnly />
    </div>
  );
}
