#!/usr/bin/env node
// Demo account requests and demo accounts (PRD §3.6.3, 2026-11-13): the requests' list, review and
// reject; the demo accounts' re-issue, list, extend, revoke, usage, and the agency's own accounts —
// all through `wrangler d1 execute` (D1). Nothing here is on the internet, and there is no demo
// server: the demo is the frontend-only copy this site serves at /demo/app, and its accounts are D1
// `demo_accounts`.
//
// A request that asks for a demo account gets it at once from the Worker (POST /api/inquiry —
// no review step): ID = the request's email, password = a word for the email's first letter + the
// last four digits of its phone (scripts/lib/demo-password.mjs), 14 days. So `issue` is for
// re-issuing (a lost password, a fixed number) and for requests that came without an account (one
// IP over its daily cap, an older request).
//
//   node scripts/inquiry.mjs list [--status new|reviewed|issued|rejected]
//   node scripts/inquiry.mjs show <id>
//   node scripts/inquiry.mjs review <id> [--note …]
//   node scripts/inquiry.mjs reject <id> --note …
//   node scripts/inquiry.mjs issue <id> [--days 14] [--company-no <number> --kind business|corporate|uscc|foreign] [--phone <digits>]
//   node scripts/inquiry.mjs extend <id> --days 7          (the request's demo account)
//   node scripts/inquiry.mjs revoke <id>                   (the request's demo account)
//   node scripts/inquiry.mjs demo list
//   node scripts/inquiry.mjs demo create --id <id> --company-no <digits> [--kind business|corporate|foreign] [--company-name …] [--no-expiry | --days N] [--locale ko|en|zh-CN]
//                                         (the password comes from stdin — never an argument)
//   node scripts/inquiry.mjs demo extend <demo id> --days 7
//   node scripts/inquiry.mjs demo revoke <demo id>
//   node scripts/inquiry.mjs demo delete <demo id>         (the account and its usage — for test data)
//   node scripts/inquiry.mjs demo usage <demo id>
//   add --remote to work on the deployed D1 (without it: the local one `wrangler dev` uses)
//
// Only PBKDF2 hashes are stored. The agency handle is $SOLOSQUAD_HANDLE (else $USER). $MARKETING_URL
// is used in the mail draft.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { execute, handle, iso, parseArgs, sql } from './lib/d1.mjs';
import { checkCompanyNo, displayCompanyNo, kindForCountry } from './lib/company-no.mjs';
import { demoPassword } from './lib/demo-password.mjs';
import { hashPassword, newPassword } from './lib/password.mjs';
import { phoneDigits } from './lib/phone.mjs';
import { workflowRunsLine } from './lib/usage.mjs';

const { pos, opts } = parseArgs(process.argv.slice(2));
const remote = opts.remote === true;
const [verb, id, third] = pos;
const run = (statements) => execute(statements, { remote });

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const usage = () =>
  die(
    'usage: inquiry.mjs list [--status …] | show <id> | review <id> [--note] | reject <id> --note | issue <id> [--days 14] [--company-no --kind] [--phone] | extend <id> --days N | revoke <id> | demo list | demo create --id <id> --company-no <digits> [--company-name] [--no-expiry | --days N] [--locale] (password on stdin) | demo extend <demo id> --days N | demo revoke <demo id> | demo delete <demo id> | demo usage <demo id>   [--remote]',
  );

const DAY = 86_400_000;
const LOCALES = ['ko', 'en', 'zh-CN'];
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
/** an internal ID: letters, digits, . _ -, 3–40, starting with a letter or digit */
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/;

const days = (v, fallback) => {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 90) die('--days is a whole number of days, 1–90');
  return n;
};
const log = (inquiryId, action, detail) => sql`INSERT INTO inquiry_log (inquiry_id, ts, actor, action, detail) VALUES (${inquiryId}, ${iso()}, ${handle()}, ${action}, ${detail ? JSON.stringify(detail) : null})`;

function load(inquiryId) {
  if (!inquiryId) usage();
  const [[row]] = run([sql`SELECT * FROM inquiries WHERE id = ${inquiryId}`]);
  if (!row) die(`no inquiry ${inquiryId}`);
  return row;
}

