# SoloSquad marketing site (`marketing/`)

The outward-facing site (decision 62, PRD v2.1.0 §3.6): the landing, the login router, the demo
login, **the demo itself** and the demo account request. Company servers never serve these. A
company server's `/` is its own login, and the customer web build carries none of this code, copy
or example data (C62).

- **Static pages**: the marketing build of `web/` (`npm --prefix ../web run build:marketing` →
  `marketing/public/`), served by Workers Static Assets. `/login`, `/login/help`, `/demo`,
  `/privacy` and `/demo/app/…` are client routes (SPA fallback).
- **The demo** (`/demo/app/…`, 2026-11-13): the customer web's own screens running in the
  browser against an in-memory engine (`web/src/demo/`) — the example company 모아 리빙 and its
  three scripted workflows (재무 · 소싱 · SNS) with their approval points, in ko · en · zh-CN.
  **No demo server, no engine, nothing saved**: a reload starts over. One demo for everyone; a demo
  account only adds its company's name (settings → company) and its end date (the demo band).
  It loads as its own chunk, so the landing never downloads it.
- **Worker** (`src/index.ts`, Cloudflare Workers + D1):

| Route | What it does |
|---|---|
| `POST /api/login/route` | A **plain form post** `{code, id}`, so it works without JS, always answered with a **303**. A known active company code → `https://<company server>/login?u=<id>` (the ID is passed through as typed: no code prefix, never stored or checked beyond length and characters). The reserved code `demo` → `/demo?u=<id>`. Unknown, suspended, malformed or over the limit → `/login/help`. Every answer runs the same D1 lookup and is padded to the same time (`ROUTE_PAD_MS`, 250 ms). Limit per hashed IP: 10 a minute and 60 an hour. No password ever reaches this route |
| `POST /api/inquiry` | A demo account request (JSON from the modal) → D1 `inquiries` (status `new`) plus one `inquiry_log` row (`created`). One required `company_no`, the company's representative registration number (below). Spam protection: a honeypot field (`website`, answered as received and dropped), the 3-second rule (a signed token from `GET /api/form-token`), a per-IP limit (5 an hour) and 3 per email a day. Turnstile only runs if `TURNSTILE_ENABLED = "true"`; it is off by default because it is blocked in mainland China, and review is the real gate. Neither the IP nor the user-agent is stored |
| `POST /api/demo/login` | The demo login: a **plain form post** `{company_no, username, password}` from `/demo` (works without JS), same-origin only. The number must be the one stored with the account (dashes, spaces and case ignored), the password is checked against its PBKDF2 hash, the account must be neither expired nor revoked. Success → **303 `/demo/app`** with the session cookie. Every failure (wrong number, ID or password, expired, revoked, cross-site, over a limit) is the same **303 `/demo?error=1`**, padded to the same time. Limits: the router's per hashed IP (10 a minute, 60 an hour) plus 20 an hour per demo ID |
| `GET /api/demo/me` | `{demo_id, company_name, locale, expires}` for the signed-in demo account, or 401 |
| `POST /api/demo/event` | One usage event `{kind: view \| action, detail}` (JSON, same-origin, signed in; detail = 1–80 of `A-Z a-z 0-9 _ . : / -`, e.g. `/o/moa/w/hq/office`, `run:finance-monthly`, `approve:pay`). 30 a minute and 300 an hour per account |
| `POST /api/demo/logout` | Forgets the cookie, records `logout` |
| `/demo/app`, `/demo/app/*` | Let through only with a demo session (the Worker runs first for these paths); without one → 303 `/demo` |
| `GET /api/config` · `GET /api/form-token` | What the pages need (the consent version, Turnstile on/off) and the form-opened token |
| cron (daily 03:17 UTC) | Deletes inquiries past `retain_until` with their log, demo usage events older than `RETAIN_DAYS`, and demo accounts that ended (expired or revoked) that long ago, with their events (`RETAIN_DAYS`, 365) |

There is **no admin HTTP API**. The agency works through `wrangler d1 execute` (below), so nothing
on the internet needs guarding.

