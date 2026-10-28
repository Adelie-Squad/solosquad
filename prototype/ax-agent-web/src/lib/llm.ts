import { useEffect, useState } from 'react';
import { AGENT_NAME, space } from '../data/dummy';

// 개발 서버의 /api/llm 대리 호출(server/llm-proxy.ts)을 부르는 얇은 클라이언트.
// 키가 없거나 정적 배포(경로 없음)면 configured=false — 화면은 더미 응답을 쓴다.

export interface LlmStatus {
  configured: boolean;
  model: string;
  daily: { used: number; limit: number; remaining: number } | null;
  /** invalid_key 면 키는 있지만 오픈라우터가 거절한 것 */
  error?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

let current: LlmStatus | null = null;
const listeners = new Set<(s: LlmStatus | null) => void>();

function publish(next: LlmStatus | null) {
  current = next;
  listeners.forEach((l) => l(next));
}

export async function refreshLlmStatus(): Promise<LlmStatus | null> {
  try {
    const r = await fetch('/api/llm/status');
    if (!r.ok) throw new Error(String(r.status));
    publish((await r.json()) as LlmStatus);
  } catch {
    publish({ configured: false, model: '', daily: null });
  }
  return current;
}

/** 연결 상태 — 처음 쓰는 화면이 한 번 불러오고, 호출할 때마다 갱신된다 */
export function useLlm(): LlmStatus | null {
  const [status, setStatus] = useState(current);
  useEffect(() => {
    listeners.add(setStatus);
    if (!current) refreshLlmStatus();
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}

export async function llmChat(messages: LlmMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const r = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: opts.maxTokens, temperature: opts.temperature }),
  });
  const json = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
  refreshLlmStatus();
  if (!r.ok || !json.text) throw new Error(json.error ?? `HTTP ${r.status}`);
  return json.text;
}

/** 모델이 ```json 코드블록이나 앞뒤 문장을 붙여도 첫 JSON 객체만 꺼낸다 */
export function parseJsonObject<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** 모든 호출에 붙이는 배경 — 가상 회사 '모아 리빙' 데모라는 점과 하루의 말투 */
export const BUSINESS_CONTEXT = `너는 '${space.name}'의 AI 직원 '${AGENT_NAME}'다. ${space.name}은 중국 공장에서 생활용품(실리콘 밀폐용기, 접이식 수납함 등)을 수입해 스마트스토어 · 쿠팡 · 자사몰에서 파는 소규모 커머스 회사이고(가상 데모), 부서 에이전트로 재무 · 상품 소싱 · 마케팅을 둔다.
- 사장님에게 한국어로, 결과부터 짧게 말한다. 사장님이 할 일은 한 가지 행동으로 끝낸다.
- 자동으로 처리한 일과 승인이 필요한 일을 구분해 말한다.
- 모르는 실제 수치는 지어내지 말고, 필요하면 가정이라고 밝힌다.`;
