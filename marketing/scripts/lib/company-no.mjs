// The company's registration number (2026-11-12, digits only since 2026-11-13, China 2026-11-14).
// One source of truth for the Worker (src/validate.ts · src/demo.ts), the agency CLI
// (scripts/inquiry.mjs) and the web (the request modal and the demo login import this file) — plain
// JS so Node runs it as is.
//
// The country picks the kind (country → kind: kr → business | corporate, cn → uscc, other → foreign):
//   business   Korean 사업자등록번호, 10 digits, shown NNN-NN-NNNNN. Check digit: weights
//              1,3,7,1,3,7,1,3,5 on the first nine digits, plus floor(9th digit × 5 / 10); the
//              10th digit = (10 − sum mod 10) mod 10.
//   corporate  Korean 법인등록번호, 13 digits, shown NNNNNN-NNNNNNN. Check digit: weights
//              1,2,1,2,… on the first twelve digits; the 13th = (10 − sum mod 10) mod 10.
//   uscc       China's 统一社会信用代码 (GB 32100-2015), 18 characters from the 31-character
//              alphabet 0-9 A-H J-N P-R T U W-Y (no I, O, Z, S, V); the 18th is a check character:
//              weights 1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28 on the first seventeen
//              (each as its index in the alphabet), check = (31 − sum mod 31) mod 31. Shown plain.
//   foreign    another country's number: 4–20 letters and digits (upper-cased), no check.
// The stored value is the normalised code: digits for the Korean kinds, upper-case letters and
// digits otherwise (with the kind). Internal accounts (the agency's own) skip the checks: any 4–20
// digits.

export const COMPANY_NO_KINDS = ['business', 'corporate', 'uscc', 'foreign'];
export const KOREAN_KINDS = ['business', 'corporate'];
export const LENGTH = { business: 10, corporate: 13, uscc: 18 };
export const FOREIGN_MIN = 4;
export const MAX_DIGITS = 20;

/** Only the digits of `raw` (full-width digits count; everything else is dropped). */
export function digitsOf(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(/\D/g, '');
}

/** Letters and digits only, upper-cased (full-width ones count) — how numbers are compared. */
export function codeOf(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** The kind for a country: Korea's pick (business by default), China's code, or another country's. */
export function kindForCountry(country, koreanKind) {
  if (country === 'kr') return koreanKind === 'corporate' ? 'corporate' : 'business';
  if (country === 'cn') return 'uscc';
  return 'foreign';
}

/** Whether the field for `kind` takes letters (China's code, another country's number). */
export const takesLetters = (kind) => kind === 'uscc' || kind === 'foreign';

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

export const USCC_ALPHABET = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

/** The check character for the first seventeen characters of a 统一社会信用代码 (null if one is not in the alphabet). */
export function usccCheckChar(first17) {
  if (typeof first17 !== 'string' || first17.length !== 17) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = USCC_ALPHABET.indexOf(first17[i]);
    if (v < 0) return null;
    sum += v * USCC_WEIGHTS[i];
  }
  return USCC_ALPHABET[(31 - (sum % 31)) % 31];
}

/** A 统一社会信用代码 whose characters and check character are right (18, upper case). */
export function usccOk(code) {
  if (typeof code !== 'string' || code.length !== 18) return false;
  return usccCheckChar(code.slice(0, 17)) === code[17];
}

/** How a number of `kind` is shown while it is typed (partial input is formatted as far as it goes). */
export function formatCompanyNo(raw, kind) {
  if (kind === 'uscc') return codeOf(raw).slice(0, LENGTH.uscc);
  if (kind === 'foreign') return codeOf(raw).slice(0, MAX_DIGITS);
  const d = digitsOf(raw);
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

/** The demo login's Korean field (no kind there): 10 digits → 3-2-5, 13 → 6-7, any other length plain. */
export function formatByLength(digits) {
  const d = digitsOf(digits).slice(0, MAX_DIGITS);
  if (d.length === 10) return formatCompanyNo(d, 'business');
  if (d.length === 13) return formatCompanyNo(d, 'corporate');
  return d;
}

/** The most characters a field of `kind` takes. */
export const maxDigits = (kind) => LENGTH[kind] ?? MAX_DIGITS;

/**
 * Check a typed number. `kind` = business · corporate (a Korean company), uscc (a Chinese one),
 * anything else means another country's. `raw` may carry hyphens and spaces besides the number.
 * → { ok: true, digits, kind } (`digits` = the normalised code — digits for the Korean kinds) or
 * { ok: false, error: 'required' | 'invalid' | 'length' | 'check' }.
 */
export function checkCompanyNo(raw, kind, { internal = false } = {}) {
  const text = typeof raw === 'string' ? raw.normalize('NFKC').trim() : '';
  if (!text) return { ok: false, error: 'required' };
  if (internal || kind === 'business' || kind === 'corporate') {
    if (/[^\d\s-]/.test(text)) return { ok: false, error: 'invalid' };
    const digits = text.replace(/\D/g, '');
    if (internal) return digits.length >= FOREIGN_MIN && digits.length <= MAX_DIGITS ? { ok: true, digits, kind: 'foreign' } : { ok: false, error: 'length' };
    if (digits.length !== LENGTH[kind]) return { ok: false, error: 'length' };
    const right = kind === 'business' ? businessNoOk(digits) : corporateNoOk(digits);
    return right ? { ok: true, digits, kind } : { ok: false, error: 'check' };
  }
  if (/[^0-9A-Za-z\s-]/.test(text)) return { ok: false, error: 'invalid' };
  const code = codeOf(text);
  if (kind === 'uscc') {
    if (code.length !== LENGTH.uscc) return { ok: false, error: 'length' };
    return usccOk(code) ? { ok: true, digits: code, kind: 'uscc' } : { ok: false, error: 'check' };
  }
  return code.length >= FOREIGN_MIN && code.length <= MAX_DIGITS ? { ok: true, digits: code, kind: 'foreign' } : { ok: false, error: 'length' };
}

/** The kind a Korean number of this many digits most likely is (old clients sent no kind). */
export const kindByLength = (digits) => (digits.length === 13 ? 'corporate' : 'business');

/** The stored number as people read it: the Korean kinds with their hyphens, the rest plain. */
export function displayCompanyNo(digits, kind) {
  if (typeof digits !== 'string') return '';
  // China's code, another country's number, and rows from before 2026-11-13 may hold letters
  if (/[^\d]/.test(digits)) return digits;
  if (kind === 'business' || kind === 'corporate') return formatCompanyNo(digits, kind);
  return kind ? digitsOf(digits) : formatByLength(digits);
}
