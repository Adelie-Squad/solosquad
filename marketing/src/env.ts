/** The bindings and settings of the marketing Worker (wrangler.toml `[vars]` + secrets). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CONSENT_VERSION: string;
  TURNSTILE_ENABLED: string;
  TURNSTILE_SITE_KEY: string;
  MIN_FILL_SECONDS: string;
  RETAIN_DAYS: string;
  INQUIRY_LIMIT_PER_HOUR: string;
  INQUIRY_LIMIT_PER_EMAIL_DAY: string;
  ROUTE_LIMIT_PER_MIN: string;
  ROUTE_LIMIT_PER_HOUR: string;
  /** days a demo account issued on a request lasts (default 14) */
  DEMO_DAYS?: string;
  /** new demo accounts one hashed IP may get a day (default 3; a repeat request for the same email does not count) */
  DEMO_ISSUE_LIMIT_PER_IP_DAY?: string;
  /** demo login attempts per demo ID an hour, from any IP (the per-IP limits are the router's) */
  DEMO_LOGIN_LIMIT_PER_ID_HOUR?: string;
  /** usage events per demo account a minute and an hour */
  DEMO_EVENT_LIMIT_PER_MIN?: string;
  DEMO_EVENT_LIMIT_PER_HOUR?: string;
  /** the shortest a login route answers in, found or not (ms) — so timing does not tell them apart */
  ROUTE_PAD_MS?: string;
  /** optional: POSTed {id, company, requests} for each new inquiry (no contact details) — DM4 */
  NOTIFY_WEBHOOK?: string;
  FORM_SECRET?: string;
  /** signs the demo session cookie; without it nobody can sign in to the demo */
  DEMO_SECRET?: string;
  IP_SALT?: string;
  TURNSTILE_SECRET?: string;
}

export const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const turnstileOn = (env: Env) => env.TURNSTILE_ENABLED === 'true';
