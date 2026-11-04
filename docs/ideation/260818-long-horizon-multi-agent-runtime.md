# 장기작업 멀티에이전트 · 런타임/러너 실측 조사 — 세션·스레드·컨텍스트·협업 + Runner 추상화

> **조사일** 2026-08-18 · **방법** 딥리서치 워크플로 2건 병렬(`wf_67dbb3eb-f6a` 오케스트레이션 / `wf_f3f97eb5-58c` 런타임·러너)
> · 서브에이전트 **217개** · 소스 **53건** 판독 · 웹 도구호출 **1,254회** · 토큰 **5.37M**
>
> **위치** — [[260810-hermes-agent-orchestration-topology]] · [[260810-openclaw-orchestration-topology]] 의
> **외부 대조군 문서**다. 앞의 두 문서가 "특정 구현체 2개를 깊게" 팠다면 이 문서는
> **"같은 문제를 푼 나머지 전부"** 를 넓게 판다. 중복 조사를 피하기 위해 Hermes·OpenClaw·
> Claude Code 3건은 조사 지시에서 명시적으로 제외했다.
>
> **투입 대상** — `M9`(토폴로지) · `M10` · `M12`(세션 비용 배수) · `§C1`(하네스 인터페이스 ADR) ·
> `§F′ [2] 컨텍스트` · `§F′ [3] 실행`
>
> ⚠️ **신뢰도 표기 필수** — 합성(synthesize) 단계가 세션 한도로 **3건 모두 실패**했다.
> 이 문서는 검증 단계까지 살아남은 원자료를 사람이 직접 합성한 것이다. 각 주장에 등급을 붙였다:
>
> | 등급 | 뜻 |
> |---|---|
> | ✅ | 적대적 교차검증 3-0 통과 |
> | ◐ | 1차 소스 직접 인용 있음, **교차검증 미완**(검증 에이전트가 세션 한도로 실패) |
> | ⚠ | 검증자가 반증 또는 과장 판정 — 인용문 범위로 축소해 기재 |
> | ○ | 2차 소스(블로그·포럼) — 방향성 참고용 |

---

## 0. 한 문장

**업계 전체가 "자식 = 실행" 에서 "자식 = 1급 세션" 으로 이동했고, 그 이동의 대가는 세션 소유권을
누가 갖느냐는 질문으로 되돌아온다** — 그리고 이 질문에 대해 지금 존재하는 답은 네 가지뿐이다
(런타임 소유 / 호출자 소유 / 외부 서비스 소유 / 에이전트 소유). SoloSquad 는 아직 답하지 않았다.

---

## A. 결론 8가지 — 먼저 읽을 것

| # | 결론 | 근거 |
|---|---|---|
| **A1** | **"자식=세션" 이 승리했다.** Codex 는 서브에이전트를 `ThreadId` 를 가진 1급 스레드로 스폰하고 부모-자식 관계를 `AgentGraphStore` 에 **영속 그래프 엣지**로 기록한다. OpenHands V1 은 서브에이전트를 "독립 conversation" 으로 정의했다. | §B |
| **A2** | **동시성 상한의 실측 합의는 한 자릿수다.** Codex `max_threads` **기본 6**, OpenHands `tool_concurrency_limit` **기본 1**(권장 시작 4), Cursor 2.0 **하드캡 8**, worktree 실무 한계 8~10. Hermes 의 `max_concurrent_children: 3` 은 업계 하한이 아니라 **정상 범위 안**이다. | §C |
| **A3** | **스폰 깊이는 다 1이다.** Codex `max_depth` 기본 **1**(손자 금지) = Hermes `max_spawn_depth: 1` 과 정확히 일치. **독립적으로 같은 값에 도달했다는 것이 이 조사에서 가장 강한 수렴 신호다.** | §C |
| **A4** | **요약 핸드오프는 정보이론적으로 손실이다.** 96k 입력에서 단일 요약이 남기는 원본 비율 **~3%**, 500토큰 요약은 **1% 미만**. 2K 예산에서 요약 조건이 **단순 FIFO 절단보다 나빴다**(44.6% vs 77.2%). | §D |
| **A5** | **컴팩션은 정확도만 깎는 게 아니라 재현성을 깎는다.** 압축이 강해질수록 Pass@2 와 Pass² 의 간극이 벌어진다 = **같은 작업이 될 때도 안 될 때도 있게 된다.** 장기 무인 실행에서 이게 정확도 손실보다 위험하다. | §D |
| **A6** | **멀티에이전트 토큰 배수 = 15×(vs 채팅), 조율형은 팬아웃 대비 3.2~3.6×.** 그리고 그 증가분은 **출력이 아니라 입력(누적 컨텍스트)** 이다. **M12 의 변수는 이걸로 대체 가능하다.** | §D·§K |
| **A7** | **Runner 추상화의 진짜 축은 "세션 소유권" 하나다.** OpenAI Agents SDK=호출자, Google ADK=런타임(SessionService), LangGraph=호출자(thread_id)+런타임(checkpointer), ACP=**에이전트**, Temporal=**durable 런타임**. 5가지 답이 존재하고 각각 다른 것을 포기했다. | §F |
| **A8** | **"thread 를 1급으로 만들면 락이 생긴다."** OpenAI Assistants 는 Thread 를 서버 소유 1급 자원으로 만든 대가로 **비종료 Run 동안 Thread 전체가 잠겼고**, `requires_action` 은 **~10분 만료**였다. 이 모델은 2026-08-26 에 폐기된다. | §G |

---

## B. 축 1 — 자식은 "실행"인가 "세션"인가

[[260810-hermes-agent-orchestration-topology]] §A / [[260810-openclaw-orchestration-topology]] §0 에서
세운 이분법이 외부에서 어떻게 갈렸는지.

### B.1 구현체 대조

| 구현체 | 자식의 정체 | 식별자 | 계보 기록 | 부모보다 오래 사는가 |
|---|---|---|---|---|
| **Codex CLI** ◐ | **1급 스레드(세션)** — `run_codex_thread_interactive` | `ThreadId` + `AgentPath` | **`AgentGraphStore.upsert_thread_spawn_edge()`** 로 영속 그래프 엣지 | 예 (JSONL rollout 파일이 진실의 원천) |
| **OpenHands V1** ◐ | **독립 conversation** — 부모의 모델설정·워크스페이스 상속 | conversation id (REST `POST /conversations`) | — | 예 (이벤트 소싱 `base_state.json` + 이벤트별 JSON) |
| **Prime Agent** ◐ | **데몬 상주 세션** — supervisor 가 호스팅 | 안정 이름 (`prime-agent list/attach/rename`) | family roster | **예** — 터미널 닫아도 detach 일 뿐 |
| **Modal Sandbox** ◐ | **원격 서비스 소유 세션** | `sandbox_id` / `sandbox_name` | — | 예 — `sb.detach()` 후 `Sandbox.from_id()` 로 재획득 |
| **E2B Sandbox** ◐ | **상태머신 있는 1급 자원** (Running/Paused/Snapshotting/Killed) | id, `Sandbox.connect()` | — | 예 — paused 는 **TTL 없음**(무기한) |
| **OpenHands SDK 서브에이전트** ⚠ | 중첩 실행 컨텍스트 | — | — | 아니오 (검증자 반증 있음, §M) |
| **Anthropic 리서치 시스템** ✅ | **실행** — lead 가 **동기 블로킹**으로 대기 | — | — | 아니오 |

### B.2 결정적 발견 — Codex 의 fork 정책

> ◐ *"History can be either fully copied or truncated via `LastNTurns` strategy."*

**컨텍스트 상속이 isolated/fork 이진 선택이 아니라 정책이다.** OpenClaw 의 `context: fork` 는
"전부 복사" 한 가지만 있고, Claude Code 의 서브에이전트는 "전부 격리" 한 가지만 있다.
Codex 는 **"마지막 N턴만 상속"** 이라는 제3의 값을 만들었다.

> **SoloSquad 함의** — 8-layer JIT spawn assembly 의 `spawn.max_context_tokens: 80000` 은
> 지금 "무엇을 넣을까"를 우선순위로 푼다. Codex 는 같은 문제를 **"부모의 최근 N턴"** 이라는
> 축으로 푼다. 두 축은 직교하며 **둘 다 필요할 수 있다.**

### B.3 resume 은 프로토콜이 보장하지 않는다 ◐

ACP(Zed Agent Client Protocol) 실측:

- `session/new` 를 **클라이언트가** 호출하지만 `sessionId` 는 **에이전트가 생성·소유**한다.
- `session/load` 는 **선택적 능력**이다 — `agentCapabilities.loadSession` 기본값 `false`.
- `session/close`·`delete`·`list`·`resume` 전부 별도 `sessionCapabilities` 플래그 뒤에 있고 **기본 `{}`(전부 없음)**.
- **`session/save` 가 없다.** 클라이언트가 자기 저장소에서 세션을 되살릴 방법이 프로토콜에 없다.

> ◐ *"`session/load` is **not** an over-the-wire transcript transport. […] The protocol has no
> `session/save` and no client-supplied history payload."*

**그 결과 실제로 터진 사고**(OpenHands 이슈, 2026-05-01 개설 → 06-04 종료) ◐:

| 상황 | 결과 |
|---|---|
| 인-샌드박스 프로세스 크래시 (FS 보존) | resume **성공** |
| 클라우드 샌드박스 recycle | resume **완전 실패** |

이유: `acp_session_id` 와 ACP 서버의 세션 파일이 **둘 다 샌드박스 파일시스템 안에만** 존재.
오케스트레이터의 durable 이벤트 스토어는 살아있는데 **로드할 런타임 세션이 없는**
"주소는 있는데 실체가 없는 대화" 가 생긴다.

**실제 shipped 된 해결책 2가지** ◐:
1. **(임시)** `new_session` 으로 새로 시작하고 이전 이벤트를 `<<RESUMED CONVERSATION>>` 접두 합성 메시지로 재생 — **tool-call provenance 와 샌드박스 FS 상태를 전부 잃는다.**
2. **(근본)** CLI 의 개인 세션 저장소를 영속 볼륨으로 이전 — `CLAUDE_CONFIG_DIR=/workspace/.claude`, `CODEX_HOME=/workspace/.codex`. Gemini CLI 는 **동등한 환경변수가 없어** 1번에 머물렀다.
   - ⚠ 부작용: **`CLAUDE_CONFIG_DIR` 를 설정하면 SDK 가 `ANTHROPIC_API_KEY` 를 떨어뜨린다.**

> **SoloSquad 함의 (M9·§C1 직결)** — "세션 디렉터리를 우리가 지정할 수 있는가"가
> **하네스 선택의 하드 기준**이 된다. Claude Code·Codex 는 되고 Gemini CLI 는 안 된다.
> 5-메서드 시그니처에 **`session_home` 주입 가능성**을 필수 항목으로 넣어야 한다.

---

## C. 축 2 — 동시성·격리의 실측 숫자

### C.1 상한값 총람

| 시스템 | 설정 키 | 기본값 | 성격 |
|---|---|---:|---|
| Codex CLI | `agents.max_threads` | **6** ◐ | 초과 시 **하드 스폰 실패**(`Failed to spawn agents`) ✅ — 큐잉 없음 |
| Codex CLI | `max_depth` | **1** ◐ | 손자 스폰 금지 |
| OpenHands SDK | `tool_concurrency_limit` | **1** ✅ | 1=순차 / 2–8=보통 / >8=자원고갈 위험 ✅ |
| Cursor 2.0 | — | **8** ○ | 하드캡 (2025-10) |
| worktree 실무 | — | 8–10 ○ | 초과 시 관리비용 > 병렬이득 |
| Anthropic 리서치 | 프롬프트 규칙 | 1 / 2–4 / 10+ ✅ | 사실확인 1, 비교 2–4, 복합리서치 10+ |
| **Hermes (기존 조사)** | `max_concurrent_children` | 3 | **업계 정상 범위 안** |
| **Hermes (기존 조사)** | `max_spawn_depth` | 1 | **Codex 와 독립 일치** |

**Codex 는 큐가 없다** ✅ — 슬롯이 차면 사람이 완료된 에이전트를 수동으로 닫아야 하고,
그 수동 개입이 부모의 "main thread" 조율 로직을 깨뜨린다. 요청자는 **큐잉을 신규 기능으로 요청**했다.

> **SoloSquad 함의** — Hermes 의 Kanban(SQLite 영속 큐)은 Codex 가 **없어서 문제를 겪고 있는 바로 그것**이다.
> 결정 근거가 하나 늘었다: 팬아웃 상한 + **입장 대기열**은 세트다.

### C.2 worktree 격리는 깨진다 ○ (중요)

Claude Code `isolation: worktree` 의 **동시 팬아웃 시 실패** 보고(2026-08-02):

| 증상 | 내용 |
|---|---|
| 부분 실패 | 한 메시지에 5개 디스패치 → **2개만 제대로 격리, 3개는 부모 repo 의 워킹트리·ref 에 작업** |
| 교차 오염 | `test(bl-274)` 커밋이 **다른 에이전트의 feature 브랜치에 착지** → PR diff 오염 |
| 공유 상태 변형 | 자식이 **메인 repo 에 `git stash` 엔트리 생성**, 사용자의 미커밋 작업을 stash/revert |
| 실무 대응 | **병렬 포기 → 엄격 순차** (사실상 동시성 1) |
| 근본 원인 | 동시 worktree 에이전트 간 **공유 `.git/` 디렉터리 경쟁** — 관련 이슈 #55724·#47266(종료)·#77671(열림) |

**가장 위험한 점**: 락 경쟁으로 *실패* 하는 게 아니라 **성공하되 엉뚱한 곳에 착지**한다.
PR diff 와 git 히스토리를 사람이 정독하지 않으면 발견되지 않는다.

**추가 비용** ○: Cursor 사용자가 2GB 코드베이스에서 **20분에 9.82GB** 소비.
worktree 제거는 syscall 폭풍(파일 1만개 기준 `unlink()` ~10,000 · `rmdir()` ~500 · `lstat()` 10,500+).

**그리고 worktree 는 런타임 상태를 격리하지 못한다** ○ — 포트·DB·Docker 데몬·모노레포 빌드캐시는 여전히 공유.
(두 번째 React dev server 가 뜨지 않는다.)

### C.3 격리 계층의 3분류

| 계층 | 예 | 격리하는 것 | 격리 못하는 것 |
|---|---|---|---|
| **git worktree** | Claude Code | 워킹트리 | `.git/`, 포트, DB, 캐시 |
| **컨테이너** | OpenHands DockerWorkspace ◐ | 파일시스템 전체 + 프로세스 | 포트 수동 할당 필요(host_port, +1 VSCode, +2 VNC) |
| **microVM/스냅샷** | E2B, Modal ◐ | 메모리까지 | TCP 연결(스냅샷 시 끊김) |

**그리고 OpenHands 는 컨테이너 강제를 되돌렸다** ◐ (되돌린 결정 — 최고 신호):

> *"V0 was built on the assumption that all tool calls should run inside sandboxed Docker containers […]
> each conversation spanned two independent processes (agent and sandbox) with **potentially divergent states**.
> […] **Sandboxing should be opt-in, not universal.** V1 unifies agent and tool execution in a single process by default"*

**Prime Agent 도 같은 선을 긋는다** ◐:
> *"Daemon workers are process-isolated for **lifecycle and failure containment, not security-sandboxed**.
> They normally run with the same operating-system permissions as the client."*

> **SoloSquad 함의** — "멀티세션 = 격리" 라는 등식은 **틀렸다**. 프로세스 분리는 수명 관리이지 보안이 아니다.
> 두 결정을 분리해서 내려야 한다: **(a) 자식을 별도 프로세스로 둘 것인가** ·
> **(b) 자식을 샌드박스에 가둘 것인가.**

---

## D. 축 3 — 컨텍스트 오케스트레이션 (정량)

**이 절이 M12 의 직접 입력이다.**

### D.1 요약 핸드오프의 손실 — 숫자

| 측정 | 값 | 출처등급 |
|---|---|---|
| 96k 입력 단일 요약이 남기는 원본 비율 | **~3%** | ◐ |
| 96k 입력 · 500토큰 요약 | **<1%** | ◐ |
| 2K 예산 정상종료율: 요약 / FIFO절단 / 전체이력 | **44.6% / 77.2% / 66.6%** | ◐ |
| 다음 행동분포 TV 발산: 원문유지 / 요약흡수 / 삭제 | **0.149 / 0.233 / 0.289** | ◐ |
| 컴팩션 직후 첫 행동의 blocked/error 증가 | **+0.108** (이후에도 지속) | ◐ |
| 압축이 피크 토큰을 줄이는 폭 | **26~54%** (≈2배 예산, 자릿수 아님) | ◐ |
| 압축 최대화 시 정확도 손실 | OfficeBench **−4.2p**, 8-objective QA **−3.1 EM** | ◐ |
| 검증기 최적화 압축(TRACE) vs 무압축 | 77.1% vs **85.7%** (−8.6p) | ◐ |
| 순진한 절단(FIFO/retrieval)의 hard 과제 붕괴 | 39.7% → **15.9%** | ◐ |

**정보이론적 근거** ◐ — Data Processing Inequality 상, 압축 표현으로 작동하는 자식은
전체 컨텍스트를 가진 단일 에이전트 대비 **정답과의 상호정보량을 늘릴 수 없다.**
요약 핸드오프는 **엄밀히 손실이며 결코 가산적이지 않다.**

### D.2 컴팩션은 비결정성의 원천이다 ◐

> *"Under stronger compression, the gap between P@2 and P² widens substantially."*

Pass@2(둘 중 하나 성공) − Pass²(둘 다 성공) 간극이 압축 강도에 비례해 벌어진다.
= **되던 게 가끔 안 되게 된다.**

> ◐ 요약 볼륨은 **조작 불가**하다 — 프롬프트 지시가 대체로 무시되고, 출력 길이 변동계수가
> 모델·입력크기에 따라 **19.8%~171.6%** 로 요동친다. "서브에이전트가 요약을 리턴한다" 설계는
> **무엇이 살아남을지가 실행마다 다르다.**

### D.3 컴팩션은 배경작업이 아니라 벽시계 비용이다 ◐

