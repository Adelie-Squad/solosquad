#!/usr/bin/env node
// Login routes (PRD §3.6.2): company code → company server, through `wrangler d1 execute`.
// The last step of setting up a customer (I28) is `route add`.
//
//   node scripts/route.mjs list                                   [--remote]
//   node scripts/route.mjs add <code> <https://server> [--note …]  [--remote]
//   node scripts/route.mjs suspend <code>                         [--remote]
//   node scripts/route.mjs resume <code>                          [--remote]
//
// --remote = the deployed D1; without it, the local one `wrangler dev` uses. The agency handle
// is $SOLOSQUAD_HANDLE (else $USER). Notes are pseudonymous — no names or contact details.
import { execute, handle, iso, parseArgs, sql } from './lib/d1.mjs';
import { checkCode, checkServer } from './lib/routes.mjs';

const { pos, opts } = parseArgs(process.argv.slice(2));
const remote = opts.remote === true;
const [verb, a, b] = pos;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const usage = () => die('usage: route.mjs list | add <code> <https://server> [--note …] | suspend <code> | resume <code>   [--remote]');

function main() {
  if (verb === 'list') {
    const [rows] = execute([sql`SELECT code, kind, server_url, status, note, updated_at, updated_by FROM login_routes ORDER BY kind DESC, code`], { remote });
    for (const r of rows) console.log(`${r.code.padEnd(20)}  ${r.kind.padEnd(8)}  ${r.status.padEnd(9)}  ${r.server_url.padEnd(40)}  ${r.updated_at.slice(0, 16)} ${r.updated_by}${r.note ? `  · ${r.note}` : ''}`);
    return;
  }
  if (verb === 'add') {
    if (!a || !b) usage();
    const code = checkCode(a);
    if (!code.ok) die(code.error);
    const server = checkServer(b, { allowLocal: !remote });
    if (!server.ok) die(server.error);
    const note = typeof opts.note === 'string' ? opts.note.slice(0, 200) : null;
    execute(
      [
        sql`INSERT INTO login_routes (code, kind, server_url, status, note, updated_at, updated_by) VALUES (${code.code}, 'customer', ${server.url}, 'active', ${note}, ${iso()}, ${handle()})
            ON CONFLICT (code) DO UPDATE SET server_url = excluded.server_url, status = 'active', note = coalesce(excluded.note, note), updated_at = excluded.updated_at, updated_by = excluded.updated_by
            WHERE kind = 'customer'`,
      ],
      { remote },
    );
    console.log(`${code.code} → ${server.url}`);
    return;
  }
  if (verb === 'suspend' || verb === 'resume') {
    if (!a) usage();
    const code = checkCode(a);
    if (!code.ok) die(code.error);
    const status = verb === 'suspend' ? 'suspended' : 'active';
    const [changed] = execute([sql`UPDATE login_routes SET status = ${status}, updated_at = ${iso()}, updated_by = ${handle()} WHERE code = ${code.code} AND kind = 'customer' RETURNING code`], { remote });
    if (!changed.length) die(`no route ${code.code}`);
    console.log(`${code.code} ${status}`);
    return;
  }
  usage();
}

try {
  main();
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
