// POST /api/login/route — the marketing login router (PRD §3.6.2, decision 62 · DM5). A plain
// form post {code, id}, so it works without JavaScript; the answer is always a 303:
//   a known active customer code → https://<company server>/login?u=<id> (the ID as typed — never
//     prefixed with the code, never looked at beyond length and characters, never stored)
//   the reserved code "demo"      → /demo?u=<id>
//   anything else (unknown · suspended · malformed · over the limit) → /login/help, the neutral page
// Every answer runs the same D1 lookup and is padded to the same time. No password ever comes here.
import { num, type Env } from './env';
import { ipHash, sleep, withinLimit } from './http';

export const HELP = '/login/help';
export const DEMO = '/demo';
const MAX_ID = 120;

/** a-z 0-9, 3–20 characters; typed in any case. */
export const CODE = /^[a-z0-9]{3,20}$/;

/** "demo" and codes ending in "demo" are never given to a company (demo IDs are `<slug>Demo`). */
export const reservedCode = (code: string) => code.endsWith('demo');

export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.normalize('NFKC').trim().toLowerCase();
  return CODE.test(code) ? code : null;
}

/** The ID as typed (trimmed) when a login field could hold it: 1–120 characters, no spaces or controls. */
export function passableId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.normalize('NFC').trim();
  // eslint-disable-next-line no-control-regex
  if (!id || id.length > MAX_ID || /[\s\u0000-\u001f\u007f<>"'`]/.test(id)) return null;
  return id;
}

interface RouteRow {
  kind: 'customer' | 'demo';
  server_url: string;
  status: 'active' | 'suspended';
}

export const customerLogin = (server: string, id: string) => `${server.replace(/\/+$/, '')}/login?u=${encodeURIComponent(id)}`;

/** Where a {code, id} pair goes (a path on this site or a company server's login). */
export function destination(row: RouteRow | null, code: string | null, id: string | null): string {
  if (!row || !code || !id || row.status !== 'active') return HELP;
  if (row.kind === 'demo') return code === 'demo' ? `${DEMO}?u=${encodeURIComponent(id)}` : HELP;
  if (reservedCode(code)) return HELP;
  return customerLogin(row.server_url, id);
}

const seeOther = (location: string, url: URL) =>
  new Response(null, {
    status: 303,
    headers: { location: location.startsWith('/') ? new URL(location, url).toString() : location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });

async function formFields(req: Request): Promise<{ code: unknown; id: unknown }> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('multipart/form-data')) return { code: null, id: null };
  const body = await req.text();
  if (body.length > 2048) return { code: null, id: null };
  const form = new URLSearchParams(body);
  return { code: form.get('code'), id: form.get('id') };
}

export async function postRoute(req: Request, env: Env): Promise<Response> {
  const started = Date.now();
  const url = new URL(req.url);
  const ip = await ipHash(req, env);
  const [perMin, perHour] = await Promise.all([
    withinLimit(env.DB, `route-min:${ip}`, 60, num(env.ROUTE_LIMIT_PER_MIN, 10)),
    withinLimit(env.DB, `route-hour:${ip}`, 3600, num(env.ROUTE_LIMIT_PER_HOUR, 60)),
  ]);
  const fields = await formFields(req);
  const code = perMin && perHour ? normaliseCode(fields.code) : null;
  const id = passableId(fields.id);
  // the lookup runs whatever came in, so every answer costs the same
  const row = await env.DB.prepare('SELECT kind, server_url, status FROM login_routes WHERE code = ?1').bind(code ?? '').first<RouteRow>();
  const to = destination(row, code, id);
  const left = num(env.ROUTE_PAD_MS, 250) - (Date.now() - started);
  if (left > 0) await sleep(left);
  return seeOther(to, url);
}
