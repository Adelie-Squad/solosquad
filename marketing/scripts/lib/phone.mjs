// The phone number on the request (2026-11-13): required with a demo account — its last four digits
// are half of the demo password (demo-password.mjs). One source of truth for the Worker, the CLI
// and the web, like company-no.mjs.
//
// Since 2026-11-14 (user: "문의 받을 때 메신저 받지 말고 전화를 받고, 드롭다운에서 나라 +nn 선택하도록") the
// number comes with a country calling code picked from a short list (DIAL_CODES — +82 first) and is
// stored in E.164 (`+821012345678`): the national number with its leading trunk 0 dropped. "Other"
// (DIAL_OTHER) takes the whole international number, country code first. The national formats below
// still shape what is typed.
//
// Korean numbers (country kr) are shown with hyphens while typed:
//   mobile and other area codes  010-1234-5678 · 031-123-4567 (3-3-4 or 3-4-4)
//   Seoul                        02-123-4567 · 02-1234-5678
//   nationwide numbers           1588-1234
// and are 02 + 7–8 digits, 0X(X) + 8–9 digits (10–11 in all), or 15xx–19xx + 4.
// Chinese numbers (country cn, 2026-11-14): a mobile, 11 digits starting with 1, shown 1XX-XXXX-XXXX;
// a leading +86 / 0086 is taken off (a Chinese mobile never starts with 8 or 0, so it is never part
// of the number). Stored as the 11 digits.
// Other countries: digits only, 6–15 (a leading country code is allowed — it is just digits).

export const PHONE_MAX = { kr: 11, cn: 15, other: 15 };
export const PHONE_MIN_OTHER = 6;

export function phoneDigits(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(/\D/g, '');
}

export const phoneMax = (country) => PHONE_MAX[country] ?? PHONE_MAX.other;

/** A Chinese number without its country code (0086 · 86 in front), as far as it is typed. */
export function chinaLocal(digits) {
  if (digits.startsWith('0086')) return digits.slice(4);
  if (digits.startsWith('86')) return digits.slice(2);
  return digits;
}

/** head-NNN-NNNN while typing, head-NNNN-NNNN once `rest` is `full` digits long. */
const groups = (head, rest, full) => {
  if (!rest) return head;
  if (rest.length <= 3) return `${head}-${rest}`;
  if (rest.length < full) return `${head}-${rest.slice(0, 3)}-${rest.slice(3)}`;
  return `${head}-${rest.slice(0, 4)}-${rest.slice(4)}`;
};

/** 1XX-XXXX-XXXX as far as it goes. */
const chinaGroups = (d) => {
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
};

