# SoloSquad marketing site (`marketing/`)

The outward-facing site (decision 62, PRD v2.1.0 §3.6): the landing, the login router, the demo
login, **the demo itself** and the demo account request. Company servers never serve these. A
company server's `/` is its own login, and the customer web build carries none of this code, copy
or example data (C62).

- **Static pages**: the marketing build of `web/` (`npm --prefix ../web run build:marketing` →
  `marketing/public/`), served by Workers Static Assets. `/login`, `/login/help`, `/demo`,
  `/policy` (the privacy policy) and `/demo/app/…` are client routes (SPA fallback). `/privacy`, the
  policy's old address, gets a **301 to `/policy`** from the Worker (it runs first for that path).
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
| `POST /api/inquiry` | A demo account request (JSON from the modal) → D1 `inquiries` (status `new`) plus one `inquiry_log` row (`created`). One required `company_no` with its kind (below) and, when a demo account is asked for, a required `phone`. **A request that asks for a demo account gets it at once** (2026-11-13 — no review step; below): the answer is `{ok, demo: {id, password, company_no, company_no_kind, company_name, expires, reused}}`, the request becomes `issued` and logs `issued`. Spam protection: a honeypot field (`website`, answered as received and dropped), the 3-second rule (a signed token from `GET /api/form-token`), a per-IP limit (5 an hour), 3 per email a day, and **3 new demo accounts per IP a day** (`DEMO_ISSUE_LIMIT_PER_IP_DAY` — past it the request is kept as `new` without an account, for the agency). Turnstile only runs if `TURNSTILE_ENABLED = "true"`; it is off by default because it is blocked in mainland China. Neither the IP nor the user-agent is stored |
| `POST /api/demo/login` | The demo login: a **plain form post** `{company_no, username, password}` from `/demo` (works without JS), same-origin only. The ID is the request's email (or an internal ID like `solosquad`), any case. The number is compared **by its digits only** (the field shows hyphens; an older row's letters are ignored), the password is checked against its PBKDF2 hash, the account must be neither expired nor revoked (an internal account may have no end). Success → **303 `/demo/app`** with the session cookie. Every failure (wrong number, ID or password, expired, revoked, cross-site, over a limit) is the same **303 `/demo?error=1`**, padded to the same time. Limits: the router's per hashed IP (10 a minute, 60 an hour) plus 20 an hour per demo ID |
| `GET /api/demo/me` | `{demo_id, company_name, locale, expires}` for the signed-in demo account (`expires` null = no end), or 401 |
| `POST /api/demo/event` | One usage event `{kind: view \| action, detail}` (JSON, same-origin, signed in; detail = 1–80 of `A-Z a-z 0-9 _ . : / -`, e.g. `/o/moa/w/hq/office`, `run:finance-monthly`, `approve:pay`). 30 a minute and 300 an hour per account |
| `POST /api/demo/logout` | Forgets the cookie, records `logout` |
| `/demo/app`, `/demo/app/*` | Let through only with a demo session (the Worker runs first for these paths); without one → 303 `/demo` |
| `GET /api/config` · `GET /api/form-token` | What the pages need (the consent version, Turnstile on/off) and the form-opened token |
| cron (daily 03:17 UTC) | Deletes inquiries past `retain_until` with their log, demo usage events older than `RETAIN_DAYS`, and demo accounts that ended (expired or revoked) that long ago, with their events (`RETAIN_DAYS`, 365) |

There is **no admin HTTP API**. The agency works through `wrangler d1 execute` (below), so nothing
on the internet needs guarding.

The demo login (`/demo`) is a plain form posted to this Worker (`POST /api/demo/login`) with three
fields: `company_no` (법인(사업자)등록번호 — the number given in the request, digits only, hyphens
shown by length: 10 → 3-2-5, 13 → 6-7), `username` (the request's email, or an internal ID) and
`password`. The session is an **HMAC-signed cookie** (`ss_demo`, secret `DEMO_SECRET`;
HttpOnly, Secure, SameSite=Lax, Path=/) carrying the demo ID, the company name, the locale and the
session's end (12 hours, or the account's end when sooner). It is checked against D1 on every use,
so `revoke` or an expiry ends a session at once. Passwords are PBKDF2-SHA256 with a per-account
16-byte salt at **100 000 iterations — the most Workers allow**. One WebCrypto file,
`scripts/lib/password.mjs`, serves the Worker and the CLI. The customer demo password follows an
easy rule (below) by the owner's choice, so it is guessable from the email and the phone: what
keeps a stranger out is the registration number asked with it, the limits (20 tries an hour per
ID, 10 a minute per IP) and that the demo holds only example data.

**Usage data** (`demo_events`): login, logout, a screen viewed (its address without ids) and a
button pressed (run · approve · decline · a scripted chat intent · review · start over · a locked
setting · 상담 요청). Never what was typed, no IP, no user-agent — the same stance as the inquiries,
and the same retention (`RETAIN_DAYS`).

**The company registration number** (`company_no`, decided 2026-11-12; digits only since
2026-11-13) is one representative number per request, stored as **digits** with its kind
(`company_no_kind`):

