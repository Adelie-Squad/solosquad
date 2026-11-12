// Demo IDs (PRD §3.6.3, decision 62): `<slug>Demo`, e.g. `samsungDemo`, issued after review and
// tied to the inquiry. The slug comes from the company name, else the applicant's name:
// - Latin letters stay as they are.
// - Hangul is romanised by the Revised Romanization, letter by letter (삼성 → samseong). A brand
//   spelling like `samsung` is the reviewer's `--slug`.
// - Chinese becomes toneless pinyin (华为 → huawei).
// Legal-form words are dropped. The slug is a-z 0-9 and 3–16 long; longer names keep their first word,
// else the first 16 letters. A taken ID gets 2, 3, … after `Demo`.
import { pinyin } from 'pinyin-pro';

const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

/** Hangul syllables → Latin letters (each syllable its own word); other characters stay. */
export function romaniseHangul(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      out += ch;
      continue;
    }
    out += INITIAL[Math.floor(code / 588)] + MEDIAL[Math.floor((code % 588) / 28)] + FINAL[code % 28];
  }
  return out;
}

const HAN = /\p{Script=Han}/u;

/** Han characters → toneless pinyin, the words of one run joined (华为 → huawei). */
export function pinyinOf(text) {
  return text.replace(/\p{Script=Han}+/gu, (run) => ` ${pinyin(run, { toneType: 'none', type: 'array' }).join('')} `);
}

// legal-form words that do not say which company it is
const SUFFIXES = [
  /주식회사|유한책임회사|유한회사|합자회사|합명회사|\(주\)|㈜|\(유\)/g,
  /股份有限公司|有限责任公司|有限公司|集团|公司/g,
  /\b(co|corp|corporation|inc|incorporated|ltd|limited|llc|plc|gmbh|company)\b\.?/gi,
];

export const SLUG = /^[a-z][a-z0-9]{2,15}$/;
const MAX = 16;

/** A slug for a name, or null when none can be made (no letters left, or under 3). */
export function slugFrom(name) {
  if (!name) return null;
  let s = String(name).normalize('NFKC');
  for (const re of SUFFIXES) s = s.replace(re, ' ');
  s = pinyinOf(romaniseHangul(s));
  // letters we cannot spell in Latin (kana, Cyrillic, …) are the reviewer's call
  if (/\p{L}/u.test(s.replace(/[A-Za-z]/g, ''))) return null;
  const words = s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return null;
  let slug = words.join('');
  if (slug.length > MAX) slug = words[0].length >= 3 && words[0].length <= MAX ? words[0] : slug.slice(0, MAX);
  slug = slug.replace(/^[0-9]+/, '');
  return SLUG.test(slug) ? slug : null;
}

export const hasHan = (s) => HAN.test(s ?? '');

export const demoIdFor = (slug, n = 1) => `${slug}Demo${n > 1 ? n : ''}`;

/** The first `<slug>Demo`, `<slug>Demo2`, … not in `taken` (compared without case — logins ignore case). */
export function nextDemoId(slug, taken) {
  const used = new Set([...taken].map((t) => String(t).toLowerCase()));
  for (let n = 1; ; n++) {
    const id = demoIdFor(slug, n);
    if (!used.has(id.toLowerCase())) return id;
  }
}
