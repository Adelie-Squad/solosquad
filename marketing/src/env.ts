/** The bindings and settings of the marketing Worker (wrangler.toml `[vars]` + secrets). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DEMO_LOGIN_URL: string;
  CONSENT_VERSION: string;
  TURNSTILE_ENABLED: string;
  TURNSTILE_SITE_KEY: string;
  MIN_FILL_SECONDS: string;
  RETAIN_DAYS: string;
  INQUIRY_LIMIT_PER_HOUR: string;
  INQUIRY_LIMIT_PER_EMAIL_DAY: string;
  ROUTE_LIMIT_PER_MIN: string;
  ROUTE_LIMIT_PER_HOUR: string;
  /** the shortest a login route answers in, found or not (ms) — so timing does not tell them apart */
  ROUTE_PAD_MS?: string;
  /** optional: POSTed {id, company, requests} for each new inquiry (no contact details) — DM4 */
  NOTIFY_WEBHOOK?: string;
  FORM_SECRET?: string;
  IP_SALT?: string;
  TURNSTILE_SECRET?: string;
}

export const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const turnstileOn = (env: Env) => env.TURNSTILE_ENABLED === 'true';
