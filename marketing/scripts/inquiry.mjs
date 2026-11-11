#!/usr/bin/env node
// Demo account requests (PRD §3.6.3): review, issue, reject, extend and revoke, through
// `wrangler d1 execute` (D1) and `ssh` (the demo server). Nothing here is on the internet.
//
//   node scripts/inquiry.mjs list [--status new|reviewed|issued|rejected]
//   node scripts/inquiry.mjs show <id>
//   node scripts/inquiry.mjs review <id> [--note …]
//   node scripts/inquiry.mjs reject <id> --note …
//   node scripts/inquiry.mjs issue <id> [--slug samsung] [--days 14] [--company-no …] [--record]
//   node scripts/inquiry.mjs extend <id> --days 7
//   node scripts/inquiry.mjs revoke <id>
//   add --remote to work on the deployed D1 (without it: the local one `wrangler dev` uses)
//
// The demo server: $DEMO_SSH (an ssh host, e.g. "demo") runs `solosquad demo issue|extend|revoke`
// there. The account's password appears once, in this terminal, and is stored nowhere else. Without
// $DEMO_SSH the command is printed for you to run; `issue … --record` then writes the result to D1.
// The inquiry's company registration number goes to the demo server with the ID (the demo login
// asks for it); `--company-no` stands in for it on a request from before the number was asked.
// The agency handle is $SOLOSQUAD_HANDLE (else $USER). $MARKETING_URL is used in the mail draft.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { execute, handle, iso, parseArgs, sql } from './lib/d1.mjs';
import { normalizeCompanyNo } from './lib/company-no.mjs';
import { demoIssueArgs, nextDemoId, SLUG, slugFrom } from './lib/demo-id.mjs';

const { pos, opts } = parseArgs(process.argv.slice(2));
const remote = opts.remote === true;
const [verb, id] = pos;
const run = (statements) => execute(statements, { remote });

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const usage = () => die('usage: inquiry.mjs list [--status …] | show <id> | review <id> [--note] | reject <id> --note | issue <id> [--slug] [--days 14] [--company-no] [--record] | extend <id> --days N | revoke <id>   [--remote]');

const DAY = 86_400_000;
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