- 블로킹 컴팩션이 HotpotQA 전체 실행시간의 **최대 62%** 를 잡아먹음 (Llama-3.1-8B, 16k 임계).
- 압축기 자체 오버헤드: **14–28초/과제**, 프론티어 모델 압축기 **$0.045/예제**.
  → 소형 모델(Qwen3-14B)로 증류하면 품질 95%+ 유지하며 **$0.0004 (99.1% 절감)**.
- 병렬 블록 요약으로 바꾸면 **1.26×~1.60× 단축** — **팬아웃은 작업뿐 아니라 컨텍스트 관리에도 적용된다.**

### D.4 구현체별 컴팩션 정책 대조 ○

| 구현체 | 정책 |
|---|---|
| **Codex CLI** | 요약 단독 대체 **안 함** — `초기컨텍스트 + 최근 사용자메시지 ~20k + 요약` 하이브리드. 임계 `model_auto_compact_token_limit` ~180k/~244k(모델별), 유효 컨텍스트 95%. **컴팩션 자체가 실패해서 지수 백오프 재시도 로직 보유.** 제품 내 경고: *"반복 컴팩션은 모델 정확도를 떨어뜨린다"* |
| **OpenCode** | **2단 예산** — prune 패스가 도구출력 최근 40k 보호(`PRUNE_PROTECT`), 20k 이상 회수 가능할 때만 prune(`PRUNE_MINIMUM`). 전체 컴팩션은 `isOverflow()` 때만. `OPENCODE_DISABLE_AUTOCOMPACT` 로 완전 해제 가능 |
| **Amp (Sourcegraph)** | **자동 컴팩션 없음.** 수동 Handoff(보조모델이 목표 관련 정보만 추출해 새 스레드로) · Fork · Edit/Restore · 교차스레드 참조. **"사용자 주도 컨텍스트 수술 > 자동 요약"** 에 베팅 |
| **OpenHands** | Condenser 가 이벤트를 버리고 요약 대체, `CondensationEvent` 로 로그에 기록. 기본 `LLMSummarizingCondenser` 는 **API 비용 최대 2× 절감, 성능 저하 없음** 주장 ◐ |
| **Prime Agent** | 컴팩션이 **세션 수명과 분리** — IPython 커널이 컴팩션을 관통해 생존하므로 변수·임포트·태스크 상태가 남는다. 컴팩션은 goal·자율연속·heartbeat·자식세션을 **종료시키지 않는다**. 에이전트가 스스로 보존 대상을 지시 가능: `compact.run("Preserve the failing tests and remaining migration steps")` ◐ |

> **SoloSquad 함의 — Prime Agent 의 "커널 생존" 이 가장 중요한 아이디어다.**
> 컨텍스트를 압축해도 **실행 상태(변수·연결·작업 진행)** 를 압축하지 않으면 손실이 크게 준다.
> 우리 goal/workflow 의 `<id>/` 디렉터리가 정확히 그 자리를 이미 갖고 있다 —
> **컴팩션 시 컨텍스트만 줄이고 파일 상태는 온존**시키는 것이 설계 원칙이 되어야 한다.

### D.5 장기 무인 실행의 실제 실패 원인 ◐

Long-Horizon-Terminal-Bench (2026-07):

| 항목 | 값 |
|---|---|
| 과제당 평균 토큰 | **9.9M** |
| 평균 에피소드 | 231 |
| 평균 실행시간 | **85.3분** |
| **미해결 실행의 79%** | **90분 예산 소진 — 아직 작업 중이었다** |
| 조기 종료 | 19% · 하네스 오류 3% |
| 최강 모델 pass@1 (0.95 임계) | **15.2%** · 완벽 임계 10.9% |
| 전 모델 평균 | **4.3% / 1.7%** |

**"false finish"** — 부분 보상이 높은 지점에서 숨은 검증기를 만족시키지 못한 채 스스로 종료.
= **에이전트의 자가 완료 보고는 신뢰할 수 없다.**

> **SoloSquad 함의 (결정 6 = goal 8시간+ 무인 실행에 직격)** —
> ① 실패의 79% 가 "시간 초과" 라면 **필요한 것은 더 똑똑한 에이전트가 아니라 더 긴 지평**이다.
> ② **완료 판정을 에이전트에게 맡기면 안 된다.** 외부 검증기가 있어야 한다.
> ③ 참고: 이 벤치마크의 레퍼런스 하네스는 **단일 롱호라이즌 터미널 세션** 이다 —
> 즉 현재 표준 평가 환경에는 서브에이전트 분해가 **아예 없다.**

---

## E. 축 4 — 협업 프로토콜

### E.1 4가지 형태

| 형태 | 대표 | 특징 |
|---|---|---|
| **부모 보고형** (요약 리턴) | Anthropic 리서치, Claude Code 서브에이전트 | 단순·저비용. **정보 손실 §D1** |
| **피어 메일박스** | Prime Agent ◐, OpenCode teams ○ | 풀메시. 배달 모드·수신 상태 필요 |
| **공유 작업 큐** | Hermes Kanban, Claude Code agent teams | claim·락·의존성. 크래시 복구에 강함 |
| **블랙보드(공유 상태)** | CodeCRDT ◐ | 메시지 없이 관찰로 조율 |

### E.2 Prime Agent 의 메시징 계약 ◐ — 가장 정교한 실측 사례

| 요소 | 값 |
|---|---|
| 배달 모드 | `auto`(바쁘면 steer, 유휴면 즉시) · `steer`(작업 중 삽입) · `follow_up`(현재 턴 종료 대기) |
| 수신 상태 | `delivered`(유휴 타깃 컨텍스트 도달) / `queued`(후속 배달 수락) |
| 도달 범위 | **family roster 안으로만 브로드캐스트** |
| 발신자 신원 | **데몬이 서버측에서 파생** (자칭 불가) |
| 제한 | 메시지 크기·레이트·대기큐 상한 |
| **되돌린 결정** | 커밋 #597(2026-08-05) *"narrow agent reach to the nuclear family"* — **도달 범위를 나중에 좁혔다** |

**스케줄 배달의 크래시 안전성** ◐:
> *"Due ticks are **claimed before delivery** so a crash does not replay an uncertain prompt,
> and **missed ticks are coalesced** rather than accumulated into an unbounded backlog."*

= claim-before-deliver + tick coalescing. **재시도 큐가 무한히 자라지 않게 하는 정석.**

### E.3 스폰 모델은 3번 갈아엎였다 ○ (OpenCode agent-teams 포팅)

| 시도 | 결과 |
|---|---|
| 논블로킹 스폰 | lead 가 먼저 종료 → **팀원 고아화** |
| 블로킹 스폰 | **병렬성 소멸** |
| **최종** | fire-and-forget + 세션ID 즉시 반환 + **auto-wake** (메시징 계층이 유휴 세션을 재기동할 수 있어야 성립) |

메일박스 구조: 에이전트별 **append-only JSONL** 이 진실의 원천(O(1) append) + 수신자 세션에
**합성 user 메시지로 주입**. (Claude Code 의 JSON 배열 저장은 O(N) 역직렬화라고 저자가 지적 ○)

**배달 내구성은 best-effort** ○ — 메시지당 10KB 상한은 있으나 **바운드 큐가 없어** 빠른 발신자가
느린 수신자를 범람시킬 수 있고, `markRead()` 와 영수증 주입 사이 크래시 시 **읽음 알림이 영구 소실**.
크래시된 팀원은 **자동 재시작 안 함** — 폭주 방지를 위한 의도적 선택.

> **대조** — OpenClaw 는 **30분 재시도 · 7일 보존 · 수동 retry** 라는 명시적 내구성 사다리를 갖는다.
> [[260810-openclaw-orchestration-topology]] 의 그 설계가 **업계에서 가장 앞서 있다**는 것이 이 조사로 확인된다.

### E.4 블랙보드(CRDT)의 실측 ◐

CodeCRDT, 600 시행(6 과제 × 50 실행 × 2 모드):

| 지표 | 값 |
|---|---|
| 속도 | 일부 과제 **+21.1%**, 다른 과제 **−39.4%** — **부호가 뒤집힌다** |
| 머지 | **100% 수렴, 머지 실패 0** |
| 그러나 | **의미적 충돌 5~10% 잔존** |

= **문법/데이터 층의 충돌은 CRDT 로 완전히 없앨 수 있지만, 의미 충돌은 별도 조정 단계가 필요하다.**

### E.5 조율을 늘리면 손해다 ◐ (가장 반직관적 결과)

정보 통제 벤치(단일 모델, 고정 도구·프롬프트, Polymarket 이진시장 100개):

| 토폴로지 | 비용/시장 | Brier(낮을수록 좋음) | 판정 |
|---|---:|---:|---|
| **독립 앙상블(무통신)** | **$0.10** | **0.159** | **프론티어** |
| 순차 파이프라인 | $0.36 | **0.153** | 프론티어 |
| 오케스트레이터-전문가 | $0.31 | 0.162 | **지배당함** |
| 피어 비평 토론 | $0.23 | 0.170 | **지배당함** |

