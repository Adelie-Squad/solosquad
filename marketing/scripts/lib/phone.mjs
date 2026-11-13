// The phone number on the request (2026-11-13): required with a demo account — its last four digits
// are half of the demo password (demo-password.mjs). One source of truth for the Worker, the CLI
// and the web, like company-no.mjs. Stored as digits only.
//
// Korean numbers (country kr) are shown with hyphens while typed:
//   mobile and other area codes  010-1234-5678 · 031-123-4567 (3-3-4 or 3-4-4)
//   Seoul                        02-123-4567 · 02-1234-5678
//   nationwide numbers           1588-1234
// and are 02 + 7–8 digits, 0X(X) + 8–9 digits (10–11 in all), or 15xx–19xx + 4.
// Other countries: digits only, 6–15 (a leading country code is allowed — it is just digits).

export const PHONE_MAX = { kr: 11, other: 15 };
export const PHONE_MIN_OTHER = 6;

export function phoneDigits(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(/\D/g, '');
}

export const phoneMax = (country) => (country === 'kr' ? PHONE_MAX.kr : PHONE_MAX.other);

/** head-NNN-NNNN while typing, head-NNNN-NNNN once `rest` is `full` digits long. */
const groups = (head, rest, full) => {
  if (!rest) return head;
  if (rest.length <= 3) return `${head}-${rest}`;
  if (rest.length < full) return `${head}-${rest.slice(0, 3)}-${rest.slice(3)}`;
  return `${head}-${rest.slice(0, 4)}-${rest.slice(4)}`;
};

/** How the number is shown while typed: Korean with hyphens (partial input as far as it goes), others plain. */
export function formatPhone(raw, country) {
  const d = phoneDigits(raw).slice(0, phoneMax(country));
  if (country !== 'kr') return d;
  if (d.startsWith('02')) return d.length <= 2 ? d : groups('02', d.slice(2), 8);
  if (d.startsWith('0')) return d.length <= 3 ? d : groups(d.slice(0, 3), d.slice(3), 8);
  if (/^1[5-9]/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4, 8)}`;
  return d;
}

const KOREAN = /^(?:02\d{7,8}|0[13-9]\d{8,9}|1[5-9]\d{6})$/;

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
  return digits.length >= PHONE_MIN_OTHER && digits.length <= PHONE_MAX.other ? { ok: true, digits } : { ok: false, error: 'invalid' };
}