/** How the number is shown while typed: Korean and Chinese with hyphens (partial input as far as it goes), others plain. */
export function formatPhone(raw, country) {
  const d = phoneDigits(raw).slice(0, phoneMax(country));
  if (country === 'cn') {
    const local = chinaLocal(d);
    const prefix = local.length < d.length ? '+86 ' : '';
    return `${prefix}${chinaGroups(local.slice(0, 11))}`;
  }
  if (country !== 'kr') return d;
  if (d.startsWith('02')) return d.length <= 2 ? d : groups('02', d.slice(2), 8);
  if (d.startsWith('0')) return d.length <= 3 ? d : groups(d.slice(0, 3), d.slice(3), 8);
  if (/^1[5-9]/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4, 8)}`;
  return d;
}

const KOREAN = /^(?:02\d{7,8}|0[13-9]\d{8,9}|1[5-9]\d{6})$/;
const CHINESE_MOBILE = /^1\d{10}$/;

/**
 * → { ok: true, digits } or { ok: false, error: 'required' | 'invalid' }. Hyphens, spaces, dots,
 * brackets and a leading + may come with the digits in `raw`; nothing else.
 */
export function checkPhone(raw, country) {
  const text = typeof raw === 'string' ? raw.normalize('NFKC').trim() : '';
  if (!text) return { ok: false, error: 'required' };
  if (/[^\d\s\-+().]/.test(text)) return { ok: false, error: 'invalid' };
  const digits = text.replace(/\D/g, '');
  if (country === 'kr') return KOREAN.test(digits) ? { ok: true, digits } : { ok: false, error: 'invalid' };
  if (country === 'cn') {
    const local = chinaLocal(digits);
    return CHINESE_MOBILE.test(local) ? { ok: true, digits: local } : { ok: false, error: 'invalid' };
  }
  return digits.length >= PHONE_MIN_OTHER && digits.length <= PHONE_MAX.other ? { ok: true, digits } : { ok: false, error: 'invalid' };
}

// ── the country calling code (2026-11-14) ──────────────────────────────

/** The codes the request offers, in this order; +82 is the default. */
export const DIAL_CODES = ['82', '86', '81', '1', '84', '852', '886', '65'];
/** Any other country: the whole number, its country code first. */
export const DIAL_OTHER = 'other';

/** How long the national number is, by code (digits, without the trunk 0). */
const NATIONAL = { 1: [10, 10], 81: [9, 10], 84: [9, 10], 852: [8, 8], 886: [8, 9], 65: [8, 8] };

/** The code a company country starts the phone at (the dial follows the country until it is changed). */
export function dialForCountry(country) {
  if (country === 'kr') return '82';
  if (country === 'cn') return '86';
  return null;
}

export const isDial = (dial) => dial === DIAL_OTHER || DIAL_CODES.includes(dial);

/**
 * A Korean number as far as it is typed, with its leading 0 (the trunk prefix) — accepted with or
 * without it, and with an 82 in front when pasted whole. 15xx–19xx nationwide numbers keep no 0.
 */
export function koreaLocal(digits) {
  let d = digits;
  if (d.startsWith('82') && d.length > 2) d = d.slice(2);
  if (!d || d.startsWith('0') || /^1[5-9]/.test(d)) return d;
  return `0${d}`;
}

/** How many digits the number field takes for a code. */
export function dialMax(dial) {
  if (dial === '82') return 13;
  if (dial === '86') return 15;
  if (dial === DIAL_OTHER) return 15;
  const n = NATIONAL[dial];
  return n ? n[1] + 1 : 15;
}

/** How the number is shown while typed, for a code: Korean and Chinese with hyphens, others plain. */
export function formatDialPhone(raw, dial) {
  const d = phoneDigits(raw).slice(0, dialMax(dial));
  if (dial === '86') return formatPhone(chinaLocal(d), 'cn');
  if (dial === '82') {
    // shown as typed: with the 0 if it was typed, without if not
    if (!d || d.startsWith('0') || /^1[5-9]/.test(d) || d.startsWith('82')) return formatPhone(d.startsWith('82') ? koreaLocal(d) : d, 'kr');
    return formatPhone(`0${d}`, 'kr').slice(1);
  }
  return d;
}

/**
 * → { ok: true, e164 } or { ok: false, error: 'required' | 'invalid' }. Hyphens, spaces, dots,
 * brackets and a leading + may come with the digits in `raw`; nothing else. Korea: the Korean
 * rules (checkPhone), the 0 dropped; China: an 11-digit mobile; the other listed codes: the national
 * number's length, a leading 0 dropped; other: 8–15 digits, country code first (00 in front dropped).
 */
export function checkDialPhone(raw, dial) {
  const text = typeof raw === 'string' ? raw.normalize('NFKC').trim() : '';
  if (!text) return { ok: false, error: 'required' };
  if (/[^\d\s\-+().]/.test(text) || !isDial(dial)) return { ok: false, error: 'invalid' };
  const digits = text.replace(/\D/g, '');
  if (dial === '82') {
    const r = checkPhone(koreaLocal(digits), 'kr');
    return r.ok ? { ok: true, e164: `+82${r.digits.replace(/^0/, '')}` } : r;
  }
  if (dial === '86') {
    const r = checkPhone(digits, 'cn');
    return r.ok ? { ok: true, e164: `+86${r.digits}` } : r;
  }
  if (dial === DIAL_OTHER) {
    const d = digits.replace(/^00/, '');
    return d.length >= 8 && d.length <= 15 && !d.startsWith('0') ? { ok: true, e164: `+${d}` } : { ok: false, error: 'invalid' };
  }
  let national = digits.replace(/^0/, '');
  if (dial === '1' && national.length === 11 && national.startsWith('1')) national = national.slice(1);
  const [min, max] = NATIONAL[dial];
  return national.length >= min && national.length <= max ? { ok: true, e164: `+${dial}${national}` } : { ok: false, error: 'invalid' };
}

/** The code an E.164 number was stored with (the longest listed code it starts with), or other. */
export function dialOf(e164) {
  const d = phoneDigits(e164);
  const hit = [...DIAL_CODES].sort((a, b) => b.length - a.length).find((c) => d.startsWith(c));
  return hit ?? DIAL_OTHER;
}
