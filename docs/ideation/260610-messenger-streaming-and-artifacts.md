# 메신저에서 "중간 보고 + 산출물 아카이브" 구현하기 — 레퍼런스 조사

> **문제의식.** Claude·Gemini 를 웹/터미널에서 쓰면 ⑴ 작업을 여러 단계로 쪼개
> **중간중간 보고하며** 다음 작업으로 넘어가고, ⑵ 보고서·이미지 같은 산출물이
> **대화와 분리된 곳에 따로 아카이브**되어 나중에 다시 볼 수 있다. 그런데 지금
> SoloSquad 의 Chief 는 Discord 에서 **턴이 끝날 때까지 기다렸다 한 번에** 텍스트로만
> 답한다(아래 §0). 이 격차를 메신저 환경에서 어떻게 메우는지 레퍼런스를 정리한다.

> **청자:** SoloSquad 개발자(본인). dev 워크플로·내부 구현 관점의 설계 메모이며,
> 확정 기획(PRD)이 아니라 방향 탐색이다.

---

## 0. 현재 우리 코드의 실제 동작 (출발점)

조사 결과 Chief 의 Discord 응답은 **batch(끝까지 기다렸다 일괄 전송)** 다.

| 측면 | 현재 동작 | 근거 파일 |
|---|---|---|
| 긴 응답 / 중간 보고 | LLM 텍스트를 메모리에 누적 → 턴 끝나고 한 번에 | `chief-runner.ts` `collectedAssistantText[]` → `join()` |
| 부분 메시지 | CLI 는 `--include-partial-messages` 로 받지만 **Discord 로 안 흘림** | `claude-process.ts` |
| 진행 표시 | 실행 중엔 Discord **타이핑 인디케이터**만, narration 은 **턴 종료 후** 일괄 | `bot/index.ts`, `discord-narration.ts` |
| 길이 제한 | 1900자 청크 분할은 ✅ | `discord-adapter.ts` `text.match(/.{1,1900}/gs)` |
| 산출물(파일/이미지) | **첨부 미구현** — `MessageContext` 에 파일 전송 메서드 자체가 없음 | `messenger/base.ts`, `discord-adapter.ts` |

> 다만 **이미 깔린 토대가 있다:** Chief 는 단계 이벤트를
> `chief-stage-events.jsonl`(DECOMPOSE / DISPATCH / AWAIT)로 적고,
> `discord-task-card.ts` 가 **embed 카드 + 스레드** 를 만들 줄 안다. 지금은 이걸
> **턴이 끝난 뒤 한꺼번에** 게시할 뿐이다. 즉 "중간 보고"는 *새 인프라*가 아니라
> **기존 이벤트 스트림을 실시간으로 흘리는 문제**에 가깝다.

---

## 1. 두 개의 다른 문제로 분리하기

흔히 뭉뚱그리지만, 레퍼런스를 보면 이건 **메커니즘이 전혀 다른 두 기능**이다.

- **(A) 중간 진행 보고 (Progress / Thinking Steps)** — *시간 축* 문제. "지금 뭘 하는
  중인지"를 작업이 흐르는 동안 실시간으로 보여주기.
- **(B) 산출물 아카이브 (Artifacts)** — *공간 축* 문제. 완성된 결과물을 대화 흐름과
  **분리된 영속 위치**에 저장하고 버전·다운로드·재참조 가능하게 하기.

웹/터미널 도구는 이 둘을 각각 다른 메커니즘으로 푼다. 메신저로 옮길 때도 따로 설계해야 한다.

---

## 2. (A) 중간 보고 — 웹/터미널은 어떻게 하나

### 2.1 근본 원리: 에이전트 루프가 "이벤트 스트림"을 뱉는다

Claude Code/Agent SDK 의 핵심은 **agentic loop 가 토큰·툴콜·툴결과를 NDJSON 이벤트로
실시간 방출**한다는 것. 한 턴 안에서 이벤트가 교차한다:

