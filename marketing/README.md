# SoloSquad marketing site (`marketing/`)

The outward-facing site (decision 62, PRD v2.1.0 §3.6): the landing, the login router, the demo
login and the demo account request. Company servers never serve these. A company server's `/` is
its own login, and the customer web build carries none of this code or copy (C62).

- **Static pages**: the marketing build of `web/` (`npm --prefix ../web run build:marketing` →
  `marketing/public/`), served by Workers Static Assets. `/login`, `/login/help`, `/demo` and
  `/privacy` are client routes (SPA fallback).
- **Worker** (`src/index.ts`, Cloudflare Workers + D1):

| Route | What it does |
|---|---|
| `POST /api/login/route` | A **plain form post** `{code, id}`, so it works without JS, always answered with a **303**. A known active company code → `https://<company server>/login?u=<id>` (the ID is passed through as typed: no code prefix, never stored or checked beyond length and characters). The reserved code `demo` → `/demo?u=<id>`. Unknown, suspended, malformed or over the limit → `/login/help`. Every answer runs the same D1 lookup and is padded to the same time (`ROUTE_PAD_MS`, 250 ms). Limit per hashed IP: 10 a minute and 60 an hour. No password ever reaches this route |
| `POST /api/inquiry` | A demo account request (JSON from the modal) → D1 `inquiries` (status `new`) plus one `inquiry_log` row (`created`). Spam protection: a honeypot field (`website`, answered as received and dropped), the 3-second rule (a signed token from `GET /api/form-token`), a per-IP limit (5 an hour) and 3 per email a day. Turnstile only runs if `TURNSTILE_ENABLED = "true"`; it is off by default because it is blocked in mainland China, and review is the real gate. Neither the IP nor the user-agent is stored |
| `GET /api/config` · `GET /api/form-token` | What the pages need (the demo login URL, the consent version, Turnstile on/off) and the form-opened token |
| cron (daily 03:17 UTC) | Deletes inquiries past `retain_until`, with their log (`RETAIN_DAYS`, 365) |

There is **no admin HTTP API**. The agency works through `wrangler d1 execute` (below), so nothing
on the internet needs guarding.

The demo login (`/demo`) is a plain form that the browser **posts straight to the demo server**
(`DEMO_LOGIN_URL`, the engine's demo-mode `POST /api/auth/demo-login`, PRD §3.6.8), with the fields
`username` and `password`. The marketing site never sees the password.

## D1 schema (`migrations/0001_init.sql`, PRD §3.6.3)

- `inquiries`:
  - id (ULID), created_at, updated_at
  - the form: company, business_type, country, contact_name, email, reach_kind, reach_value,
    wants, requests (`demo` · `consult`), message
  - consent: consent_required, consent_demo (DM6 ⓑ), consent_version, consent_news
  - locale, source (`landing_hero` · `landing_start` · `pricing` · `demo_login`), opened_at
  - handling: status (`new` · `reviewed` · `issued` · `rejected`), reviewed_at, reviewed_by,
    review_note, demo_id (unique), demo_issued_at, demo_expires_at, retain_until
- `inquiry_log`: inquiry_id, ts, actor, action (`created` · `reviewed` · `issued` · `rejected` ·
  `extended` · `revoked`), detail (JSON, no personal data)
- `login_routes`: code (a-z and 0-9, 3–20 characters), kind (`customer` · `demo`), server_url,
  status (`active` · `suspended`), note, updated_at, updated_by. The migration seeds the reserved
  `demo` row. `demo` and codes ending in `demo` can't be given to a company
- `rate_limits`: fixed windows per hashed IP, kept for at most a day

## Run it locally (no Cloudflare account needed)

```bash
cd marketing
npm ci
cp .dev.vars.example .dev.vars          # FORM_SECRET · IP_SALT for local use
npm run build:web                        # web/ marketing build → marketing/public
npm run migrate:local                    # the local D1 in .wrangler/
npx wrangler dev --port 8791 --var 'DEMO_LOGIN_URL:http://127.0.0.1:8793/api/auth/demo-login'
node scripts/route.mjs add moa http://127.0.0.1:8792     # local D1: http://127.0.0.1 is allowed
```

Tests run the Worker in Miniflare with an in-memory D1 and need no credentials:

```bash
npm test           # vitest: the worker project (workerd + D1) and the scripts project (Node)
npm run typecheck
```

## Agency CLI (`wrangler d1 execute` · `ssh`)

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
node scripts/inquiry.mjs issue <id> [--slug samsung] [--days 14] [--record]
node scripts/inquiry.mjs extend <id> --days 7
node scripts/inquiry.mjs revoke <id>
```

`issue` works out the demo ID `<slug>Demo`:
- The slug is suggested from the company name, else the applicant's name, and you confirm it or
  pass `--slug`. Latin letters are kept, Hangul is romanised letter by letter (삼성 → `samseong`;
  a brand spelling like `samsung` is your `--slug`), Chinese becomes toneless pinyin (华为 →
  `huawei`), and legal-form words are dropped. The slug is 3–16 characters.
- A taken ID gets `2`, `3`, … at the end (`samsungDemo2`), ignoring case.

Then it creates the account on the demo server:

```
ssh $DEMO_SSH solosquad demo issue --id samsungDemo2 --inquiry <id> --days 14 --locale ko
```

The demo server prints the password once, in your terminal, and stores only its hash. `issue` then
records `issued`, `demo_id` and `demo_expires_at` in D1, adds the log row and prints a mail draft in
the request's language for you to send from the agency mailbox (DM4).

Without `$DEMO_SSH`, `issue` prints the demo server command instead. Run it yourself, then run
`issue … --record`.

## Deploy (you run these; this repo never deploys)

1. `cd marketing && npm ci`
2. `npx wrangler login`
3. Run `npx wrangler d1 create solosquad-marketing --location apac` and paste the printed
   `database_id` into `wrangler.toml`. The storage location also goes in the privacy text
   (`[검토 필요]`, DM6).
4. `npm run migrate:remote`
5. Set the secrets with `npx wrangler secret put FORM_SECRET` and `IP_SALT` (long random strings).
   Optional: `NOTIFY_WEBHOOK` (the new-request notice, which carries no contact details) and
   `TURNSTILE_SECRET` (only if Turnstile is turned on).
6. In `wrangler.toml [vars]`, set `DEMO_LOGIN_URL` to the demo server's
   `https://demo.<agency>/api/auth/demo-login`. Bump `CONSENT_VERSION` whenever the consent text
   changes.
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
