// The company's registration number (2026-11-12, digits only since 2026-11-13). One source of truth
// for the Worker (src/validate.ts · src/demo.ts), the agency CLI (scripts/inquiry.mjs) and the web
// (the request modal and the demo login import this file) — plain JS so Node runs it as is.
//
// Kinds:
//   business   Korean 사업자등록번호, 10 digits, shown NNN-NN-NNNNN. Check digit: weights
//              1,3,7,1,3,7,1,3,5 on the first nine digits, plus floor(9th digit × 5 / 10); the
//              10th digit = (10 − sum mod 10) mod 10.
//   corporate  Korean 법인등록번호, 13 digits, shown NNNNNN-NNNNNNN. Check digit: weights
//              1,2,1,2,… on the first twelve digits; the 13th = (10 − sum mod 10) mod 10.
//   foreign    another country's number: 4–20 digits, no hyphens, no check digit.
// Only the digits are stored (with the kind). Internal accounts (the agency's own) skip the check
// digit: any 4–20 digits.

export const COMPANY_NO_KINDS = ['business', 'corporate', 'foreign'];
export const KOREAN_KINDS = ['business', 'corporate'];
export const LENGTH = { business: 10, corporate: 13 };
export const FOREIGN_MIN = 4;
export const MAX_DIGITS = 20;

/** Only the digits of `raw` (full-width digits count; everything else is dropped). */
export function digitsOf(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(/\D/g, '');
}

const BUSINESS_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

/** A 사업자등록번호 whose check digit is right (10 digits). */
export function businessNoOk(digits) {
  if (!/^\d{10}$/.test(digits ?? '')) return false;
  const d = [...digits].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * BUSINESS_WEIGHTS[i];
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

/** A 법인등록번호 whose check digit is right (13 digits). */
export function corporateNoOk(digits) {
  if (!/^\d{13}$/.test(digits ?? '')) return false;
  const d = [...digits].map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 === 0 ? 1 : 2);
  return (10 - (sum % 10)) % 10 === d[12];
}

/** How a number of `kind` is shown while it is typed (partial input is formatted as far as it goes). */
export function formatCompanyNo(digits, kind) {
  const d = digitsOf(digits);
  if (kind === 'business') {
    const s = d.slice(0, 10);
    if (s.length <= 3) return s;
    if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
    return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`;
  }
  if (kind === 'corporate') {
    const s = d.slice(0, 13);
    return s.length <= 6 ? s : `${s.slice(0, 6)}-${s.slice(6)}`;
  }
  return d.slice(0, MAX_DIGITS);
}

/** The demo login's field (no kind there): 10 digits → 3-2-5, 13 → 6-7, any other length plain. */
export function formatByLength(digits) {
  const d = digitsOf(digits).slice(0, MAX_DIGITS);
  if (d.length === 10) return formatCompanyNo(d, 'business');
  if (d.length === 13) return formatCompanyNo(d, 'corporate');
  return d;
}

/** The most digits a field of `kind` takes. */
export const maxDigits = (kind) => LENGTH[kind] ?? MAX_DIGITS;

/**
 * Check a typed number. `kind` is business · corporate for a Korean company (country kr), anything
 * else means foreign. `raw` may carry the hyphens the field shows (and spaces), nothing else.
 * → { ok: true, digits, kind } or { ok: false, error: 'required' | 'invalid' | 'length' | 'check' }.
 */
export function checkCompanyNo(raw, kind, { internal = false } = {}) {
  const text = typeof raw === 'string' ? raw.normalize('NFKC').trim() : '';
  if (!text) return { ok: false, error: 'required' };
  if (/[^\d\s-]/.test(text)) return { ok: false, error: 'invalid' };
  const digits = text.replace(/\D/g, '');
  if (internal) return digits.length >= FOREIGN_MIN && digits.length <= MAX_DIGITS ? { ok: true, digits, kind: 'foreign' } : { ok: false, error: 'length' };
  if (kind === 'business' || kind === 'corporate') {
    if (digits.length !== LENGTH[kind]) return { ok: false, error: 'length' };
    const right = kind === 'business' ? businessNoOk(digits) : corporateNoOk(digits);
    return right ? { ok: true, digits, kind } : { ok: false, error: 'check' };
  }
  return digits.length >= FOREIGN_MIN && digits.length <= MAX_DIGITS ? { ok: true, digits, kind: 'foreign' } : { ok: false, error: 'length' };
}

/** The kind a Korean number of this many digits most likely is (old clients sent no kind). */
export const kindByLength = (digits) => (digits.length === 13 ? 'corporate' : 'business');

/** The stored number as people read it: the Korean kinds with their hyphens, the rest plain. */
export function displayCompanyNo(digits, kind) {
  if (typeof digits !== 'string') return '';
  // rows from before 2026-11-13 may hold letters (another country's number, upper-cased)
  if (/[^\d]/.test(digits)) return digits;
  if (kind === 'business' || kind === 'corporate') return formatCompanyNo(digits, kind);
  return kind ? digitsOf(digits) : formatByLength(digits);
}
