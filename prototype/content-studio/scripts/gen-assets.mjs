// 시나리오(scenario.json) → 렌더용 스펙(spec.json).
//   1) cut.ai 가 있으면 비즈라우터 이미지 편집(chat/completions + 원본 이미지)으로 컷 이미지를 만든다
//   2) cut.narration 을 비즈라우터 TTS(/audio/speech)로 읽고, 길이를 재서 컷 길이를 정한다
// 키는 SoloSquad 공통 env(<repo>/.solosquad/.env → <repo>/.env)의 BIZROUTER_* 에서 읽는다.
// 이미 만든 파일은 다시 만들지 않는다(--force 로 재생성).
//
//   node scripts/gen-assets.mjs [public/local/scenario.json]

import { execFileSync, spawnSync } from 'node:child_process';
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

// 앞뒤 무음만 자르고 음량만 맞춘다(속도는 건드리지 않음 — 억양이 납작해진다)
function trimAudio(raw, out) {
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', `${trim},areverse,${trim},areverse,loudnorm=I=-14:TP=-1.5:LRA=11`, out]);
}

// 문장 사이 숨 구간(무음) 목록 [{start,end}] — ffmpeg 는 stderr 로 쓴다
function silenceList(file) {
  const r = spawnSync('ffmpeg', ['-nostats', '-i', file, '-af', 'silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf-8' });
  const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? s })).filter((g) => g.end > g.start);
}

// 글자 수 비교용 정규화 — Whisper 는 '4리터'를 '4L' 로 적는 등 표기가 대본과 달라서 같은 꼴로 맞춘다
const strip = (s) =>
  s
    .replace(/[\s,.!?·~'"]/g, '')
    .replace(/리터/g, 'L')
    .replace(/[lL]/g, 'L');

// 1순위: 단어 정렬 — Whisper 단어 목록에서 각 줄의 첫 단어를 글자 수로 찾고, 그 단어 바로 앞 무음 가운데를 경계로.
// 무음 길이만으로는 문장 사이 숨과 쉼표 쉼을 못 가르는 경우가 있어서(실측: 둘 다 0.2초) 텍스트 위치를 기준으로 삼는다.
function splitByWords(file, lines) {
  const py = process.env.WHISPER_PYTHON || path.join(process.env.HOME ?? '', 'Dev/OpenMontage/.venv/bin/python');
  if (!fs.existsSync(py)) return null;
  const r = spawnSync(py, [path.join(ROOT, 'scripts', 'words.py'), file], { encoding: 'utf-8' });
  if (r.status !== 0) return null;
  const words = JSON.parse(r.stdout.trim().split('\n').pop());
  const total = durationSec(file);
  const gaps = silenceList(file);
  const bounds = [0];
  let lineChars = 0;
  let wi = 0;
  let wordChars = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    lineChars += strip(lines[i]).length;
    // 앞까지의 글자 수가 lineChars 에 가장 가까운 단어 = 다음 줄의 첫 단어
    while (wi < words.length - 1 && Math.abs(wordChars + strip(words[wi].w).length - lineChars) <= Math.abs(wordChars - lineChars)) {
      wordChars += strip(words[wi].w).length;
      wi++;
    }
    const start = words[wi].s;
    const prev = bounds[bounds.length - 1];
    const near = gaps.filter((g) => g.end > prev + 0.5 && Math.abs((g.start + g.end) / 2 - start) < 0.9);
    const gap = near.sort((a, b) => Math.abs((a.start + a.end) / 2 - start) - Math.abs((b.start + b.end) / 2 - start))[0];
    bounds.push(gap ? (gap.start + gap.end) / 2 : Math.max(prev + 0.5, start - 0.05));
  }
  bounds.push(total);
  return bounds;
}

// 2순위(대체): 무음 DP. 문장 사이 숨은 대개 문장 안 쉼표 쉼보다 길다.
// 무음 구간마다 "길이 − 글자 수 비례 추정 지점과의 거리" 점수를 주고, 순서를 지키는 (줄 수 − 1)개 조합 중
// 합이 가장 큰 것을 고른다(DP). 무음이 모자라면 추정 지점을 그대로 쓴다.
function splitByBreaths(file, lines) {
  const total = durationSec(file);
  const gaps = silenceList(file).map((g) => ({ mid: (g.start + g.end) / 2, len: g.end - g.start }));
  const weights = lines.map((l) => l.replace(/[\s,.!?·]/g, '').length);
  const sum = weights.reduce((a, b) => a + b, 0);
  const guesses = [];
  let acc = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    acc += weights[i];
    guesses.push((acc / sum) * total);
  }
  const k = guesses.length;
  const g = gaps.length;
  if (g < k) return [0, ...guesses, total];
  const score = (i, j) => gaps[j].len - 0.3 * Math.abs(gaps[j].mid - guesses[i]);
  // best[i][j]: 경계 i 를 무음 j 에 둘 때 0..i 까지 최고 점수
  const best = Array.from({ length: k }, () => new Array(g).fill(-Infinity));
  const from = Array.from({ length: k }, () => new Array(g).fill(-1));
  for (let j = 0; j < g; j++) best[0][j] = score(0, j);
  for (let i = 1; i < k; i++) {
    for (let j = i; j < g; j++) {
      for (let p = i - 1; p < j; p++) {
        const v = best[i - 1][p] + score(i, j);
        if (v > best[i][j]) {
          best[i][j] = v;
          from[i][j] = p;
        }
      }
    }
  }
  let j = best[k - 1].indexOf(Math.max(...best[k - 1]));
  const picked = [];
  for (let i = k - 1; i >= 0; i--) {
    picked.unshift(gaps[j].mid);
    j = from[i][j];
  }
  return [0, ...picked, total];
}

