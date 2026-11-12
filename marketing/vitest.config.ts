import { mkdirSync } from 'node:fs';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Static assets come from the marketing build of web/; the Worker tests do not need it built.
mkdirSync(new URL('./public', import.meta.url), { recursive: true });

// Two projects: the Worker in Miniflare (workerd + an in-memory D1 — no Cloudflare account), and
// the agency scripts' pure parts (demo IDs, route checks, SQL quoting) in Node.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.toml' },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  FORM_SECRET: 'test-form-secret',
                  IP_SALT: 'test-salt',
                  ROUTE_PAD_MS: '40',
                  DEMO_SECRET: 'test-demo-secret',
                },
              },
            }),
          ],
          test: { name: 'worker', include: ['test/worker/**/*.test.ts'], setupFiles: ['./test/worker/setup.ts'] },
        },
        { test: { name: 'scripts', include: ['test/scripts/**/*.test.ts'], environment: 'node' } },
      ],
    },
  };
});
