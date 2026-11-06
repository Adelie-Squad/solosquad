import { existsSync } from 'node:fs';
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

// The engine serves the build from the same origin (PRD v2.1.0 W5 · I2). In development,
// `solosquad serve` runs on 7420 and Vite proxies /api to it — still one origin for the
// browser, so the session cookie and CSRF token work the same way. No LLM call is ever
// made from here or from the browser: everything goes through the engine.
export default defineConfig({
  plugins: [react(), officeAssets()],
  server: {
    port: 5180,
    // SOLOSQUAD_API points the proxy at another engine (a second local demo on its own port)
    proxy: { '/api': { target: process.env.SOLOSQUAD_API ?? 'http://127.0.0.1:7420', changeOrigin: false } },
  },
  // the office chunk (three.js · R3F · drei) loads only on /office — the warning is expected there
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1100 },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
