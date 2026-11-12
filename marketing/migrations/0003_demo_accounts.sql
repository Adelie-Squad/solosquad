-- The demo accounts live here now (2026-11-13): the demo is a frontend-only copy of the customer
-- web on this site (`/demo/app`), so the login, its accounts and their usage are this Worker's.
-- No demo server, no engine. One demo for everyone; an account only carries the company it was
-- issued for (its name shows in the demo's settings) and when it ends.

CREATE TABLE demo_accounts (
  id            TEXT PRIMARY KEY,               -- as issued: samsungDemo, samsungDemo2 …
  id_lower      TEXT NOT NULL UNIQUE,           -- logins ignore case
  inquiry_id    TEXT,                           -- the inquiry it answers (no FK: the inquiry may be swept first)
  company_no    TEXT NOT NULL,                  -- normalised like inquiries.company_no (src/validate.ts)
  company_name  TEXT NOT NULL,                  -- 80, from the inquiry
  locale        TEXT NOT NULL DEFAULT 'ko',     -- ko · en · zh-CN: the demo's first language
  password_hash TEXT NOT NULL,                  -- pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL,                  -- the agency handle
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX demo_accounts_inquiry ON demo_accounts (inquiry_id);

-- What a demo account did: login · logout · view (a screen) · action (a button, e.g. run
-- finance-monthly, approve pay). No IP, no user-agent, nothing typed. Kept RETAIN_DAYS (the daily
-- sweep), like the inquiries.
CREATE TABLE demo_events (
  demo_id TEXT NOT NULL,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('login', 'logout', 'view', 'action')),
  detail  TEXT                                  -- 80, e.g. "/o/moa/w/hq/office" · "run:finance-monthly" · "approve:pay"
);
CREATE INDEX demo_events_demo ON demo_events (demo_id, at);
CREATE INDEX demo_events_at ON demo_events (at);
