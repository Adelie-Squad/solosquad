-- The company's registration number (2026-11-12): one representative number per inquiry, asked for
-- again at the demo login next to the ID and password. Normalised by src/validate.ts — a Korean
-- 사업자등록번호 (10) or 법인등록번호 (13) as digits only, another country's number (4–30 letters,
-- digits and dashes) upper-cased. NULL only on rows from before this migration.
ALTER TABLE inquiries ADD COLUMN company_no TEXT;
