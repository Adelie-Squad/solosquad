// The SoloSquad marketing site Worker (decision 62, PRD §3.6). Static pages come from Workers
// Static Assets (the marketing build of web/, SPA fallback for /login · /login/help · /demo ·
// /privacy); this answers /api/* and runs the daily retention sweep. There is no admin HTTP API —
// the agency works through wrangler (`scripts/route.mjs` · `scripts/inquiry.mjs`).
import { turnstileOn, type Env } from './env';
import { json } from './http';
import { formToken, postInquiry, sweep } from './inquiry';
import { postRoute } from './route';

/** What the pages need to know (no secrets). */
export const siteConfig = (env: Env) => ({
  demo_login_url: env.DEMO_LOGIN_URL,
  consent_version: env.CONSENT_VERSION,
  turnstile: { enabled: turnstileOn(env), site_key: turnstileOn(env) ? env.TURNSTILE_SITE_KEY : '' },
});

async function api(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (path === '/api/config' && req.method === 'GET') return json(siteConfig(env));
  if (path === '/api/form-token' && req.method === 'GET') return json({ token: await formToken(env) });
  if (path === '/api/login/route' && req.method === 'POST') return postRoute(req, env);
  if (path === '/api/inquiry' && req.method === 'POST') {
    // the modal posts JSON from this origin; a cross-site form post never reaches the handler
    if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
    return postInquiry(req, env, ctx);
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/')) {
      try {
        return await api(req, env, ctx, path);
      } catch (err) {
        console.error('marketing api', path, err instanceof Error ? err.message : 'error');
        return json({ error: 'server_error' }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweep(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