- 중조율 토폴로지가 평평한 팬아웃 대비 **토큰 3.2~3.6×**, 그 증가분은 **입력 토큰**(도구 페이로드 + 상위단계 출력 누적).
- 토폴로지별 고유 실패 시그니처: 합의정렬 → **가장 먼저 나온 제안에 앵커링해 다양성 붕괴** ·
  오케스트레이터 → **lead 가 단일 오류원, 실수가 하위작업에 연쇄** · 고정순서 파이프라인 → **초기 오류가 정정 지점 없이 전파**.
- ⚠ **통계적 검정력 약함** — 5개 사전등록 예측 중 3개만 방향 일치, 쌍별 비교는 n=100 에서 Bonferroni 보정 통과 못함. 저자도 "방법론 검증용 첫 사례" 라고 못박음.

### E.6 표준 프로토콜의 실제 채택 ◐

| 프로토콜 | 경계 | 상태 |
|---|---|---|
| **MCP** | 에이전트 ↔ 도구 | 2025-12 Anthropic 이 **Agentic AI Foundation**(LF 산하, Block·OpenAI 공동창립)에 기부 |
| **A2A** | 에이전트 ↔ 에이전트 | 2025-06-23 Google 이 LF 기부. **v1.0.0**, 3전송(JSON-RPC/gRPC/REST). 2026-04 기준 지원 조직 150+ |
| **ACP (IBM)** | 에이전트 ↔ 에이전트 | **폐기** — 2025-03 출시, 2025-08 A2A 로 흡수. **출시~폐기 5개월** |
| **ACP (Zed)** | 에디터 ↔ 에이전트 | 활성. 안정 프로토콜 버전 1. Rust/TS/Python/Java/Kotlin SDK |
| **AG-UI** | 에이전트 ↔ 프론트엔드 | 17개 이벤트 타입, `STATE_DELTA` 는 **RFC 6902 JSON Patch**. 6개 런타임 어댑터 |

**⚠ 이름 충돌 주의** — "ACP" 는 두 개다. IBM 것은 죽었고 Zed 것은 살아있다.

**그리고 A2A 는 우리 같은 케이스를 명시적으로 배제한다** ◐:
> *"If you are building a **local coding assistant** […] A2A is probably unnecessary.
> **No A2A when the workflow is local.**"*

**MAST 논문의 반론** ◐: 에이전트 간 오정렬은 관측된 실패의 **~32%** 인데,
컨텍스트 전달·통신 프로토콜(=A2A/MCP/ACP 계열) 로는 **불충분**하며 "social reasoning" 이 필요하다.

> **SoloSquad 함의** — **표준 프로토콜을 채택할 이유가 지금은 없다.**
> 우리는 로컬 단일 애플리케이션이고, A2A 스펙 자체가 이 경우를 배제한다.
> **ACP(Zed) 만 예외** — 에디터 통합을 목표로 삼는 날 필요해진다.

---

## F. 축 5 — Runner 추상화: **세션을 누가 소유하는가**

**§C1 하네스 인터페이스 ADR 의 핵심 입력.**

### F.1 5가지 답

| 프레임워크 | 소유자 | 실제 시그니처 | 포기한 것 |
|---|---|---|---|
| **OpenAI Agents SDK** | **호출자** ✅ | `Runner.run(agent, input, *, session: Session\|None = None, ...)` — Runner 는 **per-call 무상태** | 런타임이 상태 일관성을 보장 못함 |
| **Google ADK** | **런타임 + SessionService** ✅ | 에이전트는 `event.actions.state_delta` 를 실어 **yield** 만 하고, Runner 가 `session_service.append_event()` 로 커밋해야 영속 보장 | 호출자 자유도 |
| **LangGraph** | **분할** ◐ | 식별자는 호출자(`config["configurable"]["thread_id"]`), 저장소는 컴파일 타임(`builder.compile(checkpointer=, store=)`) | 단일 소유자의 명확성 |
| **ACP (Zed)** | **에이전트** ◐ | 클라가 `session/new` 호출 → **에이전트가 `sessionId` 생성·소유** | 클라이언트의 세션 복원 능력 |
| **Temporal + Agents SDK** | **durable 런타임** ◐ | `Agent`/`Runner` 객체가 **Workflow 실행 컨텍스트 안에서** 생성·수명 → 상태가 **워크플로 히스토리로 영속** | 스트리밍(별도 배관 필요) |

### F.2 OpenAI Agents SDK — 4메서드 Session 프로토콜 ✅

```python
async def get_items(self, limit: int | None = None) -> list[TResponseInputItem]
async def add_items(self, items: list[TResponseInputItem]) -> None
async def pop_item(self) -> TResponseInputItem | None
async def clear_session(self) -> None
# + session_id: str (필수 속성), session_settings (선택)
```

**이 4개만 구현하면 어떤 백엔드든 유효한 세션이다.** 공식 구현: `SQLiteSession`,
`AsyncSQLiteSession`, `RedisSession`, `SQLAlchemySession`, `MongoDBSession`, `DaprSession`,
그리고 **서버 소유** `OpenAIConversationsSession(conversation_id="conv_123")`.

**결정적 제약** ✅:
> *"In the same run, a session **cannot be combined with** the run-level continuation options
> `conversation_id`, `previous_response_id`, or `auto_previous_response_id`."*

= **클라이언트 소유와 서버 소유는 배타적이다. 반드시 하나를 골라야 한다.**

**루프 종료 계약** ✅: 최종출력(`agent.output_type`) → 종료 / handoff → 재진입 / 그 외 → 툴 실행 후 재루프.
`max_turns` 초과 시 `MaxTurnsExceeded`, `None` 이면 **무제한**.

### F.3 Google ADK — 상태 스코프 4단 접두사 ✅

| 접두사 | 스코프 | 영속성 |
|---|---|---|
| (없음) | 현재 세션 | 영속 |
| `user:` | 해당 사용자의 **모든 세션** | 영속 |
| `app:` | 앱 전체 **모든 사용자/세션** | 영속 |
| `temp:` | **단일 invocation 한정** | **비영속** |

**`temp:` 의 결정적 성질** ◐:
> *"When a parent agent calls a sub-agent […] it passes its `InvocationContext` to the sub-agent.
> This means the entire chain of agent calls shares the same invocation ID and, therefore, **the same `temp:` state**."*

= **부모→자식 체인 전체가 하나의 스크래치패드를 공유하되, 끝나면 사라진다.**

**협력적 async generator 계약** ✅:
> *"Execution of the agent logic **pauses immediately after the yield** statement. […]
> Only after the Runner has processed the yielded event does the agent logic resume."*

그리고 **dirty read 를 문서가 인정한다** ◐ — 같은 invocation 안에서 커밋 전 상태를 읽을 수 있고,
yield 전에 invocation 이 실패하면 그 변경은 **유실된다.** = **이벤트 yield 지점이 사실상 체크포인트 경계다.**

**안티패턴 명시** ✅: `retrieved_session.state['key'] = value` 는 이벤트 추적을 우회하고,
`DatabaseSessionService`·`VertexAiSessionService` 에서 **영속되지 않으며** `last_update_time` 도 갱신 안 됨.

### F.4 LangGraph — 저장소에 이음매를 낸다 ◐

**4쌍(8메서드) 추상 베이스 클래스**:
```
get_tuple(config)                          / aget_tuple
list(config, filter, before, limit)        / alist
put(config, checkpoint, metadata, new_versions) / aput
put_writes(config, writes, task_id, task_path)  / aput_writes
+ delete_thread, delete_for_runs, copy_thread, prune
```

> **§C1 직결** — **LangGraph 는 하네스 이음매를 "실행"이 아니라 "저장소"에 냈다.**
> 우리의 5-메서드 시그니처가 무엇을 추상화할지에 대한 **제3의 선택지**다.

**체크포인트 레코드** ◐: `v=1` TypedDict + `channel_values`/`channel_versions`/`versions_seen`,
메타데이터에 `source ∈ {input, loop, update, fork}` 와 `step`(첫 입력은 −1).
→ **fork 가 메타데이터 값으로 존재한다** = 시간여행·분기가 로그가 아니라 **주소지정 가능**하다.

**durability 3값 노브** ◐:
```python
Durability = Literal["sync", "async", "exit"]
# sync : 다음 스텝 전 동기 영속
# async: 다음 스텝 실행 중 비동기 영속
# exit : 그래프 종료 시에만 영속
```
= **전부/전무가 아니라 호출 단위로 쓰기지연 ↔ 크래시복구를 맞바꾼다.**

**human-in-the-loop 이 상태모델에 타입으로 박혀 있다** ◐:
`StateSnapshot.interrupts: tuple[Interrupt, ...]`, 각 `Interrupt` 는 재개 가능한 `id`,
재개는 `Command(resume=...)`. = **일시정지가 out-of-band 관례가 아니라 1급 상태 전이.**

**운영 한계** ◐: `thread_id` **255자 미만**(Postgres 컬럼 길이), `InMemorySaver` 는 재시작 시 전부 소실,
장수 스레드에서 체크포인트가 누적되므로 **애플리케이션이 직접 pruning 전략을 구현해야** 한다(내장 TTL 없음).

**소유권이 배포 모드에 따라 뒤집힌다** ◐:
> *"**Agent Server handles persistence automatically** — When using the Agent Server, you do not need
> to implement or configure checkpointers or stores manually."*

