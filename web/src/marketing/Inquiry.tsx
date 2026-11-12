// The demo account request (decision 62, PRD §3.5.2 ⑥ + §3.6.3): a modal on the shared Modal
// frame, opened from the landing's last section and the demo login (and the pricing section once it
// exists), each with its `source`. Fields = §3.5.2 ⑥ + 요청 (demo · consult) + the company's
// registration number (one representative number — the demo login asks for it again, 2026-11-12)
// + the demo-usage consent when a demo account is asked for (DM6 ⓑ); the page checks them for convenience, the
// marketing Worker decides (POST /api/inquiry). Spam: a hidden honeypot field, a
// "form opened" token for the minimum fill time, and Turnstile only when the site turns it on.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { useI18n, type Locale, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { formToken, sendInquiry, siteConfig, type FieldError } from './siteApi';

const KINDS = ['retail', 'online', 'maker', 'service', 'partner', 'other'] as const;
const COUNTRIES = ['kr', 'cn', 'other'] as const;
const REQUESTS = ['demo', 'consult'] as const;
const WANTS = ['finance', 'sourcing', 'sns', 'other'] as const;
const PHONE_KINDS = ['phone', 'kakao', 'wechat'] as const;
const MAX = { company: 80, contact_name: 40, email: 254, reach_value: 60, message: 1000 };
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

type Want = (typeof WANTS)[number];
export type Request = (typeof REQUESTS)[number];
export type Source = 'landing_hero' | 'landing_start' | 'pricing' | 'demo_login' | 'demo_app';

interface Form {
  company: string;
  company_no: string;
  business_type: string;
  country: string;
  contact_name: string;
  email: string;
  reach_kind: string;
  reach_value: string;
  wants: Want[];
  requests: Request[];
  message: string;
  consent_required: boolean;
  consent_demo: boolean;
  consent_news: boolean;
  website: string;
}

const blank = (locale: Locale, requests: Request[]): Form => ({
  company: '',
  company_no: '',
  business_type: '',
  country: locale === 'zh-CN' ? 'cn' : locale === 'ko' ? 'kr' : '',
  contact_name: '',
  email: '',
  reach_kind: locale === 'zh-CN' ? 'wechat' : locale === 'ko' ? 'kakao' : 'phone',
  reach_value: '',
  wants: [],
  requests,
  message: '',
  consent_required: false,
  consent_demo: false,
  consent_news: false,
  website: '',
});

/** The company's registration number as the Worker stores it (marketing/src/validate.ts
 * `normalizeCompanyNo`): a Korean 사업자 · 법인등록번호 → its 10 or 13 digits (a Korean company must
 * give one of those), another country's → 4–30 letters, digits and dashes, upper-cased; else null. */
export function normalizeCompanyNo(raw: string, country?: string): string | null {
  const text = raw.normalize('NFKC').trim();
  const digits = text.replace(/[\s-]/g, '');
  if (/^(?:\d{10}|\d{13})$/.test(digits)) return digits;
  if (country === 'kr') return null;
  const other = text.toUpperCase();
  return /^[A-Z0-9-]{4,30}$/.test(other) ? other : null;
}

/** The same rules as the marketing Worker (marketing/src/validate.ts), for the marks before sending. */
export function checkInquiry(f: Form): Record<string, FieldError> {
  const out: Record<string, FieldError> = {};
  const text = (k: keyof typeof MAX, required: boolean) => {
    const v = f[k].trim();
    if (!v && required) out[k] = 'required';
    else if (v.length > MAX[k]) out[k] = 'too_long';
  };
  text('company', true);
  if (!f.company_no.trim()) out.company_no = 'required';
  else if (!normalizeCompanyNo(f.company_no, f.country)) out.company_no = 'invalid';
  text('contact_name', true);
  text('email', true);
  if (f.email.trim() && !out.email && !EMAIL.test(f.email.trim())) out.email = 'invalid';
  text('reach_value', false);
  text('message', false);
  if (!f.business_type) out.business_type = 'required';
  if (!f.country) out.country = 'required';
  if (!f.wants.length) out.wants = 'required';
  if (!f.requests.length) out.requests = 'required';
  if (!f.consent_required) out.consent_required = 'required';
  if (f.requests.includes('demo') && !f.consent_demo) out.consent_demo = 'required';
  return out;
}

