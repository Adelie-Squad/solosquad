import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The engine serves the build from the same origin (PRD v2.1.0 W5 · I2). In development,
// `solosquad serve` runs on 7420 and Vite proxies /api to it — still one origin for the
// browser, so the session cookie and CSRF token work the same way. No LLM call is ever
// made from here or from the browser: everything goes through the engine.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { '/api': { target: 'http://127.0.0.1:7420', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