```
init(세션 메타) → assistant(텍스트 토큰…) → assistant(tool_use: Read file X)
  → user(tool_result) → assistant(텍스트…) → … → result(최종 요약)
```

터미널/웹 UI 는 이 스트림을 **그대로 화면에 흘려서** "읽고 → 파일 고치고 → 또 읽고"가
실시간으로 보인다. 즉 중간 보고는 *별도 기능*이 아니라 **이미 흐르는 이벤트를 렌더만**
하는 것. ([Claude Code agent loop], [Streaming vs single mode])

> **우리와의 갭:** §0 처럼 우리도 `--include-partial-messages` 로 이 스트림을 **받고는
> 있다.** 그냥 Discord 로 **forward 를 안 할 뿐.** 파이프의 끝단만 막혀 있는 셈.

### 2.2 메신저용 정답: Slack "Thinking Steps" (가장 직접적인 레퍼런스)

Slack 이 2025~26 에 **AI 에이전트의 사고 과정을 채팅에 실시간 노출**하는 1급 API 를
냈다. 메신저에서 중간 보고를 어떻게 모델링하는지 보여주는 레퍼런스다.
([Slack Thinking Steps], [Slack Block Kit for agents])

**API 표면 — "open / append / close" 3단계:**

```
chat.startStream(channel, thread_ts)        // 스트리밍 메시지 1개 연다
chat.appendStream(stream.id, <chunk>)       // 작업하며 조각을 계속 덧붙인다
chat.stopStream(stream.id)                   // 최종 응답으로 확정
```

**덧붙이는 chunk 4종:**

| Chunk | 의미 | 우리 대응물 |
|---|---|---|
| Markdown Text Block | 자유 텍스트(추론·전환 설명) | Chief assistant 텍스트 |
| **Task Card Block** | 단일 액션/툴콜 1개. `title`·`status`·`references` 포함 | **우리 DISPATCH 이벤트 = 서브에이전트 1건** |
| Plan Block | Task Card 들의 컨테이너(다단계 계획 묶음) | **우리 DECOMPOSE = 계획 분해** |
| URL Sources | Task Card 에 외부 참조 첨부 | 커밋/PR/파일 링크 |

**상태 머신:** `pending → in_progress → completed / error`. 카드의 status 를
**그 자리에서 갱신**(in_progress→complete)해 한 메시지가 살아 움직인다.

**UX 가이드(중요):**
- 두 가지 표시 모드 — **Plan mode**(다단계 계획을 미리 펼침) vs **Timeline mode**(일어나는
  순서대로 선형). 우리 DECOMPOSE→DISPATCH→AWAIT 흐름은 둘 다 자연 매핑.
- **둘 다 기본 접힘(collapsed)** — 대화를 압도하지 않게. 사용자가 펴서 추론을 들여다봄.
- "출력을 실시간으로 줘서 사용자가 **즉시 읽기 시작**하게 하라. 스트리밍은 대기를 짧게
  느끼게 하고, **방향이 틀리면 끝나기 전에 멈춰 redirect** 할 수 있다." → 이게 중간
  보고의 진짜 가치(안전·교정 가능성).

### 2.3 Discord 에는 그런 1급 API 가 없다 — 두 가지 대체 패턴

Discord 엔 Slack `startStream` 같은 게 없다. 커뮤니티가 쓰는 우회는 두 가지.

**패턴 ① 메시지 edit 기반 스트리밍 (한 메시지를 계속 고쳐쓰기)**
- 빈 메시지를 먼저 보내고, 토큰이 쌓이면 `message.edit()` 로 **같은 메시지를 갱신**.
  웹의 타이핑 효과를 흉내. ([Discord stream-based responses 논의])
- **함정 = rate limit.** Discord 글로벌 50 req/s + 라우트별 버킷. 토큰마다 edit 하면
  즉시 429. → **반드시 debounce/throttle**: "N토큰마다 또는 ~750ms~1s 주기로만 edit".
  알려진 버그로 타이핑 인디케이터가 영구히 안 꺼지는 케이스도 있으니 정리 로직 필요.
  ([Discord rate limits], [discord.js gotchas])