/** The request's demo account id (written by the Worker since 2026-11-13; demo_id before). */
const accountOf = (row) => row.demo_account ?? row.demo_id ?? null;

const MAIL = {
  ko: (d) => `제목: SoloSquad 데모 계정을 보내 드려요\n\n${d.name}님, 신청해 주셔서 고마워요.\n\n데모 로그인: ${d.url}\n법인(사업자)등록번호: ${d.companyNo}\n아이디: ${d.demoId}\n비밀번호: ${d.password}\n사용 기간: ${d.until}까지\n\n데모는 예시 데이터로 움직여요. 궁금한 점은 이 메일에 답장해 주세요.`,
  en: (d) => `Subject: Your SoloSquad demo account\n\nHi ${d.name}, thank you for your request.\n\nDemo login: ${d.url}\nCompany registration number: ${d.companyNo}\nID: ${d.demoId}\nPassword: ${d.password}\nAvailable until: ${d.until}\n\nThe demo runs on sample data. Reply to this email with any questions.`,
  'zh-CN': (d) => `主题：您的 SoloSquad 演示账号\n\n${d.name}，您好，感谢您的申请。\n\n演示登录：${d.url}\n企业注册号：${d.companyNo}\n账号：${d.demoId}\n密码：${d.password}\n使用期限：至 ${d.until}\n\n演示使用示例数据运行。如有问题，请直接回复此邮件。`,
};

/** (Re-)issue the request's account: ID = its email, password by the rule (else 16 random characters), the end moved out. */
async function issue(row) {
  if (row.status === 'rejected') die(`inquiry ${row.id} was rejected — it cannot be issued`);
  const length = days(opts.days, 14);
  const demoId = String(row.email).toLowerCase();

  let companyNo = row.company_no;
  let kind = row.company_no_kind ?? null;
  if (typeof opts['company-no'] === 'string') {
    kind = typeof opts.kind === 'string' ? opts.kind : row.country === 'kr' ? (row.company_no_kind ?? null) : kindForCountry(row.country);
    if (!kind) die('--kind business|corporate|uscc|foreign goes with --company-no');
    const checked = checkCompanyNo(opts['company-no'], kind);
    if (!checked.ok) die(`--company-no: ${checked.error === 'check' ? 'the check digit is wrong' : 'a 사업자등록번호 is 10 digits, a 법인등록번호 13, a 统一社会信用代码 18 letters and digits, another country’s 4–20'}`);
    companyNo = checked.digits;
  }
  if (!companyNo) die(`inquiry ${row.id} has no company registration number — ask for it and pass --company-no --kind`);

  const [[known]] = run([sql`SELECT id, revoked_at, internal FROM demo_accounts WHERE id_lower = ${demoId}`]);
  if (known?.internal) die(`${known.id} is an internal account`);
  if (known?.revoked_at) die(`${known.id} was revoked (${known.revoked_at}) — delete it first (demo delete) to issue it again`);

  const phone = typeof opts.phone === 'string' ? phoneDigits(opts.phone) : (row.phone ?? '');
  const password = demoPassword(demoId, phone) ?? newPassword();
  const now = Date.now();
  const expires = iso(now + length * DAY);
  const locale = MAIL[row.locale] ? row.locale : 'ko';
  const [[acct]] = run([
    sql`INSERT INTO demo_accounts (id, id_lower, inquiry_id, company_no, company_no_kind, company_name, locale, password_hash, created_at, created_by, updated_at, expires_at, internal)
        VALUES (${demoId}, ${demoId}, ${row.id}, ${companyNo}, ${kind}, ${row.company}, ${locale}, ${await hashPassword(password)}, ${iso(now)}, ${handle()}, ${iso(now)}, ${expires}, 0)
        ON CONFLICT (id_lower) DO UPDATE SET inquiry_id = excluded.inquiry_id, company_no = excluded.company_no, company_no_kind = excluded.company_no_kind,
          company_name = excluded.company_name, locale = excluded.locale, password_hash = excluded.password_hash, updated_at = excluded.updated_at,
          expires_at = max(coalesce(demo_accounts.expires_at, ''), excluded.expires_at)
        RETURNING expires_at`,
    sql`UPDATE inquiries SET status = 'issued', demo_account = ${demoId}, demo_issued_at = ${iso(now)}, demo_expires_at = (SELECT expires_at FROM demo_accounts WHERE id_lower = ${demoId}),
          company_no = ${companyNo}, company_no_kind = ${kind}, reviewed_at = coalesce(reviewed_at, ${iso(now)}), reviewed_by = coalesce(reviewed_by, ${handle()}), updated_at = ${iso(now)}
        WHERE id = ${row.id} AND status != 'rejected'`,
    log(row.id, 'issued', { reused: !!known, days: length }),
  ]);
  const until = acct?.expires_at ?? expires;
  const url = `${(process.env.MARKETING_URL ?? 'https://solosquad.example.com').replace(/\/+$/, '')}/demo`;
  const shown = displayCompanyNo(companyNo, kind);
  console.log(`${known ? 're-issued' : 'issued'} ${demoId} for inquiry ${row.id} (${row.company}, company no ${shown}), until ${until}`);
  console.log(`password: ${password}   (${demoPassword(demoId, phone) ? 'the rule: word + the phone’s last four' : 'random — the request has no phone'}; only its hash is kept)`);
  console.log(`\n--- mail draft (${locale}) to ${row.email} — send it from the agency mailbox ---\n`);
  console.log(MAIL[locale]({ name: row.contact_name, companyNo: shown, demoId, url, until: until.slice(0, 10), password }));
}

