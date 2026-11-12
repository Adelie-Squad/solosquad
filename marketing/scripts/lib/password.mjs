// Demo account passwords (2026-11-13): PBKDF2-SHA256 with a per-account 16-byte salt, through
// WebCrypto only — so the Worker (workerd) and the agency CLI (Node) share this one file. Workers
// accept at most 100 000 PBKDF2 iterations, so that is the count; a 16-character random password
// (≈ 92 bits) is what carries the strength. Stored as `pbkdf2-sha256$<iterations>$<salt>$<hash>`
// (base64url).

export const ITERATIONS = 100_000;
const enc = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const unb64url = (text) => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password, { iterations = ITERATIONS, salt = crypto.getRandomValues(new Uint8Array(16)) } = {}) {
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await derive(password, salt, iterations))}`;
}

/** true when `password` is the one `stored` was made from. A malformed `stored` is false. */
export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored ?? '').split('$');
  const iterations = Number(iter);
  if (alg !== 'pbkdf2-sha256' || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > ITERATIONS || !salt || !hash) return false;
  let want;
  let got;
  try {
    want = unb64url(hash);
    got = await derive(String(password ?? ''), unb64url(salt), iterations);
  } catch {
    return false;
  }
  if (want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want[i] ^ got[i];
  return diff === 0;
}

/** A stored hash nobody's password matches — verified against when there is no such account, so a
 * wrong ID costs the same as a wrong password. */
export const DUMMY_HASH = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 16 characters without look-alikes (0 O 1 l I) — printed once by the CLI, only its hash is kept. */
export function newPassword(length = 16) {
  const out = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('');
}