const FIELD_MESSAGE: Record<string, Partial<Record<FieldError, MessageKey>>> = {
  email: { invalid: 'landing.contact.invalidEmail' },
  company_no: { invalid: 'landing.contact.invalidCompanyNo' },
  wants: { required: 'landing.contact.pickOne', invalid: 'landing.contact.pickOne' },
  requests: { required: 'landing.contact.pickOne', invalid: 'landing.contact.pickOne' },
  consent_required: { required: 'landing.contact.needConsent' },
  consent_demo: { required: 'landing.contact.needConsent' },
  business_type: { required: 'landing.contact.choose', invalid: 'landing.contact.invalid' },
  country: { required: 'landing.contact.choose', invalid: 'landing.contact.invalid' },
  reach_kind: { invalid: 'landing.contact.invalid' },
};
const fieldMessage = (name: string, e: FieldError): MessageKey =>
  FIELD_MESSAGE[name]?.[e] ?? (e === 'too_long' ? 'landing.contact.tooLong' : e === 'invalid' ? 'landing.contact.invalid' : 'landing.contact.required');

const PROBLEM: Record<string, MessageKey> = {
  too_fast: 'landing.contact.stale',
  expired: 'landing.contact.stale',
  rate_limited: 'landing.contact.throttled',
  bot_check: 'landing.contact.botCheck',
  failed: 'landing.contact.failed',
};

interface TurnstileApi {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void }) => string;
  reset: (id?: string) => void;
}

/** Cloudflare Turnstile, only when the site turns it on (off by default — blocked in China). */
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as unknown as { turnstile?: TurnstileApi };
    const draw = () => {
      if (box.current && w.turnstile) w.turnstile.render(box.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken('') });
    };
    if (w.turnstile) return draw();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = draw;
    document.head.appendChild(s);
  }, [siteKey, onToken]);
  return <div ref={box} className="inquiry-turnstile" />;
}


export interface OpenRequest {
  source: Source;
  /** pre-checked 요청 — the demo login and the last section: a demo account; pricing: + a call */
  requests?: Request[];
}