= 같은 그래프 코드가 라이브러리 모드에선 자기 상태를 소유하고, 매니지드 모드에선 서버에 위임한다.

---

## G. 축 6 — thread / session / run 3층 모델과 그 폐기

### G.1 OpenAI Assistants API — 폐기 연표 ◐

| 날짜 | 사건 |
|---|---|
| 2025-08-26 | 개발자에게 폐기 통보 |
| **2026-08-26** | **하드 셧다운** (통보 후 정확히 1년) |

**대체 매핑** ◐:

| Assistants | Responses | 변화 |
|---|---|---|
| Assistants | **Prompts** | 대시보드 생성·버전관리 |
| **Threads** | **Conversations** | 메시지만이 아니라 **item 스트림** |
| **Runs** | **Responses** | **툴콜 루프를 클라이언트가 명시 관리** |
| Run steps | Items | 메시지·툴콜·출력 등 일반화 객체 |

**즉 3층 모델은 버려진 게 아니라 다시 잘렸다.** 그리고 잘린 자리가 정확히
**"런루프를 서버가 도느냐 클라이언트가 도느냐"** 다.

### G.2 thread 를 1급으로 만든 대가 ◐

| 비용 | 내용 |
|---|---|
| **락** | *"When a Run is in_progress and not in a terminal state, **the Thread is locked**"* — 종료 상태 전까지 새 메시지·새 run 추가 불가 |
| **만료** | `requires_action` 의 툴 출력은 `expires_at`(**생성 후 ~10분**) 전에 제출해야 함. 아니면 `expired` |
| **상태머신 9종** | queued · in_progress · requires_action · cancelling · cancelled · failed · completed · **incomplete** · expired |
| **스펙 드리프트** | ◐ `incomplete` 가 **OpenAI 자신의 OpenAPI 스펙에 없었다**(2024-05-10 보고 → 05-13 수정). 공식 Node SDK 의 `RunStatus` 타입에도 빠져 있어 **타입 클라이언트가 서버가 실제로 반환하는 상태를 표현할 수 없었다** |
| **컨텍스트 한계** | Thread 당 메시지 **100,000**, `truncation_strategy: auto\|last_messages`, run 단위 `max_prompt_tokens`/`max_completion_tokens` |

**"human-in-the-loop 을 Run 에 주차할 수 없다"** ◐ — 10분 만료 때문에.
장시간 툴 실행도 마찬가지다.

> **SoloSquad 함의 (M9 직결)** —
> **"thread 를 1급 자원으로 만들면 배타 락과 만료 타이머가 따라온다."**
> 우리가 Discord 스레드에 워크플로를 매다는 지금 구조는 **Assistants 와 같은 함정**을 갖는다:
> 스레드에 진행 중인 실행이 있을 때 새 요청이 오면 어떻게 되는가?
> Assistants 는 **락**으로 답했고 **그래서 폐기됐다**. 우리는 **레인(lane)** 으로 답해야 한다
> — Hermes 의 `session_key` 문법이 정확히 그 답이다.

### G.3 Responses API 의 새 계약 ◐

| 항목 | 값 |
|---|---|
| 상태 컨테이너 2종 | `previous_response_id` 체이닝 / `conversation` 객체 |
| **TTL 비대칭** | Response 객체 **30일 기본**(`store: false` 로 해제) · **Conversation 객체와 그 item 은 30일 TTL 면제** |
| **비용** | 체이닝은 절감이 아니다 — *"all previous input tokens for responses in the chain are **billed as input tokens**"* |
| 수동 상태관리 시 | 어시스턴트 텍스트만이 아니라 **`output` 배열의 모든 item 을 그대로 왕복**시켜야 추론이 보존됨 = 자체 하네스는 **provider 고유 불투명 item 을 원문 그대로 영속**해야 함 |

### G.4 ACP 의 대안 — run 상태머신을 5개로 압축 ◐

`PromptResponse.stopReason` 은 **동기 반환**되는 5값뿐:
`end_turn` · `max_tokens` · `max_turn_requests` · `refusal` · `cancelled`.

- queued/in_progress/requires_action/expired **폴링 상태가 없다.**
- 중간 상태는 `session/update` **알림으로 push**.
- 툴 승인(=Assistants 의 `requires_action`)은 run 상태가 아니라 **별도 `session/request_permission` 호출**.

> **이것이 3층 모델 문제의 현재 최선의 답으로 보인다** — run 을 자원으로 만들지 않고
> **동기 반환 + 이벤트 push** 로 대체하면 락도 만료도 폴링도 사라진다.

### G.5 ADK 의 3층 ◐

`Session`(영속) / `Invocation`(단일 질의 사이클, `invocation_id`) / `Event`(원자 단위) + `branch`(에이전트 위계 경로).

**run 층이 상태머신을 가진 1급 자원이 아니라 상관관계 ID 로 축소되어 있다.** — Assistants 의 반대 선택.

`EventActions` 가 제어흐름을 데이터로 실어나른다: `state_delta` · `artifact_delta` ·
`transfer_to_agent` · `escalate` · `skip_summarization`.
→ **멀티에이전트 핸드오프가 별도 Runner API 가 아니라 이벤트 스트림 위의 데이터다.**
이벤트 스트림을 소비하는 어떤 하네스든 관측할 수 있다.

**스트리밍과 커밋의 분리** ◐: `partial=True` 이벤트는 UI 로 즉시 전달되지만 그 `actions` 는 처리되지 않고,
`partial=False` 또는 `turn_complete=True` 인 최종 이벤트만 상태를 커밋한다.

---

## H. 축 7 — 내구성 실행(durable execution) 런타임

### H.1 Temporal 의 선택 — 경계는 "에이전트 루프"가 아니라 "모델 호출·툴 호출" ◐

`temporalio.contrib.openai_agents.OpenAIAgentsPlugin(SimplePlugin)`:

- 툴 = 평범한 Temporal Activity (`@activity.defn`) → `activity_as_tool` 이 함수 시그니처에서 **OpenAI 툴 스키마 자동 생성**.
- **LLM 비결정성 처리** = 개발자가 손으로 감싸는 게 아니라 플러그인이 모델 호출을 **결정론 샌드박스 밖 activity 로 라우팅**.
- `Agent`/`Runner` 는 **Workflow 실행 컨텍스트 안에서** 살아 → 멀티턴 상태가 **워크플로 히스토리로 영속**.

**❗ 기본 타임아웃이 없다** ◐:
> `ModelActivityParameters` 의 `task_queue`·`schedule_to_close_timeout`·`schedule_to_start_timeout`·
> `start_to_close_timeout`·`heartbeat_timeout`·`retry_policy`·`versioning_intent`·`summary_override`
> **전부 `X | None = None`.** `cancellation_type` 필드는 아예 없음.

= **durable 런타임을 채택한다고 타임아웃 매트릭스를 물려받지 않는다. 전부 직접 설계해야 한다.**

**❗ 스트리밍이 activity 경계를 못 넘는다** ◐ — 별도 배관 필드가 추가됨:
`streaming_topic: str | None = None`, `streaming_batch_interval: timedelta`, `use_local_activity: bool`.
그리고 *"배치 간격을 `start_to_close_timeout` 보다 낮게 설정해 멈춘 모델 호출을 먼저 잡으라"* 고 문서가 지시.

> **이것이 "에이전트 루프를 durable workflow 로 짜라" 에 대한 가장 구체적인 반대 논거다.**
> 토큰 스트리밍이 **별도 전송 + 별도 튜닝 노브**가 된다. 인터랙티브 코딩 에이전트에서 스트리밍은 주 UX 다.

**MCP 는 균일하게 다룰 수 없다** ◐:
`mcp_server_providers: Sequence[StatelessMCPServerProvider | StatefulMCPServerProvider] = ()`
— **툴 서버가 세션 상태를 갖는지 여부가 replay 시 재호출 가능성을 결정**하므로 타입 수준에서 갈라야 한다.

**샌드박스는 별도 주입층** ◐: `sandbox_clients: Sequence[SandboxClientProvider] = ()`
→ **durable 런타임(축7)과 격리 러너(축8)가 하나의 런타임이 아니라 합성 가능한 별개 레이어로 설계돼 있다.**

### H.2 결정론 요구는 보편적이지 않다 ◐

| 방식 | 결정론 요구 | 근거 |
|---|---|---|
| **로그 기반** (Temporal, Restate) | **시스템 레벨 강제** | 재실행하며 순차 로그와 대조, 기록된 스텝은 값만 재생 |
| **객체/프라미스 집합** (Resonate) | **유스케이스 레벨만** | 미해결 프라미스만 호출, 코드 경로가 달라져도 복구 중단 없음 |

**로그 기반의 구체적 실패 모드** ◐:
> 비결정적 분기(예: `random()` 가드가 `baz()` 호출 여부를 결정)가 replay 시 로그 불일치를 만들고,
> **그 시점에 런타임이 진행할 방법을 잃는다.**

→ LLM 출력은 본질적으로 비결정적이므로 **에이전트 루프를 워크플로 코드로 직접 쓰면 이 함정에 정면으로 걸린다.**
Temporal 이 모델 호출을 activity 밖으로 밀어낸 이유가 바로 이것.

