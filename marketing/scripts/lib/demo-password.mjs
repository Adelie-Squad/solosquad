// The demo account's password (2026-11-13, the owner's rule): an easy English word for the first
// letter of the email, then the last four digits of the phone number on the request.
//   abc123@gmail.com + 010-1234-5678 → apple5678
// The letter is the email's first character when it is a-z (any case); else the first a-z letter
// anywhere in the email; else there is none and the word is "squad". One source of truth for the
// Worker (auto-issue on POST /api/inquiry), the CLI (`issue`) and the docs (README). Only the
// PBKDF2 hash is stored (password.mjs); the plain password goes back once, to the browser that sent
// the request.

export const WORDS = {
  a: 'apple',
  b: 'banana',
  c: 'cat',
  d: 'dog',
  e: 'egg',
  f: 'fish',
  g: 'grape',
  h: 'house',
  i: 'ice',
  j: 'juice',
  k: 'kite',
  l: 'lemon',
  m: 'moon',
  n: 'nest',
  o: 'orange',
  p: 'penguin',
  q: 'queen',
  r: 'river',
  s: 'squad',
  t: 'tiger',
  u: 'umbrella',
  v: 'violin',
  w: 'water',
  x: 'xray',
  y: 'yellow',
  z: 'zebra',
};

export const FALLBACK_WORD = 'squad';

/** The word for an email: its first letter's, else the first a-z letter found, else "squad". */
export function wordFor(email) {
  const text = String(email ?? '').toLowerCase();
  const letter = /^[a-z]/.test(text) ? text[0] : (/[a-z]/.exec(text)?.[0] ?? null);
  return letter ? WORDS[letter] : FALLBACK_WORD;
}

/** word + the last four digits of the phone; null when the phone has fewer than four digits. */
export function demoPassword(email, phone) {
  const digits = String(phone ?? '').normalize('NFKC').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `${wordFor(email)}${digits.slice(-4)}`;
}
