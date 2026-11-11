// The marketing site's own API (marketing/src — the Cloudflare Worker, decision 62, PRD §3.6). Not the engine:
// the marketing build has no session, no CSRF and no /api/me.

export interface SiteConfig {
  demo_login_url: string;
  consent_version: string;
  turnstile: { enabled: boolean; site_key: string };
}

export type FieldError = 'required' | 'too_long' | 'invalid';

export type InquiryResult =
  | { ok: true }
  | { ok: false; error: 'invalid'; fields: Record<string, FieldError> }
  | { ok: false; error: 'too_fast' | 'expired' | 'rate_limited' | 'bot_check' | 'failed' };

let config: Promise<SiteConfig> | null = null;

export function siteConfig(): Promise<SiteConfig> {
  config ??= fetch('/api/config')
    .then((r) => (r.ok ? (r.json() as Promise<SiteConfig>) : Promise.reject(new Error(String(r.status)))))
    .catch((err: unknown) => {
      config = null;
      throw err;
    });
  return config;
}

/** For tests: forget the cached config. */
export const resetSiteConfig = () => {
  config = null;
};

export async function formToken(): Promise<string | null> {
  try {
    const r = await fetch('/api/form-token');
    return r.ok ? ((await r.json()) as { token: string }).token : null;
  } catch {
    return null;
  }
}

const postJson = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function sendInquiry(body: Record<string, unknown>): Promise<InquiryResult> {
  try {
    const r = await postJson('/api/inquiry', body);
    const out = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Record<string, FieldError> };
    if (r.ok && out.ok) return { ok: true };
    if (out.error === 'invalid' && out.fields) return { ok: false, error: 'invalid', fields: out.fields };
    if (out.error === 'too_fast' || out.error === 'expired' || out.error === 'rate_limited' || out.error === 'bot_check') return { ok: false, error: out.error };
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
