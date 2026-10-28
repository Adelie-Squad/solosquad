// 개발 서버 전용 LLM 대리 호출 — 브라우저는 /api/llm/* 만 부르고, 오픈라우터 키는 여기서만 붙는다.
// 키는 SoloSquad 코어와 같은 공통 env 에서 읽는다(src/util/config.ts 의 loadEnv 와 같은 순서):
//   <repo>/.solosquad/.env → <repo>/.env
// 요청마다 다시 읽으므로 .env 를 고친 뒤 개발 서버를 다시 띄울 필요가 없다.
// vite build 결과(정적 배포)에는 이 경로가 없어서, 화면은 더미 응답으로 돌아간다.

import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

const OPENROUTER = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';

function readEnv(repoRoot: string): Record<string, string> {
  const file = [path.join(repoRoot, '.solosquad', '.env'), path.join(repoRoot, '.env')].find((f) => fs.existsSync(f));
  const env: Record<string, string> = {};
  if (!file) return env;
  for (const line of fs.readFileSync(file, 'utf-8').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** 오픈라우터 응답에서 무료 모델 일일 사용량 — 필드가 없으면 null (계정 종류마다 다르다) */
function dailyFrom(data: Record<string, unknown>): { used: number; limit: number; remaining: number } | null {
  const d = data.free_model_daily_requests as { used?: number; limit?: number; remaining?: number } | undefined;
  if (!d || typeof d.limit !== 'number') return null;
  const used = d.used ?? 0;
  return { used, limit: d.limit, remaining: d.remaining ?? Math.max(0, d.limit - used) };
}

export function llmProxy(repoRoot: string): Plugin {
  return {
    name: 'ax-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm', async (req, res) => {
        const env = readEnv(repoRoot);
        const key = env.OPENROUTER_API_KEY;
        const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;
        const headers = {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5180',
          'X-Title': 'SoloSquad ax-agent-web prototype',
        };

        try {
          // GET /api/llm/status — 키가 있는지, 어떤 모델인지, 무료 일일 사용량
          if (req.method === 'GET' && req.url?.startsWith('/status')) {
            if (!key) return send(res, 200, { configured: false, model, daily: null });
            const r = await fetch(`${OPENROUTER}/key`, { headers });
            // 키가 틀리면 '연결 안 됨'으로 알려 화면이 실제 AI 라고 표시하지 않게 한다
            if (r.status === 401 || r.status === 403) return send(res, 200, { configured: false, model, daily: null, error: 'invalid_key' });
            if (!r.ok) return send(res, 200, { configured: true, model, daily: null, error: `key check ${r.status}` });
            const json = (await r.json()) as { data?: Record<string, unknown> };
            return send(res, 200, { configured: true, model, daily: dailyFrom(json.data ?? {}) });
          }

          // POST /api/llm/chat — { messages, max_tokens?, temperature? } → { text, model }
          if (req.method === 'POST' && req.url?.startsWith('/chat')) {
            if (!key) return send(res, 503, { error: 'no_key' });
            const { messages, max_tokens = 600, temperature = 0.6 } = JSON.parse((await readBody(req)) || '{}');
            // openrouter/free 가 고르는 무료 모델은 대부분 추론형이라, 생각에 토큰을 다 쓰고 본문이 비는 일이 있다.
            // 생각은 짧게 · 숨기게 요청하고, 그래도 비면 토큰을 늘려 한 번만 다시 부른다.
            const call = async (budget: number) => {
              const r = await fetch(`${OPENROUTER}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model,
                  messages,
                  max_tokens: budget,
                  temperature,
                  reasoning: { effort: 'low', exclude: true },
                }),
              });
              const json = (await r.json()) as {
                choices?: { message?: { content?: string } }[];
                model?: string;
                error?: { message?: string };
              };
              return { r, json, text: json.choices?.[0]?.message?.content?.trim() ?? '' };
            };
            let result = await call(max_tokens);
            if (result.r.ok && !result.text) result = await call(max_tokens * 3);
            const { r, json, text } = result;
            if (!r.ok) return send(res, r.status, { error: json.error?.message ?? `upstream ${r.status}` });
            if (!text) return send(res, 502, { error: 'empty_response' });
            return send(res, 200, { text, model: json.model ?? model });
          }

          send(res, 404, { error: 'not_found' });
        } catch (err) {
          send(res, 500, { error: err instanceof Error ? err.message : 'proxy_error' });
        }
      });
    },
  };
}
