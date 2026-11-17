# content-studio — 숏폼 콘텐츠 자동화 프로토타입

## 검증하려는 것
크리에이티브 · 마케터 에이전트가 **레퍼런스 영상 → 컷표·카피 → 에셋 → 렌더 → 업로드 키트**를
사람 손 최소로 돌릴 수 있는가. 첫 목표는 TikTok / Reels / Shorts 용 9:16 영상 2형식.

| 단계 | 도구 | 위치 |
|---|---|---|
| 레퍼런스 분석 | OpenMontage `video_analyzer`(yt-dlp · scene detect · 키프레임) + faster-whisper + 1초 컨택트시트 육안 판독 | 리포 밖 `~/Dev/OpenMontage` (AGPL-3.0 — 코드 복사 금지) |
| 이미지 에셋 | 비즈라우터 `chat/completions` 이미지 편집(기본 `google/gemini-3.1-flash-image`) — 실제 제품 컷 위주, AI 는 배경·연출 컷만 | `scripts/gen-assets.mjs` |
| 내레이션 | 비즈라우터 `/audio/speech`(`openai/gpt-4o-mini-tts`, `instructions` 로 화자·호흡·강조 지시). `voice.mode: "script"` 면 대본 전체를 한 번에 읽혀 문장 사이 호흡을 살리고, 컷 경계는 Whisper 단어 정렬 → 직전 무음에 맞춘다(없으면 무음 DP). 문장 사이 숨이 `breathSec` 보다 짧으면 무음을 끼워 넣고, `takes` 번 읽혀 비즈라우터 STT 일치도가 가장 높은 녹음을 쓴다. 배속은 걸지 않는다(억양이 납작해짐) · -14 LUFS. Gemini TTS 는 비즈라우터에서 `instructions` 를 못 받고 지시문을 소리 내 읽어서 제외 | `scripts/gen-assets.mjs`, `scripts/words.py` |
| 렌더 | Remotion 4 (1080x1920, 30fps) | `src/` |
| 업로드 | 채널 정책상 TikTok 은 사용자 업로드, YouTube 는 API 가능 → 업로드 키트(캡션·태그·링크) | `public/local/upload-kit.md` |

키는 SoloSquad 공통 env(`<repo>/.env`)의 `BIZROUTER_*` — `.env.example` 10번 섹션.

## 무엇이 더미인가 / 공개 리포 규칙
- 커밋되는 건 코드와 가상 브랜드 예시(`public/example/spec.json`, '모모 키친')뿐.
- 실제 고객사 이미지 · 시나리오 · 생성 에셋 · 렌더 결과는 `public/local/`, `out/` (gitignore).

## 실행
```bash
npm install
npm run assets   # public/local/scenario.json → 이미지 편집 · TTS · spec.json
npm run studio   # 미리보기
npm run render   # out/format-a.mp4
```

## 형식
- **A — 3단 레터박스 몽타주**: 상단 고정 2줄 타이틀 · 가운데 정사각 창 2~3초 하드컷 + Ken Burns · 하단 1줄 자막 · 마지막 컷 링크 버튼. (구현됨)
- **B — 상단 모션그래픽 카드 + 하단 제품/화자 분할**: 훅 → 리스트 예고 → 1~5 → 댓글 키워드 CTA. (다음)
