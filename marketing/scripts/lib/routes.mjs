// What `route add` accepts (PRD §3.6.2): the company code and the company server. The same code
// rules as the Worker's src/route.ts.

export const CODE = /^[a-z0-9]{3,20}$/;

/** { ok, code } or { ok: false, error } — "demo" and "…demo" are reserved for the demo login. */
export function checkCode(raw) {
  const code = String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  if (!CODE.test(code)) return { ok: false, error: 'a company code is 3–20 letters a-z or digits' };
  if (code.endsWith('demo')) return { ok: false, error: `"${code}" is reserved: "demo" and codes ending in "demo" belong to the demo login` };
  return { ok: true, code };
}

/** https://host (no path, query, user or fragment); http://localhost · 127.0.0.1 only with allowLocal. */
export function checkServer(raw, { allowLocal = false } = {}) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return { ok: false, error: 'not a URL' };
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!(u.protocol === 'https:' || (allowLocal && local && u.protocol === 'http:'))) return { ok: false, error: 'the company server must be https://' };
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return { ok: false, error: 'only the origin: https://office.example.com' };
  return { ok: true, url: u.origin };
}
