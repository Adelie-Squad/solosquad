// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dictionaries, LOCALES, translate } from '../src/i18n';
import { ko } from '../src/i18n/ko';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionaries (I31 · K36)', () => {
  const keys = Object.keys(ko).sort();

  it.each(LOCALES)('%s has every key, no extra key and no empty text', (locale) => {
    const dict = dictionaries[locale];
    expect(Object.keys(dict).sort()).toEqual(keys);
    for (const k of keys) expect(dict[k as keyof typeof ko].trim(), `${locale} ${k}`).not.toBe('');
  });

  it.each(LOCALES)('%s keeps the same {placeholders} as ko', (locale) => {
    for (const k of keys) {
      expect(placeholders(dictionaries[locale][k as keyof typeof ko]), `${locale} ${k}`).toEqual(placeholders(ko[k as keyof typeof ko]));
    }
  });

  it('fills placeholders and defaults to ko', () => {
    expect(translate('en', 'approvals.needsTeam', { team: 'core' })).toBe('Members of team core, or the owner, approve this.');
    expect(translate('ko', 'nav.dashboard')).toBe('대시보드');
  });
});

describe('no unused keys', () => {
  it('every key is used somewhere in src (or built from a known prefix)', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const code: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== 'i18n') walk(p);
        } else if (/\.tsx?$/.test(name)) code.push(readFileSync(p, 'utf8'));
      }
    };
    walk(src);
    const all = code.join('\n');
    const built = ['category.', 'connections.kind.', 'artifact.kind.', 'messenger.channel.', 'calendar.view.', 'calendar.kind.', 'calendar.color.']; // `category.${c}` · `connections.kind.${k}` · `artifact.kind.${k}` · `messenger.channel.${c}`
    const unused = Object.keys(ko).filter((k) => !all.includes(`'${k}'`) && !built.some((p) => k.startsWith(p)));
    expect(unused).toEqual([]);
  });
});

describe('no hard-coded Korean in components', () => {
  const src = fileURLToPath(new URL('../src', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'i18n') walk(p);
      } else if (/\.(tsx?|mts)$/.test(name) && !name.endsWith('.gen.ts')) files.push(p);
    }
  };
  walk(src);

  it('finds the source files', () => expect(files.length).toBeGreaterThan(20));

  it.each(files.map((f) => [relative(src, f), f]))('%s has no Hangul outside comments', (_name, file) => {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    expect(code.match(/[ㄱ-힝]+/g)).toBeNull();
  });
});