function InquiryModal({ onClose, source, requests }: { onClose: () => void; source: Source; requests: Request[] }) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<Form>(() => blank(locale, requests));
  const [marks, setMarks] = useState<Record<string, FieldError>>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Form | null>(null);
  const [turnstile, setTurnstile] = useState<{ siteKey: string } | null>(null);
  const [botToken, setBotToken] = useState('');
  const token = useRef<Promise<string | null>>(formToken());

  useEffect(() => {
    siteConfig()
      .then((c) => c.turnstile.enabled && c.turnstile.site_key && setTurnstile({ siteKey: c.turnstile.site_key }))
      .catch(() => undefined);
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setMarks((m) => {
      if (!(k in m)) return m;
      const next = { ...m };
      delete next[k];
      return next;
    });
  };
  const toggle = <K extends 'wants' | 'requests'>(k: K, v: Form[K][number]) => {
    const list = form[k] as string[];
    set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]) as Form[K]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const local = checkInquiry(form);
    setMarks(local);
    if (Object.keys(local).length) {
      setProblem('landing.contact.fix');
      return;
    }
    setBusy(true);
    const reach = form.reach_value.trim();
    const res = await sendInquiry({
      company: form.company.trim(),
      company_no: form.company_no.trim(),
      business_type: form.business_type,
      country: form.country,
      contact_name: form.contact_name.trim(),
      email: form.email.trim(),
      reach_kind: reach ? form.reach_kind : undefined,
      reach_value: reach || undefined,
      wants: form.wants,
      requests: form.requests,
      message: form.message.trim() || undefined,
      consent_required: form.consent_required,
      consent_demo: form.requests.includes('demo') && form.consent_demo,
      consent_news: form.consent_news,
      website: form.website,
      locale,
      source,
      form_token: await token.current,
      turnstile_token: botToken || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setDone(form);
      return;
    }
    if (res.error === 'invalid') {
      setMarks(res.fields);
      setProblem('landing.contact.fix');
      return;
    }
    // a stale or too-early form gets a fresh token; the person sends again
    if (res.error === 'expired' || res.error === 'too_fast') token.current = formToken();
    setProblem(PROBLEM[res.error]);
  };

  const err = (name: string) =>
    marks[name] ? (
      <small className="inquiry-error" id={`inquiry-${name}-error`}>
        {t(fieldMessage(name, marks[name]))}
      </small>
    ) : null;
  const invalid = (name: string) => (marks[name] ? { 'aria-invalid': true as const, 'aria-describedby': `inquiry-${name}-error` } : {});

  if (done) {
    return (
      <Modal label={t('landing.apply.done.title')} onClose={onClose} className="inquiry-modal">
        <div className="inquiry-done" role="status">
          <ICON.done size={28} className="inquiry-done-icon" />
          <h2>{t('landing.apply.done.title')}</h2>
          <p>{t('landing.apply.done.body')}</p>
          <dl className="inquiry-summary">
            <dt>{t('landing.contact.company')}</dt>
            <dd>{done.company.trim()}</dd>
            <dt>{t('landing.contact.companyNo')}</dt>
            <dd>{done.company_no.trim()}</dd>
            <dt>{t('landing.apply.requests')}</dt>
            <dd>{done.requests.map((r) => t(`landing.apply.requests.${r}`)).join(' · ')}</dd>
            <dt>{t('landing.contact.wants')}</dt>
            <dd>{done.wants.map((w) => t(`landing.contact.wants.${w}`)).join(' · ')}</dd>
          </dl>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </Modal>
    );
  }

  const chips = <K extends 'wants' | 'requests'>(k: K, list: readonly Form[K][number][], label: (v: Form[K][number]) => MessageKey, legend: MessageKey) => (
    <fieldset className="field inquiry-wants" {...(marks[k] ? { 'aria-describedby': `inquiry-${k}-error` } : {})}>
      <legend>{t(legend)}</legend>
      <div className="inquiry-chips">
        {list.map((v) => {
          const on = (form[k] as string[]).includes(v);
          return (
            <label key={v} className={`inquiry-chip ${on ? 'is-on' : ''}`.trim()}>
              <input type="checkbox" checked={on} onChange={() => toggle(k, v)} />
              {t(label(v))}
            </label>
          );
        })}
      </div>
      {err(k)}
    </fieldset>
  );

  return (
    <Modal label={t('landing.apply.title')} onClose={onClose} className="inquiry-modal">
      <form className="inquiry-form" onSubmit={(e) => void submit(e)} noValidate>
        <header className="inquiry-head">
          <h2>{t('landing.apply.title')}</h2>
          <p>{t('landing.apply.lead')}</p>
        </header>
        {chips('requests', REQUESTS, (r) => `landing.apply.requests.${r}`, 'landing.apply.requests')}
        <div className="inquiry-grid">
          <label className="field">
            <span>{t('landing.contact.company')}</span>
            <input name="company" autoComplete="organization" maxLength={MAX.company} value={form.company} onChange={(e) => set('company', e.target.value)} {...invalid('company')} />
            {err('company')}
          </label>
          <label className="field">
            <span>{t('landing.contact.companyNo')}</span>
            <small>{t('landing.contact.companyNoHint')}</small>
            <input
              name="company_no"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              placeholder="123-45-67890"
              value={form.company_no}
              onChange={(e) => set('company_no', e.target.value)}
              {...invalid('company_no')}
            />
            {err('company_no')}
          </label>
          <label className="field">
            <span>{t('landing.contact.kind')}</span>
            <select name="business_type" value={form.business_type} onChange={(e) => set('business_type', e.target.value)} {...invalid('business_type')}>
              <option value="" disabled>
                —
              </option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`landing.contact.business.${k}`)}
                </option>
              ))}
            </select>
            {err('business_type')}
          </label>
          <label className="field">
            <span>{t('landing.contact.contact')}</span>
            <input name="contact_name" autoComplete="name" maxLength={MAX.contact_name} value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} {...invalid('contact_name')} />
            {err('contact_name')}
          </label>
          <label className="field">
            <span>{t('landing.contact.country')}</span>
            <select name="country" value={form.country} onChange={(e) => set('country', e.target.value)} {...invalid('country')}>
              <option value="" disabled>
                —
              </option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {t(`landing.contact.country.${c}`)}
                </option>
              ))}
            </select>
            {err('country')}
          </label>
          <label className="field">
            <span>{t('landing.contact.email')}</span>
            <input name="email" type="email" autoComplete="email" maxLength={MAX.email} value={form.email} onChange={(e) => set('email', e.target.value)} {...invalid('email')} />
            {err('email')}
          </label>
          <div className="field">
            <span id="inquiry-reach-label">
              {t('landing.contact.phone')} <em className="inquiry-optional">{t('landing.contact.optional')}</em>
            </span>
            <div className="inquiry-phone">
              <select aria-label={t('landing.contact.phoneKind')} value={form.reach_kind} onChange={(e) => set('reach_kind', e.target.value)}>
                {PHONE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`landing.contact.phoneKind.${k}`)}
                  </option>
                ))}
              </select>
              <input name="reach_value" aria-labelledby="inquiry-reach-label" maxLength={MAX.reach_value} value={form.reach_value} onChange={(e) => set('reach_value', e.target.value)} {...invalid('reach_value')} />
            </div>
            {err('reach_value')}
          </div>
        </div>

        {chips('wants', WANTS, (w) => `landing.contact.wants.${w}`, 'landing.contact.wants')}

        <label className="field">
          <span>
            {t('landing.contact.message')} <em className="inquiry-optional">{t('landing.contact.optional')}</em>
          </span>
          <textarea name="message" rows={3} maxLength={MAX.message} placeholder={t('landing.contact.messageHint')} value={form.message} onChange={(e) => set('message', e.target.value)} {...invalid('message')} />
          {err('message')}
        </label>

        {/* the honeypot: people never see or reach it; a bot that fills every field does */}
        <div className="inquiry-trap" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
          </label>
        </div>

        <div className="inquiry-consent">
          <label className="inquiry-check">
            <input type="checkbox" checked={form.consent_required} onChange={(e) => set('consent_required', e.target.checked)} {...invalid('consent_required')} />
            <span>{t('landing.contact.consent')}</span>
          </label>
          <details>
            <summary>{t('landing.contact.consentMore')}</summary>
            <p>{t('landing.contact.consentText')}</p>
            <Link to="/privacy" target="_blank" rel="noopener">
              {t('landing.contact.privacyLink')}
            </Link>
          </details>
          {err('consent_required')}
          {form.requests.includes('demo') && (
            <>
              <label className="inquiry-check">
                <input type="checkbox" checked={form.consent_demo} onChange={(e) => set('consent_demo', e.target.checked)} {...invalid('consent_demo')} />
                <span>{t('landing.apply.consent.demo')}</span>
              </label>
              {err('consent_demo')}
            </>
          )}
          <label className="inquiry-check">
            <input type="checkbox" checked={form.consent_news} onChange={(e) => set('consent_news', e.target.checked)} />
            <span>{t('landing.contact.newsletter')}</span>
          </label>
        </div>

        {turnstile && <Turnstile siteKey={turnstile.siteKey} onToken={setBotToken} />}

        {problem && (
          <p className="form-error" role="alert">
            {t(problem)}
          </p>
        )}
        <div className="inquiry-actions">
          <button className="btn is-primary" disabled={busy}>
            {busy ? t('common.wait') : t('landing.apply.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const InquiryContext = createContext<((how: OpenRequest) => void) | null>(null);

/** One request modal for the marketing pages; `useInquiry()(…)` opens it with its source. */
export function InquiryProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenRequest | null>(null);
  const show = useCallback((how: OpenRequest) => setOpen(how), []);
  const close = useCallback(() => setOpen(null), []);
  return (
    <InquiryContext.Provider value={show}>
      {children}
      {open && <InquiryModal onClose={close} source={open.source} requests={open.requests ?? ['demo']} />}
    </InquiryContext.Provider>
  );
}

export function useInquiry(): (how: OpenRequest) => void {
  const open = useContext(InquiryContext);
  if (!open) throw new Error('useInquiry outside InquiryProvider');
  return open;
}
