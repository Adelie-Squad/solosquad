// The company's registration number (2026-11-12), the scripts' copy of src/validate.ts
// `normalizeCompanyNo` (the scripts run in plain Node, without the Worker's TypeScript; a test
// keeps the two the same): a Korean 사업자등록번호 or 법인등록번호 → its 10 or 13 digits, another
// country's number → 4–30 letters, digits and dashes, upper-cased. → the stored form, or null.
export function normalizeCompanyNo(raw, country) {
  if (typeof raw !== 'string') return null;
  const text = raw.normalize('NFKC').trim();
  const digits = text.replace(/[\s-]/g, '');
  if (/^(?:\d{10}|\d{13})$/.test(digits)) return digits;
  if (country === 'kr') return null;
  const other = text.toUpperCase();
  return /^[A-Z0-9-]{4,30}$/.test(other) ? other : null;
}
