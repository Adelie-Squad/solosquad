// Who runs the marketing site — the footer and the privacy policy read these, nothing else does.
// The representative's name is not confirmed yet (user, 2026-11-14): change it here only. It lives
// under messages/ because the Korean name is Hangul (web/test/i18n.test.ts keeps Hangul out of
// components). No Chinese name is made up — zh-CN shows the romanized one.
import type { Locale } from '../../i18n';

export const SITE = {
  brand: 'SoloSquad',
  /** 대표자 = 개인정보 보호책임자 */
  owner: { ko: '정승원', en: 'Seungwon Jung', 'zh-CN': 'Seungwon Jung' } as Record<Locale, string>,
  email: 'contact@toronchul.app',
  /** the privacy policy's 시행일 — move it (and CONSENT_VERSION in marketing/wrangler.toml) when the text changes */
  policyEffective: '2026-11-14',
  /** the policy page — the user keeps /privacy (2026-11-14); `/policy` redirects here */
  policyPath: '/privacy',
} as const;
