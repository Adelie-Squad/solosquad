-- SoloSquad marketing site (decision 62, PRD v2.1.0 §3.6.3): demo account requests, their
-- handling log, the login routes (company code → company server) and the per-IP counters.

-- One inquiry = one row. Personal data — deleted after retain_until (the daily cron trigger).
CREATE TABLE inquiries (
  id               TEXT PRIMARY KEY,          -- ULID (time-ordered, hard to guess)
  created_at       TEXT NOT NULL,             -- ISO-8601 UTC
  updated_at       TEXT NOT NULL,
  -- the form (§3.5.2 ⑥)
  company          TEXT NOT NULL,             -- 80
  business_type    TEXT NOT NULL,             -- retail · online · maker · service · partner · other
  country          TEXT NOT NULL,             -- kr · cn · other
  contact_name     TEXT NOT NULL,             -- 40
  email            TEXT NOT NULL,
  reach_kind       TEXT,                      -- phone · kakao · wechat
  reach_value      TEXT,                      -- 60
  wants            TEXT NOT NULL,             -- JSON: finance · sourcing · sns · other
  requests         TEXT NOT NULL,             -- JSON: demo · consult
  message          TEXT,                      -- 1000
  -- consent (C52 · C60)
  consent_required INTEGER NOT NULL CHECK (consent_required = 1),
  consent_demo     INTEGER NOT NULL DEFAULT 0, -- DM6 ⓑ: the demo-usage line, required when requests has demo
  consent_version  TEXT NOT NULL,
  consent_news     INTEGER NOT NULL DEFAULT 0, -- news, apart from the required consent
  locale           TEXT NOT NULL,             -- ko · en · zh-CN
  source           TEXT NOT NULL,             -- landing_hero · landing_start · pricing · demo_login
  opened_at        TEXT,                      -- when the form was opened (the 3-second rule)
  -- handling
  status           TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'reviewed', 'issued', 'rejected')),
  reviewed_at      TEXT,
  reviewed_by      TEXT,                      -- the agency handle
  review_note      TEXT,                      -- pseudonymous note
  demo_id          TEXT UNIQUE,               -- e.g. samsungDemo
  demo_issued_at   TEXT,
  demo_expires_at  TEXT,
  retain_until     TEXT NOT NULL              -- created_at + the retention period
);
CREATE INDEX inquiries_status ON inquiries (status, created_at);
CREATE INDEX inquiries_email ON inquiries (email, created_at);

-- Who reviewed · issued · rejected · extended, and when. Deleted with the inquiry.
CREATE TABLE inquiry_log (
  inquiry_id TEXT NOT NULL REFERENCES inquiries (id) ON DELETE CASCADE,
  ts         TEXT NOT NULL,
  actor      TEXT NOT NULL,                   -- 'system' · an agency handle
  action     TEXT NOT NULL,                   -- created · reviewed · issued · rejected · extended · revoked · notified
  detail     TEXT                             -- JSON, no personal data
);
CREATE INDEX inquiry_log_inquiry ON inquiry_log (inquiry_id, ts);

-- §3.6.2: company code → server. No people, no passwords. Codes "demo" and "…demo" are reserved.
CREATE TABLE login_routes (
  code       TEXT PRIMARY KEY,                -- a-z 0-9, 3–20, lower case
  kind       TEXT NOT NULL CHECK (kind IN ('customer', 'demo')),
  server_url TEXT NOT NULL,                   -- https://office.moa.co.kr (customer) · /demo (demo)
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  note       TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
INSERT INTO login_routes (code, kind, server_url, status, note, updated_at, updated_by)
VALUES ('demo', 'demo', '/demo', 'active', 'reserved: the demo login', '2026-11-11T00:00:00Z', 'system');

-- fixed-window counters per hashed IP (kept a day at most); no Durable Objects, no KV
CREATE TABLE rate_limits (
  bucket       TEXT    NOT NULL,              -- "route-min:<hash>" · "route-hour:<hash>" · "inquiry:<hash>"
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
