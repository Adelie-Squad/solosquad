// POST /api/inquiry — a demo account request (PRD §3.6.3, decision 62). Stored in D1 `inquiries`
// (status new) with one `inquiry_log` "created" row. Spam protection, all judged here: a honeypot
// field (filled → answered as received, never stored), a minimum fill time (a signed "form opened"
// token from GET /api/form-token), a per-IP hourly limit, three per email a day, and Turnstile only
// when TURNSTILE_ENABLED (off by default — it does not load from mainland China; review is the real
// gate). Neither the IP nor the user-agent is stored with the inquiry.
import { num, turnstileOn, type Env } from './env';
import { hmac, ipHash, iso, json, readJson, sameSecret, ulid, withinLimit } from './http';
import { validateInquiry } from './validate';

const TOKEN_MAX_AGE_MS = 24 * 3600 * 1000;
const HONEYPOT = 'website';

const secret = (env: Env) => env.FORM_SECRET || 'solosquad-marketing-dev-form-secret';

/** `<opened ms>.<hmac>` — proves when the form was opened without a session. */
export async function formToken(env: Env, now = Date.now()): Promise<string> {
  return `${now}.${await hmac(secret(env), `form:${now}`)}`;
}

/** When the form was opened, or why the token does not count. */
export async function checkFormToken(env: Env, token: unknown, now = Date.now()): Promise<{ ok: true; opened: number } | { ok: false; error: 'too_fast' | 'expired' }> {
  if (typeof token !== 'string') return { ok: false, error: 'expired' };
  const [issued, mac] = token.split('.');
  const at = Number(issued);
  if (!Number.isSafeInteger(at) || !mac || !(await sameSecret(mac, await hmac(secret(env), `form:${at}`)))) return { ok: false, error: 'expired' };
  if (now - at > TOKEN_MAX_AGE_MS || at > now + 60_000) return { ok: false, error: 'expired' };
  if (now - at < num(env.MIN_FILL_SECONDS, 3) * 1000) return { ok: false, error: 'too_fast' };
  return { ok: true, opened: at };
}

async function turnstilePasses(env: Env, token: unknown, ip: string | null): Promise<boolean> {
  if (typeof token !== 'string' || !token || !env.TURNSTILE_SECRET) return false;
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

export const RECEIVED = { ok: true } as const;

export async function postInquiry(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const body = await readJson(req);
  if (!body) return json({ error: 'bad_request' }, 400);
  const ip = await ipHash(req, env);

  if (!(await withinLimit(env.DB, `inquiry:${ip}`, 3600, num(env.INQUIRY_LIMIT_PER_HOUR, 5)))) return json({ error: 'rate_limited' }, 429);

  // a bot that fills every field: answered the same as a person, never stored
  const trap = body[HONEYPOT];
  if (typeof trap === 'string' ? trap.trim() !== '' : trap != null) return json(RECEIVED);

  const token = await checkFormToken(env, body.form_token);
  if (!token.ok) return json({ error: token.error }, 400);

  if (turnstileOn(env) && !(await turnstilePasses(env, body.turnstile_token, req.headers.get('cf-connecting-ip')))) return json({ error: 'bot_check' }, 400);

  const checked = validateInquiry(body);
  if (!checked.ok) return json({ error: 'invalid', fields: checked.fields }, 400);
  const v = checked.value;

  const now = Date.now();
  const sameEmail = await env.DB.prepare('SELECT count(*) AS n FROM inquiries WHERE email = ?1 AND created_at > ?2')
    .bind(v.email, iso(now - 86_400_000))
    .first<{ n: number }>();
  if ((sameEmail?.n ?? 0) >= num(env.INQUIRY_LIMIT_PER_EMAIL_DAY, 3)) return json({ error: 'rate_limited' }, 429);

  const id = ulid(now);
  const at = iso(now);
  const retain = iso(now + num(env.RETAIN_DAYS, 365) * 86_400_000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO inquiries (id, created_at, updated_at, company, business_type, country, contact_name, email, reach_kind, reach_value,
         wants, requests, message, consent_required, consent_demo, consent_version, consent_news, locale, source, opened_at, status, retain_until,
         company_no)
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?14, ?15, ?16, ?17, ?18, 'new', ?19, ?20)`,
    ).bind(
      id,
      at,
      v.company,
      v.business_type,
      v.country,
      v.contact_name,
      v.email,
      v.reach_kind,
      v.reach_value,
      JSON.stringify(v.wants),
      JSON.stringify(v.requests),
      v.message,
      v.consent_demo ? 1 : 0,
      env.CONSENT_VERSION,
      v.consent_news ? 1 : 0,
      v.locale,
      v.source,
      iso(token.opened),
      retain,
      v.company_no,
    ),
    env.DB.prepare("INSERT INTO inquiry_log (inquiry_id, ts, actor, action, detail) VALUES (?1, ?2, 'system', 'created', ?3)").bind(id, at, JSON.stringify({ source: v.source, requests: v.requests })),
  ]);

  // the agency is told there is a new one — company, requests and number only, no contact details
  if (env.NOTIFY_WEBHOOK) {
    const send = fetch(env.NOTIFY_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, company: v.company, requests: v.requests }) }).catch(() => undefined);
    if (ctx) ctx.waitUntil(send);
    else await send;
  }
  return json(RECEIVED);
}

/** The daily cron: inquiries past retain_until go, with their log; counters older than a day go. */
export async function sweep(env: Env, now = Date.now()): Promise<number> {
  const cut = iso(now);
  const [, gone] = await env.DB.batch([
    env.DB.prepare('DELETE FROM inquiry_log WHERE inquiry_id IN (SELECT id FROM inquiries WHERE retain_until < ?1)').bind(cut),
    env.DB.prepare('DELETE FROM inquiries WHERE retain_until < ?1').bind(cut),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(Math.floor(now / 1000) - 86_400),
  ]);
  return gone.meta.changes ?? 0;
}
