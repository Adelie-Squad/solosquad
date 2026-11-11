// The agency's way into the marketing D1 (PRD §3.6.2 · §3.6.3): `wrangler d1 execute`, nothing
// exposed on the internet. `--local` (default for trying it out against `wrangler dev`) or `--remote`.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATABASE = 'solosquad-marketing';

/** A SQL literal: strings quoted with '' doubled, numbers checked, null as NULL. */
export function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('not a finite number');
    return String(v);
  }
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/\u0000/g, '');
  return `'${s.replace(/'/g, "''")}'`;
}

/** sql`SELECT … WHERE id = ${id}` — every value goes through lit(). */
export function sql(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? lit(values[i]) : ''), '');
}

/** Run statements; the rows of each come back in order. */
export function execute(statements, { remote = false } = {}) {
  const command = statements.join(';\n');
  const args = ['wrangler', 'd1', 'execute', DATABASE, remote ? '--remote' : '--local', '--json', '--command', command];
  const r = spawnSync('npx', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim().split('\n').slice(-5).join('\n');
    throw new Error(`wrangler d1 execute failed:\n${msg}`);
  }
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  return out.map((o) => o.results ?? []);
}

export function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) opts[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[k] = argv[++i];
      else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

/** The agency handle on every change (`SOLOSQUAD_HANDLE`, else the OS user). */
export const handle = () => process.env.SOLOSQUAD_HANDLE || process.env.USER || 'agency';

export const iso = (ms = Date.now()) => new Date(ms).toISOString();