> ◐ *"To be successful with any Durable Execution platform, a developer will inevitably need to
> understand how replay works."* — **어떤 플랫폼도 이 학습비용을 추상화해주지 못한다.**

### H.3 checkpointing ≠ durable execution ○

> *"Checkpointing says: '**I saved your state. You take it from here.**'
> Durable execution says: '**Your agent workflows will run to completion. Period. I handle everything.**'"*

| 프레임워크 | 상태 저장 | 실패 감지 | 자동 재개 |
|---|---|---|---|
| LangGraph checkpointer | O | **X** | **X** — 호출자가 `invoke(None, config)` 재호출 |
| Google ADK `ResumabilityConfig(is_resumable=True)` (v1.14.0) | O | **X** | **X** — watchdog·heartbeat·health check **없음** |
| CrewAI `@persist` | O (SQLite, 스텝별) | X | **X** — `from_pending(flow_id)`/`resume()` 수동 + 개발자가 skip 로직 작성 |
| Dapr Workflows | O (모든 await 지점) | O | **O** |

**ADK 의 재개 단위**: `invocation_id` 기반. `SequentialAgent` 는 `current_sub_agent`,
`LoopAgent` 는 `times_looped`, `ParallelAgent` 는 완료된 서브에이전트를 추적. (v1.16.0 `ReflectAndRetryToolPlugin`)

> **SoloSquad 함의 (M9·§F′[3] 직결)** — 결정 6(goal 8시간+ 무인)이 요구하는 것은
> **checkpointing 이 아니라 durable execution 이다.** 그런데 조사한 **에이전트 프레임워크 전부가
> checkpointing 까지만 제공한다.** 감시자(watchdog)를 우리가 짓거나 Dapr/Temporal 급을 도입하거나 둘 중 하나다.
> **그리고 이건 "하네스가 세션을 소유하는가" 와 완전히 별개의 결정이다.**

---

## I. 축 8 — 샌드박스/격리 러너 실측치

### I.1 스냅샷·재개 성능 ◐

| 항목 | E2B | Modal |
|---|---|---|
| pause 비용 | **~4초 / 1GiB RAM** (선형) | — |
| resume 비용 | **~1초** | — |
| 스냅샷 범위 | FS + 메모리(기본), `keepMemory:false` 로 FS만 | FS(`snapshot_filesystem`) / 디렉터리(`snapshot_directory`) / **메모리(alpha `_experimental_snapshot`)** |
| 보존 | **TTL 없음 — 무기한**, 명시적 kill 필요 | FS·디렉터리 **30일** · **메모리 7일 (연장 불가)** |
| 연속 실행 상한 | Pro **24시간** / Hobby **1시간** · 기본 타임아웃 **5분** | 기본 **5분**, 최대 **24시간** + 별도 idle_timeout |
| pause/resume 효과 | **연속 실행 한도 리셋** | 메모리 스냅샷은 **샌드박스를 종료시킨다** |

**Modal 메모리 스냅샷의 제약** ◐ — 라이브 세션의 주기적 체크포인트로 **쓸 수 없다**:
- 스냅샷을 뜨면 **샌드박스가 종료된다.**
- **같은 인스턴스 타입**에서만 복원 가능, **GPU 미지원**.
- 열린 TCP 연결은 스냅샷 시 닫히고 복원 후 재연결 필요.
- **`Sandbox.exec` 실행 중에는 스냅샷 불가** → 에이전트가 툴콜 중간에 스냅샷하려면 **먼저 자기 실행을 정지시켜야** 한다.
- 만료 스냅샷은 **지연 실패** — 마운트 시점 또는 첫 상호작용 때 `NotFoundError` → **세션 시작이 아니라 실행 중간에 터진다.**

**E2B 의 세션 모델** ◐ — 샌드박스가 **1급 조회가능 자원**:
```
Sandbox.list({ query: { state: ['paused'] } })   # Running/Paused/Snapshotting/Killed
Sandbox.connect(id)                               # 수명을 "연장만" 함 (리셋 아님)
```

**Modal 의 세션 모델** ◐ — **외부 서비스 소유** 패턴의 교과서:
```
sb.detach()                          # 클라이언트 연결만 해제, 샌드박스는 계속 실행
Sandbox.from_id(sandbox_id)          # 나중에 아무 프로세스나 재획득
Sandbox.from_name(app_name, sandbox_name)
```

### I.2 네트워크 정책 — 기본값이 갈린다 ◐

| 러너 | 기본 egress | 세부 |
|---|---|---|
| **OpenAI Codex cloud** | **차단(deny)** | agent 단계 인터넷 차단. **setup script 단계는 열림**(의존성 설치용) → **네트워크 정책 경계로 2단계 분리**. 켤 경우 None / `Common dependencies` 프리셋(80+ 도메인) / All 3단. **HTTP 메서드 수준 강제**(GET/HEAD/OPTIONS 만 허용, POST/PUT/PATCH/DELETE 차단 옵션) |
| **GitHub Copilot coding agent** | **차단(deny + 큐레이션 allowlist)** | **GitHub Actions 어플라이언스가 러너**. 방화벽은 **에이전트의 Bash 툴이 띄운 프로세스에만** 적용 — **MCP 서버와 사전 setup 단계는 면제**. 조직/repo 3키 설정(`Enable firewall`/`Recommended allowlist`/`Allow repository custom rules`), 기본 위임 상태는 "Let repositories decide". 차단 시 **PR 본문/코멘트에 경고를 남긴다**(무음 실패 아님) |
| **Modal** | **허용(permissive)** | 모든 공개 IP 로 아웃바운드 가능, 인바운드는 0. `block_network=True` / `outbound_cidr_allowlist` / `outbound_domain_allowlist`(TLS 443 만) 로 **opt-in 하드닝** |

**Codex 가 밝힌 차단 근거** ◐ — 성능이 아니라 **위협 모델**:
> *"Prompt injection from untrusted web content" · "Exfiltration of code or secrets"*
> — GitHub 이슈 본문에 숨긴 지시가 에이전트를 조작해 커밋 메시지를 공격자 서버로 보내는 시나리오.

### I.3 OpenHands 러너 = 아웃오브프로세스 클라이언트-서버 ◐

- 백엔드가 **세션별 Docker 컨테이너를 RESTful API 로 구동** → 샌드박스가 라이브러리 호출이 아니라 **네트워크 주소를 가진 서비스**.
- 컨테이너 안 진입점은 `ActionExecutor` 하나 — **Action in / Observation out** (5메서드 수명주기 API 가 아니다).
- **콜드스타트는 스냅샷이 아니라 이미지 태그 3단 + 재빌드 4단 사다리로 관리**:
  ```
  versioned : oh_v{ver}_{base_image}
  lock      : oh_v{ver}_{lock_hash16}          # MD5(base + pyproject.toml + poetry.lock)[:16]
  source    : oh_v{ver}_{lock_hash16}_{src_hash16}
  ```
  → no re-build / fastest / ok-ish / slowest.
- 영속 상태는 호스트 마운트로 위임(`SandboxConfig.volumes`: bind / `volume:<name>` / `:overlay` COW).
  **컨테이너 자신은 durable 상태를 갖지 않는다.**
- `DockerWorkspace` 사용 시 로컬 `Conversation` 이 자동으로 **`RemoteConversation`** 으로 승격 —
  자체 conversation ID + WebSocket 이벤트 스트리밍.
- 관측성이 **사후 로그가 아니라 라이브 인간 관람 표면**: 컨테이너에 **VS Code Web**(에이전트 작업파일 열람·편집) +
  **noVNC**(에이전트 브라우저 실시간 관람) 내장. 로컬(비Docker) 에이전트 서버엔 없음.

---

## J. 반대 논거와 그 정확한 경계

**균형을 위해 반드시 읽어야 하는 절이다.**

### J.1 Cognition, *"Don't Build Multi-Agents"* (2025-06-12) ○

- **입장**: 병렬 멀티에이전트 협업은 **취약한 시스템**을 만든다. 기본 아키텍처는 **단일 스레드 선형 에이전트**.
  OpenAI Swarm, Microsoft Autogen 을 **틀린 패턴을 밀고 있다고 실명 지목.**
- **실패 메커니즘**: 형제 서브에이전트가 서로의 **trace 를 못 본다** → 암묵적 결정이 충돌 →
  병합 에이전트가 조정 불가능한 조합을 물려받는다.
  → *"Share context, and **share full agent traces**, not just individual messages"*
- **처방**: 행동·대화 이력을 핵심 세부·사건·결정으로 압축하는 **전용 LLM**.
  단, *"This is **hard to get right**. It takes investment."* — 공짜 프리미티브가 아니라고 못박음.
- **예측**: 쓸만한 병렬성은 전용 에이전트 간 프로토콜이 아니라 **단일 스레드 에이전트의 소통능력 향상의 부산물**로 온다.

### J.2 LangChain Harrison Chase (2025-06-16) ○

- **결정 축**: **읽기 중심 vs 쓰기 중심.** 병렬 서브에이전트는 정보 수집(읽기)엔 유효, **쓰기에선 붕괴** —
  충돌 쓰기를 병합해야 하고 에이전트 간 컨텍스트를 전달해야 하기 때문.