**패턴 ② append-only 단계 메시지 (단계마다 새 메시지/카드)**
- 토큰 스트림이 아니라 **의미 단위(단계)마다** 새 메시지 또는 embed 를 게시:
  "🔍 계획 수립…" → "⚙️ Engineer dispatch (auth.ts)" → "⏳ 결과 대기" → 최종.
- Slack Thinking Steps 의 Discord 이식판. **우리 `chief-stage-events.jsonl` 와 1:1**.
  edit 빈도가 낮아 rate limit 안전하고, 우리 `discord-task-card.ts` embed 를 재활용 가능.

> **추천:** 토큰 단위 ①은 비싸고(편집 폭주) 가치가 낮다(Chief 출력은 보통 요약).
> **②(단계 단위 append) + 최종 응답만 텍스트 스트리밍**이 메신저에 맞다. 즉
> *"thinking 은 카드로, 결론은 글로"*.

### 2.4 실증 레퍼런스 — 실제로 Discord 에 구현한 OSS (조사: 2026-06-16)

§2.3 은 "커뮤니티 우회 2가지"라고만 적고 **실제 구현체는 비워뒀다.** 실측해보니
**OSS 들은 거의 다 패턴 ①(한 메시지를 계속 edit 하는 토큰 스트리밍)을 1급으로** 구현했고,
그중 `llmcord` 가 사실상 레퍼런스다. 막연한 "750ms~1s" 가 아니라 **실제 상수**가 나온다.

**① `llmcord` (jakobdylanc, Python 단일 파일) — Discord 스트리밍의 정석**

| 항목 | 실제 코드 값 | 메모 |
|---|---|---|
| edit 쓰로틀 | `EDIT_DELAY_SECONDS = 1` | 1초마다만 edit → rate-limit 회피 (우리 추정과 일치) |
| 진행 표시 | `STREAMING_INDICATOR = " ⚪"` | 스트리밍 중 본문 끝에 ⚪, 완료 시 제거 |
| 상태 색 | 진행 `orange()` → 완료 `dark_green()` | **embed color 가 곧 상태 머신** |
| 길이 제한 | `4096 - len(indicator)` | **plain 2000자가 아니라 embed description 4096자 기준** |
| 타이핑 | `async with channel.typing():` 로 스트림 전체를 감쌈 | stuck-indicator 자동 정리 |

```python
ready_to_edit = (now - last_task_time) >= EDIT_DELAY_SECONDS   # 1초 디바운스
msg_split_incoming = finish_reason is None and len > max_message_length  # 넘치면 새 메시지
is_final_edit = finish_reason is not None or msg_split_incoming
# → edit는 (1초 경과 OR 마지막)일 때만, 4096자 초과 시 새 메시지로 분기, 끝나면 초록색
```

**② `js-llmcord` (stanley2058) — 위의 TS + discord.js + Vercel AI SDK 포팅 → 우리 스택에 가장 근접**
- `use_plain_responses` 토글(embed 스트리밍 vs plain) — 우리 v1.2.9 §D(plain 전환)와 직접 충돌점.
- `max_steps: 10`(툴콜 루프 = 우리 DISPATCH 반복), `include_summary`(툴콜 요약 덧붙임 = 우리가
  원하는 "중간보고"의 OSS 등가물).

**③ Vercel AI SDK / Chat SDK — step·tool-call 이벤트의 SDK 레벨 메커니즘**
- `fullStream`(≠`textStream`)을 써야 tool-calling step 사이 단락이 보존됨 → `"tool-call"` delta 를
  체크해 **툴 실행 시점을 단계별로 흘림**(= 우리 DISPATCH 를 실시간 카드로).
- **Vercel 공식 Chat SDK 의 Discord 어댑터조차** Slack 네이티브 스트리밍과 달리 **"post-then-edit +
  쓰로틀"** 로 폴백하고 `streamingUpdateIntervalMs` 로 간격 조절 → 우리 결론(Discord 엔 1급 API
  없음, edit 쓰로틀이 정답)이 **상용 SDK 에서도 동일 채택**됨을 실증.

