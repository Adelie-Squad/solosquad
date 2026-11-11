import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `import url from 'office-asset:office-kit.glb'` → a hashed asset URL. The file comes from the
 * Blender session's export (`assets/office/export/`, asset contract §1) when it is there, else
 * from the placeholder kit (`web/office-placeholder/`, same names) — so delivering the real GLBs
 * is a file drop, no code change. `OFFICE_ASSETS=placeholder` forces the placeholder.
 */
function officeAssets(): Plugin {
  const real = join(here, '..', 'assets', 'office', 'export');
  const stand = join(here, 'office-placeholder');
  const PREFIX = 'office-asset:';
  const pick = (file: string) => {
    const r = join(real, file);
    return process.env.OFFICE_ASSETS !== 'placeholder' && existsSync(r) ? r : join(stand, file);
  };
  return {
    name: 'solosquad-office-assets',
    enforce: 'pre',
    buildStart() {
      for (const f of ['office-kit.glb', 'penguin.glb']) this.info(`office ${f} <- ${pick(f)}`);
    },
    resolveId(id) {
      if (!id.startsWith(PREFIX)) return null;
      return `${pick(id.slice(PREFIX.length))}?url`;
    },
  };
}

/**
 * `import catalog from 'virtual:agent-catalog'` → the bundled agents' `display_name` and `summary`
 * (per language) from `agents/{main,specialists}/<id>/SKILL.md` frontmatter, read at build time.
 * The landing shows the team before anyone logs in, when `/api/…/agents` cannot answer — the same
 * words the app shows, from the same files.
 */
function agentCatalog(): Plugin {
  const ID = 'virtual:agent-catalog';
  const RESOLVED = `\0${ID}`;
  const agentsDir = join(here, '..', 'agents');
  const files = () =>
    ['main', 'specialists'].flatMap((group) => {
      const dir = join(agentsDir, group);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .map((id) => ({ id, file: join(dir, id, 'SKILL.md') }))
        .filter((f) => existsSync(f.file));
    });
  /** A `key:` block of `  <lang>: "<text>"` lines (YAML double-quoted strings are JSON strings here). */
  const block = (front: string, key: string): Record<string, string> | null => {
    const lines = front.split(/\r?\n/);
    const at = lines.findIndex((l) => l.trimEnd() === `${key}:`);
    if (at < 0) return null;
    const out: Record<string, string> = {};
    for (const line of lines.slice(at + 1)) {
      const m = /^\s+([A-Za-z-]+):\s*(".*")\s*$/.exec(line);
      if (!m) break;
      try {
        out[m[1]] = JSON.parse(m[2]) as string;
      } catch {
        out[m[1]] = m[2].slice(1, -1);
      }
    }
    return Object.keys(out).length ? out : null;
  };
  return {
    name: 'solosquad-agent-catalog',
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const catalog: Record<string, { display_name: Record<string, string> | null; summary: Record<string, string> | null }> = {};
      for (const { id: agent, file } of files()) {
        this.addWatchFile(file);
        const text = readFileSync(file, 'utf8');
        const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
        catalog[agent] = { display_name: block(front, 'display_name'), summary: block(front, 'summary') };
      }
      return `export default ${JSON.stringify(catalog)};`;
    },
  };
}

/**
 * `vite build --mode marketing` (decision 62): the same index.html with the marketing entry — the
 * landing, the login router, the demo login and the privacy page, no app shell — written to
 * `../marketing/public` for the site Worker's static assets. Customer servers never serve the landing.
 */
function marketingEntry(): Plugin {
  return {
    name: 'solosquad-marketing-entry',
    // 'pre': before Vite reads the entry script out of the page
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('/src/main.tsx', '/src/marketing/main.tsx') },
  };
}

// The engine serves the build from the same origin (PRD v2.1.0 W5 · I2). In development,
// `solosquad serve` runs on 7420 and Vite proxies /api to it — still one origin for the
// browser, so the session cookie and CSRF token work the same way. No LLM call is ever
// made from here or from the browser: everything goes through the engine.
export default defineConfig(({ mode }) => {
  const marketing = mode === 'marketing';
  return {
    plugins: [react(), officeAssets(), agentCatalog(), ...(marketing ? [marketingEntry()] : [])],
    server: {
      port: 5180,
      // SOLOSQUAD_API points the proxy at another engine (a second local demo on its own port);
      // in marketing mode /api is the marketing Worker (`wrangler dev`, 8787)
      proxy: { '/api': { target: process.env.SOLOSQUAD_API ?? (marketing ? 'http://127.0.0.1:8787' : 'http://127.0.0.1:7420'), changeOrigin: false } },
    },
    // the 3D chunk (three.js · R3F · drei) loads only on the office screen and the landing — the warning is expected there
    build: marketing
      ? { outDir: join(here, '..', 'marketing', 'public'), emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1100 }
      : { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1100 },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{ts,tsx}'],
    },
  };
});
