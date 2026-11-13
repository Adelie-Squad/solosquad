// The demo account request (decision 62, PRD §3.5.2 ⑥ + §3.6.3): a modal on the shared Modal
// frame, opened from the landing's last section and the demo login (and the pricing section once it
// exists), each with its `source`. Fields = §3.5.2 ⑥ + 요청 (demo · consult) + the company's
// registration number (one representative number — the demo login asks for it again, 2026-11-12)
// + the phone (required with a demo account — its last four digits are in the password) + the
// demo-usage consent when a demo account is asked for (DM6 ⓑ). The page checks them for
// convenience, the marketing Worker decides (POST /api/inquiry).
//
// Since 2026-11-13 the number and the phone are digits-only fields that put their hyphens in as
// they are typed (DigitsInput): a Korean company picks 개인사업자 (사업자등록번호, 10 digits,
// NNN-NN-NNNNN) or 법인 (법인등록번호, 13, NNNNNN-NNNNNNN) and the check digit is checked; another
// country's number is 4–20 digits. The rules are marketing/scripts/lib (company-no · phone) — the
// Worker and the CLI use the same files. A demo account comes back with the answer, and the
// completion screen shows it at once (number · ID · password · end) with a button to the demo login.
//
// Spam: a hidden honeypot field, a "form opened" token for the minimum fill time, and Turnstile
// only when the site turns it on.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useHref, useNavigate } from 'react-router-dom';
import { checkCompanyNo, displayCompanyNo, formatCompanyNo, maxDigits, type CompanyNoKind } from '../../../marketing/scripts/lib/company-no.mjs';
import { checkPhone, formatPhone, phoneMax } from '../../../marketing/scripts/lib/phone.mjs';
import { Modal } from '../components/Modal';
import { useI18n, type Locale, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { DigitsInput } from './DigitsInput';
import { formToken, sendInquiry, siteConfig, type FieldError, type IssuedDemo } from './siteApi';

const KINDS = ['retail', 'online', 'maker', 'service', 'partner', 'other'] as const;
const COUNTRIES = ['kr', 'cn', 'other'] as const;
const REQUESTS = ['demo', 'consult'] as const;
const WANTS = ['finance', 'sourcing', 'sns', 'other'] as const;
/** the messenger next to the phone (the phone itself is its own field since 2026-11-13) */
const MESSENGERS = ['kakao', 'wechat'] as const;
const KOREAN_KINDS = ['business', 'corporate'] as const;
const MAX = { company: 80, contact_name: 40, email: 254, reach_value: 60, message: 1000 };
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

type Want = (typeof WANTS)[number];
type KoreanKind = (typeof KOREAN_KINDS)[number];
export type Request = (typeof REQUESTS)[number];
export type Source = 'landing_hero' | 'landing_start' | 'pricing' | 'demo_login' | 'demo_app';

export interface Form {
  company: string;
  /** digits */
  company_no: string;
  /** 개인사업자 · 법인 — used when the country is kr */
  company_no_kind: KoreanKind;
  business_type: string;
  country: string;
  contact_name: string;
  email: string;
  /** digits */
  phone: string;
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
  company_no_kind: 'business',
  business_type: '',
  country: locale === 'zh-CN' ? 'cn' : locale === 'ko' ? 'kr' : '',
  contact_name: '',
  email: '',
  phone: '',
  reach_kind: locale === 'zh-CN' ? 'wechat' : 'kakao',
  reach_value: '',
  wants: [],
  requests,
  message: '',
  consent_required: false,
  consent_demo: false,
  consent_news: false,
  website: '',
});

/** The number's kind: a Korean company's pick, else another country's number. */
export const companyNoKind = (f: Pick<Form, 'country' | 'company_no_kind'>): CompanyNoKind => (f.country === 'kr' ? f.company_no_kind : 'foreign');