function demoAccount(demoId) {
  if (!demoId) usage();
  const [[acct]] = run([sql`SELECT * FROM demo_accounts WHERE id_lower = ${String(demoId).toLowerCase()}`]);
  if (!acct) die(`no demo account ${demoId}`);
  return acct;
}

const statusOf = (a, now = Date.now()) => (a.revoked_at ? 'revoked' : a.expires_at && Date.parse(a.expires_at) <= now ? 'expired' : 'active');

function extendDemo(acct, more) {
  if (acct.revoked_at) die(`${acct.id} was revoked — issue a new one`);
  if (!acct.expires_at) die(`${acct.id} has no end`);
  const until = iso(Math.max(Date.now(), Date.parse(acct.expires_at) || 0) + more * DAY);
  run([
    sql`UPDATE demo_accounts SET expires_at = ${until} WHERE id = ${acct.id}`,
    sql`UPDATE inquiries SET demo_expires_at = ${until}, updated_at = ${iso()} WHERE demo_account = ${acct.id} OR demo_id = ${acct.id}`,
    ...(acct.inquiry_id ? [log(acct.inquiry_id, 'extended', { days: more })] : []),
  ]);
  console.log(`${acct.id} until ${until}`);
}

function revokeDemo(acct) {
  if (acct.revoked_at) die(`${acct.id} was already revoked (${acct.revoked_at})`);
  const now = iso();
  run([
    sql`UPDATE demo_accounts SET revoked_at = ${now} WHERE id = ${acct.id}`,
    sql`UPDATE inquiries SET demo_expires_at = ${now}, updated_at = ${now} WHERE demo_account = ${acct.id} OR demo_id = ${acct.id}`,
    ...(acct.inquiry_id ? [log(acct.inquiry_id, 'revoked')] : []),
  ]);
  console.log(`${acct.id} revoked — its session ends now`);
}

/** The password for `demo create`: piped on stdin (one line), or typed twice without echo. */
async function readPassword() {
  if (!process.stdin.isTTY) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    return text.replace(/\r?\n$/, '');
  }
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const ask = async (q) => {
    process.stdout.write(q);
    muted = true;
    const answer = await rl.question('');
    muted = false;
    process.stdout.write('\n');
    return answer;
  };
  const first = await ask('password: ');
  const again = await ask('again: ');
  rl.close();
  if (first !== again) die('the two passwords differ');
  return first;
}