- **코딩을 명시적으로 나쁜 궁합으로 지목**: 리서치보다 진짜 병렬 가능한 하위작업이 적고,
  현재 LLM 에이전트는 실시간 상호 조율·위임을 못한다.
- **Anthropic Claude Research 도 같은 선택**: 종합/작성은 **단일 메인 에이전트에 가뒀고**,
  서브에이전트는 **읽기/리서치 단계에만** 썼다 — **의도된 선택이지 한계가 아니었다.**
- **왜 그래도 작동하는가**: *"Multi-agent systems work mainly because they help **spend enough tokens**"*
  → **추론 품질 향상이 아니라 토큰 스케일링.** = 항상 더 나은 아키텍처가 아니라 **비용/가치 판단.**

### J.3 정량 반론 — 예산 통제 시 단일이 이긴다 ◐

thinking token 예산을 6단(100/500/1k/2k/5k/10k)으로 고정, 3개 모델군 × 5개 MAS 아키텍처:

> *"SAS is the best-performing system or statistically indistinguishable from the best
> **for all budgets except the lowest one**"*
> (예: MuSiQue @5k, DeepSeek-R1 — SAS **0.419** vs Sequential MAS 0.323)

**보고된 MAS 우위는 상당 부분 compute confound 다.** 저자들은 **Gemini 2.5 의 thinking-budget 제어가
요청 예산을 충실히 강제하지 않는 계측 artifact** 를 지적한다 → **실제 추론 토큰을 정규화하지 않은
MAS vs SAS 벤치마크는 전부 의심 대상.**

### J.4 ❗ 그런데 그 반론에는 명시적 경계가 있다 ◐ — **이게 결정적이다**

같은 논문이 **멀티에이전트가 실제로 값하는 조건을 반증가능하게 제시한다**:

> *"multi-agent systems become competitive when a single agent's **effective context utilization is degraded**,
> or when more compute is expended."*
> (masking/substitution 로 유도한 heavy degradation α=0.7 에서 Sequential MAS 가 SAS 를 역전)

그리고 스코프를 스스로 제한한다:
> *"focuses on **text-only multi-hop reasoning**; MAS advantages **with tools/vision or safety constraints are out of scope**"*

> ### 이 조사의 가장 중요한 한 줄
> **"장기 코딩 에이전트는 정의상 컨텍스트가 열화된 영역에 산다"** — 수 시간~수일에 걸친 context rot 이 바로
> 그 α 다. 따라서 **이 논문은 코딩 에이전트의 멀티에이전트를 반증하지 않는다.**
> 대신 **서브에이전트의 정체를 재정의한다: 추론 품질 업그레이드가 아니라 컨텍스트 열화 치료제다.**
>
> **→ 이 프레이밍이 M9 의 판단 기준이 되어야 한다.** "서브에이전트가 더 똑똑한가?" 는 틀린 질문이다.
> **"이 작업의 컨텍스트가 열화됐는가?"** 가 맞는 질문이다.

### J.5 MAST — 실패의 구조 ◐

1,600+ 주석 trace, 7개 MAS 프레임워크(ChatDev·MetaGPT·HyperAgent·AppWorld·AG2·Magentic-One·OpenManus):

- **14개 실패 모드 → 3범주**: 시스템 설계 문제 · **에이전트 간 오정렬** · **작업 검증**. (주석자 일치도 κ=0.88)
- **전술적 수정의 한계**: ChatDev 에서 역할 명세 개선 + CEO 최종결정권 부여 = **+9.4%**,
  고수준 목표 검증 추가 = ProgramDev **+15.6%**. → **대부분의 실패는 그대로 남았다.**
  저자 결론: 프롬프트/토폴로지 조정보다 *"more sophisticated solutions"* 필요.
- **검증기가 겉핥기다**: *"많은 기존 verifier 가 철저히 검증하라고 프롬프트해도 코드가 컴파일되는지 같은
  피상적 검사만 수행한다."* → **최종단 저수준 검사 의존은 부적합, 실행 전반에 분산된 다단 검증 필요.**

**41~87% 생산 실패율** ◐ (별 논문) — 대부분 base-model 능력이 아니라 **조율 결함**.
→ 조율을 **에이전트 로직·정보접근과 분리된 설정 가능한 아키텍처 레이어**로 다뤄야 한다는 주장.

### J.6 실무자 1인칭 회의 ○

Armin Ronacher (2025-07-30):
- Task 툴은 병렬화·컨텍스트 격리에 자주 쓰지만, **Anthropic 의 전용 sub-agents 기능이 raw task 툴보다 쉽지 않았다.**
- **읽기 전용 조사에만 팬아웃이 작동**한다. 읽기/쓰기 혼합 하위작업은 **혼돈**.
- 이론상 서브에이전트가 컨텍스트를 보존해야 하는데, **새 세션 시작 + Markdown 파일에 생각 쓰기**가 더 나은 결과.
- **print/headless 모드가 느리고 디버깅이 어려웠다** — 무인 장기 실행의 기반이 될 바로 그 표면.

---

## K. SoloSquad 환류 — 결정 항목에 직접 넣을 것

### K.1 M12 (세션 비용 배수) — **변수 재정의 제안**

