// The demo account request (PRD §3.5.2 ⑥ + §3.6.3, decision 62). The modal checks the same rules
// for convenience; this is the one that counts.

export const BUSINESS_TYPES = ['retail', 'online', 'maker', 'service', 'partner', 'other'] as const;
export const COUNTRIES = ['kr', 'cn', 'other'] as const;
export const WANTS = ['finance', 'sourcing', 'sns', 'other'] as const;
export const REQUESTS = ['demo', 'consult'] as const;
export const REACH_KINDS = ['phone', 'kakao', 'wechat'] as const;
export const LOCALES = ['ko', 'en', 'zh-CN'] as const;
export const SOURCES = ['landing_hero', 'landing_start', 'pricing', 'demo_login'] as const;

export const MAX = { company: 80, contact_name: 40, email: 254, reach_value: 60, message: 1000 } as const;

export type FieldError = 'required' | 'too_long' | 'invalid';

export interface Inquiry {
  company: string;
  business_type: (typeof BUSINESS_TYPES)[number];
  country: (typeof COUNTRIES)[number];
  contact_name: string;
  email: string;
  reach_kind: (typeof REACH_KINDS)[number] | null;
  reach_value: string | null;
  wants: (typeof WANTS)[number][];
  requests: (typeof REQUESTS)[number][];
  message: string | null;
  consent_demo: boolean;
  consent_news: boolean;
  locale: (typeof LOCALES)[number];
  source: (typeof SOURCES)[number];
}

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const text = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
const oneOf = <T extends readonly string[]>(list: T, v: unknown): T[number] | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T[number]) : null);

function many<T extends readonly string[]>(list: T, v: unknown, name: string, fields: Record<string, FieldError>): T[number][] {
  const raw = Array.isArray(v) ? v : [];
  const picked = [...new Set(raw.map((w) => oneOf(list, w)))];
  if (!raw.length) fields[name] = 'required';
  else if (picked.includes(null) || raw.length > list.length) fields[name] = 'invalid';
  return picked.filter((p): p is T[number] => p !== null);
}

export function validateInquiry(body: Record<string, unknown>): { ok: true; value: Inquiry } | { ok: false; fields: Record<string, FieldError> } {
  const fields: Record<string, FieldError> = {};
  const need = (name: keyof typeof MAX, required: boolean) => {
    const v = text(body[name]);
    if (!v) {
      if (required) fields[name] = 'required';
      return '';
    }
    if (v.length > MAX[name]) fields[name] = 'too_long';
    else if (name !== 'message' && CONTROL.test(v)) fields[name] = 'invalid';
    return v;
  };

  const company = need('company', true);
  const contactName = need('contact_name', true);
  const email = need('email', true);
  if (email && !fields.email && !EMAIL.test(email)) fields.email = 'invalid';
  const reachValue = need('reach_value', false);
  const message = need('message', false);

  const businessType = oneOf(BUSINESS_TYPES, body.business_type);
  if (!businessType) fields.business_type = body.business_type ? 'invalid' : 'required';
  const country = oneOf(COUNTRIES, body.country);
  if (!country) fields.country = body.country ? 'invalid' : 'required';
  const reachKind = reachValue ? oneOf(REACH_KINDS, body.reach_kind ?? 'phone') : null;
  if (reachValue && !reachKind) fields.reach_kind = 'invalid';

  const wants = many(WANTS, body.wants, 'wants', fields);
  const requests = many(REQUESTS, body.requests, 'requests', fields);

  if (body.consent_required !== true) fields.consent_required = 'required';
  // DM6 ⓑ: asking for a demo account also needs the demo-usage consent
  if (requests.includes('demo') && body.consent_demo !== true) fields.consent_demo = 'required';

  const locale = oneOf(LOCALES, body.locale);
  if (!locale) fields.locale = 'invalid';
  const source = oneOf(SOURCES, body.source);
  if (!source) fields.source = 'invalid';

  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    value: {
      company,
      business_type: businessType!,
      country: country!,
      contact_name: contactName,
      email: email.toLowerCase(),
      reach_kind: reachKind,
      reach_value: reachValue || null,
      wants,
      requests,
      message: message || null,
      consent_demo: requests.includes('demo'),
      consent_news: body.consent_news === true,
      locale: locale!,
      source: source!,
    },
  };
}