/** The agency's own account (internal): any ID, any 4–20 digit number (no check digit), maybe no end. */
async function createDemo() {
  const demoId = typeof opts.id === 'string' ? opts.id.normalize('NFKC').trim() : '';
  if (!(EMAIL.test(demoId) || PLAIN_ID.test(demoId))) die('--id: an email, or 3–40 letters, digits, . _ - (e.g. solosquad)');
  const checked = checkCompanyNo(typeof opts['company-no'] === 'string' ? opts['company-no'] : '', null, { internal: true });
  if (!checked.ok) die('--company-no: 4–20 digits');
  // the kind only says how the number is shown (business 10 digits · corporate 13); no check digit here
  const kind = typeof opts.kind === 'string' ? opts.kind : 'foreign';
  if (!['business', 'corporate', 'foreign'].includes(kind)) die('--kind: business, corporate or foreign');
  if ((kind === 'business' && checked.digits.length !== 10) || (kind === 'corporate' && checked.digits.length !== 13)) die(`--kind ${kind}: ${kind === 'business' ? 10 : 13} digits`);
  const name = typeof opts['company-name'] === 'string' ? opts['company-name'].trim().slice(0, 80) : 'SoloSquad';
  const locale = typeof opts.locale === 'string' ? opts.locale : 'ko';
  if (!LOCALES.includes(locale)) die('--locale: ko, en or zh-CN');
  const noEnd = opts['no-expiry'] === true;
  if (noEnd && opts.days !== undefined) die('--no-expiry or --days, not both');
  const expires = noEnd ? null : iso(Date.now() + days(opts.days, 14) * DAY);

  const [[taken]] = run([sql`SELECT id FROM demo_accounts WHERE id_lower = ${demoId.toLowerCase()}`]);
  if (taken) die(`${taken.id} already exists — demo delete it first to make it again`);
  const password = await readPassword();
  if (password.length < 8 || password.length > 128) die('the password is 8–128 characters');
  const now = iso();
  run([
    sql`INSERT INTO demo_accounts (id, id_lower, inquiry_id, company_no, company_no_kind, company_name, locale, password_hash, created_at, created_by, updated_at, expires_at, internal)
        VALUES (${demoId}, ${demoId.toLowerCase()}, NULL, ${checked.digits}, ${kind}, ${name}, ${locale}, ${await hashPassword(password)}, ${now}, ${handle()}, ${now}, ${expires}, 1)`,
  ]);
  console.log(`created internal demo account ${demoId} (${name}, company no ${displayCompanyNo(checked.digits, kind)}), ${expires ? `until ${expires}` : 'no end'}`);
}

function demoCommand(sub, demoId) {
  if (sub === 'list') {
    const [rows] = run([
      sql`SELECT a.*, (SELECT max(at) FROM demo_events e WHERE e.demo_id = a.id AND e.kind = 'login') AS last_login,
                 (SELECT count(*) FROM demo_events e WHERE e.demo_id = a.id AND e.kind = 'login') AS logins
          FROM demo_accounts a ORDER BY a.created_at DESC LIMIT 200`,
    ]);
    for (const a of rows) {
      console.log(
        [
          a.id.padEnd(32),
          statusOf(a).padEnd(8),
          (a.expires_at ? a.expires_at.slice(0, 16) : 'no end').padEnd(16),
          a.internal ? 'internal' : 'customer',
          displayCompanyNo(a.company_no, a.company_no_kind).padEnd(14),
          a.locale.padEnd(5),
          String(a.logins).padStart(3),
          (a.last_login ?? '-').slice(0, 16).padEnd(16),
          a.inquiry_id ?? '-',
          a.company_name,
        ].join('  '),
      );
    }
    if (!rows.length) console.log('(none)');
    return;
  }
  if (sub === 'create') return createDemo();
  if (sub === 'extend') return extendDemo(demoAccount(demoId), days(opts.days, 7));
  if (sub === 'revoke') return revokeDemo(demoAccount(demoId));
  if (sub === 'delete') {
    const acct = demoAccount(demoId);
    run([
      sql`DELETE FROM demo_events WHERE demo_id = ${acct.id}`,
      sql`DELETE FROM demo_accounts WHERE id = ${acct.id}`,
      sql`UPDATE inquiries SET demo_expires_at = ${iso()}, updated_at = ${iso()} WHERE demo_account = ${acct.id} OR demo_id = ${acct.id}`,
    ]);
    console.log(`${acct.id} deleted, with its usage`);
    return;
  }
  if (sub === 'usage') {
    const acct = demoAccount(demoId);
    const [events] = run([sql`SELECT kind, detail, count(*) AS n, min(at) AS first, max(at) AS last FROM demo_events WHERE demo_id = ${acct.id} GROUP BY kind, detail ORDER BY kind, n DESC`]);
    const by = (k) => events.filter((e) => e.kind === k);
    const total = (k) => by(k).reduce((s, e) => s + e.n, 0);
    const logins = by('login')[0];
    console.log(`${acct.id} · ${acct.company_name} · inquiry ${acct.inquiry_id ?? '-'} · ${statusOf(acct)} ${acct.expires_at ? `until ${acct.expires_at.slice(0, 16)}` : '(no end)'}${acct.internal ? ' · internal' : ''}`);
    console.log(workflowRunsLine(events));
    console.log(`logins ${total('login')} (first ${logins?.first?.slice(0, 16) ?? '-'}, last ${logins?.last?.slice(0, 16) ?? '-'}) · logouts ${total('logout')} · screens ${total('view')} · actions ${total('action')}`);
    for (const k of ['view', 'action']) {
      if (!by(k).length) continue;
      console.log(`\n${k === 'view' ? 'screens viewed' : 'buttons pressed'}:`);
      for (const e of by(k)) console.log(`  ${String(e.n).padStart(4)}  ${e.detail ?? '-'}`);
    }
    return;
  }
  usage();
}