기존 조사([[260810-hermes-agent-orchestration-topology]] §C)에서 확인된 것: **Hermes 는 배수를 측정한 적이 없다.**
보수적 기본값 + 다층 캡을 냈을 뿐이고, 실제 사고(#80764)는 **세션당 상주 바이트(캐시된 트랜스크립트 RSS)** 였다.

이제 외부 실측치가 확보됐다:

| 변수 | 값 | 등급 |
|---|---|---|
| 멀티에이전트 / 채팅 토큰 배수 | **15×** | ✅ |
| 단일 에이전트 / 채팅 | ~4× | ✅ |
| 중조율 토폴로지 / 독립 팬아웃 | **3.2~3.6×** | ◐ |
| **증가분의 정체** | **입력 토큰**(도구 페이로드 + 상위단계 출력 누적), 출력 아님 | ◐ |
| 단일 세션 장기작업 절대 비용 | **9.9M 토큰 / 231 에피소드 / 85분** | ◐ |
| 압축이 사는 피크 토큰 | 26~54% | ◐ |

> **제안** — M12 의 측정 대상을 **"세션 수 × 배수"** 에서
> **"세션당 상주 입력 토큰 + 상주 RSS"** 로 바꾸면 `[2] 컨텍스트` 블로커가 해소된다.
> 배수는 이미 외부 실측치(15× / 3.2–3.6×)가 있으므로 **우리가 측정할 필요가 없다.**
> 우리가 측정해야 하는 것은 **우리 8-layer 조립이 세션당 몇 바이트를 상주시키는가** 뿐이다.

### K.2 M9 (Chief/PM 토폴로지) — **판단 기준 3개**

| 기준 | 질문 | 이 조사의 답 |
|---|---|---|
| **① 자식의 정체** | 실행인가 세션인가 | **세션.** Codex·OpenHands V1·Prime Agent 전부 이동 완료. 우리는 이미 `sessions/`·`workflows/<id>/`·`goals/<id>/` 로 세션 모델의 뼈대를 갖고 있는데 **스폰 메커니즘만 실행 모델**이다 — 이 불일치가 결정 6 을 막는다 |
| **② 팬아웃의 정당성** | 서브에이전트가 왜 필요한가 | **추론 품질이 아니라 컨텍스트 열화 치료(§J4).** → **"작업이 길어서 컨텍스트가 썩는가"** 로 판단. 짧은 작업엔 팬아웃 금지 |
| **③ 조율의 무게** | 얼마나 촘촘히 조율할 것인가 | **가볍게.** 오케스트레이터-전문가·피어토론은 독립 앙상블에 **파레토 지배당했다**(§E5). Chief 가 모든 걸 중계하면 **단일 오류원 + 3.2~3.6× 토큰** |

**구체 수치 제안**:
```
max_concurrent_children : 3   (유지 — 업계 정상 범위, Codex 6·OpenHands 1·Cursor 8 사이)
max_spawn_depth         : 1   (유지 — Codex 와 독립 일치, 가장 강한 수렴 신호)
+ 입장 대기열            : 필수 (Codex 가 없어서 겪는 문제 — 슬롯 만차 시 하드 실패)
+ 완료 판정              : 외부 검증기 (false finish, §D5)
```

### K.3 §C1 하네스 인터페이스 ADR — **5-메서드에 반드시 들어갈 것**

| # | 항목 | 근거 |
|---|---|---|
| 1 | **`session_home` 주입 가능성** | `CLAUDE_CONFIG_DIR`/`CODEX_HOME` 은 되고 Gemini CLI 는 안 된다(§B3). **하네스 선택의 하드 기준** |
| 2 | **세션 소유권 선언** | 5가지 답 중 하나를 명시적으로 고를 것(§F1). OpenAI SDK 는 **클라이언트 소유와 서버 소유를 배타로 강제**한다 — 우리도 배타로 둬야 모호성이 없다 |
| 3 | **이음매 위치: 실행 vs 저장소** | LangGraph 는 **저장소에 이음매를 냈다**(4쌍 8메서드). 우리 5메서드가 실행을 추상화할지 저장소를 추상화할지가 **아직 미결** |
| 4 | **durability 3값 노브** | `sync`/`async`/`exit` (LangGraph). 전부/전무가 아니라 **호출 단위 트레이드오프** |
| 5 | **인터럽트를 1급 상태로** | `interrupts: tuple[Interrupt, ...]` + `Command(resume=)`. 승인 대기를 out-of-band 관례로 두면 안 된다 |
| 6 | **run 을 자원으로 만들지 말 것** | Assistants 의 락·10분 만료·스펙드리프트(§G2). **ACP 의 5-stopReason + 이벤트 push** 가 현재 최선 |
| 7 | **이벤트에 제어흐름을 실을 것** | ADK `EventActions`(`transfer_to_agent`/`escalate`/`state_delta`). 스트림 소비자가 전부 관측 가능해진다 |

### K.4 §F′ [3] 실행 — durable execution 은 별도 결정

**조사한 에이전트 프레임워크 전부가 checkpointing 까지만 준다**(§H3). watchdog·heartbeat·health check 는 어디에도 없다.
결정 6(8시간+ 무인)을 만족시키려면:

```
(a) 우리가 supervisor 를 짓는다          → Prime Agent 모델 (데몬 + 워커 + claim-before-deliver)
(b) 하네스에 위임한다                     → claude --bg + ~/.claude/jobs/
(c) durable 런타임을 도입한다             → Temporal/Dapr — 단, 스트리밍이 별도 배관이 된다(§H1)
```
**이 셋은 "세션을 누가 소유하는가"(§C1 #2)와 별개의 축이다. 따로 결정할 것.**

### K.5 컨텍스트 설계 원칙 3개 (즉시 적용 가능)

1. **요약 단독 대체 금지** — Codex 처럼 `초기컨텍스트 + 최근 원문 N + 요약` 하이브리드.
   (요약 단독은 2K 예산에서 **FIFO 절단보다 나빴다**)
2. **실행 상태와 컨텍스트를 분리 압축** — Prime Agent 의 IPython 커널 생존 모델.
   우리의 `goals/<id>/`·`workflows/<id>/` 디렉터리가 이미 그 자리다. **컴팩션이 파일 상태를 건드리면 안 된다.**
3. **압축기를 소형 모델로 증류** — 프론티어 압축기 $0.045 → 증류 $0.0004 (**99.1% 절감, 품질 95%+ 유지**).
   장기 실행에서 컴팩션이 벽시계의 최대 62% 를 먹으므로 **이건 성능 문제이기도 하다.**

---

## L. 미조사 영역 — 정직한 공백

이 조사가 **다루지 못한 것**(합성 단계 실패 + 세션 한도로 검증 에이전트 67/38/33 개가 중단):

| 영역 | 상태 |
|---|---|
| Devin · Cursor background agents 내부 구조 | **거의 없음** — Cursor 는 동시성 캡 8(2차 소스)만 확보 |
| Daytona · Firecracker · gVisor · devcontainer | **없음** |
| Inngest · DBOS · AWS Step Functions | **없음** (Temporal/Restate/Resonate/Dapr 만) |
| Amp · Aider · Goose 의 세션 모델 | **Amp 컴팩션 정책만** 확보 |
| AutoGen · CrewAI · smolagents · Mastra · Vercel AI SDK · Pydantic AI 의 Runner 시그니처 | **CrewAI `@persist` 만** 확보 |
| Claude Agent SDK (`query()`/`ClaudeSDKClient`) 의 resume/fork 옵션 | **없음** |
| 세션당 상주 메모리(RSS) 실측 | **없음** — M12 의 남은 미지수 |
| GitHub Actions self-hosted runner 를 에이전트 러너로 전용하는 패턴의 장단 | **Copilot 사례만** (러너가 Actions 어플라이언스라는 사실 확인) |

⚠ **OpenHands 관련 5개 주장은 검증자가 반증(0-3)했다** — `TaskToolSet` 중첩 실행 컨텍스트,
자동 격리 부재, DockerWorkspace 컨텍스트 매니저 수명, 포트 삼중 수동 할당, 컨테이너 레벨 격리.
같은 페이지의 다른 주장(`tool_concurrency_limit`)은 3-0 통과했으므로 **페이지 접근 실패가 아니라
해석 과장으로 판정된 것으로 보인다.** 이 문서에서는 **OpenHands V1 공식 블로그(§C3·§I3) 기반 주장만 채택**했다.

⚠ **Anthropic 의 "서브에이전트 출력을 파일시스템으로" 주장**은 검증자가 **과장 판정**했다.
원문은 조건부다: *"Direct subagent outputs **can** bypass the main coordinator **for certain types of results**."*
= 전면 이전이 아니라 **선택적 우회**다.

---

## M. 출처

### 1차 (스펙·API 레퍼런스·공식 문서)
- OpenAI Agents SDK — `openai.github.io/openai-agents-python/ref/run/` · `/sessions/`
- Google ADK — `google.github.io/adk-docs/sessions/state/` · `/events/` · `/runtime/event-loop/` (→ `adk.dev` 로 301 이전)
- LangGraph — `docs.langchain.com/oss/python/langgraph/persistence` · `libs/checkpoint/.../base/__init__.py` · `libs/langgraph/.../types.py`
- OpenAI Assistants 마이그레이션 — `developers.openai.com/api/docs/assistants/migration` · `/deep-dive`
- OpenAI Responses/Conversations API 공식 문서
- Agent Client Protocol (Zed) — `agentclientprotocol.com` + repo (Apache-2.0, ~4.0k★)
- Temporal Python SDK — `temporalio.contrib.openai_agents.OpenAIAgentsPlugin`
- OpenHands — `docs.openhands.dev/sdk/guides/parallel-tool-execution` · `/agent-server/docker-sandbox` · runtime 문서 · V1 아키텍처 블로그(2025-11-05) · 이슈(2026-05-01)
- E2B · Modal 샌드박스 공식 문서
- OpenAI Codex cloud internet access 문서 · `openai/codex` 이슈 #16183
- GitHub Copilot coding agent 방화벽 문서
- Prime Agent 저장소 문서 (PR #493/#494, #597)
- Anthropic, *Multi-agent research system* (2025-06-13)
- LF AI & Data, ACP→A2A 통합 공지 (2025-08-29)

### 논문
- MAST — *Why Do Multi-Agent LLM Systems Fail?* `arXiv:2503.13657` (v1 2025-03-17, v3 2025-10-26)
- 단일 vs 멀티 예산통제 비교 `arXiv:2604.02460` (2026-04-02, v2 04-11)
- 컴팩션 정량 `arXiv:2608.06503` (2026-08-06)
- ACON 컨텍스트 압축 `arXiv:2510.00615` (2025-10-01, v3 2026-06-01, ICML 2026)
- Long-Horizon-Terminal-Bench (2026-07-09, v2 07-13)
- 블로킹 컴팩션 서빙 특성화 (2026-05-22)
- CodeCRDT 블랙보드 (2025-10-18)
- 조율 토폴로지 Pareto (2026-05-05)

### 2차 (블로그·포럼 — 방향성 참고)
- Cognition, *Don't Build Multi-Agents* (2025-06-12)
- LangChain(Harrison Chase), *How and when to build multi-agent systems* (2025-06-16)
- Armin Ronacher, *Agentic Coding* (2025-07-30)
- Codex CLI 서브에이전트 해설 (2026-03-26, upd. 2026-08-18) · 세션 영속 해설 (2026-08-12)
- 컴팩션 구현 비교 gist (2025-12-02, upd. 2026-08-07)
- OpenCode agent-teams 포팅 회고 (2026-02-10)
- worktree 격리 실패 보고 (2026-08-02) · worktree 운영 실무 (2026-02-22)
- A2A 채택 현황 분석 (Rost Glukhov, ~2026-04) · AG-UI 해설 (2025-11-03)
- durable execution vs checkpointing 비교 (2026-02-25) · Resonate 결정론 해설 (2025-06-09)

---

## 부록 — 조사 메타데이터

| 워크플로 | Run ID | 에이전트 | 완료/실패 | 소스 | 토큰 |
|---|---|---:|---:|---:|---:|
| 오케스트레이션 4축 | `wf_67dbb3eb-f6a` | 107 | 74 / 33 | 25 | 2.81M |
| 런타임·러너 5축 | `wf_f3f97eb5-58c` | 110 | 72 / 38 | 28 | 2.55M |

**실패 원인** — 전량 `You've hit your session limit` (검증·합성 단계에 집중).
따라서 **검증 통과 주장(✅)은 18건뿐이고 나머지는 1차 소스 인용은 있으나 교차검증 미완(◐)** 이다.
재실행이 필요하면:
```
Workflow({scriptPath: "...deep-research-wf_67dbb3eb-f6a.js", resumeFromRunId: "wf_67dbb3eb-f6a"})
Workflow({scriptPath: "...deep-research-wf_f3f97eb5-58c.js", resumeFromRunId: "wf_f3f97eb5-58c"})
```
캐시된 에이전트는 즉시 재생되므로 **실패한 검증·합성 단계만 다시 돈다.**