> **이 조사가 §2.3 추천을 부분 수정한다.** §2.3 은 "토큰 스트리밍 ①은 ROI 낮으니 P3" 라 했지만,
> **실제 OSS 는 ①을 1급으로** 만든다. 차이의 핵심:
> 1. **embed vs plain.** llmcord 가 스트리밍을 매끄럽게 하는 건 embed(4096자 + color 상태)로 **한
>    메시지를 live-edit** 하기 때문. 우리는 v1.2.9 에서 plain 1900자 청크(`discord-adapter.ts:73`)로
>    갔는데, **스트리밍하려면 "살아 움직이는 단일 메시지"** 가 필요 → 현행 `reply()` 와 별개의 송신
>    경로(또는 embed 복귀)가 선행 과제.
> 2. **우리만의 강점.** llmcord 엔 없는 `chief-stage-events.jsonl`(의미 단위 이벤트)이 우리에겐
>    이미 있다. 그래서 **토큰 edit 없이도 ②(단계 카드)를 더 깔끔하게** 갈 수 있다. ①이 필요하면
>    위 상수(`EDIT_DELAY_SECONDS=1` 등)를 그대로 차용하면 된다.

**참고 링크:** [jakobdylanc/llmcord](https://github.com/jakobdylanc/llmcord) ·
[stanley2058/js-llmcord](https://github.com/stanley2058/js-llmcord) ·
[Vercel: AI agent for Slack (Chat SDK + AI SDK)](https://vercel.com/kb/guide/how-to-build-an-ai-agent-for-slack-with-chat-sdk-and-ai-sdk) ·
[QwenPaw #1296 — streaming via message edit](https://github.com/agentscope-ai/QwenPaw/issues/1296)

---

## 결론 한눈에 + 사용자 경험

**결론(엔지니어용 한 줄):** *"중간보고는 새 인프라가 아니라, **이미 있는 `chief-stage-events.jsonl`
이벤트 스트림을 턴 종료 후가 아니라 진행 중에 흘리는 문제**다. OSS 정답은 1초 디바운스 edit
스트리밍이고, 우리는 단계 이벤트가 있으니 거기에 얹기만 하면 된다."*

**왜 지금 모습이 답답한가 (Before):** Chief 에게 시키면 Discord 는 **타이핑 점만 깜빡이다가,
작업이 다 끝난 한참 뒤 긴 글 한 덩어리가 툭** 떨어진다. 그동안 뭘 하는지, 방향이 맞는지 알 수
없고, **틀렸어도 끝나기 전엔 못 멈춘다.**

**사용자 입장에서 달라지는 경험 (After):**

| 시점 | 지금 (Before) | 이 기능 후 (After) |
|---|---|---|
| 작업 시작 직후 | 타이핑 점만 | "🔍 계획 수립 중… (3단계로 분해)" 카드 즉시 |
| 작업 진행 중 | (침묵) | "⚙️ Engineer 출동 → `auth.ts`" / "⏳ 결과 대기" 가 **실시간으로 한 줄씩** |
| 방향이 틀렸을 때 | 끝날 때까지 못 멈춤 | **중간에 보고 보고 바로 멈춰서 교정** ← 진짜 가치 |
| 결과물(보고서/이미지) | 채팅에 긴 텍스트로 묻힘 | **파일로 저장 + 카드 링크**, 나중에 다시 찾기 쉬움 |
| 최종 답 | 긴 글 한 덩어리 | 단계 카드는 접힌 채 남고, **결론만 깔끔한 글로** |

한 문장: **"비서가 일하는 걸 어깨너머로 보는" 느낌** — 무슨 일을 어떤 순서로 하는지 보이고,
아니다 싶으면 중간에 끊을 수 있고, 결과물은 대화에 묻히지 않고 따로 쌓인다.

---

## 3. (B) 산출물 아카이브 — 웹은 어떻게 하나

### 3.1 원리: "대화 흐름"과 "결과물"의 물리적 분리

Claude Artifacts / ChatGPT Canvas / Gemini Canvas 의 공통 아키텍처:
([Artifacts vs Canvas], [Research productivity guide])

- **사이드 패널 분리** — 산출물은 채팅 본문이 아니라 **별도 캔버스/패널**에 산다.
  대화는 흐르고 결과물은 고정된다.
- **영속 + 버전 + 재참조** — Claude Artifacts 는 **프로젝트에 저장**되어 여러 대화에서
  참조·갱신되고, **버전 관리**와 copy/download 를 제공. ChatGPT Canvas 는 문서가
  ChatGPT 안에 살고(웹 게시는 없음), Gemini 도 유사.
- **Artifact ≠ Project** — Artifact 는 개별 산출물(문서·컴포넌트·SVG), Project 는 여러
  대화·아티팩트를 공유 지침 아래 묶는 워크스페이스. (계층 구조 — 우리 doc hierarchy 와 동형)

핵심 통찰: **산출물을 "메시지 안의 텍스트"로 두지 않는다.** 주소(영속 위치)를 갖는
**1급 객체**로 두고, 채팅엔 그 **포인터(링크/카드)**만 흘린다.

### 3.2 메신저로 옮길 때 — Discord 의 제약과 3가지 경로

Discord 엔 사이드 캔버스가 없다. 산출물을 "1급 객체 + 채팅엔 포인터" 원칙으로 구현하는 길:

**경로 ① 파일 첨부 (가장 단순)**
- 보고서 `.md`/이미지/`.zip` 을 **메시지 첨부**로 올린다.
- **제약:** 봇 업로드 한도가 작다(무료 ~10MB, 과거 봇 8MB). 큰 산출물·다수 파일엔 부적합.
  ([Discord file size FAQ], [Bot upload limit issue])
- **우리 갭:** `MessageContext` 에 첨부 메서드가 **아예 없음**(§0). discord.js
  `MessagePayload.files` 로 추가하는 인터페이스 확장이 선행 과제.

**경로 ② 워크스페이스 파일 = 정전(canonical) + 채팅엔 링크/카드**
- SoloSquad 는 이미 **워크스페이스 디렉토리(repo)** 가 있다. 산출물을
  `workspace/<org>/artifacts/260610-report.md` 처럼 **파일로 커밋/저장**하고, Discord 엔
  **embed 카드(제목·요약·경로/링크)** 만 보낸다. 이게 Artifacts 의 "분리+영속+버전"을
  **git 으로 공짜로** 얻는 길(버전 = git history). 우리 멘탈모델(repo=정전)과 가장 정합.
- 원격 접근이 필요하면 PR/gist/raw URL 로 노출(이미 git 연동 존재).

**경로 ③ 외부 호스팅 + 링크 (대용량/리치)**
- 10MB 초과나 렌더가 필요한 산출물(대시보드·HTML 리포트)은 외부에 올리고 링크.
  ([Discord file size workaround]) — 다만 외부 의존이라 SoloSquad 의 "로컬 우선" 가치와
  trade-off. 후순위.

**아카이브 인덱스(재참조 UX):**
- 웹의 "Artifacts 패널 목록"에 해당하는 걸 메신저에선 **전용 채널/스레드**로 구현 가능.
  예: `works-<handle>` 의 산출물을 **`artifacts-<handle>` 채널** 또는 작업 스레드에 카드로
  누적 → 스크롤이 곧 아카이브. 우리 채널 네이밍 컨벤션(`command-`/`works-`)에 한 종류 추가.

---

## 4. 종합 — 메신저용 권장 아키텍처 (우리 코드 기준)

두 축을 우리 기존 인프라에 얹은 그림:

```
[Chief turn 시작]
   │  (A) 진행 보고: 단계 이벤트를 "실시간"으로 흘린다
   ├─▶ works-<handle> 에 Task Card embed 게시 (status: in_progress)
   │     · DECOMPOSE → Plan 카드 / DISPATCH → Task 카드 / AWAIT → 상태 갱신
   │     · 출처 = chief-stage-events.jsonl 을 "턴 종료 후"가 아니라 "tail -f" 로
   │     · edit throttle ≥ ~1s, rate-limit 안전
   │
   │  (작업 수행…)
   │
   │  (B) 산출물: 파일은 워크스페이스에 커밋, 채팅엔 포인터
   ├─▶ 보고서/이미지 → workspace/<org>/artifacts/ 에 저장(버전=git)
   │     └─ Discord: embed 카드(제목·요약·경로) + (작으면) 파일 첨부
   │
[Chief turn 종료]
   └─▶ 최종 결론 텍스트 = command-<handle> 에 글로(현행 chunk 분할 유지)
        Task Card 들 status → completed 로 마감
```

**원칙 한 줄:** *"thinking·progress 는 카드로(works 채널), 결론은 글로(command 채널),
산출물은 파일+포인터로(workspace+artifacts)."*

### 단계적 도입 제안 (저위험 → 고가치 순)

1. **P0 — 실시간 narration.** 지금 *턴 종료 후* 게시하는 stage narration 을
   **턴 진행 중 tail** 로 바꾼다. 새 데이터 모델 0, 기존 `discord-task-card.ts` 재활용.
   가장 싸고 체감 큼. (= Slack Timeline mode 의 Discord append 판)
2. **P1 — 산출물 파일화.** `MessageContext` 에 첨부/링크 메서드 추가 +
   `workspace/<org>/artifacts/` 규약. 보고서를 텍스트 본문 대신 파일+카드로.
3. **P2 — 산출물 아카이브 채널.** `artifacts-<handle>` 채널 또는 작업 스레드 누적으로
   "다시 보기" UX. (Artifacts 패널의 메신저 등가물)
4. **P3(선택) — 최종 텍스트 스트리밍.** edit-debounce 토큰 스트리밍. ROI 낮음(Chief
   출력은 짧은 요약). rate-limit 리스크 대비 가치 재평가 후 결정.

> **연결 메모:** P0~P1 은 [`v1.4.0-session-orchestration`] 의 다중 repo "출장 보고"와
> 시너지(출장마다 카드 1장). dev-confirm 승인 게이트([v1.3.0])의 승인 UX 도 같은 Task
> Card 상태 머신(`awaiting_approval`)으로 통합 가능.

---

## 참고 자료 (Sources)

**에이전트 루프 / 스트리밍 원리**
- [Claude Code agent loop] — https://code.claude.com/docs/en/agent-sdk/agent-loop
- [Streaming vs single mode] — https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode

**메신저 중간 보고 UX (가장 직접적)**
- [Slack Thinking Steps] — https://slack.dev/slack-thinking-steps-ai-agents/
- [Slack Block Kit for agents] — https://slack.dev/build-richer-agent-experiences-with-block-kit/

**Discord 구현 제약**
- [Discord stream-based responses 논의] — https://github.com/discord/discord-api-docs/discussions/6310
- [Discord rate limits] — https://docs.discord.com/developers/topics/rate-limits
- [discord.js gotchas] — https://www.vibebot.gg/blog/discord-js-gotchas
- [Discord file size FAQ] — https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ
- [Bot upload limit issue] — https://github.com/discord/discord-api-docs/issues/2037
- [Discord file size workaround] — https://file.kiwi/blog/discord-file-size-limit

**산출물 아카이브 (Artifacts/Canvas)**
- [Artifacts vs Canvas] — https://unmarkdown.com/blog/claude-artifacts-vs-chatgpt-canvas
- [Research productivity guide] — https://promptrevolution.poltextlab.com/enhancing-research-productivity-a-comprehensive-guide-to-canvas-and-artifacts-in-genai-interfaces/

**내부 연결 문서**
- `docs/prd/v1.4.0-session-orchestration.md`, `docs/prd/v1.3.0-dev-confirm-gate-live.md`
- `docs/ideation/260605-ochestrator-session.md`