The demo login (`/demo`) is a plain form posted to this Worker (`POST /api/demo/login`) with three
fields: `company_no` (법인(사업자)등록번호 — the number given in the request), `username` (the demo
ID) and `password`. The session is an **HMAC-signed cookie** (`ss_demo`, secret `DEMO_SECRET`;
HttpOnly, Secure, SameSite=Lax, Path=/) carrying the demo ID, the company name, the locale and the
session's end (12 hours, or the account's end when sooner). It is checked against D1 on every use,
so `revoke` or an expiry ends a session at once. Passwords are PBKDF2-SHA256 with a per-account
16-byte salt at **100 000 iterations — the most Workers allow**; the 16-character random password
(≈ 92 bits) is what carries the strength. One WebCrypto file, `scripts/lib/password.mjs`, serves
the Worker and the CLI.

**Usage data** (`demo_events`): login, logout, a screen viewed (its address without ids) and a
button pressed (run · approve · decline · a scripted chat intent · review · start over · a locked
setting · 상담 요청). Never what was typed, no IP, no user-agent — the same stance as the inquiries,
and the same retention (`RETAIN_DAYS`).

**The company registration number** (`company_no`, decided 2026-11-12) is one representative
number per request:
- A Korean 사업자등록번호 (10 digits, `123-45-67890`) or 법인등록번호 (13 digits,
  `110111-1234567`) is stored as digits only. A request with country `kr` must give one of these
  two.
- Another country's number is 4–30 letters, digits and dashes, stored upper-cased.
- The Worker (`src/validate.ts` `normalizeCompanyNo`) decides. The modal checks the same rule, and
  `scripts/lib/company-no.mjs` keeps the same rule (a test compares the two).

## D1 schema (`migrations/0001_init.sql` · `0002_company_no.sql` · `0003_demo_accounts.sql`, PRD §3.6.3)

- `inquiries`:
  - id (ULID), created_at, updated_at
  - the form: company, company_no (normalised; `0002`, NULL only on older rows), business_type,
    country, contact_name, email, reach_kind, reach_value, wants, requests (`demo` · `consult`),
    message
  - consent: consent_required, consent_demo (DM6 ⓑ), consent_version, consent_news
  - locale, source (`landing_hero` · `landing_start` · `pricing` · `demo_login`), opened_at
  - handling: status (`new` · `reviewed` · `issued` · `rejected`), reviewed_at, reviewed_by,
    review_note, demo_id (unique), demo_issued_at, demo_expires_at, retain_until
- `inquiry_log`: inquiry_id, ts, actor, action (`created` · `reviewed` · `issued` · `rejected` ·
  `extended` · `revoked`), detail (JSON, no personal data)
- `login_routes`: code (a-z and 0-9, 3–20 characters), kind (`customer` · `demo`), server_url,
  status (`active` · `suspended`), note, updated_at, updated_by. The migration seeds the reserved
  `demo` row. `demo` and codes ending in `demo` can't be given to a company
- `demo_accounts` (`0003`): id (as issued, `samsungDemo`), id_lower (unique — logins ignore case),
  inquiry_id, company_no (normalised), company_name, locale, password_hash
  (`pbkdf2-sha256$<iterations>$<salt>$<hash>`), created_at, created_by, expires_at, revoked_at
- `demo_events` (`0003`): demo_id, at, kind (`login` · `logout` · `view` · `action`), detail (≤ 80)
- `rate_limits`: fixed windows per hashed IP (and per demo ID / account for the demo), kept for at
  most a day

## Run it locally (no Cloudflare account needed)

```bash
cd marketing
npm ci
cp .dev.vars.example .dev.vars          # FORM_SECRET · IP_SALT · DEMO_SECRET for local use
npm run build:web                        # web/ marketing build (with the demo) → marketing/public
npm run migrate:local                    # the local D1 in .wrangler/
npx wrangler dev --port 8796 --ip 127.0.0.1
node scripts/route.mjs add moa http://127.0.0.1:8792     # local D1: http://127.0.0.1 is allowed
# a demo account: send a request from the landing (or /demo → 데모 계정 신청하기), then
node scripts/inquiry.mjs list
node scripts/inquiry.mjs issue <inquiry id> --slug test  # prints the password once
# → http://127.0.0.1:8796/demo (Chrome keeps the Secure cookie on http://127.0.0.1)
```

Tests run the Worker in Miniflare with an in-memory D1 and need no credentials:

```bash
npm test           # vitest: the worker project (workerd + D1) and the scripts project (Node)
npm run typecheck
```

## Agency CLI (`wrangler d1 execute`)

Add `--remote` to work on the deployed D1; without it, the scripts use the local D1. The handle
recorded on every change is `$SOLOSQUAD_HANDLE` (else `$USER`).

```bash
# login routes (the last step of setting up a customer, I28)
node scripts/route.mjs list
node scripts/route.mjs add <code> https://office.<customer>.com [--note …]
node scripts/route.mjs suspend <code>          # → the neutral page
node scripts/route.mjs resume <code>

# demo account requests
node scripts/inquiry.mjs list [--status new|reviewed|issued|rejected]
node scripts/inquiry.mjs show <id>
node scripts/inquiry.mjs review <id> [--note …]
node scripts/inquiry.mjs reject <id> --note …
node scripts/inquiry.mjs issue <id> [--slug samsung] [--days 14] [--company-no …]
node scripts/inquiry.mjs extend <id> --days 7          # the inquiry's demo account
node scripts/inquiry.mjs revoke <id>                   # the inquiry's demo account

# demo accounts
node scripts/inquiry.mjs demo list                     # id · status · end · number · locale · logins · last login · inquiry · company
node scripts/inquiry.mjs demo extend <demo id> --days 7  # from its end, or from now when it has ended
node scripts/inquiry.mjs demo revoke <demo id>         # its session ends at once
node scripts/inquiry.mjs demo usage <demo id>          # logins, screens viewed, buttons pressed
```

`issue` works out the demo ID `<slug>Demo`:
- The slug is suggested from the company name, else the applicant's name, and you confirm it or
  pass `--slug`. Latin letters are kept, Hangul is romanised letter by letter (삼성 → `samseong`;
  a brand spelling like `samsung` is your `--slug`), Chinese becomes toneless pinyin (华为 →
  `huawei`), and legal-form words are dropped. The slug is 3–16 characters.
- A taken ID gets `2`, `3`, … at the end (`samsungDemo2`), ignoring case.

Then it creates the account **in D1** (`demo_accounts`) — no demo server, no ssh:
- the inquiry's `company_no` and company name go with it (the demo login asks for the number; the
  name shows in the demo's settings). A request from before the number was asked has none: `issue`
  stops and asks for `--company-no …`, which it also writes to the inquiry;
- a 16-character password (no look-alikes) is printed **once**, in your terminal; only its hash is
  stored;
- the inquiry gets `issued`, `demo_id` and `demo_expires_at` and a log row, and a mail draft in the
  request's language is printed for you to send from the agency mailbox (DM4). The draft lists the
  three things the demo login asks for: the number, the ID and the password.

`--remote` works on the deployed D1 the same way. `extend` and `revoke` keep the inquiry's
`demo_expires_at` and log in step with the account.

## Deploy (you run these; this repo never deploys)

1. `cd marketing && npm ci`
2. `npx wrangler login`
3. Run `npx wrangler d1 create solosquad-marketing --location apac` and paste the printed
   `database_id` into `wrangler.toml`. The storage location also goes in the privacy text
   (`[검토 필요]`, DM6).
4. `npm run migrate:remote`
5. Set the secrets with `npx wrangler secret put FORM_SECRET`, `IP_SALT` and `DEMO_SECRET` (long
   random strings — without `DEMO_SECRET` nobody can sign in to the demo; changing it signs
   everyone out). Optional: `NOTIFY_WEBHOOK` (the new-request notice, which carries no contact
   details) and `TURNSTILE_SECRET` (only if Turnstile is turned on).
6. Bump `CONSENT_VERSION` in `wrangler.toml [vars]` whenever the consent text changes.
7. `npm run deploy` (the marketing build, then `wrangler deploy`). This also registers the daily
   cron trigger.
8. Add the custom domain:
   - Either in the Cloudflare dashboard: Workers & Pages → `solosquad-marketing` → Settings →
     Domains & Routes → Add → Custom domain (the zone must be on Cloudflare).
   - Or add this to `wrangler.toml` and deploy again:
     ```toml
     routes = [{ pattern = "solosquad.example.com", custom_domain = true }]
     ```
9. For each customer: `node scripts/route.mjs add <code> https://office.<customer>.com --remote`
