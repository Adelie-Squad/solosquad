#!/usr/bin/env node
// Check office GLBs against the asset contract (docs/design/office-asset-contract.md) — the same
// check the web runs in development and the tests run on the placeholder.
//
//   npm --prefix web run check:office-assets                       # assets/office/export/
//   npm --prefix web run check:office-assets -- <dir>              # <dir>/office-kit.glb + penguin.glb
//   npm --prefix web run check:office-assets -- <a.glb> <b.glb>    # kind from the file name
//
// Relative paths resolve from where npm was run. Exit 1 when something the web needs is missing;
// warnings (budget, AO, compression, matte look) do not fail. Needs Node ≥ 22.18 (type stripping).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOfficeAssets, formatReport } from '../src/office/contract.ts';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2).filter((a) => a !== '--');
const targets = args.length ? args.map((a) => resolve(base, a)) : [join(here, '..', '..', 'assets', 'office', 'export')];

const files = {};
for (const t of targets) {
  if (existsSync(t) && statSync(t).isDirectory()) {
    for (const [kind, name] of [['kit', 'office-kit.glb'], ['penguin', 'penguin.glb']]) {
      const p = join(t, name);
      if (existsSync(p)) files[kind] = p;
    }
  } else if (existsSync(t)) {
    files[/penguin/i.test(basename(t)) ? 'penguin' : 'kit'] = t;
  } else {
    console.error(`no such file or directory: ${t}`);
    process.exit(2);
  }
}

const bytes = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, new Uint8Array(readFileSync(p))]));
const reports = checkOfficeAssets(bytes);
for (const [k, p] of Object.entries(files)) console.log(`${k.padEnd(8)}${p}  ${(bytes[k].byteLength / 1024).toFixed(1)} kB`);
console.log(formatReport(reports));
const missing = reports.reduce((n, r) => n + r.missing.length, 0);
const warnings = reports.reduce((n, r) => n + r.warnings.length, 0);
console.log(`\n${missing ? 'FAIL' : 'PASS'} — ${missing} missing, ${warnings} warnings`);
process.exit(missing ? 1 : 0);