| Kind | Who | Digits | Shown | Check digit |
|---|---|---|---|---|
| `business` | a Korean 개인사업자 — 사업자등록번호 | 10 | `NNN-NN-NNNNN` | weights 1,3,7,1,3,7,1,3,5 on the first nine, plus ⌊9th × 5 / 10⌋; 10th = (10 − sum mod 10) mod 10 |
| `corporate` | a Korean 법인 — 법인등록번호 | 13 | `NNNNNN-NNNNNNN` | weights 1,2,1,2,… on the first twelve; 13th = (10 − sum mod 10) mod 10 |
| `foreign` | another country | 4–20 | no hyphens | none |

- Country `kr` → the modal shows a 개인사업자 / 법인 toggle; other countries have none. The fields
  take digits only (anything else is dropped as typed or pasted, full-width digits are read, an IME
  is left alone until it ends its composition) and put the hyphens in as they are typed.
- A Korean request without a kind (an older page) is read by its length.
- Internal accounts (`demo create`) skip the check digit: any 4–20 digits (e.g. the owner's `solosquad`: 개인 `123-45-67890`).
- **One source of truth**: `scripts/lib/company-no.mjs` — the Worker (`src/validate.ts`,
  `src/demo.ts`), the CLI and the web (`web/src/marketing/Inquiry.tsx`, `DemoLogin.tsx`) all import
  it (with `company-no.d.mts` for TypeScript).

**The phone** (`phone`, 2026-11-13) is required when a demo account is asked for, stored as digits
(`scripts/lib/phone.mjs`). Korean numbers get their hyphens as typed (`010-1234-5678`,
`02-123-4567`, `031-123-4567`, `1588-1234`) and must be 02 + 7–8 digits, 0X(X) + 8–9, or 15xx–19xx
+ 4; other countries' are 6–15 digits (a country code is just leading digits). The messenger
(`reach_kind` kakao · wechat + `reach_value`) stays optional and separate; `reach_kind = phone` is
still accepted from older pages.

**The demo account on the request** (2026-11-13, `src/demo.ts` `issueDemo`):
- **ID** = the request's email, lower case.
- **Password** = the word for the email's first letter + the **last four digits of the phone**
  (`abc123@gmail.com` + `010-1234-5678` → `apple5678`). No leading letter → the first a–z letter in
  the email; none at all → `squad`. The words (`scripts/lib/demo-password.mjs`):

  | a apple | b banana | c cat | d dog | e egg | f fish | g grape | h house | i ice |
  |---|---|---|---|---|---|---|---|---|
  | **j** juice | **k** kite | **l** lemon | **m** moon | **n** nest | **o** orange | **p** penguin | **q** queen | **r** river |
  | **s** squad | **t** tiger | **u** umbrella | **v** violin | **w** water | **x** xray | **y** yellow | **z** zebra | |

- **End** = `DEMO_DAYS` (14) days.
- Only the PBKDF2 hash is stored; the plain password is in the submit's answer, to that browser
  only, and the modal's completion screen shows it with the number, ID and end and a button to
  `/demo` that fills the number and the ID (never the password, never in the address).
- **The same email again** keeps its one account: the password follows the new phone, the number,
  company and language follow the new request, the end moves out (never in), and the new request is
  linked (`inquiries.demo_account`, `demo_accounts.inquiry_id`).
- Not issued (the request is kept as `new`): the account was revoked, the ID belongs to an internal
  account, or the IP has had its 3 new accounts today.
- `src/mail.ts` `sendDemoMail` is the hook for mailing the account later — it sends nothing yet, so
  the completion screen promises no mail.

## D1 schema (`migrations/0001_init.sql` · `0002_company_no.sql` · `0003_demo_accounts.sql` · `0004_demo_auto_issue.sql`, PRD §3.6.3)

- `inquiries`:
  - id (ULID), created_at, updated_at
  - the form: company, company_no (digits; `0002`, NULL only on older rows — which may hold
    letters), company_no_kind (`business` · `corporate` · `foreign`; `0004`), business_type,
    country, contact_name, email, phone (digits; `0004`), reach_kind, reach_value, wants, requests
    (`demo` · `consult`), message
  - consent: consent_required, consent_demo (DM6 ⓑ), consent_version, consent_news
  - locale, source (`landing_hero` · `landing_start` · `pricing` · `demo_login`), opened_at
  - handling: status (`new` · `reviewed` · `issued` · `rejected`), reviewed_at, reviewed_by,
    review_note, demo_account (the account it was answered with — several requests from one email
    share one; `0004`), demo_id (unique, from before `0004`, no longer written), demo_issued_at,
    demo_expires_at, retain_until
- `inquiry_log`: inquiry_id, ts, actor, action (`created` · `reviewed` · `issued` · `rejected` ·
  `extended` · `revoked`), detail (JSON, no personal data)
- `login_routes`: code (a-z and 0-9, 3–20 characters), kind (`customer` · `demo`), server_url,
  status (`active` · `suspended`), note, updated_at, updated_by. The migration seeds the reserved
  `demo` row. `demo` and codes ending in `demo` can't be given to a company
- `demo_accounts` (`0003`, remade by `0004`): id (the request's email · an internal ID like
  `solosquad` · older `samsungDemo`), id_lower (unique — logins ignore case), inquiry_id (the latest
  request), company_no (digits), company_no_kind, company_name, locale, password_hash
  (`pbkdf2-sha256$<iterations>$<salt>$<hash>`), created_at, created_by (`system` when issued on a
  request), updated_at, expires_at (NULL = no end), revoked_at, internal (the agency's own)
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
# a demo account: send a request with 데모 계정 from the landing (or /demo → 데모 계정 신청하기);
# the completion screen shows the number, ID and password → 데모 시작하기
# an internal account with no end (the password from stdin, never an argument):
node scripts/inquiry.mjs demo create --id solosquad --company-no 1234567890 --kind business --company-name SoloSquad --no-expiry   # asks for the password twice (no echo)
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
node scripts/inquiry.mjs issue <id> [--days 14] [--company-no <digits> --kind business|corporate|foreign] [--phone <digits>]
node scripts/inquiry.mjs extend <id> --days 7          # the inquiry's demo account
node scripts/inquiry.mjs revoke <id>                   # the inquiry's demo account

# demo accounts
node scripts/inquiry.mjs demo list                     # id (email) · status · end (or "no end") · internal/customer · number · locale · logins · last login · inquiry · company
node scripts/inquiry.mjs demo create --id <id> --company-no <digits> [--kind business|corporate|foreign] [--company-name …] [--no-expiry | --days N] [--locale ko|en|zh-CN]
                                                       # an internal account; the password from stdin (piped, or typed twice without echo)
node scripts/inquiry.mjs demo extend <demo id> --days 7  # from its end, or from now when it has ended
node scripts/inquiry.mjs demo revoke <demo id>         # its session ends at once
node scripts/inquiry.mjs demo delete <demo id>         # the account and its usage (test data)
node scripts/inquiry.mjs demo usage <demo id>          # logins, screens viewed, buttons pressed
```

Demo accounts are issued by the Worker when the request comes in, so `issue` is for the rest —
a lost password, a fixed number, a request kept without an account (its IP was over the daily cap,
or it came before 2026-11-13):
- the ID is the request's email; an existing account keeps its ID, gets the new password and
  number, and its end moves out (never in). A revoked account is not re-issued — `demo delete` it
  first; an internal one is refused;
- the password follows the rule (word + the phone's last four — `--phone` stands in for an older
  request without one); with no phone at all a 16-character random password is made. It is printed
  **once**, in your terminal; only its hash is stored;
- `--company-no` with `--kind` replaces the number (checked like the modal: length and check
  digit);
- the request gets `issued`, `demo_account` and `demo_expires_at` and a log row, and a mail draft
  in the request's language is printed for you to send from the agency mailbox (DM4) — the number,
  the ID and the password.

`demo create` makes the agency's own account (`internal`): any ID (an email, or 3–40 letters,
digits, `. _ -`), any 4–20 digit number (no check digit; `--kind business` · `corporate` only shows it with hyphens and needs 10 · 13 digits), `--no-expiry` for no end. The password is
read from stdin — never pass it as an argument (it would land in the shell history and the process
list). Requests never touch an internal account.

`--remote` works on the deployed D1 the same way. `extend` and `revoke` keep the request's
`demo_expires_at` and log in step with the account.

## Privacy policy (`/policy`, 2026-11-14)

**법률 검토 전 초안** — the text is written from what this code does, not reviewed by a lawyer yet.
The page itself does not say so; this note does. The Korean text is authoritative, en and zh-CN
are translations (the page says the Korean version prevails).

- Text: `web/src/marketing/messages/policy.ts` (12 sections: purpose, items, retention, deletion,
  third parties, processors and transfer abroad, rights, safety, cookies, officer, remedies,
  changes). Who and when: `web/src/marketing/messages/site.ts` (representative, contact email,
  effective date). The site footer (landing, `/policy`, `/login`, `/login/help`, `/demo`) reads
  the same file.
- Keep in step: when what is collected, how long it is kept (`RETAIN_DAYS`, `DEMO_DAYS`, the
  cron), the cookie, the D1 location or the processors change, change the policy text,
  `policyEffective` and `CONSENT_VERSION` (and the request modal's consent text) together.
  `web/test/policy.test.tsx` checks the policy's numbers against this `wrangler.toml`.
- Not chosen yet: a mail provider (`src/mail.ts` sends nothing). When one is added, it goes into
  §6 as a processor.

## Deploy (you run these; this repo never deploys)

1. `cd marketing && npm ci`
2. `npx wrangler login`
3. Run `npx wrangler d1 create solosquad-marketing --location apac` and paste the printed
   `database_id` into `wrangler.toml`. The privacy policy (`/policy` §6) states this APAC location
   hint — if you pick another, change `web/src/marketing/messages/policy.ts` too (DM6).
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