async function main() {
  if (verb === 'list') {
    const status = typeof opts.status === 'string' ? opts.status : null;
    const cols = 'id, created_at, status, company, company_no, company_no_kind, business_type, country, requests, source, demo_id, demo_account, demo_expires_at';
    const [rows] = run([
      status
        ? `SELECT ${cols} FROM inquiries WHERE status = ${sql`${status}`} ORDER BY created_at DESC LIMIT 200`
        : `SELECT ${cols} FROM inquiries ORDER BY created_at DESC LIMIT 200`,
    ]);
    for (const q of rows) {
      console.log(
        [q.id, q.created_at.slice(0, 16), q.status.padEnd(8), (accountOf(q) ?? '-').padEnd(32), displayCompanyNo(q.company_no, q.company_no_kind).padEnd(14), q.country.padEnd(5), q.requests.padEnd(18), q.source.padEnd(13), q.company].join(
          '  ',
        ),
      );
    }
    if (!rows.length) console.log('(none)');
    return;
  }
  if (verb === 'show') {
    const row = load(id);
    const [entries] = run([sql`SELECT ts, actor, action, detail FROM inquiry_log WHERE inquiry_id = ${row.id} ORDER BY ts`]);
    console.log(JSON.stringify({ ...row, wants: JSON.parse(row.wants), requests: JSON.parse(row.requests), log: entries }, null, 2));
    return;
  }
  if (verb === 'review') {
    const row = load(id);
    if (row.status !== 'new') die(`inquiry ${row.id} is ${row.status}`);
    const note = typeof opts.note === 'string' ? opts.note.slice(0, 1000) : null;
    run([
      sql`UPDATE inquiries SET status = 'reviewed', reviewed_at = ${iso()}, reviewed_by = ${handle()}, review_note = coalesce(${note}, review_note), updated_at = ${iso()} WHERE id = ${row.id}`,
      log(row.id, 'reviewed'),
    ]);
    console.log(`inquiry ${row.id} reviewed`);
    return;
  }
  if (verb === 'reject') {
    const row = load(id);
    if (accountOf(row)) die(`inquiry ${row.id} has a demo account (${accountOf(row)}) — revoke it instead`);
    if (typeof opts.note !== 'string') die('reject needs --note (why — pseudonymous)');
    run([
      sql`UPDATE inquiries SET status = 'rejected', reviewed_at = ${iso()}, reviewed_by = ${handle()}, review_note = ${opts.note.slice(0, 1000)}, updated_at = ${iso()} WHERE id = ${row.id}`,
      log(row.id, 'rejected'),
    ]);
    console.log(`inquiry ${row.id} rejected`);
    return;
  }
  if (verb === 'issue') return issue(load(id));
  if (verb === 'extend' || verb === 'revoke') {
    const row = load(id);
    if (!accountOf(row)) die(`inquiry ${row.id} has no demo account`);
    const acct = demoAccount(accountOf(row));
    return verb === 'extend' ? extendDemo(acct, days(opts.days, 7)) : revokeDemo(acct);
  }
  if (verb === 'demo') return demoCommand(id, third);
  usage();
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