// 문장 사이 숨이 breathSec 보다 짧으면 그 경계에 무음을 끼워 넣는다 — TTS 가 숨 없이 붙여 읽을 때가 있어서(실측).
// 반환: 새 파일 경로와 옮겨진 경계(끼운 무음의 가운데).
function padBreaths(file, bounds, breathSec) {
  const gaps = silenceList(file);
  const dir = path.join(path.dirname(file), '.pad');
  fs.mkdirSync(dir, { recursive: true });
  const parts = [];
  const newBounds = [0];
  let shift = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const seg = path.join(dir, `seg${i}.wav`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ss', String(bounds[i]), '-to', String(bounds[i + 1]), '-ar', '24000', '-ac', '1', seg]);
    parts.push(seg);
    if (i === bounds.length - 2) break;
    const b = bounds[i + 1];
    const gap = gaps.find((g) => g.start - 0.02 <= b && b <= g.end + 0.02);
    const pad = Math.max(0, breathSec - (gap ? gap.end - gap.start : 0));
    if (pad > 0.01) {
      const sil = path.join(dir, `sil${i}.wav`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', pad.toFixed(3), sil]);
      parts.push(sil);
    }
    shift += pad;
    newBounds.push(b + shift - pad / 2);
  }
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  const out = file.replace(/\.mp3$/, '.paced.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, out]);
  newBounds.push(durationSec(out));
  fs.rmSync(dir, { recursive: true, force: true });
  return { file: out, bounds: newBounds };
}

// 비즈라우터 STT — 녹음 고르기용
async function transcribe(file) {
  const form = new FormData();
  form.append('model', 'openai/gpt-transcribe');
  form.append('language', 'ko');
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const r = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: AUTH, body: form });
  if (!r.ok) throw new Error(`stt ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).text ?? '';
}

// 대본과 전사의 글자 단위 일치도(1 − 편집거리/길이). 숫자는 한글로 읽힌 것과 비교하려고 지운다.
function similarity(a, b) {
  const n = (s) => strip(s).replace(/[0-9]/g, '');
  const x = n(a);
  const y = n(b);
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...new Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - d[x.length][y.length] / Math.max(x.length, 1);
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
  if (cut.narration && scenario.voice.mode !== 'script') {
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

// voice.mode = "script": 대본 전체를 한 번에 읽혀 문장 사이 호흡·억양을 살리고, 컷 길이는 숨 구간에 맞춘다
let narration = null;
if (scenario.voice.mode === 'script') {
  const lines = scenario.cuts.map((c) => c.narration ?? '');
  const voiceKey = `${scenario.voice.voice}`;
  const raw = path.join(outDir, 'tts', `script-${voiceKey}.raw.mp3`);
  const file = path.join(outDir, 'tts', `script-${voiceKey}.mp3`);
  if (FORCE || !fs.existsSync(raw)) {
    // 같은 대본도 녹음마다 발음이 조금씩 다르다 — takes 번 읽혀 STT 일치도가 가장 높은 녹음을 쓴다
    const takes = scenario.voice.takes ?? 1;
    const script = lines.join('\n');
    let bestScore = -1;
    for (let t = 1; t <= takes; t++) {
      const takeRaw = raw.replace(/\.raw\.mp3$/, `.take${t}.raw.mp3`);
      const takeFile = takeRaw.replace(/\.raw\.mp3$/, '.mp3');
      fs.writeFileSync(takeRaw, await tts(script, scenario.voice));
      trimAudio(takeRaw, takeFile);
      const heard = takes > 1 ? await transcribe(takeFile) : script;
      const score = similarity(script, heard);
      console.log(`[tts] script (${voiceKey}) take ${t}/${takes} — 일치도 ${(score * 100).toFixed(1)}%  "${heard}"`);
      if (score > bestScore) {
        bestScore = score;
        fs.copyFileSync(takeRaw, raw);
      }
      fs.rmSync(takeFile, { force: true });
    }
  }
  trimAudio(raw, file);
  const found = splitByWords(file, lines) ?? splitByBreaths(file, lines);
  const paced = padBreaths(file, found, scenario.voice.breathSec ?? 0.3);
  const bounds = paced.bounds;
  const lead = scenario.voice.leadSec ?? 0.15;
  cuts.forEach((c, i) => {
    const end = i === cuts.length - 1 ? bounds[i + 1] + (scenario.cuts[i].tailSec ?? 1.0) : bounds[i + 1];
    c.durationInFrames = Math.round((end - bounds[i] + (i === 0 ? lead : 0)) * FPS);
  });
  narration = { src: rel(paced.file), startFrame: Math.round(lead * FPS) };
  console.log('boundaries', bounds.map((b) => b.toFixed(2)).join(' '));
}

const spec = { title: scenario.title, footer: scenario.footer, accent: scenario.accent, narration, cuts };
fs.writeFileSync(path.join(outDir, 'spec.json'), JSON.stringify(spec, null, 2));
const total = cuts.reduce((s, c) => s + c.durationInFrames, 0) / FPS;
console.log(`spec.json — ${cuts.length} cuts, ${total.toFixed(1)}s`);