/** The same rules as the marketing Worker (marketing/src/validate.ts), for the marks before sending. */
export function checkInquiry(f: Form): Record<string, FieldError> {
  const out: Record<string, FieldError> = {};
  const text = (k: keyof typeof MAX, required: boolean) => {
    const v = f[k].trim();
    if (!v && required) out[k] = 'required';
    else if (v.length > MAX[k]) out[k] = 'too_long';
  };
  text('company', true);
  const no = checkCompanyNo(f.company_no, companyNoKind(f));
  if (!no.ok) out.company_no = no.error === 'required' ? 'required' : 'invalid';
  text('contact_name', true);
  text('email', true);
  if (f.email.trim() && !out.email && !EMAIL.test(f.email.trim())) out.email = 'invalid';
  if (f.phone) {
    if (!checkPhone(f.phone, f.country).ok) out.phone = 'invalid';
  } else if (f.requests.includes('demo')) out.phone = 'required';
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
  phone: { invalid: 'landing.contact.invalidPhone' },
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

/** What is wrong with the number as typed: its length for the kind, or its check digit. */
function companyNoMessage(f: Form, e: FieldError): MessageKey {
  if (e === 'required') return 'landing.contact.required';
  const kind = companyNoKind(f);
  const r = checkCompanyNo(f.company_no, kind);
  if (r.ok) return 'landing.contact.invalidCompanyNo';
  if (r.error === 'check') return 'landing.contact.companyNoCheck';
  return `landing.contact.companyNoLength.${kind}`;
}

const PLACEHOLDER: Record<CompanyNoKind, string> = { business: '123-45-67890', corporate: '123456-1234567', foreign: '' };
const PHONE_PLACEHOLDER = (country: string) => (country === 'kr' ? '010-1234-5678' : '');

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

/** What the demo login fills in when the completion screen sends someone there — never the password. */
export interface DemoPrefill {
  id: string;
  company_no: string;
}
export const DEMO_PREFILL_KEY = 'solosquad.demoPrefill';

export interface OpenRequest {
  source: Source;
  /** pre-checked 요청 — the demo login and the last section: a demo account; pricing: + a call */
  requests?: Request[];
}

/** The completion screen with the account just issued: shown once, the password only here. */
function Issued({ demo, form, onClose }: { demo: IssuedDemo; form: Form; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const root = useHref('/');
  const start = () => {
    const prefill: DemoPrefill = { id: demo.id, company_no: demo.company_no };
    try {
      sessionStorage.setItem(DEMO_PREFILL_KEY, JSON.stringify(prefill));
    } catch {
      // private mode: the login just starts empty
    }
    onClose();
    // the marketing pages share one router; the demo app (/demo/app) has its own
    if (root === '/') navigate('/demo', { state: prefill });
    else window.location.assign('/demo');
  };
  return (
    <div className="inquiry-done" role="status">
      <ICON.done size={28} className="inquiry-done-icon" />
      <h2>{t('landing.apply.done.demoTitle')}</h2>
      <p>{t(demo.reused ? 'landing.apply.done.demoAgain' : 'landing.apply.done.demoBody')}</p>
      <dl className="inquiry-summary inquiry-account" data-testid="inquiry-account">
        <dt>{t('landing.contact.companyNo')}</dt>
        <dd className="inquiry-mono">{displayCompanyNo(demo.company_no, demo.company_no_kind)}</dd>
        <dt>{t('auth.username')}</dt>
        <dd className="inquiry-mono">{demo.id}</dd>
        <dt>{t('auth.password')}</dt>
        <dd className="inquiry-mono">{demo.password}</dd>
        <dt>{t('landing.apply.done.until')}</dt>
        <dd>{t('landing.apply.done.untilValue', { date: fmt.date(Date.parse(demo.expires) / 1000) })}</dd>
      </dl>
      {form.requests.includes('consult') && <p>{t('landing.apply.done.consult')}</p>}
      <div className="inquiry-done-actions">
        <button type="button" className="btn is-primary" onClick={start} data-testid="inquiry-start-demo">
          {t('demo.login.submit')}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

function InquiryModal({ onClose, source, requests }: { onClose: () => void; source: Source; requests: Request[] }) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<Form>(() => blank(locale, requests));
  const [marks, setMarks] = useState<Record<string, FieldError>>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ form: Form; demo: IssuedDemo | null } | null>(null);
  const [turnstile, setTurnstile] = useState<{ siteKey: string } | null>(null);
  const [botToken, setBotToken] = useState('');
  // asked once when the form opens (not on every render — a keystroke re-renders)
  const token = useRef<Promise<string | null> | null>(null);
  token.current ??= formToken();

  useEffect(() => {
    siteConfig()
      .then((c) => c.turnstile.enabled && c.turnstile.site_key && setTurnstile({ siteKey: c.turnstile.site_key }))
      .catch(() => undefined);
  }, []);

  const unmark = (...names: string[]) =>
    setMarks((m) => {
      if (!names.some((n) => n in m)) return m;
      const next = { ...m };
      for (const n of names) delete next[n];
      return next;
    });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    unmark(k);
  };
  const toggle = <K extends 'wants' | 'requests'>(k: K, v: Form[K][number]) => {
    const list = form[k] as string[];
    set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]) as Form[K]);
  };
  // a new country or kind keeps the digits, cut to what the new kind takes
  const setNumberKind = (patch: Partial<Pick<Form, 'country' | 'company_no_kind'>>) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      return { ...next, company_no: next.company_no.slice(0, maxDigits(companyNoKind(next))), phone: next.phone.slice(0, phoneMax(next.country)) };
    });
    unmark('company_no', 'country', 'phone');
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
      company_no: form.company_no,
      company_no_kind: form.country === 'kr' ? form.company_no_kind : undefined,
      business_type: form.business_type,
      country: form.country,
      contact_name: form.contact_name.trim(),
      email: form.email.trim(),
      phone: form.phone || undefined,
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
      setDone({ form, demo: res.demo });
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

  const err = (name: string, message?: MessageKey) =>
    marks[name] ? (
      <small className="inquiry-error" id={`inquiry-${name}-error`}>
        {t(message ?? fieldMessage(name, marks[name]))}
      </small>
    ) : null;
  const invalid = (name: string) => (marks[name] ? { 'aria-invalid': true as const, 'aria-describedby': `inquiry-${name}-error` } : {});

  if (done) {
    return (
      <Modal label={t(done.demo ? 'landing.apply.done.demoTitle' : 'landing.apply.done.title')} onClose={onClose} className="inquiry-modal">
        {done.demo ? (
          <Issued demo={done.demo} form={done.form} onClose={onClose} />
        ) : (
          <div className="inquiry-done" role="status">
            <ICON.done size={28} className="inquiry-done-icon" />
            <h2>{t('landing.apply.done.title')}</h2>
            <p>{t('landing.apply.done.body')}</p>
            <dl className="inquiry-summary">
              <dt>{t('landing.contact.company')}</dt>
              <dd>{done.form.company.trim()}</dd>
              <dt>{t('landing.contact.companyNo')}</dt>
              <dd>{formatCompanyNo(done.form.company_no, companyNoKind(done.form))}</dd>
              <dt>{t('landing.apply.requests')}</dt>
              <dd>{done.form.requests.map((r) => t(`landing.apply.requests.${r}`)).join(' · ')}</dd>
              <dt>{t('landing.contact.wants')}</dt>
              <dd>{done.form.wants.map((w) => t(`landing.contact.wants.${w}`)).join(' · ')}</dd>
            </dl>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        )}
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

  const kind = companyNoKind(form);
  const wantsDemo = form.requests.includes('demo');

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
            <span>{t('landing.contact.country')}</span>
            <select name="country" value={form.country} onChange={(e) => setNumberKind({ country: e.target.value })} {...invalid('country')}>
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
          <div className="field inquiry-company-no">
            <label htmlFor="inquiry-company-no">{t('landing.contact.companyNo')}</label>
            {form.country === 'kr' && (
              <div className="segmented" role="radiogroup" aria-label={t('landing.contact.companyNoKind')} data-testid="company-no-kind">
                {KOREAN_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={form.company_no_kind === k}
                    className={form.company_no_kind === k ? 'is-active' : ''}
                    onClick={() => setNumberKind({ company_no_kind: k })}
                  >
                    {t(`landing.contact.companyNoKind.${k}`)}
                  </button>
                ))}
              </div>
            )}
            <small id="inquiry-company-no-hint">{t(`landing.contact.companyNoHint.${kind}`)}</small>
            <DigitsInput
              id="inquiry-company-no"
              name="company_no"
              value={form.company_no}
              onDigits={(d) => set('company_no', d)}
              format={(d) => formatCompanyNo(d, kind)}
              max={maxDigits(kind)}
              placeholder={PLACEHOLDER[kind]}
              aria-describedby={marks.company_no ? 'inquiry-company_no-error' : 'inquiry-company-no-hint'}
              {...(marks.company_no ? { 'aria-invalid': true as const } : {})}
            />
            {marks.company_no && err('company_no', companyNoMessage(form, marks.company_no))}
          </div>
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
            <span>{t('landing.contact.email')}</span>
            {wantsDemo && <small>{t('landing.contact.emailHint')}</small>}
            <input name="email" type="email" autoComplete="email" maxLength={MAX.email} value={form.email} onChange={(e) => set('email', e.target.value)} {...invalid('email')} />
            {err('email')}
          </label>
          <div className="field">
            <label htmlFor="inquiry-phone">
              {t('landing.contact.phoneNumber')}
              {!wantsDemo && (
                <>
                  {' '}
                  <em className="inquiry-optional">{t('landing.contact.optional')}</em>
                </>
              )}
            </label>
            {wantsDemo && <small id="inquiry-phone-hint">{t('landing.contact.phoneHint')}</small>}
            <DigitsInput
              id="inquiry-phone"
              name="phone"
              autoComplete="tel"
              value={form.phone}
              onDigits={(d) => set('phone', d)}
              format={(d) => formatPhone(d, form.country)}
              max={phoneMax(form.country)}
              placeholder={PHONE_PLACEHOLDER(form.country)}
              aria-describedby={marks.phone ? 'inquiry-phone-error' : wantsDemo ? 'inquiry-phone-hint' : undefined}
              {...(marks.phone ? { 'aria-invalid': true as const } : {})}
            />
            {err('phone')}
          </div>
          <div className="field">
            <span id="inquiry-reach-label">
              {t('landing.contact.messenger')} <em className="inquiry-optional">{t('landing.contact.optional')}</em>
            </span>
            <div className="inquiry-phone">
              <select aria-label={t('landing.contact.phoneKind')} value={form.reach_kind} onChange={(e) => set('reach_kind', e.target.value)}>
                {MESSENGERS.map((k) => (
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
          {wantsDemo && (
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
