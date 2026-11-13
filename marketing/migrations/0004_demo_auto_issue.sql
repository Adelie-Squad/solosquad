-- Demo accounts issued on the request itself (2026-11-13, the owner's call): no review step. The
-- login ID is the request's email, the password = a word for the email's first letter + the last
-- four digits of the phone (scripts/lib/demo-password.mjs). Registration numbers and phones are
-- digits only, with the number's kind. The agency's own accounts (`internal`) may have no end.

-- the request: the kind of its registration number (business · corporate · foreign — NULL on rows
-- from before), the phone (digits; required with a demo account), and the demo account it was
-- answered with. Several requests from one email share one account, so this is not unique — the
-- old `demo_id` (unique, issued by hand) is no longer written.
ALTER TABLE inquiries ADD COLUMN company_no_kind TEXT;
ALTER TABLE inquiries ADD COLUMN phone TEXT;
ALTER TABLE inquiries ADD COLUMN demo_account TEXT;
UPDATE inquiries SET demo_account = demo_id WHERE demo_id IS NOT NULL;
CREATE INDEX inquiries_demo_account ON inquiries (demo_account);

-- demo_accounts again, so expires_at may be NULL (no end — internal accounts only). Nothing
-- references this table, so it is copied and swapped.
CREATE TABLE demo_accounts_next (
  id              TEXT PRIMARY KEY,             -- the request's email (lower case) · an internal id like "solosquad" · old: samsungDemo
  id_lower        TEXT NOT NULL UNIQUE,         -- logins ignore case
  inquiry_id      TEXT,                         -- the latest request it answers (no FK: the request may be swept first)
  company_no      TEXT NOT NULL,                -- digits (src/validate.ts · scripts/lib/company-no.mjs); old rows may hold letters
  company_no_kind TEXT,                         -- business · corporate · foreign; NULL on old rows
  company_name    TEXT NOT NULL,                -- 80, from the request
  locale          TEXT NOT NULL DEFAULT 'ko',   -- ko · en · zh-CN: the demo's first language
  password_hash   TEXT NOT NULL,                -- pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,                -- 'system' (issued on the request) · the agency handle
  updated_at      TEXT,                         -- the last re-issue (a new request from the same email, `issue`)
  expires_at      TEXT,                         -- NULL = no end (internal accounts)
  revoked_at      TEXT,
  internal        INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)) -- the agency's own (`demo create`)
);
INSERT INTO demo_accounts_next (id, id_lower, inquiry_id, company_no, company_name, locale, password_hash, created_at, created_by, expires_at, revoked_at)
  SELECT id, id_lower, inquiry_id, company_no, company_name, locale, password_hash, created_at, created_by, expires_at, revoked_at FROM demo_accounts;
DROP TABLE demo_accounts;
ALTER TABLE demo_accounts_next RENAME TO demo_accounts;
CREATE INDEX demo_accounts_inquiry ON demo_accounts (inquiry_id);