/** Run a demo-server command over ssh (the terminal sees its output — the password, once). */
function onDemoServer(args) {
  const host = process.env.DEMO_SSH;
  const quoted = args.map((a) => (/^[A-Za-z0-9_./:=-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(' ');
  if (!host) return { ran: false, command: quoted };
  const r = spawnSync('ssh', [host, quoted], { stdio: 'inherit' });
  if (r.status !== 0) die(`the demo server refused (ssh ${host} ${quoted})`);
  return { ran: true, command: quoted };
}

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
  rl.close();
  return answer || fallback;
}

const MAIL = {
  ko: (d) => `제목: SoloSquad 데모 계정을 보내 드려요\n\n${d.name}님, 신청해 주셔서 고마워요.\n\n데모 로그인: ${d.url}\n법인(사업자)등록번호: ${d.companyNo}\n아이디: ${d.demoId}\n비밀번호: (데모 서버가 위에 한 번 보인 비밀번호)\n사용 기간: ${d.until}까지\n\n데모는 예시 데이터로 움직여요. 궁금한 점은 이 메일에 답장해 주세요.`,
  en: (d) => `Subject: Your SoloSquad demo account\n\nHi ${d.name}, thank you for your request.\n\nDemo login: ${d.url}\nCompany registration number: ${d.companyNo}\nID: ${d.demoId}\nPassword: (the one the demo server showed above, once)\nAvailable until: ${d.until}\n\nThe demo runs on sample data. Reply to this email with any questions.`,
  'zh-CN': (d) => `主题：您的 SoloSquad 演示账号\n\n${d.name}，您好，感谢您的申请。\n\n演示登录：${d.url}\n企业注册号：${d.companyNo}\n账号：${d.demoId}\n密码：（演示服务器在上方显示过一次的密码）\n使用期限：至 ${d.until}\n\n演示使用示例数据运行。如有问题，请直接回复此邮件。`,
};

async function issue(row) {
  if (row.status === 'rejected') die(`inquiry ${row.id} was rejected — it cannot be issued`);
  if (row.demo_id) die(`already issued: ${row.demo_id} (until ${row.demo_expires_at}) — use extend`);
  const length = days(opts.days, 14);

  let slug = typeof opts.slug === 'string' ? opts.slug.trim().toLowerCase() : null;
  if (!slug) {
    const suggestion = slugFrom(row.company) ?? slugFrom(row.contact_name);
    slug = String((await ask(`slug for "${row.company}" / "${row.contact_name}"`, suggestion ?? '')) ?? '').toLowerCase();
  }
  if (!SLUG.test(slug)) die('a slug is a-z then a-z 0-9, 3–16 characters (--slug)');
  const companyNo = typeof opts['company-no'] === 'string' ? normalizeCompanyNo(opts['company-no']) : row.company_no;
  if (!companyNo) die(typeof opts['company-no'] === 'string' ? '--company-no: a 사업자등록번호 (10 digits), 법인등록번호 (13) or another country’s number (4–30 letters, digits, dashes)' : `inquiry ${row.id} has no company registration number — ask for it and pass --company-no`);

  const [taken] = run([sql`SELECT demo_id FROM inquiries WHERE demo_id IS NOT NULL AND lower(demo_id) LIKE ${`${slug}demo%`}`]);
  const demoId = nextDemoId(
    slug,
    taken.map((t) => t.demo_id),
  );
  const now = Date.now();
  const expires = iso(now + length * DAY);

  const demo = onDemoServer(demoIssueArgs({ demoId, inquiryId: row.id, companyNo, days: length, locale: row.locale }));
  if (!demo.ran && opts.record !== true) {
    const again = companyNo === row.company_no ? '' : ` --company-no ${companyNo}`;
    console.log(`demo ID: ${demoId}  (inquiry ${row.id}, company no ${companyNo}, ${length} days)\n\nrun on the demo server:\n  ${demo.command}\n\nthen record it:\n  node scripts/inquiry.mjs issue ${row.id} --slug ${slug} --days ${length}${again} --record${remote ? ' --remote' : ''}`);
    return;
  }
  run([
    sql`UPDATE inquiries SET status = 'issued', demo_id = ${demoId}, demo_issued_at = ${iso(now)}, demo_expires_at = ${expires}, company_no = ${companyNo},
          reviewed_at = coalesce(reviewed_at, ${iso(now)}), reviewed_by = coalesce(reviewed_by, ${handle()}), updated_at = ${iso(now)}
        WHERE id = ${row.id} AND demo_id IS NULL AND status != 'rejected'`,
    log(row.id, 'issued', { demo_id: demoId, days: length }),
  ]);
  const locale = MAIL[row.locale] ? row.locale : 'ko';
  const url = `${(process.env.MARKETING_URL ?? 'https://solosquad.example.com').replace(/\/+$/, '')}/demo?u=${encodeURIComponent(demoId)}`;
  console.log(`issued ${demoId} for inquiry ${row.id}, until ${expires}\n\n--- mail draft (${locale}) to ${row.email} — send it from the agency mailbox ---\n`);
  console.log(MAIL[locale]({ name: row.contact_name, companyNo, demoId, url, until: expires.slice(0, 10) }));
}

async function main() {
  if (verb === 'list') {
    const status = typeof opts.status === 'string' ? opts.status : null;
    const [rows] = run([
      status
        ? sql`SELECT id, created_at, status, company, company_no, business_type, country, requests, source, demo_id, demo_expires_at FROM inquiries WHERE status = ${status} ORDER BY created_at DESC LIMIT 200`
        : sql`SELECT id, created_at, status, company, company_no, business_type, country, requests, source, demo_id, demo_expires_at FROM inquiries ORDER BY created_at DESC LIMIT 200`,
    ]);
    for (const q of rows) {
      console.log([q.id, q.created_at.slice(0, 16), q.status.padEnd(8), (q.demo_id ?? '-').padEnd(18), (q.company_no ?? '-').padEnd(14), q.country.padEnd(5), q.requests.padEnd(18), q.source.padEnd(13), q.company].join('  '));
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
    if (row.demo_id) die(`inquiry ${row.id} has a demo account (${row.demo_id}) — revoke it instead`);
    if (typeof opts.note !== 'string') die('reject needs --note (why — pseudonymous)');
    run([
      sql`UPDATE inquiries SET status = 'rejected', reviewed_at = ${iso()}, reviewed_by = ${handle()}, review_note = ${opts.note.slice(0, 1000)}, updated_at = ${iso()} WHERE id = ${row.id}`,
      log(row.id, 'rejected'),
    ]);
    console.log(`inquiry ${row.id} rejected`);
    return;
  }
  if (verb === 'issue') return issue(load(id));
  if (verb === 'extend') {
    const row = load(id);
    if (!row.demo_id) die(`inquiry ${row.id} has no demo account`);
    const more = days(opts.days, 7);
    const from = Math.max(Date.now(), Date.parse(row.demo_expires_at ?? '') || 0);
    const until = iso(from + more * DAY);
    const demo = onDemoServer(['solosquad', 'demo', 'extend', '--id', row.demo_id, '--days', String(more)]);
    if (!demo.ran) console.log(`run on the demo server:\n  ${demo.command}\n`);
    run([sql`UPDATE inquiries SET demo_expires_at = ${until}, updated_at = ${iso()} WHERE id = ${row.id}`, log(row.id, 'extended', { days: more })]);
    console.log(`${row.demo_id} until ${until}`);
    return;
  }
  if (verb === 'revoke') {
    const row = load(id);
    if (!row.demo_id) die(`inquiry ${row.id} has no demo account`);
    const demo = onDemoServer(['solosquad', 'demo', 'revoke', '--id', row.demo_id]);
    if (!demo.ran) console.log(`run on the demo server:\n  ${demo.command}\n`);
    run([sql`UPDATE inquiries SET demo_expires_at = ${iso()}, updated_at = ${iso()} WHERE id = ${row.id}`, log(row.id, 'revoked')]);
    console.log(`${row.demo_id} revoked`);
    return;
  }
  usage();
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
