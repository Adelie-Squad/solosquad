// Writes the 2D penguin (src/characters/PenguinIcon.tsx) as standalone SVG files for the brand
// identity record: identity/character/2d/. Not part of the app build.
//
//   node web/scripts/identity-icons.mjs [outDir]      (default: ../identity/character/2d)
//
// Uses Vite's SSR loader so the TSX component is rendered as it ships — no copy of the shape.
// `--cheek` is a CSS variable in the app; a standalone SVG gets the light value as a fallback.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(web, '..', 'identity', 'character', '2d'));
const SIZES = [20, 28, 40, 64];
const CHEEK = '#E01FAE';

const server = await createServer({ root: web, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { AgentIcon, Mascot, Penguin } = await server.ssrLoadModule('/src/characters/PenguinIcon.tsx');
  const { ROSTER } = await server.ssrLoadModule('/src/characters/roster.ts');

  const write = (rel, el) => {
    const svg = renderToStaticMarkup(el)
      .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
      .replaceAll('var(--cheek)', `var(--cheek, ${CHEEK})`);
    const path = join(out, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${svg}\n`);
    console.log(path);
  };

  for (const size of SIZES) {
    write(`${size}/plain.svg`, h(Penguin, { size, team: null }));
    for (const agent of Object.keys(ROSTER)) write(`${size}/${agent}.svg`, h(AgentIcon, { agent, size }));
    // a role the roster does not know: the scarf in its team colour (here product)
    write(`${size}/custom-role.svg`, h(AgentIcon, { agent: 'custom-role', team: 'product', size }));
  }
  for (const size of [96, 240]) write(`mascot-${size}.svg`, h(Mascot, { size }));
} finally {
  await server.close();
}
