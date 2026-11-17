// 시나리오(scenario.json) → 렌더용 스펙(spec.json).
//   1) cut.ai 가 있으면 비즈라우터 이미지 편집(chat/completions + 원본 이미지)으로 컷 이미지를 만든다
//   2) cut.narration 을 비즈라우터 TTS(/audio/speech)로 읽고, 길이를 재서 컷 길이를 정한다
// 키는 SoloSquad 공통 env(<repo>/.solosquad/.env → <repo>/.env)의 BIZROUTER_* 에서 읽는다.
// 이미 만든 파일은 다시 만들지 않는다(--force 로 재생성).
//
//   node scripts/gen-assets.mjs [public/local/scenario.json]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FPS = 30;
const MIN_CUT_SEC = 2.2;
const TAIL_SEC = 0.2;

function repoRoot() {
  let dir = ROOT;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return ROOT;
}

function readEnv() {
  // 워크트리에서도 원래 체크아웃의 .env 를 찾도록 git common dir 기준 루트도 본다
  const roots = [repoRoot()];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT }).toString().trim();
    roots.push(path.dirname(common));
  } catch {}
  for (const r of roots) {
    const file = [path.join(r, '.solosquad', '.env'), path.join(r, '.env')].find((f) => fs.existsSync(f));
    if (!file) continue;
    const env = {};
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    if (env.BIZROUTER_API_KEY) return env;
  }
  throw new Error('BIZROUTER_API_KEY 를 .env 에서 찾지 못했습니다');
}

const env = readEnv();
const BASE = (env.BIZROUTER_BASE_URL || 'https://bizrouter.ai/api/v1').replace(/\/$/, '');
const AUTH = { Authorization: `Bearer ${env.BIZROUTER_API_KEY}` };
const FORCE = process.argv.includes('--force');

async function editImage(prompt, srcFile, model) {
  const b64 = fs.readFileSync(srcFile).toString('base64');
  const mime = srcFile.endsWith('.png') ? 'image/png' : 'image/jpeg';
  // 비즈라우터의 Gemini 이미지 모델은 modalities 를 붙이면 실패한다(cha-z 11/12 실측) — 빼고 보낸다
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }],
    }),
  });
  if (!r.ok) throw new Error(`image ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const msg = (await r.json()).choices?.[0]?.message ?? {};
  // 응답 형식이 모델마다 다르다: message.images[] · content[] 파트 · 텍스트 속 data URL
  const parts = Array.isArray(msg.content) ? msg.content : [];
  const fromPart = parts
    .map((p) => p?.image_url?.url ?? p?.url ?? (p?.inline_data?.data ? `data:${p.inline_data.mime_type ?? 'image/png'};base64,${p.inline_data.data}` : null))
    .find(Boolean);
  const text = typeof msg.content === 'string' ? msg.content : parts.map((p) => p?.text ?? '').join(' ');
  const url = msg.images?.[0]?.image_url?.url ?? fromPart ?? text.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/)?.[0];
  if (!url) throw new Error(`이미지 없는 응답: ${JSON.stringify(msg).slice(0, 400)}`);
  if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

async function tts(text, voice) {
  const r = await fetch(`${BASE}/audio/speech`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: voice.model, voice: voice.voice, input: text, instructions: voice.instructions, response_format: 'mp3' }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

// TTS 결과의 앞뒤 무음을 자르고 숏폼 템포로 살짝 빠르게(ffmpeg — OpenMontage 설치에 포함)
function tightenAudio(raw, out, tempo) {
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', `${trim},areverse,${trim},areverse,atempo=${tempo},loudnorm=I=-14:TP=-1.5:LRA=11`, out]);
}

function durationSec(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

const scenarioPath = path.resolve(ROOT, process.argv.find((a) => a.endsWith('.json')) ?? 'public/local/scenario.json');
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
const outDir = path.dirname(scenarioPath);
const rel = (f) => path.relative(PUBLIC, f).split(path.sep).join('/');
fs.mkdirSync(path.join(outDir, 'gen'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'tts'), { recursive: true });

const cuts = [];
for (const [i, cut] of scenario.cuts.entries()) {
  const id = cut.id ?? `c${i + 1}`;
  let image = cut.image;
  if (cut.ai) {
    const file = path.join(outDir, 'gen', `${id}.png`);
    if (FORCE || !fs.existsSync(file)) {
      console.log(`[image] ${id} …`);
      fs.writeFileSync(file, await editImage(cut.ai.prompt, path.join(PUBLIC, cut.ai.from), cut.ai.model ?? scenario.imageModel));
    }
    image = rel(file);
  }
  let audio = null;
  let sec = cut.seconds ?? MIN_CUT_SEC;
  if (cut.narration) {
    const raw = path.join(outDir, 'tts', `${id}.raw.mp3`);
    const file = path.join(outDir, 'tts', `${id}.mp3`);
    if (FORCE || !fs.existsSync(raw)) {
      console.log(`[tts] ${id} ${cut.narration}`);
      fs.writeFileSync(raw, await tts(cut.narration, scenario.voice));
    }
    tightenAudio(raw, file, scenario.voice.tempo ?? 1.1);
    audio = rel(file);
    sec = Math.max(sec, durationSec(file) + TAIL_SEC);
  }
  cuts.push({ id, image, caption: cut.caption ?? cut.narration ?? '', audio, durationInFrames: Math.round(sec * FPS), focus: cut.focus ?? 'center' });
}

const spec = { title: scenario.title, footer: scenario.footer, accent: scenario.accent, cuts };
fs.writeFileSync(path.join(outDir, 'spec.json'), JSON.stringify(spec, null, 2));
const total = cuts.reduce((s, c) => s + c.durationInFrames, 0) / FPS;
console.log(`spec.json — ${cuts.length} cuts, ${total.toFixed(1)}s`);
