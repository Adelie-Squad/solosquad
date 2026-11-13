// The SoloSquad marketing site Worker (decision 62, PRD §3.6). Static pages come from Workers
// Static Assets (the marketing build of web/, SPA fallback for /login · /login/help · /demo ·
// /privacy · /demo/app/…); this answers /api/*, sends /policy on to /privacy (301), lets
// /demo/app/… through only with a demo session, and runs the daily retention sweep. There is no admin HTTP API — the agency works through
// wrangler (`scripts/route.mjs` · `scripts/inquiry.mjs`).
import { demoPage, DEMO_APP, getMe, postEvent, postLogin, postLogout, sweepDemo } from './demo';
import { turnstileOn, type Env } from './env';
import { json } from './http';
import { formToken, postInquiry, sweep } from './inquiry';
import { postRoute } from './route';

/** the privacy policy's page — the user keeps /privacy (2026-11-14); /policy is sent there */
const POLICY = '/privacy';
const OTHER_POLICY = '/policy';

/** What the pages need to know (no secrets). */
export const siteConfig = (env: Env) => ({
  consent_version: env.CONSENT_VERSION,
  turnstile: { enabled: turnstileOn(env), site_key: turnstileOn(env) ? env.TURNSTILE_SITE_KEY : '' },
});

async function api(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (path === '/api/config' && req.method === 'GET') return json(siteConfig(env));
  if (path === '/api/form-token' && req.method === 'GET') return json({ token: await formToken(env) });
  if (path === '/api/login/route' && req.method === 'POST') return postRoute(req, env);
  if (path === '/api/demo/login' && req.method === 'POST') return postLogin(req, env);
  if (path === '/api/demo/me' && req.method === 'GET') return getMe(req, env);
  if (path === '/api/demo/event' && req.method === 'POST') return postEvent(req, env);
  if (path === '/api/demo/logout' && req.method === 'POST') return postLogout(req, env);
  if (path === '/api/inquiry' && req.method === 'POST') {
    // the modal posts JSON from this origin; a cross-site form post never reaches the handler
    if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
    return postInquiry(req, env, ctx);
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    // /policy (a link that was out for a day, 2026-11-14) lands on the privacy policy
    if (path === OTHER_POLICY || path === `${OTHER_POLICY}/`) return Response.redirect(new URL(`${POLICY}${url.search}`, url).toString(), 301);
    if (path.startsWith('/api/')) {
      try {
        return await api(req, env, ctx, path);
      } catch (err) {
        console.error('marketing api', path, err instanceof Error ? err.message : 'error');
        return json({ error: 'server_error' }, 500);
      }
    }
    if (path === DEMO_APP || path.startsWith(`${DEMO_APP}/`)) {
      try {
        return await demoPage(req, env);
      } catch (err) {
        console.error('demo page', err instanceof Error ? err.message : 'error');
        return json({ error: 'server_error' }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([sweep(env), sweepDemo(env)]).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
