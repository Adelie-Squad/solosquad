import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { llmProxy } from './server/llm-proxy';

// 저장소 루트 — 코어와 같은 공통 env(.solosquad/.env → .env)를 읽는다
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react(), llmProxy(repoRoot)],
  server: { port: 5180 },
});
