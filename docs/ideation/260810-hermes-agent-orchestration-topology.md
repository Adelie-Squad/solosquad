# Hermes Agent 오케스트레이션·토폴로지 실측 조사 — 위임·멀티LLM·세션·컨텍스트 + 설계 진화

> **조사일** 2026-08-10 · **대상** [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
> (main 브랜치, 조사 시점 최종 push `2026-08-10T09:52Z` · Python · 228,152 stars · 9,659 파일 ·
> **21,615 커밋**)
>
> **구성 3부** — **§A(1~6) 현재 구조의 단면** · **§B(7~9) SoloSquad 환류** ·
> **§C(10~16) 시간축 — 실제 코드 변경으로 본 설계 진화.**
> §C 는 히스토리 전체를 근거로 **되돌린 결정 9건**과 **되돌리지 않은 흐름 5건**을 분리하고,
> Hermes 가 `AGENTS.md` 에 박제한 **거절 루브릭·Footprint Ladder** 를 정리한다.
> **결론의 무게는 §C 에 있다** — 단면은 무엇을 만들었는지만 알려주고, 시간축은 무엇이 안 통했는지를 알려준다.
>
> **목적** — SoloSquad v2.0 재작성의 미결 대장(`260803-solosquad-architecture-redesign.md` §0.0.7)
> 중 **M9(토폴로지)** · **M12(세션 비용)** · **M13(Tier-2)** 과 §C1(하네스 계약) · §C3(멀티LLM 라우팅) ·
> §D2(세션 레지스트리)에 **실측 입력**을 넣는다. Hermes 는 SoloSquad 가 v0.6(trajectory→skill,
> FTS5 hot/cold) · v0.7(WAL-safe SQLite backup) · v1.1(5-layer 위계)에서 이미 3회 차용한 소스이므로,
> **같은 소스를 재작성 시점에 다시 읽는 것**이 이 조사의 위치다.

---

## 0. 조사 방법과 신뢰 등급

**1차 소스만 사용했다.** 검색으로 나오는 `hermes-agent.ai` · `hermesatlas.com` ·
`codersera.com` 등은 **3자 SEO 사이트**로, 실제 소스와 대조했을 때 존재하지 않는 개념
("typed result objects", "structured message passing layer")을 서술하거나 데모 수치를
검증 불가 형태로 인용한다. **이 문서의 모든 사실은 repo 파일에서 직접 읽은 것**이며
파일 경로를 병기했다.

| 등급 | 의미 | 이 문서에서 |
|---|---|---|
| ✅ | repo 소스/공식 docs 에서 직접 확인 | 본문 서술 전부 |
| ⚠️ | Hermes 자체 문서 안에서 **모순** 발견 | §5.3 에 1건 기록 |
| ❌ | 3자 사이트에만 존재, 소스에 없음 | 본문에서 배제 |

**§C(시간축)의 근거** — `git clone --filter=blob:none` 로 받은 **전체 히스토리 21,615 커밋**.
날짜·커밋 제목·이슈 번호는 전부 실제 커밋 메타데이터이며, 추정한 부분은 그렇다고 표기했다.

**읽은 파일** — `tools/delegate_tool.py`(4,356줄) · `tools/async_delegation.py`(1,515) ·
`agent/subagent_lifecycle.py`(540) · `agent/moa_loop.py`(2,384) · `hermes_cli/config_defaults.py`(4,414) ·
`hermes_cli/auth.py` · `agent/credential_pool.py`(3,178) · `agent/credential_sources.py` ·
`gateway/config.py` · `tools/thread_context.py` · `docs/session-lifecycle.md`(679) ·
`docs/micro-compaction.md`(401) · `docs/profile-routing.md`(117) · `docs/kanban/multi-gateway.md` ·
`skills/software-development/hermes-agent-skill-authoring/SKILL.md` ·
**`AGENTS.md`(1,512줄 — 기여 루브릭·Footprint Ladder, §15 의 원본)**.

---

## 1. 한눈에 — Hermes 의 실행 모델은 **하나가 아니라 세 개**다

가장 중요한 발견부터 적는다. Hermes 에는 "오케스트레이터 → 워커" 가 **하나의 통일된 위계로
존재하지 않는다.** 서로 다른 수명·영속성·소유권을 가진 **3개의 독립 축**이 겹쳐 있고,
각각이 다른 문제를 푼다.

```
축 A  delegate_task        휘발성 팬아웃.  수명 = 부모의 한 턴.   상태 = 메모리.
      부모 → 자식 N        결과는 "요약 문자열" 로만 회수.        depth 기본 1(평면).

축 B  Kanban 보드          영속 작업 큐.   수명 = 무기한.         상태 = SQLite.
      보드 → 태스크 그래프  프로파일별 전문가에 라우팅.            크래시 복구·감사 가능.

축 C  profile routing      공간 격리.      수명 = 게이트웨이 생애.  상태 = 프로파일 홈 디렉토리.
      메시지 출처 → 프로파일  MEMORY/USER/SOUL/세션/툴 전부 분리.   1 게이트웨이 N 인격.
```

**세 축은 직교한다.** 하나의 Kanban 태스크가 `coder` 프로파일에 배정되고(축 C),
그 프로파일의 에이전트가 자기 턴 안에서 `delegate_task` 로 3개 워커를 띄우는(축 A) 식으로
합성된다. SoloSquad 의 §B1 논쟁("Chief 를 남길 것인가")이 **한 축 안에서만 벌어지고 있다는
점**이 이 조사의 첫 시사점이다 — §7.1 에서 다시 다룬다.

---

# A. 오케스트레이션 · 토폴로지

## 2. 축 A — `delegate_task`: 유일한 스폰 경로

### 2.1 계약

`tools/delegate_tool.py::DELEGATE_TASK_SCHEMA` 가 **에이전트가 다른 에이전트를 만드는 유일한
도구**다. 파라미터는 6개뿐이다.

| 파라미터 | 의미 |
|---|---|
| `goal` | 단일 위임의 목표. *"자식은 네 대화를 모른다"* 가 스키마 설명에 박혀 있음 |
| `context` | 자식에게 넘길 배경 — 파일 경로·에러·제약. **명시 전달이 유일한 경로** |
| `tasks[]` | 배치 팬아웃. 각 원소가 `{goal, context, role, output_schema}` |
| `role` | `leaf`(기본) 또는 `orchestrator` — **역할은 이 2종이 전부** |
| `output_schema` | 자식 최종답변이 만족해야 할 JSON Schema. 부모가 검증, **1회 교정 재시도** 허용 |
| `background` | **DEPRECATED·무시됨** — 최상위 위임은 항상 백그라운드 |

주목할 설계 3가지.

**⑴ 스키마 설명문이 런타임에 재생성된다.** `_build_dynamic_schema_overrides()` 가
`get_definitions()` 호출마다 `tasks`·`role` 의 description 을 **그 사용자의 실제
`max_concurrent_children` / `max_spawn_depth` 값으로 다시 쓴다.** 모델에게 프레임워크 기본값이
아니라 **현재 설정의 진실**을 보여주기 위해서다. 주석에 이유가 명시돼 있다 —
*"the depth note is literal truth (grounded in the passed config) so the LLM doesn't confabulate
nesting capabilities that don't exist."*

**⑵ 도구 설명이 "쓰지 말아야 할 때"를 더 길게 쓴다.**

```
DO NOT USE FOR:
- 추론 불필요한 기계적 다단계 작업 → execute_code
- 단일 도구 호출 → 그냥 그 도구를 불러라
- 사용자 상호작용이 필요한 일 → 서브에이전트는 질문할 수 없다
- 세션을 넘어 살아남아야 할 일 → cronjob 또는 terminal(background=True)
  ※ /stop · /new · 프로세스 종료는 실행 중인 서브에이전트를 폐기한다
```

마지막 줄이 축 A 의 성격을 규정한다 — **delegate_task 는 영속 작업용이 아니다.**

**⑶ 자식 요약은 "사실"이 아니라 "자기 보고"다.** 스키마 설명에 다음이 명문화돼 있다.

> Child summaries are SELF-REPORTS, not verified facts: a child claiming "uploaded successfully"
> or "file written" may be wrong. For external side effects, require a verifiable handle
> (URL, ID, absolute path) and **verify it yourself** — fetch the URL, stat the file, read back
> the content — before telling the user the operation succeeded.

이것은 SoloSquad `_handoff.md` 프로토콜이 **갖고 있지 않은 조항**이다(§8-①).

### 2.2 위계는 2단이 기본, 깊이는 설정값

```
depth 0  부모 에이전트
depth 1  자식 ─── role=leaf (기본) → delegate_task 없음. 여기가 바닥.
              └─ role=orchestrator → delegate_task 보유. 단 max_spawn_depth ≥ 2 일 때만.
```

- `MAX_DEPTH = 1` — **기본은 평면**이다(`delegate_tool.py:128`). 손자는 거부된다.
- `delegation.max_spawn_depth` 로 2 이상 올리면 중첩이 열린다. **상한 없음**, 하한 1.
- `delegation.orchestrator_enabled` (기본 `true`) 는 **전역 킬 스위치** — false 면
  `role="orchestrator"` 가 조용히 `leaf` 로 강등된다. 코드 revert 없이 기능을 끌 수 있게 한 것.
- 깊이를 올릴 때 주석이 경고한다 — *"each extra level multiplies API cost, so raise it deliberately."*

**orchestrator 자식은 자기 프롬프트에 자기 깊이를 안다.** `_build_child_system_prompt()` 이
`"NOTE: You are at depth {child_depth}. The delegation tree is capped at
max_spawn_depth={max_spawn_depth}."` 를 주입하고, 바닥 직전이면 *"Your own children MUST be
leaves"* 를 덧붙인다. 그리고 위임 판단 기준까지 프롬프트에 넣는다:

> WHEN NOT to delegate: … **Re-delegating your entire assigned goal to one worker
> (that's just pass-through with no value added).**

### 2.3 자식이 잃는 것 — 차단 도구 5종

```python
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",   # 재귀 위임 금지
    "clarify",         # 사용자 상호작용 금지
    "memory",          # 공유 MEMORY.md 쓰기 금지
    "send_message",    # 크로스플랫폼 부작용 금지
    "cronjob",         # 부모 이름으로 작업 예약 금지
])
```

`kanban` 툴셋도 추가로 스트립된다(`_strip_blocked_tools`). `role="orchestrator"` 는
**`delegate_task` 하나만** 되찾는다 — 나머지 4개는 orchestrator 도 못 쓴다.

차단 방식이 2중이다. ⑴ 전부 차단 도구로만 이뤄진 툴셋은 통째로 제거하고,
⑵ `hermes-cli` 같은 **혼합 번들**은 남기되 `disabled_toolsets` 로 개별 이름을 뺀다.
후자가 있어야 나중에 MCP/레지스트리가 갱신돼도 차단이 유지된다.

**설계 원칙이 뚜렷하다 — 자식에게서 뺏는 것은 전부 "부모/사용자/외부와의 접점"이다.**
자식은 계산할 수 있지만, 말을 걸 수도 기억을 남길 수도 일을 예약할 수도 없다.

### 2.4 동시성·예산·안전

| 항목 | 기본값 | 근거 파일 |
|---|---:|---|
| `delegation.max_concurrent_children` | **3** | 배치 병렬도 + 백그라운드 위임 단위를 **하나의 캡으로 통합**. 초과분은 큐잉이 아니라 **거부**(동기 실행으로 폴백) |
| `delegation.max_spawn_depth` | **1** | 평면 |
| `delegation.max_iterations` | **50** | 자식마다 독립 예산, 부모와 무관 |
| `delegation.child_timeout_seconds` | **0 = 무제한** | 과거 일괄 캡이 정상 작업(깊은 코드리뷰·대형 리서치)을 죽여서 폐지. *"failures should come from what the child is actually doing"* |
| `delegation.max_summary_chars` | **24,000** | 하드 상한. 그 위에 동적 예산(§2.5) |
| `delegation.subagent_auto_approve` | **false → auto-deny** | |
| `guardrails.loop_caps.max_subagents` | **50 / 턴** | 폭주 루프 백스톱. 턴마다 리셋 |
| `delegation.inherit_mcp_toolsets` | **true** | 툴셋을 좁혀도 부모의 MCP 는 유지 |

**concurrency 캡을 10 초과로 올리면 프로세스당 1회 경고**를 찍는다 —
*"each child consumes API tokens independently. High values multiply cost linearly."*

**승인 처리가 특히 배울 만하다.** 서브에이전트는 `ThreadPoolExecutor` 워커에서 도는데,
CLI 의 대화형 승인 콜백은 `threading.local()` 에 있어 워커가 상속하지 못한다. 콜백이 없으면
`prompt_dangerous_approval()` 이 워커 스레드에서 `input()` 으로 폴백하고, 이는 **부모의
prompt_toolkit TUI 와 stdin 을 두고 데드락**한다. 해결은 워커 스레드마다 **비대화형 콜백을
강제 주입**하는 것 —

- `false`(기본) → `_subagent_auto_deny` — `"deny"` 반환. 자식은 **복구 가능한 거절**을 본다
- `true` → `_subagent_auto_approve` — `"once"` 반환 (cron·배치용 opt-in YOLO)
- 양쪽 모두 `logger.warning` 으로 **감사 로그**를 남긴다

**멈춤 감지는 타임아웃이 아니라 하트비트다.** 자식은 30초마다 부모의 activity 를 갱신하고,
갱신이 끊기면 게이트웨이 비활성 타임아웃이 대신 발화한다.

| 상태 | 임계 | 계산 |
|---|---|---|
| 턴 사이 idle | `_HEARTBEAT_STALE_CYCLES_IDLE = 15` | 15 × 30s = **450초** |
| 같은 도구에 고착 | `_HEARTBEAT_STALE_CYCLES_IN_TOOL = 40` | 40 × 30s = **1,200초** |

같은 도구에 붙어 있는 것은 정상 장기작업일 수 있으므로 **2.7배 관대**하다.

### 2.5 결과 회수 — 컨텍스트 폭발을 막는 3단 방어

자식 요약은 부모 컨텍스트로 **축약 없이 그대로** 돌아온다. N개 배치면 N개가 한꺼번에 온다.
이것이 압축/429 죽음의 나선을 만들 수 있어 3단으로 막는다.

```
① 동적 예산   부모의 남은 컨텍스트 헤드룸을 배치 수로 나눠 요약당 예산 산정
              (_parent_summary_char_budget / _apply_summary_budget)
② 스필        예산 초과분은 ~/.hermes/cache/delegation/ 로 파일 스필
              (원격 백엔드에도 마운트됨)
③ 창 + 푸터   인컨텍스트 요약은 head+tail 창 + "생략된 중간을 읽을 정확한
              read_file offset" 푸터. web_extract 가 대형 페이지에 쓰는 것과 동일 관례
```

**"Nothing is lost"** 가 설계 목표다 — 잘린 게 아니라 **페이징된** 것이고, 부모가 필요하면
정확한 오프셋으로 되읽는다. `max_summary_chars` 는 그 위에 얹는 벨트-서스펜더로,
*"be concise"* 지시를 무시하는 모델 대비용이다.

**출력 계약도 있다.** `output_schema` 를 주면 자식에게 **미리 계약을 알리고**, 부모가 최종답변을
검증하며, 실패 시 **1회 한정 교정 재시도**를 준다. 결과 엔트리에 `schema_valid`(실패 시
`schema_errors`)가 붙는다. 스키마 작성 지침까지 설명문에 있다 —
*"Keep schemas forgiving: require only fields you will actually read."*

### 2.6 수명 — 열고 닫기

`agent/subagent_lifecycle.py` 가 **플러그인용 공개 계약**을 노출한다.
`PUBLIC_CONTRACT_VERSION = 1` 이고, 의도적으로 `AIAgent` 객체가 아니라 **불변 계약**만 준다.

```
PENDING → STARTING → RUNNING → SUCCEEDED
                            ├→ FAILED
                            ├→ INTERRUPTED
                            └→ CANCEL_REQUESTED → CANCELLED
                                                   (+ UNKNOWN)
```

입력 상한이 계약에 박혀 있다 — `goal` 16,000자 · `context` 32,000자 ·
`metadata` 8,192바이트 · `result` 32,000자 · 종료 상태 보존 `3,600초`.

**살아 있는 동안 외부에서 조종 가능하다** — `interrupt_subagent(id)` ·
`steer_subagent(id, ...)` · `list_active_subagents()`. 즉 팬아웃이 "던지고 기다리기"가 아니라
**감독 가능한 프로세스**다.

### 2.7 비동기 디스패치의 기본값

`_model_background_value()` 에 규칙이 있다.

> 최상위 에이전트의 위임은 **항상 백그라운드** — 모델이 고르지 않는다. 단일이든 배치든
> 마찬가지(배치 전체가 하나의 async 단위로 모든 자식에 join 하고 **하나의 통합 결과**를 반환).
> **예외는 orchestrator 서브에이전트(depth > 0)의 위임** — 자기 턴 안에서 워커 결과가 필요하므로 동기.

디스패치는 즉시 **라이브 트랜스크립트 경로**를 반환하고, 완료된 결과가 **스스로 대화에 재진입**한다.
도구 설명이 명령한다 — *"Do NOT wait or poll; continue other work."*

---

## 3. 축 B — Kanban: 영속 오케스트레이션

축 A 가 못 하는 것(세션을 넘어 사는 작업)을 여기서 한다. **SQLite 보드**가 상태를 갖는다.

| 설정 | 기본 | 의미 |
|---|---|---|
| `kanban.dispatch_in_gateway` | `true` | **단일 소유자** 디스패처 |
| `kanban.dispatch_interval_seconds` | 60 | 디스패치 틱 |
| `kanban.auto_decompose` | `true` | 태스크 자동 분해 |
| `kanban.auto_decompose_per_tick` | 3 | 틱당 분해 수 |
| `kanban.failure_limit` | 2 | |
| `kanban.orchestrator_profile` | `""` | 오케스트레이터 역할을 맡을 **프로파일** |
| `kanban.max_in_progress_per_profile` | `None` | 프로파일별 WIP 제한 |
| `kanban.dispatch_stale_timeout_seconds` | 14,400 (4h) | |
| `kanban.reconcile_orphans` | `true` | 고아 작업 회수 |

**보조 LLM 2개가 이 축 전용으로 배정돼 있다**(§4.2 의 슬롯 체계) —

- `auxiliary.triage_specifier` — Triage 컬럼의 거친 한 줄을 **구체 스펙으로 부풀려** `todo` 로 승격.
  주석: *"메인 모델은 짧은 스펙 확장에 과잉. gemini-flash 정도가 잘 맞는다"*
- `auxiliary.kanban_decompose` — triage 태스크를 **자식 태스크 그래프로 분해하고,
  설명을 근거로 전문가 프로파일에 라우팅**한다. JSON 태스크 그래프를 반환

**멀티 게이트웨이 배치 규약**(`docs/kanban/multi-gateway.md`)이 별도로 있다.
프로파일마다 게이트웨이 프로세스를 띄우되(default·writer·admin·coder·researcher),
**디스패처는 정확히 하나만 소유**한다 — 여러 게이트웨이가 같은 작업을 스폰하려 경쟁하지 않도록.
알림 전달은 반대로 **프로파일 소유 기반**이고, **원자적 이벤트 클레임**으로 중복 전달을 막는다.

> **여기가 "진짜 멀티에이전트"다.** 축 A 는 한 턴짜리 팬아웃이고, **역할을 가진 전문가들이
> 지속적으로 협업하는 구조는 Kanban + profile 조합**으로 구현돼 있다. 이슈 #344 가
> *"현재의 delegation(일회용 자식) vs 진짜 multi-agent(영속 역할·구조적 워크플로·상호협력)"* 를
> 구분한 것이 정확히 이 지점이며, 그 답이 프레임워크 확장이 아니라 **Kanban 이라는 데이터 구조**였다.

---

## 4. 멀티 LLM — 구독·API·로컬을 하나의 축으로 묶지 않았다

여기가 SoloSquad §C3 에 가장 직접적인 입력이다.

### 4.1 3층으로 나뉜다

```
[1] 메인 모델      config: model / providers / fallback_providers
                  대화를 실제로 수행. 도구 호출 소유.

[2] 보조 슬롯      config: auxiliary.<task>.{provider,model,base_url,api_key,
                                            timeout,extra_body,reasoning_effort}
                  작업 종류별로 독립 모델. 12+ 슬롯.

[3] 위임 모델      config: delegation.{provider,model,base_url,api_key,api_mode,
                                       reasoning_effort}
                  비면 부모 모델·폴백 체인 상속.
```

**핵심 원칙이 주석에 명문화돼 있다** —
*"Each aux task is independent — main-agent provider_routing and openrouter.min_coding_score
do NOT propagate to aux calls **by design**."* 즉 **메인의 라우팅 정책이 보조로 새지 않는다.**

### 4.2 보조 슬롯 — "작업마다 다른 모델"의 실물

확인된 슬롯(각각 provider/model/base_url/api_key/timeout/extra_body/reasoning_effort 를 독립 보유):

| 슬롯 | 용도 | timeout |
|---|---|---:|
| `vision` | 이미지 이해 | 120s (+`download_timeout` 30s) |
| `web_extract` | 웹 페이지 요약 | 360s |
| `compression` | **컨텍스트 압축** | 120s |
| `skills_hub` | 스킬 허브 | 30s |
| `approval` | 승인 판단 — *"fast/cheap model recommended"* | 30s |
| `mcp` | MCP 보조 | 30s |
| `title_generation` | 세션 제목 (+`language`) | 30s |
| `memory_query_rewrite` | 메모리 질의 재작성 | **8s** |
| `tts_audio_tags` | TTS 태그 | 30s |
| `triage_specifier` | Kanban 스펙 확장 | 120s |
| `kanban_decompose` | Kanban 태스크 그래프 분해 | — |

`reasoning_effort` 는 8단계 — `none|minimal|low|medium|high|xhigh|max|ultra`.
**슬롯마다 사고 강도를 따로 준다.**

보조 전용 안전장치 3개가 더 있다.

- `auxiliary.transient_retries: 2` — 전송 blip(연결 리셋/타임아웃/5xx/408)에 대한 **동일 provider
  재시도**. MoA 참조 어드바이저처럼 **핀 고정된 호출**은 provider 폴백이 의미 없어서, 재시도가
  없으면 blip 이 호출을 조용히 잃는다
- `auxiliary.free_only: false` — true 면 OpenRouter 폴백을 **`:free` SKU 로만** 제한.
  배경 트래픽(압축·제목·비전)이 유료 레인을 타지 않게 함
- `auxiliary.openrouter_model` — 폴백 모델 오버라이드. 비`:free` 모델이 걸리면 **1회 WARNING**

### 4.3 구독 vs API key — `auth_type` 5종, provider 36+

`hermes_cli/auth.py::PROVIDER_REGISTRY` 가 정본이다.

| `auth_type` | 의미 | 예 |
|---|---|---|
| `oauth_device_code` | 기기 코드 플로우 | **Nous Portal** |
| `oauth_external` | 외부 브라우저 OAuth | **OpenAI Codex** · **xAI Grok (SuperGrok/Premium+)** · **Qwen OAuth** |
| `oauth_minimax` | 전용 플로우 | MiniMax(minimax.io) |
| `api_key` | 키 | Anthropic · OpenAI API · Gemini · DeepSeek · Z.AI/GLM · Kimi/Moonshot(+CN) · MiniMax(+CN) · Copilot · **LM Studio(로컬)** · Ollama Cloud · NVIDIA NIM · Vercel AI Gateway · HuggingFace · Alibaba(+Coding Plan) · StepFun · Arcee · GMI · Xiaomi MiMo · Tencent TokenHub · OpenCode Zen/Go · Kilo Code · Azure Foundry … |
| `external_process` / `aws_sdk` / `vertex` | 외부 프로세스·클라우드 SDK | **GitHub Copilot ACP** · AWS Bedrock · Google Vertex AI |

**구독(OAuth)과 API key 를 같은 레지스트리 안에 넣되, `auth_type` 으로 취득 방식만 분기한다.**
소비 시점의 인터페이스는 동일하다 — 이것이 SoloSquad §C3 "2계층 어댑터"가 찾던 형태다(§7.4).

또 하나 — **레지스트리는 런타임에 자기 확장된다.** api-key 계열 provider 플러그인이 등록되면
`PROVIDER_REGISTRY` 에 자동 추가되고 alias 도 함께 등록된다(`auth.py:509-539`).

### 4.4 자격증명 풀 — 같은 provider 안의 다중화

`agent/credential_pool.py`(3,178줄)가 **동일 provider 다중 자격증명 failover** 를 한다.
`credential_pool_strategies` 로 provider 별 선택 전략을 지정한다.

| 전략 | 동작 |
|---|---|
| `round_robin` | 사용 후 우선순위 재배치(`priority` 재부여) |
| `least_used` | 가장 덜 쓴 것 |
| `random` | 무작위 |

- 각 엔트리는 `priority` 정수를 갖고 **정렬된 순서**로 관리된다
- **소진 쿨다운**(exhaustion cooldown) 상태를 추적 — 지금 쓸 수 있는 게 하나라도 있는지,
  없다면 언제 풀리는지 계산한다
- **활성 리스 카운트**로 `(리스 수, priority)` 정렬 — 가장 덜 점유된 자격증명을 고르되
  전부 점유 중이면 **블로킹 대신** 최소 점유분을 반환

### 4.5 다른 CLI 의 자격증명을 빌려 쓴다

`agent/credential_sources.py` 가 정의한 **8가지 자격증명 출처**:

```
env:<VAR>     os.environ / ~/.hermes/.env
claude_code   ~/.claude/.credentials.json          ← Claude Code 로그인 재사용
hermes_pkce   ~/.hermes/.anthropic_oauth.json
device_code   auth.json providers.<provider>       (nous, openai-codex, …)
qwen-cli      ~/.qwen/oauth_creds.json             ← Qwen CLI 로그인 재사용
gh_cli        gh auth token                        ← GitHub CLI 로그인 재사용
config:<name> custom_providers 설정 항목
model_config  model.api_key (provider == "custom")
manual        `hermes auth add`
```

Anthropic 의 키 탐색 순서는 `ANTHROPIC_API_KEY` → `ANTHROPIC_TOKEN` → `CLAUDE_CODE_OAUTH_TOKEN`.
단 `CLAUDE_CODE_OAUTH_TOKEN` 은 **암묵 환경변수로 제외**된다 — Claude Code 자신이 설정하는
값이라 의도치 않은 상속을 막기 위해서다(`auth.py:1851-1853`).

**출처마다 제거 계약(`RemovalStep`)을 등록하게 만든 것**이 이 모듈의 존재 이유다.
과거엔 출처별 임시 분기가 흩어져 있어 `hermes auth remove` 가 **다음 `load_pool()` 에서
조용히 되살아나는** 버그가 여러 출처에 있었다. 이제 제거는 ⑴ 외부 상태 정리 ⑵ auth.json 에
`(provider, source_id)` **억제 플래그** 기록 ⑶ 결과 리포트 — 3단계로 통일된다.

> **차용 가치 높음** — "여러 로그인 출처에서 자격증명을 씨딩하는 시스템은 반드시
> **대칭적 제거 계약**을 함께 설계해야 한다"는 교훈이 코드로 박제돼 있다.

### 4.6 MoA — 여러 모델을 **한 턴 안에서** 합성

`agent/moa_loop.py`(2,384줄). `/moa` 슬래시 커맨드로 **한 턴만** MoA 모드로 만든다.

```
사용자 턴
   │
   ├─► 참조(advisor) 모델 N개 ── 병렬(ThreadPoolExecutor, _MAX_REFERENCE_WORKERS 캡)
   │      각자 다른 provider/model/reasoning 슬롯
   │      실패해도 예외를 안 던짐 → "라벨 붙은 note" 로 강등
   │      컨텍스트 창이 작을 수 있어 전용 트리밍(_trim_messages_for_reference)
   │
   └─► 아그리게이터(= 실제 acting 모델)
          전체·비트리밍 트랜스크립트 수신 + 참조 출력들을 guidance 블록으로 부착
          도구 호출과 턴 종료는 여전히 일반 Hermes 루프가 소유
```

설계 포인트 4개.

- **슬래시 커맨드는 의도적으로 모델 도구가 아니다.** 모델이 스스로 MoA 를 켤 수 없다
- **참조 모델은 "행위자"가 아님을 프롬프트로 못박는다** — *"NEVER claim to have executed…
  it is analyzing state for an aggregator, not acting on the task"*
- **비용 회계가 분리된다.** `_RefAccounting` — 참조는 다른 모델/provider 에서 돌 수 있으므로
  아그리게이터 요율로 합산하면 틀린다. 별도 집계 후 병합
- **프라이버시 필터** `moa.privacy_filter: '' | display | full` — 어드바이저 출력이 대화의 PII를
  UI·트레이스 파일·아그리게이터 프롬프트로 되뿜는 것을 막는다. 비밀키류는 중앙 redactor
  (`agent.redact.redact_sensitive_text`)에 위임하고, MoA 필터는 **중앙이 일부러 두는
  이메일·전화번호만** 처리한다. 정규식 안전성 주석이 인상적 — 조언 텍스트는 코드리뷰 형태라
  줄번호·타임스탬프·git SHA·IP 가 흔하므로, 전화번호 패턴은 **명확한 구분자를 요구**해
  `2026-07-12`·`12:34:56`·헥스 ID·점4개 주소가 절대 매칭되지 않게 했다

### 4.7 외부 CLI 를 런타임으로 — Codex · ACP

Hermes 는 다른 에이전트 CLI 를 **백엔드로 흡수**한다.

- `agent/codex_runtime.py` — `run_codex_app_server_turn`(Codex CLI 설치본을 **서브프로세스
  클라이언트**로 구동) · `run_codex_stream`(Responses API `codex_responses` 모드) ·
  create-stream 실패 시 폴백 경로
- `agent/transports/` — `anthropic` · `bedrock` · `chat_completions` · `codex` ·
  `codex_app_server` · `codex_app_server_session` · `codex_event_projector` ·
  **`hermes_tools_mcp_server`**(자기 도구를 MCP 서버로 내보냄)
- `acp_adapter/` 12파일 — Agent Client Protocol 서버(auth · edit_approval · permissions ·
  provenance · session · tools). `copilot-acp` 가 `auth_type="external_process"` 인 이유

**`delegation.api_mode`** 가 이 층의 압축판이다 — `chat_completions` /
`codex_responses` / `anthropic_messages` 중에서 고르며, 비우면 URL 로 자동 감지
(`/anthropic` 접미사 → `anthropic_messages`).

> **SoloSquad §C2("Codex 는 열등한 백엔드가 아니라 패턴 소스")에 대한 실측 답** —
> Hermes 는 Codex 를 패턴 소스로 **참조**한 게 아니라 **런타임으로 실행**한다.
> 3자 사이트가 아니라 `agent/transports/codex_app_server_session.py` 가 그 증거다.

---

## 5. 세션 · 스레드 · 프로파일

### 5.1 세 단어의 정확한 정의

| 용어 | Hermes 에서의 정의 | 저장 |
|---|---|---|
| **session_key** | *대화 레인* 식별자. 결정론적 문자열 | `sessions.json` 키 |
| **session_id** | 그 레인의 *현재 화신*. `YYYYMMDD_HHMMSS_<8hex>` | SQLite `SessionDB` |
| **thread** | 플랫폼의 스레드(Discord 스레드·Telegram 포럼 토픽·Slack 스레드). **세션 키의 한 성분** | — |
| **profile** | 인격+상태 전체의 격리 단위 (`MEMORY.md`·`USER.md`·`SOUL.md`·세션·툴) | `~/.hermes/profiles/<name>` |
| **subagent** | 세션이 **아님**. 부모 턴에 종속된 휘발성 실행 | 메모리(+트랜스크립트 파일) |

**레인과 화신을 분리한 것**이 이 설계의 핵심이다. `/new` 는 레인을 유지한 채 화신만 바꾼다.

### 5.2 세션 키 문법 — 격리 정책이 곧 문자열

```
agent:main:{platform}:{chat_type}[:{chat_id}][:{thread_id}][:{participant_id}]
```

| 시나리오 | 키 |
|---|---|
| Telegram DM | `agent:main:telegram:dm:12345` |
| DM 안의 스레드 | `agent:main:telegram:dm:12345:thread_678` |
| 그룹 (사용자별 격리) | `agent:main:telegram:group:-10012345:user_abc` |
| 그룹 스레드 (공유) | `agent:main:discord:group:12345:thread_678` |
| Slack 채널 | `agent:main:slack:channel:C12345` |

**두 개의 불리언이 전체 격리 정책을 결정한다.**

| 채팅 유형 | 기본 | 제어 키 |
|---|---|---|
| DM | 항상 사적 (공유 불가) | — |
| 그룹/채널 | **사용자별 격리** | `group_sessions_per_user: true` |
| 스레드 | **공유** (모든 참가자가 같은 컨텍스트) | `thread_sessions_per_user: false` |

기본값의 방향이 반대인 게 의도적이다 — **그룹은 각자, 스레드는 함께**.
스레드는 "하나의 주제에 모인 것"이므로 공유가 맞고, 그룹은 잡담 공간이므로 격리가 맞다.

**공유 세션일 때 시스템 프롬프트가 달라진다.** 고정 사용자명을 빼고
*"Multi-user thread — messages are prefixed with [sender name]"* 로 바꾼 뒤,
발신자 이름은 **런타임에 각 사용자 메시지 앞에 붙인다.** 이유가 명시돼 있다 —
**시스템 프롬프트가 턴마다 바뀌지 않아야 프롬프트 캐싱이 산다.**

### 5.3 세션 상태 기계 — 플래그 7개

`SessionEntry` 의 불리언들이 "다음 접근 시 무엇을 할지"를 정한다.

| 플래그 | 설정 주체 | 다음 접근 시 |
|---|---|---|
| `suspended` | `/stop`, 고착 루프 3회 | **하드 와이프** — 무조건 새 `session_id` |
| `resume_pending` | 크래시 복구, drain 타임아웃 | **소프트 복구** — `session_id` 보존, 트랜스크립트 그대로 |
| `was_auto_reset` (+`auto_reset_reason`) | 정책 만료 | 1회 소비되며 "세션 만료" 안내 주입 |
| `is_fresh_reset` | `/new`, `/reset` | 토픽/채널 스킬 재주입. **자동 리셋과 구분** — 잘못된 "만료" 안내 방지 |
| `reset_had_activity` | 만료 시 | 이전 세션에 턴이 있었는지 |
| `expiry_finalized` | 만료 워처 | 재정리 방지 |

**우선순위가 엄격하다** — `suspended` > `resume_pending` > 정책 만료 > 기존 반환.
`mark_resume_pending()` 은 **절대 `suspended` 를 덮지 않는다**(하드 와이프가 이긴다).

⚠️ **Hermes 자체 문서 모순 1건.** `docs/session-lifecycle.md` §6 표는 리셋 정책 기본값을
`both` 로 적지만, 같은 문서 부록 YAML 과 **실제 코드 `gateway/config.py:501` 은 `none`** 이다.
코드 docstring 에 경위가 있다 — *"Changed July 2026 from 'both' (24h idle + daily 4am), which
surprised users who expected their conversations to persist."* **정본은 `none`.**
(SoloSquad 관점: 대화 영속을 기본으로 두는 쪽이 사용자 기대와 맞다는 실사용 피드백.)

### 5.4 크래시 복구 — `.clean_shutdown` 마커 한 장

```
게이트웨이 기동
   └─ .clean_shutdown 존재? ── 예 → 아무것도 안 함 (정상 종료였음)
                            └ 아니오 ↓
      suspend_recently_active(120s)  최근 120초 내 활동 세션 → resume_pending
                 ↓
      _suspend_stuck_loop_sessions() 3회+ 연속 재시작 생존 세션 → suspended (하드)
                 ↓                   카운터: {HERMES_HOME}/restart_counts.json
      기동 복원 중 인바운드 메시지 큐잉
                 ↓
      resume_pending 세션마다 MessageEvent 를 합성해 _handle_message 호출
      → 에이전트가 스스로 이어서 진행
```

세 가지가 잘 설계됐다.

- **`resume_pending` 은 접근 시 지워지지 않는다.** `run_conversation()` 이 진짜 응답을
  반환한 뒤에야 `clear_resume_pending()` 이 불린다. 재개 턴이 또 끊기면 플래그가 남아 **다음
  재시작이 다시 시도**한다
- **무한 재시도는 고착 카운터가 끊는다** — 3회면 `suspended` 로 승격, 사용자는 깨끗한 새 판
- **`hermes update` · `gateway restart` · `/restart` 후 원치 않는 자동 리셋을 마커가 막는다**

### 5.5 메시지 큐잉 — 슬롯 1 + 오버플로

```
adapter._pending_messages: Dict[session_key, MessageEvent]
    └ 세션당 "다음 차례" 슬롯 1개. 반복 전송 시 덮어씀(버스트 붕괴)

self._queued_events: Dict[session_key, List[MessageEvent]]
    └ 오버플로 버퍼. /queue 호출이 슬롯을 못 잡으면 여기에 append.
      drain 마다 하나씩 승격
```

**두 시나리오를 다르게 취급한다.** 에이전트가 도는 중 사용자가 연달아 보낸 메시지는
슬롯에서 **뭉개져도 되고**(마지막 것이 이김), 명시적 `/queue` 는 **각각 온전한 턴을 하나씩,
FIFO 로, 병합 없이** 생산해야 한다. 어댑터가 없으면 오버플로로 **되밀어** 조용한 유실을 막는다.

### 5.6 에이전트 캐시 — 프롬프트 캐시를 지키는 비용

게이트웨이는 `session_key → AIAgent` LRU 캐시를 유지한다. **목적은 프롬프트 캐시 보존**이다.

| 설정 | 기본 |
|---|---|
| `agent.agent_cache.max_size` | 128 |
| `agent.agent_cache.idle_ttl_secs` | 3,600 (1h) |
| `agent.agent_cache.memory_high_mb` | `auto` (cgroup `memory.high`→`memory.max`→v1→전체 RAM) |
| `agent.agent_cache.max_evictions_per_pass` | 16 |
| `agent.agent_cache.protect_recent` | 8 |
| `max_live_sessions` | 16 (분리된 세션 LRU) |
| `max_concurrent_sessions` | `None` (무제한) |

**엔트리 수 캡과 idle TTL 둘 다 메모리에 눈이 멀었다**는 것이 실전에서 드러났다(#80764).
캐시된 에이전트는 도구 출력을 포함한 **전체 라이브 트랜스크립트**를 고정하는데, 도구 호출
100회 넘는 세션이면 수십 MB다. 많은 채팅을 서빙하는 게이트웨이는 **따뜻한 트랜스크립트를
전부 상주**시키고(TTL 안에 턴을 돈 에이전트는 idle 스윕 대상이 아니므로) RSS 가 cgroup 스로틀에
닿을 때까지 오른다 → systemd stop 타임아웃 안에 SIGTERM 이 플러시를 못 끝낸다.

**밸브가 `_sweep_agent_cache_under_pressure()`** 다. 워처 틱마다 익명 RSS 를 예산과 비교해
초과분을 LRU 로 밀어내고 **`malloc_trim`** 으로 아레나를 OS 에 실제 반환한다.
**절대 안 밀어내는 3종** — ⑴ 턴 진행 중 ⑵ MRU `protect_recent` 개 ⑶ **라이브 트랜스크립트가
아직 디스크에 다 안 닿은 세션**(`transcript_persistence_caught_up()` 이
`_last_flushed_db_idx` 와 `len(_session_messages)` 를 비교).

### 5.7 만료 워처 — 5분 주기 4가지 일

`_session_expiry_watcher` 가 300초마다 돈다.

1. **만료 세션 파이널라이즈** — `on_session_finalize` 플러그인 훅 → 도구 자원 정리 →
   캐시 축출 → 세션별 오버라이드(모델/추론) 해제 → `expiry_finalized` 영속화 →
   state.db 행을 `end_reason='session_reset'` 으로 승격. **조건부 승격**이라 명시적
   경계(`compression`, `session_switch`)는 절대 덮어쓰지 않는다 — 안 그러면
   **stale-route 복구가 만료된 세션을 전체 히스토리째 되살린다**(#61220, #61993, #63539)
2. **idle 캐시 스윕**
3. **메모리 압력 스윕**
4. **오래된 엔트리 프룬**(시간당, `session_store_max_age_days`)

실패는 **세션별 3회까지 재시도**하고, 3회 후엔 `expiry_finalized=True` 로 강제 마킹해
무한 루프를 끊는다.

### 5.8 축 C — profile routing: 메시지 출처로 인격을 고른다

```yaml
profile_routes:
  - {name: server-default,  platform: discord, guild_id: "123",                        profile: server-profile}
  - {name: support-channel, platform: discord, guild_id: "123", chat_id: "987",        profile: support-profile}
  - {name: standup-thread,  platform: discord, guild_id: "123", chat_id: "987", thread_id: "111", profile: standup}
```

**매칭은 논리곱**(선언한 판별자 전부 만족), **가장 구체적인 것이 이김**. 가중치가 가산적이다:
`thread_id` 8 · `chat_id` 4 · `guild_id` 2 · (platform only) 0.
`chat_id` 는 **채널 또는 그 부모**와 매칭된다(포럼/스레드 계층 매칭).

전제조건이 하나 — `gateway.multiplex_profiles: true`. 멀티플렉싱이 **프로파일별 런타임 스코프**
(프로파일별 `HERMES_HOME`·시크릿 스코프·프로파일 네임스페이스 세션 키)를 켜고,
라우팅은 그 위에서 **결정 층**만 담당한다. 꺼져 있으면 `profile_routes` 는 통째로 무시되고
동작이 단일 프로파일과 **바이트 동일**하다.

**플랫폼 일반적**이다 — `BasePlatformAdapter` 에 `gateway_runner` 역참조가 선언돼 있어
Discord 뿐 아니라 모든 어댑터가 같은 경로를 탄다.

---

## 6. 컨텍스트 관리

### 6.1 두 가지 압축 모드

| | 배치 압축 (기본) | 마이크로 압축 (`compression.micro_compact: true`) |
|---|---|---|
| 시점 | 임계 초과 시 1회 | **매 턴 종료 후** 1 exchange |
| 비용 | 한 번에 큰 청구 + 가시적 정지 | 분할 납부, 턴당 유계 |
| 컨텍스트 곡선 | 임계까지 톱니 | 일정하게 작게 유지 |
| 프롬프트 캐시 | 유지 | **매 턴 접두 캐시 파괴** ← 결정적 단점 |
| 지식 신선도 | 창이 찰 때까지 원문 | 더 빨리 요약본이 됨 |

Hermes 문서가 스스로 경고한다 — *"for some setups that cost exceeds the benefit."*
**기본 off** 이며, *"which model pays it"* 이 무엇보다 중요하다고 말한다
(→ `auxiliary.compression` 슬롯, §4.2).

주요 기본값: `threshold: 0.50`(컨텍스트 사용률 50% 초과 시) · `target_ratio: 0.20` ·
`protect_last_n: 20` · `protect_first_n: 3` · `min_tail_user_messages: 1` ·
`max_attempts: 3` · `micro_compact_defrag_threshold_tokens: 2000` · `in_place: true`.

### 6.2 가장 중요한 원칙 — **사용자 메시지는 절대 압축하지 않는다**

exchange 는 **의도적으로 assistant 메시지에서 시작**한다. 마이크로 압축은 user 메시지를
지나쳐서 그다음 assistant 로 간다. 근거가 문서에 길게 적혀 있고, 그대로 인용할 가치가 있다.

> 어시스턴트가 만든 것은 대체로 **자기가 한 일의 서술**이다 — 이 파일을 읽었고, 저 명령을 돌렸고,
> 이 결과를 얻었다. 그런 서술은 요약해도 손실이 거의 없다. 당신의 지시는 **다른 종류의 것**이다.
> 그것은 나머지 전부가 파생돼 나온 **의도**이고, 뒤따른 작업으로부터 **복원될 수 없다.**
> *"use the existing retry helper, don't add a new one"* 을 요약으로 바꿔 쓰는 것이야말로
> 에이전트가 여섯 턴 뒤에 하지 말라던 일을 **자신 있게** 하게 되는 정확한 경로다.

대가도 정직하게 적는다 — user 턴이 누적되므로 **중간이 줄어들 수 있는 하한**이 생긴다.
보통은 낮지만, 10–20K 토큰 프롬프트를 상습적으로 붙여넣으면 그 무게는 **설계상** 남는다.

보호 구역 2개가 더 있다 — **head**(시스템 프롬프트 + 개시 메시지, 창립 지시가 절대
의역되지 않게) · **tail**(토큰 예산 창의 최근 메시지). 마이크로 압축은 **오직 그 사이 중간**에서만 일한다.

### 6.3 롤링 요약 + 커서 + defrag

- **커서** = 아직 흡수 안 된 첫 메시지 인덱스. 유실/범위이탈 시(새 프로세스, 재개 세션)
  **트랜스크립트를 스캔해 마지막 요약 마커 직후로 복구**한다. **트랜스크립트가 진실의 원천**이라
  세션 재개가 이미 한 일을 다시 요약하지 않는다
- **롤링 요약 1개**만 유지. 새 exchange 를 병합하며 결정·요구사항·파일경로·미해결질문을 접어넣고,
  낡은 디테일은 버리고, 기존 구조는 보존한다. **자격증명은 `[REDACTED]` 로 치환**하라고 명시 지시
- **낡은 마커는 버린다.** 누적 요약이므로 이전 마커는 엄밀히 중복 — 남겨두면 헤딩·종료마커
  스캐폴딩까지 딸린 근사 중복본이 쌓여 **트랜스크립트가 매 턴 줄지 않고 늘어난다**
- **defrag** — 롤링 요약이 2,000토큰을 넘으면 다음 패스가 **요약 자신을 재요약**한다.
  트랜스크립트 구조는 건드리지 않고(메시지 흡수·스플라이스 없음, 커서 정지) 요약 텍스트만 처리하므로
  "사용자 메시지 불가침" 보장이 defrag 를 통과해도 유지된다

### 6.4 DB 와의 정합 — 놓치기 쉬운 함정

인메모리 스플라이스만으론 부족하다. Hermes 의 정상 세션 플러시는 **append-only** 라
원본 행이 active 로 남고, **재개 시 요약과 그것이 대체한 메시지를 둘 다 로드**해 세션이
곧장 컨텍스트 한도를 넘는다. 그래서 매 패스가 `archive_and_compact` 를 호출해
**원자적으로 active 행을 soft-archive 하고 압축본을 삽입**한 뒤, 메시지를 "이미 영속됨"으로
스탬프해 뒤따르는 append-only 플러시가 건너뛰게 한다.

> **SoloSquad 시사** — 압축을 인메모리에서만 하고 영속층을 append-only 로 두면
> **재개 시 이중 로드**가 반드시 생긴다. §D2 세션 레지스트리 설계 시 압축과 영속의
> 원자성을 처음부터 계약에 넣어야 한다.

### 6.5 자식에게 컨텍스트를 넘기는 유일한 방법

**자동 상속이 없다.** 스키마 설명이 못박는다 —
*"Children know nothing of this conversation: pass everything needed via 'context',
including any required output language, tone, or style (e.g. 'respond in Chinese')."*

부모가 자식에게 주는 것은 정확히 4가지뿐이다.

```
① goal            ② context          ③ workspace_path (자동, 조건부)   ④ 툴셋(차감 후)
```

**③ 이 흥미롭다.** `_resolve_workspace_hint()` 는 `TERMINAL_CWD` →
`_subdirectory_hints.working_dir` → `terminal_cwd` → `cwd` 순으로 후보를 보되,
**절대경로이면서 실재하는 디렉토리일 때만** 주입한다. 그리고 자식 프롬프트에 규칙을 박는다 —

> Never assume a repository lives at `/workspace/...` or any other container-style path unless
> the task/context explicitly gives that path. If no exact local path is provided,
> **discover it first** before issuing git/workdir-specific commands.

가짜 컨테이너 경로를 서브에이전트에게 가르치지 않으려는 방어다.

### 6.6 스킬 위계 — 3층, 그러나 "라우터 스킬 금지"

```
① in-repo bundled    skills/<category>/<name>/SKILL.md            번들·상시 후보
② in-repo optional   optional-skills/<category>/<name>/SKILL.md   `hermes skills install official/...`
③ user-local         ~/.hermes/skills/<category>/<name>/SKILL.md  개인, 비공유
                     ~/.hermes/skills/openclaw-imports/           OpenClaw 마이그레이션 유입분
```

카테고리(조사 시점 14종): `apple` · `autonomous-ai-agents` · `creative` · `email` · `github` ·
`media` · `mlops` · `note-taking` · `productivity` · `research` · `smart-home` ·
`social-media` · `software-development` · `index-cache`.

프론트매터(검증기 정본 `tools/skill_manager_tool.py::_validate_frontmatter`):

```yaml
---
name: hermes-agent-skill-authoring          # 소문자·하이픈·≤64자
description: "Author in-repo SKILL.md files: frontmatter and structure."
version: 2.0.0                              # semver, 신규는 0.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [skills, authoring, conventions]
    related_skills: [plan, requesting-code-review]
---
```

하드 요구: 첫 바이트가 `---`(선행 공백줄 금지) · `\n---\n` 로 종료 · YAML 매핑 파싱 ·
`name`·`description` 존재 · 본문 비어있지 않음.

**티어 판정 기준이 명확하다** — 번들의 하드 바는 *"이 스킬을 월 5세션 이상 로드할 사용자가
있다고 정색하고 말할 수 있는가"*. **애매하면 optional.** 승격은 쉽고 강등은 churn 이라서다.

**차용 가치 최상 — "라우터/인덱스/허브 스킬 금지" 조항.**

> 핵심 내용이 형제 스킬을 가리키는 라우팅 표인 스킬은 **간접 홉을 하나 추가하고 형제들 자신의
> `When to Use` 트리거를 중복**한다. *"대신 스킬 X를 로드하라"* 포인터를 빼면 텅 비는 스킬이면
> 쓰지 마라 — 카탈로그와 각 형제의 트리거가 이미 그 일을 한다.

**전처리기**(`agent/skill_preprocessing.py`)가 SKILL.md 를 로드 시 변환한다 —
`${HERMES_SKILL_DIR}` / `${HERMES_SESSION_ID}` 치환(해석 실패 토큰은 **그대로 둬서 디버깅 가능**),
그리고 인라인 셸 `` !`date +%Y-%m-%d` `` 실행(단일 줄만, 출력 **4,000자 캡** — 폭주 명령이
컨텍스트를 못 날리게).

**번들**(`agent/skill_bundles.py`) — 여러 스킬을 한 이름으로 묶고 `description` 과
*"스킬 본문들 위에 주입할 선택적 추가 가이던스"* 를 붙일 수 있다.

---

# B. SoloSquad 로의 환류

## 7. 미결 대장에 주는 입력

### 7.1 M9 (Chief/PM 토폴로지) 🔴 — **가장 큰 시사점**

§B1 은 Chief 를 남길지(ⓓ 라우터 축소) 아니면 PM 에 통폐합할지(ⓑ/ⓒ)를 놓고 재개봉 상태다.
Hermes 의 답은 **양자택일이 아니다.**

| | SoloSquad 현행 | Hermes |
|---|---|---|
| 에이전트 **역할** 수 | Chief + 4 main + 20 specialist = **25종 정체성** | **2종** (`leaf` / `orchestrator`) |
| 정체성의 소재 | `SKILL.md` 25개 (코드가 로드) | **프로파일**(디렉토리) + **Kanban 배정**(데이터) |
| 위계의 깊이 | 문서상 5-layer | **런타임 기본 1단**(평면), 설정으로 확장 |
| 전문가 라우팅 | 4채널(slash/explicit/keyword/freq) | `kanban_decompose` **LLM 이 설명 보고 프로파일 배정** |

**핵심 관찰** — Hermes 는 "에이전트 위계"를 **코드에서 제거하고 데이터로 옮겼다.**
러너가 아는 것은 `leaf` 와 `orchestrator` 둘뿐이고, "누가 무엇을 잘하는가"는 전부
**프로파일 디렉토리와 Kanban 행**에 있다.

이것이 §T3 의 기준(*"이 구조가 없으면 코드가 무엇을 못 하는가"*)을 M9 에 적용한 결과를 시사한다.
**Chief↔PM 2단이 코드에 있어야 할 이유**를 찾는 대신, 질문을 바꿀 수 있다 —
*"러너가 알아야 하는 역할은 최소 몇 개인가?"* Hermes 의 답은 **2개**(위임 가능 / 불가능)이고,
나머지 23종은 전부 데이터로 내려간다.

⚠️ **단, 그대로 이식하면 안 되는 이유** — Hermes 의 프로파일은 **사용자가 수동으로 만드는
인격**이고, SoloSquad 의 25 에이전트는 **번들로 배송되는 제품 자산**이다(자산 98파일이
언어 중립이라 100% 승계된다는 §0.0.3 의 전제). 즉 SoloSquad 는 "프로파일을 사용자가 만든다"가
아니라 **"번들 자산이 곧 프로파일 카탈로그"** 형태가 돼야 한다.
→ **M9 결정 시 검토할 3안**: ⓐ Chief 유지 ⓑ PM 통폐합 ⓒ **역할 2종 + 자산 카탈로그**(Hermes 형).

### 7.2 M12 (세션 폭증 비용 배수) 🔴 — **실측 대신 설계값을 얻었다**

M12 는 *"5~7배는 Agent Teams 수치다. 측정 없이는 `max_active` 기본값을 정할 수 없다"* 였다.
Hermes 는 이 문제를 **측정으로 풀지 않고 다층 캡으로** 풀었다.

| 층 | 캡 | 값 |
|---|---|---|
| 턴 | 턴당 스폰 상한 | `loop_caps.max_subagents: 50` |
| 위임 | 동시 자식 | `max_concurrent_children: 3` (초과 시 **거부 후 동기 폴백**) |
| 위임 | 깊이 | `max_spawn_depth: 1` |
| 위임 | 자식 반복 | `max_iterations: 50` |
| 세션 | 전역 동시 | `max_concurrent_sessions: None` |
| 세션 | 인메모리 LRU | `max_live_sessions: 16` |
| 에이전트 | 캐시 엔트리 | `agent_cache.max_size: 128` |
| 에이전트 | idle TTL | 3,600s |
| 에이전트 | **메모리 예산** | `memory_high_mb: auto` (cgroup 연동) |

> **M12 에 대한 권고 — 실측을 착수 조건으로 두지 말 것.** Hermes 는 배수를 모른 채
> **보수적 기본값 + 다층 캡 + 사후 압력 밸브**로 출발했고, 실제 문제(#80764)는
> "동시 세션 수"가 아니라 **"캐시된 트랜스크립트의 RSS"** 에서 터졌다. 즉 M12 가 물어야 할
> 변수는 세션 수가 아니라 **세션당 상주 바이트**일 가능성이 높다.
> §0.0.8 에서 M12 는 `[2]` 를 막는 유일한 블로커인데, **이 재정의가 맞다면 `[2]` 는 지금 열린다.**

### 7.3 M4-2 (동시성 ⓒ) — **결정 14 가 옳았다는 실측 증거**

결정 14 는 *"asyncio 는 harness/ 안쪽에만, 코어 얼굴은 동기 함수"* 였다.
**Hermes 가 정확히 그 경계에서 대가를 치르고 있다.**

```
게이트웨이         asyncio  (_session_expiry_watcher 가 "gateway event loop" 에서 300초 주기)
서브에이전트       threads  (ThreadPoolExecutor)
```

경계 비용이 `tools/thread_context.py`(120줄)로 실물화돼 있다. 맨 `threading.Thread` /
`ThreadPoolExecutor` 워커는 **빈 `contextvars.Context`** 로 시작하고 스레드로컬 콜백이 없어서,
그 안의 도구 디스패치가 **조용히** 다음을 잃는다:

- 승인 세션/플랫폼 ContextVars → `check_dangerous_command` 의 **비대화형 자동승인 분기**로 빠져
  **위험 명령이 프롬프트 없이 실행**됨 (#33057, #30882)
- 스레드로컬 CLI 승인/sudo 콜백 → `prompt_dangerous_approval` 이 사용자에게 못 닿음
  (**GHSA-qg5c-hvr5-hjgr**, #15216)

**이것은 CVE 급 보안 이슈로 실현됐다.** 해결은 부모 스레드에서 스냅샷을 떠서
워커에 설치하고 **종료 시 항상 해제**(재사용 스레드가 폐기된 CLI 참조를 들지 않게)하는
단일 감사 구현으로 통일한 것이고, **fail-closed** 다 — 설치 실패 시 콜백은 `None` 으로 남고
그게 안전한 결과다(콜백 없으면 위험 명령을 거부).

> **결정 14 에 대한 보강 명세 3줄** — `[1] 계약` 에서 async↔sync 경계를 그을 때
> **"경계를 넘는 것은 데이터만이 아니라 ⑴ 승인 권한 ⑵ 감사 컨텍스트 ⑶ 취소 신호"** 임을
> 계약에 넣어야 한다. Hermes 는 이걸 사후에 배웠고 그 대가가 GHSA 1건이다.

### 7.4 §C3 / M13 (Tier-2 착수) — **2계층 어댑터의 실물 형태**

§C3 의 1차 개선안은 *"2계층 어댑터 + 순서 역전 인정"* 이었다. Hermes 의 형태는 이렇다.

```
계층 1  취득(auth)   PROVIDER_REGISTRY + auth_type 5종
                    oauth_device_code / oauth_external / oauth_minimax / api_key /
                    external_process·aws_sdk·vertex
                    → 구독과 키를 "같은 레지스트리, 다른 취득 방식" 으로 통일
계층 2  소비(call)   transports/ (anthropic·chat_completions·codex·bedrock·…)
                    + api_mode 자동감지 + credential_pool(동일 provider 다중화)
```

**M13 이 물은 것**(*"Tier-2 를 정말 만들 것인가 — 도구를 직접 구현하는 비용이 1인 상한을 넘을 수
있다"*)에 대한 Hermes 의 답은 **"도구를 직접 구현하지 않는다"** 이다.
로컬 LLM(`LM Studio`)은 `api_key` provider 로 **같은 레지스트리에 평평하게** 들어가 있고,
도구 실행은 Hermes 자신의 도구층이 하며 모델은 교체 가능한 부품이다.
**즉 Tier-2 는 별도 티어가 아니라 레지스트리의 한 행이다.**

> **권고** — §C3 이 "구독/API/로컬"을 3티어로 나눠 설계하면 계층이 늘어난다.
> Hermes 처럼 **취득 방식만 열거형으로 분기하고 소비 인터페이스를 단일화**하면
> 로컬 LLM 추가가 **레지스트리 1행 + transport 재사용**으로 끝난다. M13 은 "만들 것인가"가
> 아니라 "**레지스트리에 넣을 것인가**"로 축소된다.

### 7.5 M6 (메신저 재도입 언어) 🟢 — **참고 데이터 1건**

Hermes 는 Telegram·Discord·Slack·WhatsApp·Signal·Matrix·Feishu 를 **전부 Python 으로** 구현했다
(`gateway/platforms/base.py` + 어댑터들). 즉 §0.0.4 요건 2(*플랫폼 실시간 I/O = TS*)가
**필연이 아님을 보여주는 반례**다. 다만 Hermes 는 웹 UI 를 별도 스택(`apps/desktop` = Electron+React,
`ui-tui`, `web`)으로 두므로, **"메신저 I/O = Python 가능 / UI 렌더 = TS"** 라는 더 정밀한 선이
가능하다는 것도 함께 보여준다.
→ M6 잔여(언어)는 **"메신저 어댑터는 Python, 대시보드만 TS"** 쪽으로 기울 근거가 하나 생겼다.

### 7.6 §C1 하네스 5-메서드 — 시그니처에 반영할 것 3개

`[1] 계약` 에서 하네스 인터페이스를 확정할 때, Hermes 가 사후에 붙인 것들을
**처음부터 시그니처에 넣으면 싸다.**

| 항목 | Hermes 의 위치 | SoloSquad 계약에 넣을 형태 |
|---|---|---|
| 자식 결과의 **동적 크기 예산** | `_parent_summary_char_budget` + 스필 + 오프셋 푸터 | spawn 결과 타입에 `{summary, spill_path?, read_offset?}` |
| **출력 스키마 계약 + 1회 교정** | `output_schema` → `schema_valid`/`schema_errors` | spawn 요청에 선택적 JSON Schema, 결과에 검증 상태 |
| **감독 API**(중단·조종·조회) | `interrupt_subagent` / `steer_subagent` / `list_active_subagents` | 하네스 5-메서드 중 하나를 "실행 중 제어"로 |

### 7.7 §D2 세션 레지스트리 ("세션 = 과제") — 대비

SoloSquad 의 §D2 는 *"스레드 = 세션"* 모델이었다. Hermes 는 **레인/화신 분리**를 택했다.

| | SoloSquad §D2(안) | Hermes |
|---|---|---|
| 식별 | 스레드 ↔ 세션 1:1 | `session_key`(레인) ↔ `session_id`(화신) **1:N 시계열** |
| 리셋 | — | 레인 유지, 화신 교체 |
| 격리 정책 | — | 키 문자열에 **성분으로 인코딩** (`group_sessions_per_user` / `thread_sessions_per_user`) |
| 복구 | — | `suspended`(하드) vs `resume_pending`(소프트) **2종 분리** |

> **차용 권고** — "레인/화신 분리"는 `/new` 를 **세션 삭제가 아니라 화신 교체**로 만든다.
> SoloSquad 가 워크플로우/goal 을 스레드에 매다는 구조라면, 스레드는 레인이고
> 그 안에서 과제가 여러 화신으로 이어지는 편이 `_status.yaml` 의 `needs_revision`
> 재생성 흐름과도 맞다.

---

## 8. 차용 후보 · 기각 후보

### 8.1 차용 강력 권고 (비용 낮고 효과 명확)

| # | 항목 | 근거 | 들어갈 자리 |
|---|---|---|---|
| ① | **"자식 요약은 자기 보고" 조항** — 외부 부작용은 검증 가능한 핸들(URL/ID/절대경로)을 요구하고 **부모가 직접 검증** | `delegate_task` 설명문 | `_handoff.md` 프로토콜 + Chief SKILL.md |
| ② | **사용자 메시지 불가침** 압축 원칙 | `docs/micro-compaction.md` | `[2] 컨텍스트` 압축 명세 |
| ③ | **스레드 컨텍스트 전파 계약**(승인·감사·취소가 경계를 넘게) | `tools/thread_context.py`, GHSA | `[1] 계약` 동시성 경계 |
| ④ | **라우터/인덱스 스킬 금지** 조항 | skill-authoring SKILL.md | `skills/skill-core/core.md` (v1.3.6 매니저 표준) |
| ⑤ | **스키마 설명문 런타임 재생성** — 모델에게 프레임워크 기본값이 아니라 현재 설정의 진실을 보임 | `_build_dynamic_schema_overrides` | 하네스 도구 정의 |
| ⑥ | **자격증명 출처별 대칭 제거 계약**(`RemovalStep`) | `credential_sources.py` | `[6] 배포` / 인증 설계 |
| ⑦ | **`.clean_shutdown` 마커 + 고착 카운터** — 정상종료와 크래시를 구분해 불필요한 자동리셋 제거 | `docs/session-lifecycle.md` §7 | `[3] 실행` 러너 복구 |

### 8.2 조건부 차용 (설계 확정 후 판단)

| 항목 | 조건 |
|---|---|
| **Kanban 형 영속 오케스트레이션** | M9 가 "역할 2종 + 데이터 카탈로그"(ⓒ)로 결론날 때만 정합. 현 `workflows/<id>/_status.yaml` 과 **직접 경쟁**하므로 둘 다 두면 안 됨 |
| **profile routing** | 메신저 재도입(v2.1.0) 이후에만 의미. SoloSquad 의 `<org>/` 계층이 이미 유사 역할이라 **중복 위험** — org = profile 로 매핑되는지 먼저 판정 |
| **MoA** | 결정 6(데이터 분석·시뮬레이션)과 결이 맞으나 **비용 배수가 참조 모델 수만큼 선형**. `[4] 분석` 이후 |
| **마이크로 압축** | 프롬프트 캐시 파괴가 대가. SoloSquad 는 장시간 goal 런이 많아 **캐시 가치가 커서** 기본 off 가 맞을 것 |

### 8.3 기각 권고

| 항목 | 사유 |
|---|---|
| **auth provider 36종 전량** | 1인 창업자 도구에 과잉. Hermes 는 228k star 범용 플랫폼이라 성립. SoloSquad 는 **Claude Code 구독 + 소수 폴백**이면 족함(§C3 Tier-1 우선 원칙과 일치) |
| **7종 터미널 백엔드**(local/Docker/SSH/Singularity/Modal/Daytona/Vercel Sandbox) | 결정 5(Docker 보류) 와 충돌. v2.1.0 클라우드 배포 시 **Railway 1종**으로 충분 |
| **delegate_task 를 그대로 복제** | SoloSquad 는 spawn 을 **러너가 직접 소유**(§0.0.6 — Py 러너가 부모 프로세스로 프롬프트를 직접 조립·주입)하므로, "모델이 부르는 도구" 형태가 아니라 **러너 내부 API** 가 맞다 |

---

# C. 시간축 — 실제 코드 변경으로 본 설계 진화 (2025-07 ~ 2026-08)

> **추가 조사 2026-08-10.** §A·§B 는 **현재 상태의 단면**이다. 오픈소스는 그 단면에 이르는
> **경로**에 더 많은 정보가 있다 — 특히 **되돌린 결정**은 "무엇이 안 통했는가"의 직접 증거다.
> 이 파트는 `git clone --filter=blob:none` 로 받은 **전체 히스토리 21,615 커밋**을 근거로 한다.
> 인용한 모든 날짜·커밋 제목·이슈 번호는 실제 커밋 메타데이터다.

## 10. 성장 곡선 — 두 개의 다른 프로젝트

| 기간 | 커밋 | 성격 |
|---|---:|---|
| 2025-07 ~ 2026-01 (7개월) | **92** | 조용한 태동. 월 10건 안팎 |
| 2026-02 | 480 | **폭발 시작** |
| 2026-03 | 2,522 | |
| 2026-04 | 4,084 | |
| 2026-05 | 3,329 | |
| 2026-06 | 3,989 | |
| 2026-07 | **5,694** | 피크 |
| 2026-08 (10일) | 1,425 | |
| **합계** | **21,615** | 최초 커밋 2025-07-22 `"initital commit"`(원문 오타) |

**7개월 92커밋 → 6개월 21,500커밋.** 이 문서가 §A 에서 관찰한 정교함(하트비트 상수, 메모리 압력
밸브, 자격증명 제거 계약)은 **설계에서 나온 게 아니라 6개월간 초고속으로 부딪히며 나왔다.**
이것이 시간축을 보는 이유다 — **결과만 베끼면 그 결과가 왜 그 모양인지 모른다.**

### 10.1 아키텍처 지층 — 무엇이 언제 생겼나

```
2026-02-02  gateway/session.py            세션 모델
2026-02-19  SQLite session store          영속 메모리
2026-02-20  delegate_task ─┬              위임
            멀티 provider auth ┘          ← 같은 날. 처음부터 "여러 모델"이 전제였다
2026-02-21  context_compressor            컨텍스트 압축
2026-02-26  session reset policy          세션 만료
2026-03-14  acp_adapter/                  외부 에이전트 프로토콜
2026-03-31  credential_pool               동일 provider 다중 자격증명 (#2647)
2026-04-21  orchestrator role + depth     ← 위임에 "위계" 도입 (2개월 뒤)
2026-04-26  Kanban 보드 (#16081)          ← 영속 협업 (위계 도입 5일 뒤)
2026-05-16  codex_runtime                 Codex CLI 를 런타임으로
2026-05-17  Kanban auto-decompose (#27572) ← 오케스트레이션이 Kanban 으로 이동
2026-05-18  kanban swarm topology helper
2026-05-28  thread_context (GHSA 수정)     ← §7.3 의 그 사고
2026-06-18  multiplex phase 0/1           프로파일 격리
2026-06-25  moa_loop                      Mixture-of-Agents
2026-07-12  subagent_lifecycle            공개 계약 v1
2026-07-29  micro-compaction              점진 압축
```

**가장 중요한 순서 하나** — `delegate_task`(2026-02-20) → orchestrator role(**2개월 뒤**) →
**Kanban(그 5일 뒤)** → Kanban 자동분해(**3주 뒤**).

즉 Hermes 는 "위임에 위계를 넣어보고" → **닷새 만에 별도 영속 보드를 신설**했고,
3주 뒤 **오케스트레이션의 무게중심을 그쪽으로 옮겼다.** §1 에서 관찰한 "3축 병존"은
설계 취향이 아니라 **위임 확장이 한계에 부딪힌 결과**다. → §7.1(M9) 의 근거가 시간순으로 보강된다.

---

## 11. 되돌린 결정 9건 — "안 통한 것"의 목록

| # | 무엇 | 최초 | 반전 | 간격 | 최종 |
|---|---|---|---|---:|---|
| 1 | 반복 예산 | 03-07 `shared iteration budget across parent + subagents` | 03-25 `give subagents **independent** iteration budgets (#3004)` | **18일** | 자식마다 독립 50 |
| 2 | 자식 타임아웃 | 04-22 `add **hard timeout**` (#13770) → 04-23 `bump to **600s**` (#14809) | 06-12 `**remove** the default subagent wall-clock timeout (#45149)` | 51일·2단계 | **0 = 무제한** |
| 3 | 위임의 성격 | 04-28 `docs: clarify that it is **synchronous and not durable**` (#17022) | 06-15 `async background subagents (background=true)` (#40946) → 06-20 `background fan-out, one consolidated return` (#49734) | 48일 | **항상 백그라운드**, 파라미터 폐기 |
| 4 | 동시성 노브 | (background 전용 캡 `max_async_children` 신설) | 07-02 `**unify** concurrency caps — deprecate max_async_children (#56955)` | — | 캡 1개로 통합 |
| 5 | DM 스레드 컨텍스트 | 04-01 `seed DM thread sessions with parent transcript to preserve context` | 04-10 `**remove** DM thread session seeding to prevent **cross-thread contamination** (#7084)` | **9일** | 시딩 없음 |
| 6 | 세션 자동 리셋 | 02-26 도입 (`both` = 24h idle + 매일 4시) | 07-07 `default session auto-reset **to off (mode: none)** (#60194)` | 132일 | **none** |
| 7 | 마이크로 압축 | 07-29 도입 (default-on) | 07-29 `ship micro-compaction **opt-in, not default-on**` | **같은 날** | opt-in |
| 8 | 경로 순회 가드 | 06-05 V-009 `reject path traversal` + `reject Windows drive-letter` | 07-06 `**relax** session_key traversal guard to allow interior '/' (#59322)` | 31일 | 완화 |
| 9 | 트랜스크립트 저장 | 02-19 SQLite 도입, JSONL 병행 | 05-20 `drop JSONL fallback` + `stop writing JSONL` → 07-05 `sessions.json 을 **optional legacy mirror** 로 강등 (#59203)` | 5개월·3단계 | SQLite 단일 |

### 11.1 반전에서 읽히는 규칙 4개

**① 시간 기반 판정은 두 번 실패했다(#2).** 벽시계 캡을 넣고(04-22) → 600초로 늘리고(04-23) →
**아예 없앴다**(06-12). 대체물은 **하트비트**(04-24 `tool-activity-aware heartbeat stale
detection` #15183 → 04-26 `increase heartbeat stale thresholds`)였고, 거기서 더 나아가
2026-07-26 에 **`progress-based stale detection`** 과 **`count streamed tokens as liveness`**
가 붙었다.

> **궤적: 벽시계 → 도구 활동 → 스트리밍 토큰.** "죽었는가"를 판정하는 신호가
> **시간에서 진행도로** 이동했다. 정상적인 장기 작업과 고착을 시간으로는 구분할 수 없다는 것이
> 두 번의 실패로 확인됐다. → **SoloSquad `goal` 8h+ 무인 실행(v1.4.3)에 직접 적용**(§16.2).

**② 컨텍스트 "친절한 상속"은 오염이 된다(#5).** DM 스레드에 부모 트랜스크립트를 씨딩한 것은
*"컨텍스트를 보존하려는"* 선의였고 **9일 만에 교차오염으로 철회**됐다.
이는 §6.5(자식은 부모 대화를 모른다·명시 전달만)가 **원칙이 아니라 상처**임을 보여준다.

**③ 기본값은 두 번 다 "켜서 내보냈다가 껐다"(#6·#7).** 세션 자동 리셋은 132일 만에,
마이크로 압축은 **당일** 껐다. 후자의 커밋 시퀀스가 특히 교훈적이다 —
`도입` → `token telemetry 추가` → `report **context occupancy**, not just tokens saved`
(지표 재정의) → `state the **real cost**, and make model choice the main knob` →
**`ship opt-in, not default-on`**. **텔레메트리를 붙이자마자 기본값을 내렸다.**

**④ 보안 과잉교정도 되돌린다(#8).** V-009 경로순회 방어가 정상 세션 키의 내부 `/` 까지
막아서 31일 뒤 완화됐다. AGENTS.md 가 이것을 규범으로 승격시킨 문장이 있다 —
**"기능을 죽이는 '수정'은 잘못된 완화다"**(§15).

---

## 12. 되돌리지 않은 흐름 5개 — 18개월 단방향

반전이 "무엇이 안 통했나"라면, **한 번도 되돌리지 않은 방향**은 "무엇이 확실한가"다.

### 12.1 🔴 모델에게서 노브를 계속 회수한다 — **가장 강한 신호**

| 날짜 | 커밋 | 뺏은 것 |
|---|---|---|
| 2026-03-07 | `refactor: remove **model** parameter from delegate_task` | 자식 모델 선택 |
| 2026-04-23 | `remove model-facing **max_iterations** override; **config is authoritative** (#14732)` | 반복 예산 |
| 2026-07-01 | `remove model-facing **toolsets** arg — subagents always inherit parent's (#56386)` | 도구 선택 |
| 2026-07-02 | `fix(security): remove **model-controlled delegate ACP transport**` | 전송 계층 |
| (현재) | `background` = **DEPRECATED / IGNORED** | 실행 모드 |

**5개월간 5번, 예외 없이 한 방향.** `delegate_task` 는 처음에 모델이 고를 수 있는 파라미터를
여럿 갖고 있었고 **지금은 `goal` / `context` / `tasks` / `role` / `output_schema` 만 남았다.**
남은 것의 공통점 — **"무엇을 할지"는 모델이 정하고, "어떻게 실행할지"는 전부 설정이 정한다.**

> 이것이 이 조사 전체에서 **SoloSquad 에 가장 직접적인 결론**이다. §16.1 참조.

### 12.2 관측성에 기능만큼 반복 투자한다

```
03-01  expose subagent tool calls and thinking to user (#169/#186)
03-13  observability metadata to subagent results (#1175)
04-22  subagent spawn observability overlay (TUI)
06-12  live subagent windows (desktop)
07-19  live-viewable subagent transcripts — tail your subagents while they work (#67479)
08-07  surface per-delegation cost in the result entry
```

**5개월간 6번.** 병렬 팬아웃은 **보이지 않으면 못 쓴다**는 것이 반복 투자로 증명됐다.
마지막 항목(**위임별 비용 노출**, 8일 전)은 아직 잉크가 마르지 않았다.

### 12.3 격리는 계속 강해지기만 했다

```
02-26  WhatsApp per-contact DM 격리
03-11  Telegram 포럼 토픽 격리
03-12  Slack 스레드 격리 · 모든 DM 에 chat_id 격리 강제
03-15  그룹 세션 사용자별 격리
03-16  그 격리를 설정 가능하게        ← 정책이 코드에서 설정으로
04-05  스레드는 반대로 "기본 공유" (#5391)  ← 유일한 방향 분화
06-18  프로파일 멀티플렉싱 (phase 0/1)
07-07  cross-profile session recovery 차단 (#59325)
```

**중간에 `build_session_key()` 를 단일 진실 원천으로 추출한 커밋(03-04)** 이 있다.
플랫폼마다 격리 버그가 하나씩 터진 뒤에야 **한 함수로 모았다.**
§5.2 에서 본 "격리 정책이 곧 키 문자열"은 그 통합의 산물이다.

### 12.4 저장은 SQLite 로 수렴 (JSONL 완전 퇴출)

02-19 도입 → 05-20 읽기 폴백 제거 → 05-20 쓰기 중단 → 07-05 메타데이터를 `state.db` 로 통합
(#58899) → 07-05 라우팅 인덱스도 이동, **`sessions.json` 은 optional legacy mirror**(#59203).
**5개월에 걸친 단계적 이전**이며, 한 번도 되돌리지 않았다.

### 12.5 자격증명 출처는 넓히고, 제거 계약은 대칭화

02-20 멀티 provider → 03-06~03-17 provider 폭증(z.ai·Kimi·MiniMax·Nous·Anthropic
native + **Claude Code credential auto-discovery**(03-12)·Vercel·OpenCode·Kilo·Alibaba·
Copilot·HuggingFace·Gemini) → 03-26 **Nous 구독** 도입 → 03-31 **credential pool**(#2647).

동시에 **암묵적 동작을 두 번 제거**했다 —
03-11 `remove LLM_MODEL env var dependency — **config.yaml is sole source of truth**` ·
03-29 `**stop silently falling back to OpenRouter** when no provider is configured (#3862)`.

그리고 04-06 `fix credential removal **re-seeding** (#5670)` 에서 §4.5 의 문제가 처음 터졌고,
그 결과가 `credential_sources.py` 의 `RemovalStep` 계약이다.

---

## 13. 사고가 설계를 만들었다 — 보안 연쇄 10건

§2.3 의 차단 목록과 §7.3 의 스레드 계약은 **한 번에 설계된 것이 아니다.**
누출 경로가 하나씩 발견된 기록이다.

| 날짜 | 사건 | 남은 구조 |
|---|---|---|
| 03-26 | `restrict subagent toolsets to parent's enabled set` (#3269) | 자식 툴셋 ⊆ 부모 |
| 04-08 | `neutralize **untrusted session metadata** in prompts` | 채팅 메타데이터 = 인젝션 벡터 |
| 04-20 | `redact secrets from **context compaction** input and output` | 압축 경로의 시크릿 마스킹 |
| 04-24 | `resolve subagent approval prompts **without deadlocking parent TUI**` (#15491) | auto-deny/approve 콜백 (§2.4) |
| **05-28** | **`GHSA-qg5c-hvr5-hjgr` / #33057 — 워커 스레드가 승인 ContextVars 를 잃어 위험 명령이 프롬프트 없이 실행** | `tools/thread_context.py` (§7.3) |
| 06-05 | `V-009` 경로 순회 (+ Windows 드라이브 문자) | 세션 필드 검증 |
| 06-29 | `also neutralize untrusted **Matrix room name**` | 인젝션 벡터 추가 발견 |
| 07-01 | `sanitize **sender-name prefix** in shared multi-user sessions` | 공유 세션의 발신자명도 벡터 |
| 07-02 | `remove **model-controlled** delegate ACP transport` | §12.1 과 교차 |
| 07-11 | `strip **URL userinfo** from tool history` | 도구 이력의 자격증명 누출 |
| 07-18 | `stop **mixed platform bundles** from re-exposing blocked tools to leaf children` | §2.3 의 2중 차단이 여기서 완성 |
| 07-30 | `prevent child **HERMES_SESSION_ID leak** into parent process env` | 프로세스 env 누출 |

**패턴 3개.**

- **인젝션 벡터는 "채팅 플랫폼이 주는 문자열" 전부다** — 세션 메타데이터(04-08) · Matrix 방
  이름(06-29) · 발신자명(07-01). 하나 막을 때마다 다음이 나왔다
- **차단 목록은 이름만으론 안 된다** — 07-18 은 `hermes-cli` 같은 **혼합 번들**이 차단 도구를
  다시 노출한 사건이고, 그래서 §2.3 의 2중 차단(툴셋 제거 + `disabled_toolsets` 차감)이 생겼다
- **가장 비싼 사고(GHSA)는 "동시성 경계"에서 나왔다** — 코드가 아니라 **실행 모델의 이음매**

---

## 14. 갓파일 붕괴 → 규범 문서화 (2026-06-07 ~ 06-09)

6개월 폭주의 대가가 한 지점에서 청구됐다. `cli.py` · `run_agent.py` · `gateway/run.py`
(현재도 ~16,800줄)가 손댈 수 없게 됐고, **이틀에 걸쳐 집중 해체**했다.

```
06-07  Phase 1b  inner-retry-loop 플래그 → TurnRetryState
06-07  Phase 2   hermes cron 파서 → hermes_cli/subcommands/
06-07  Phase 2+  9개 클로저 핸들러 → top-level 승격
06-07  Phase 3   kanban watcher 루프 → GatewayKanbanWatchersMixin
06-07  Phase 3b  42개 슬래시 핸들러 → GatewaySlashCommandsMixin
06-08  Phase 4   32개 슬래시 핸들러 → CLICommandsMixin
06-08  Phase 4   에이전트 구성 클러스터 → CLIAgentSetupMixin
06-08  Phase 3   인가 클러스터 → GatewayAuthorizationMixin
06-08  Phase 1   run_conversation 후반부 → finalize_turn
06-08  Phase 2   18개 모델 마법사 함수 → model_setup_flows
        ↓
06-09  docs(agents): add **Design Philosophy + Contribution Rubric** to AGENTS.md (#42641)
```

**해체 다음 날 규범을 문서로 박제했다.** 이 순서가 의미하는 바 —
*"이렇게 되지 않으려면 무엇을 거절해야 하는가"* 를 **아프고 나서** 적었다.

---

## 15. 명시된 결정 논리 — Hermes 의 `AGENTS.md` 기여 루브릭

§14 에서 생긴 그 문서(현재 1,512줄)에 **결정 근거가 자연어로 박제**돼 있다.
SoloSquad 의 `AGENTS.md` 와 직접 비교 가능한 유일한 자료이므로 원문 기준으로 정리한다.

### 15.1 중심 문장

> **"We are expansive at the edges and conservative at the waist."**
> (가장자리에서는 확장적이고, 허리에서는 보수적이다)

"Smallest footprint" 는 **제품이 커지는 것을 막는 원칙이 아니라, 능력이 코어에 배선되는
방식**을 규율한다고 명시한다. 플랫폼·채널·provider·데스크톱 기능은 **적극 확장**하고,
절제는 오직 **코어 에이전트 + 모델 도구 스키마** — *"모든 API 호출마다 값을 치르는 유일한 곳"* —
에 겨눈다.

### 15.2 The Footprint Ladder — 새 능력의 6단 사다리

**문제를 올바르게 푸는 가장 높은(=발자국이 작은) 단을 고른다.**

```
1. 기존 코드 확장                     발자국 0
2. CLI 명령 + 스킬                    모델 도구 발자국 0. 구독·예약작업·서비스 설정의 기본 선택
3. 서비스 게이트 도구 (check_fn)       전제조건 충족 시에만 등장
4. 플러그인                           ~/.hermes/plugins/ 또는 pip
5. MCP 서버 (카탈로그)                 코어 스키마 발자국 0, 다른 MCP 호스트도 재사용
6. 새 코어 도구                       최후 수단 — 근본적이고, 거의 모든 사용자에게 유용하고,
                                     terminal+file 로 도달 불가할 때만
```

부록 규칙 하나 — **같은 *범주*를 통합하려는 PR 이 3개 이상 열리면 하나씩 머지하지 말고
ABC + 오케스트레이터를 설계**하고, 기존 내장물을 첫 provider 로 감싼 뒤,
경쟁하던 PR 들을 그 인터페이스 위의 플러그인으로 전환한다.

### 15.3 거절 목록 — "잘 만들었어도 거절"

| 거절 대상 | 근거 |
|---|---|
| **투기적 인프라** | 소비자 없는 훅·콜백·확장점. *"훅을 추가하긴 쉽고, 플러그인이 의존하기 시작한 뒤 제거하긴 어렵다"* |
| **비밀 아닌 설정의 새 `HERMES_*` env** | `.env` 는 **비밀 전용**. 타임아웃·임계값·기능 플래그·표시 설정은 전부 `config.yaml` |
| **terminal+file 로 되는 일의 새 코어 도구** | 원격 백엔드 파일 가시성이 유일한 장벽이면 **마운트를 고쳐라, 툴셋을 늘리지 말고** |
| **지시형 도구의 `offset`/`limit`** | 스킬·프롬프트·플레이북처럼 **끝까지 읽어야 하는** 콘텐츠에 페이지네이션 금지 — *"모델은 1페이지만 읽고 나머지를 건너뛴다"* |
| **기능을 죽이는 '보안 수정'** | 목적을 죽이는 완화는 틀린 완화. `git log -p -S` 로 **원 커밋의 의도를 읽고** 기능을 보존하는 수정을 찾아라 |
| **옵트인 없는 아웃바운드 텔레메트리** | 사용자 대면 옵트인(설정 게이트 + 셋업 프롬프트 + 토글)이 생기기 전엔 머지 금지 |
| **변경 감지 테스트** | 현재 값(모델 목록·설정 버전·개수)을 얼리지 말고 **불변식**을 검증하라 |
| **3자 제품의 코어 트리 통합** | 관측성 백엔드·벤더 SaaS·분석 대시보드는 `plugins/` 에 안 받는다. **품질 기준이 아니라 결합·유지보수 결정** — 독립 플러그인 repo 로 |

### 15.4 "버그라고 부르기 전에 — 전제를 검증하라"

**잘 쓴 PR 이 닫히는 가장 흔한 이유는 코드 품질이 아니라 전제가 틀렸거나, 의도된 설계를
결함으로 오인한 것**이라고 못박고, 실제 클로즈에서 뽑은 4패턴을 제시한다.

1. **"결함이 아니라 의도된 설계"** — 예: 프로파일은 **일부러 독립된 섬**이다. 기본 프로파일에서
   설정을 실시간 상속하게 하는 PR 은 *"프로파일을 결합시키는 것이야말로 이 설계가 막는 것"* 이라
   닫혔다(복사 기반 `--clone` 경로가 정당한 수요를 이미 커버)
2. **"전제가 실제 동작과 안 맞는다"** — 예: 쿨다운 중 재탐침 PR 은 서킷브레이커가
   **확인된 빈 버킷에만** 트립하므로 재탐침이 이미 빈 걸 두드릴 뿐. 또 다른 예: 새 분기가
   **런타임에 아예 실행되지 않는다**(앞선 가드가 의존 상태를 이미 pop). *"버그가 발현하는 정확한
   줄을 짚고, 그 줄의 동작을 수정이 바꾼다는 것을 보이지 못하면 전제를 검증한 게 아니다"*
3. **"그 생략은 의도적이었고 하중을 지고 있었다"** — 예: '빠진' `__init__.py` 를 복원했더니
   테스트 트리가 점 패키지로 임포트 가능해져 **실제 플러그인을 가리고 `register()` 를 삭제**했다
4. **"과잉 확장 / 지나간 접근의 부활"** — 합의된 기반을 뒤엎거나 의도적으로 닫은 방향을
   되살리면 **코드가 동작해도** 거절

### 15.5 불변식 3종 — 반드시 보존

- **프롬프트 캐시** 보존
- **엄격한 역할 교대** — 같은 역할 두 번 연속 금지, 루프 중간에 합성 user 메시지 주입 금지
- **시스템 프롬프트의 바이트 안정성** — 대화 수명 동안 불변

§5.2 에서 본 "공유 세션의 발신자명을 시스템 프롬프트가 아니라 **각 메시지 앞에 런타임 주입**"이
바로 이 3번째 불변식의 구현이다. §6.2(사용자 메시지 불가침)와 §6.3(역할 교대가 유효하도록
exchange 단위를 턴 전체로) 도 같은 계열이다.

---

## 16. 시간축이 SoloSquad 결정에 주는 것

§7 이 **현재 상태**에서 뽑은 시사라면, 아래는 **변화의 방향**에서 뽑은 것이다.

### 16.1 🔴 `[1] 계약` — "모델에게 노브를 주지 않는다"를 시그니처에 박아라

§12.1 이 이 조사 전체에서 가장 강한 단일 신호다. **5개월간 5회, 반전 0회.**
SoloSquad 의 §C1 하네스 5-메서드를 설계할 때, Hermes 가 **5번에 걸쳐 도달한 종착점에서
출발**할 수 있다.

| 결정 대상 | 잘못된 위치 | 옳은 위치 |
|---|---|---|
| 자식이 쓸 모델 | 모델의 도구 인자 | `config` (부모 상속 또는 전역 핀) |
| 반복/토큰 예산 | 모델의 도구 인자 | `config` — *"config is authoritative"* |
| 자식 툴셋 | 모델의 도구 인자 | **부모 툴셋 − 차단 목록** (자동) |
| 전송/런타임 | 모델의 도구 인자 | `config` (보안 사유) |
| 동기/비동기 | 모델의 도구 인자 | 러너가 결정 (깊이로 자동 분기) |
| **목표·컨텍스트·역할·출력계약** | — | **여기만 모델이 정한다** |

> **`[1]` 계약에 넣을 한 줄** — *"하네스 spawn 의 인자 중 모델이 채우는 것은
> **의도(무엇을)** 뿐이고, **실행 방식(어떻게)** 은 전부 설정·러너가 채운다."*
> SoloSquad 는 러너가 spawn 을 직접 소유하므로(§0.0.6) 이 분리가 **처음부터 자연스럽다.**

### 16.2 🔴 `[3] 실행` — 장기 작업 판정을 시간이 아니라 진행도로

§11.1-① 의 궤적(벽시계 → 도구 활동 → 스트리밍 토큰)은 SoloSquad 의 **`goal` 8h+ 무인
실행**(v1.4.3)에 그대로 걸린다. 현재 SoloSquad 는 engine 에 타임아웃 개념이 있고,
Hermes 는 **같은 문제로 두 번 실패한 뒤 그것을 버렸다.**

```
권고 명세 —
  ① 자식/스테이지에 벽시계 캡을 기본으로 두지 않는다 (0 = 무제한이 기본)
  ② liveness 신호를 3종으로 정의: 도구 호출 · 스트리밍 토큰 · 하트비트 갱신
  ③ 유휴 임계(턴 사이)와 고착 임계(같은 도구)를 분리하고, 후자를 훨씬 관대하게
     (Hermes 실측 비율: 450s vs 1200s ≈ 1:2.7)
```

### 16.3 🔴 M9 — Kanban 이 위임에서 **분기**한 사실이 판정 근거다

§7.1 은 "Hermes 는 역할을 2개만 둔다"는 **단면**이었다. 시간축이 더한 것은
**왜 그렇게 됐는가**다 — orchestrator role 을 넣고(04-21) **닷새 만에** 별도 영속 보드를
신설했고(04-26), 3주 뒤 자동 분해를 **Kanban 쪽에** 붙였다(05-17).

> **M9 판정 기준으로 쓸 수 있는 질문** — *"Chief↔PM 2단이 풀려는 문제는
> **한 턴 안의 팬아웃**인가, **턴을 넘어 사는 작업 그래프**인가?"*
> 전자면 역할 2종으로 충분하고, 후자면 **`workflows/<id>/_status.yaml` 이 이미 그 보드**다.
> SoloSquad 는 Hermes 가 나중에 만든 것을 **v0.3 부터 갖고 있었다** — 즉 M9 의 답은
> "Chief 를 어떻게 할까"가 아니라 **"`_status.yaml` 을 오케스트레이션의 1급 축으로
> 승격시킬 것인가"** 일 수 있다.

### 16.4 🟡 `[0]`·`[6]` — 기본값은 보수적으로 내보내고 텔레메트리로 올려라

§11.1-③ 의 두 사례(세션 리셋 132일, 마이크로 압축 당일)가 같은 결론을 준다.
특히 후자는 **텔레메트리를 붙이자마자 기본값을 내렸다** — 즉 *"켜서 내보낸 뒤 데이터를 본다"*
가 아니라 *"데이터를 본 뒤 켠다"* 가 맞다는 것을, 하루 만에 스스로 확인했다.

SoloSquad 대응 — 재작성에서 **새로 생기는 기본값**(spawn 동시성·압축 임계·goal 사이클 캡)은
전부 **보수적 출발 + 사용 관측**으로 두고, M5(사용 측정)의 옵트인 설계에 이 항목들을 포함한다.

### 16.5 🟡 §A3 재유입 차단 — Hermes 는 이것을 **기여 루브릭**으로 풀었다

SoloSquad §A3 의 고민(*"폐기 논거가 다시 유입되는 것을 어떻게 막나"*)에 대해
Hermes 의 답은 **ADR 이 아니라 `AGENTS.md` 의 "전제를 검증하라" 4패턴**(§15.4)이다.
특히 패턴 1(*"결함이 아니라 의도된 설계"*)과 패턴 4(*"지나간 접근의 부활"*)가
**정확히 §A3 이 막으려는 것**이며, 자동 트리아지 스위퍼가 읽는 **기계 가독 규범**으로도 쓰인다.

> **결정 17(ADR 발행 연기)과 정합한다.** ADR 이 없는 동안에도 재유입은 막아야 하고,
> Hermes 는 그 자리를 **개발 가이드 문서의 거절 루브릭**으로 채웠다. SoloSquad 의
> `AGENTS.md` 는 현재 **구조·경로·컨벤션**만 담고 **거절 기준**이 없다 —
> §A3 의 실질적 해법은 ADR 을 기다리는 것이 아니라 `AGENTS.md` 에 거절 루브릭 절을 여는 것일 수 있다.

### 16.6 🟢 Footprint Ladder ↔ SoloSquad primitive 5종

Hermes 의 사다리(§15.2)와 SoloSquad 의 primitive 5종은 **거의 같은 문제를 푼다.**

| Hermes 사다리 | SoloSquad 대응 | 비고 |
|---|---|---|
| 1. 기존 코드 확장 | — | |
| 2. **CLI 명령 + 스킬** | **`skills/`** | Hermes 의 *기본 선택*. SoloSquad 도 v1.3.6 에서 스킬 작성법을 내재화 |
| 3. 서비스 게이트 도구 | `dev_capability` 등 조건부 능력 | |
| 4. 플러그인 | (없음) | |
| 5. MCP 서버 | (v2.x) | |
| 6. **새 코어 도구** | **하네스 도구** | 최후 수단 |

> **차용 권고** — SoloSquad 는 primitive 5종(skill/agent/workflow/goal/cron)의 **선택 기준**이
> 문서에 없다. Hermes 의 사다리 형식(*"올바르게 푸는 가장 발자국 작은 단"*)을 빌려
> **"언제 skill 이고 언제 agent 이고 언제 workflow 인가"** 를 1개 표로 박제하면,
> v1.3.6~1.3.7 이 내재화한 작성법 위에 **선택법**이 얹힌다.

---

## 17. 미확인 · 후속 조사 대상

1. **`tools/async_delegation.py`(1,515줄) 미독파** — 백그라운드 위임 단위의 join·통합 결과
   재진입 메커니즘. `[3] 실행` 설계 시 재조사 가치 있음
2. **`agent/context_engine.py`(489줄) 미독파** — 컨텍스트 조립의 실제 진입점.
   SoloSquad 8-layer JIT 과의 대조가 §D1 에 직접 입력
3. **`agent/curator.py` / `agent/trajectory.py`** — v0.6 이 차용한 trajectory→skill 자동 요약의
   **현재 형태**. 2026-05 조사 이후 3개월 경과분 미확인
4. **이슈 #344 하위 4건**(#356·#375·#376·#377) — 워크플로 DAG·체크포인팅·에이전트 역할의
   **구현 여부**. 우산 이슈는 closed 지만 실제 머지 상태 미확인.
   현 `config_defaults.py` 에 DAG 관련 키가 없는 것으로 보아 **Kanban 이 그 자리를 대신 가져간 것**으로
   추정되나 미검증
5. **`gateway/session.py`(~1,444줄) · `gateway/run.py`(~16,800줄) 원문** — 본 조사는
   `docs/session-lifecycle.md` 를 통해 읽었고, 그 문서에서 **기본값 모순 1건**(§5.3)이 발견된 만큼
   중요 판단 전에는 원문 대조 필요

---

## 부록 A. 기본값 요약표 (조사 시점 main)

```yaml
# 위임
delegation:
  max_concurrent_children: 3      # 배치 병렬 + 백그라운드 단위 통합 캡, 초과 시 거부→동기 폴백
  max_spawn_depth: 1              # 평면. 2 이상이면 orchestrator 중첩
  orchestrator_enabled: true      # 전역 킬 스위치
  max_iterations: 50              # 자식별 독립
  child_timeout_seconds: 0        # 무제한 (하트비트가 대체)
  max_summary_chars: 24000
  subagent_auto_approve: false    # → auto-deny
  inherit_mcp_toolsets: true

guardrails.loop_caps:
  max_subagents: 50               # 턴당, 매 턴 리셋
  max_web_searches: 50

# 세션
session_reset: {mode: none, at_hour: 4, idle_minutes: 1440, notify: true}
group_sessions_per_user: true     # 그룹 = 사용자별 격리
thread_sessions_per_user: false   # 스레드 = 공유
max_live_sessions: 16
max_concurrent_sessions: null
agent:
  max_turns: 500
  gateway_timeout: 1800
  agent_cache: {max_size: 128, idle_ttl_secs: 3600, memory_high_mb: auto,
                max_evictions_per_pass: 16, protect_recent: 8}

# 컨텍스트
compression:
  enabled: true
  threshold: 0.50                 # 컨텍스트 사용률
  target_ratio: 0.20
  protect_first_n: 3
  protect_last_n: 20
  min_tail_user_messages: 1
  max_attempts: 3
  micro_compact: false            # opt-in
  micro_compact_defrag_threshold_tokens: 2000
  in_place: true

# Kanban
kanban:
  dispatch_in_gateway: true       # 단일 소유자
  dispatch_interval_seconds: 60
  auto_decompose: true
  auto_decompose_per_tick: 3
  failure_limit: 2
  dispatch_stale_timeout_seconds: 14400
  reconcile_orphans: true

# 보조 LLM
auxiliary:
  transient_retries: 2
  free_only: false
  <slot>: {provider: auto, model: "", base_url: "", api_key: "",
           timeout: N, extra_body: {}, reasoning_effort: ""}
  # 슬롯: vision · web_extract · compression · skills_hub · approval · mcp ·
  #       title_generation · memory_query_rewrite · tts_audio_tags ·
  #       triage_specifier · kanban_decompose
```

## 부록 B. 하트비트·타임아웃 상수

| 상수 | 값 | 의미 |
|---|---:|---|
| `_HEARTBEAT_INTERVAL` | 30s | 위임 중 부모 activity 갱신 주기 |
| `_HEARTBEAT_STALE_CYCLES_IDLE` | 15 (=450s) | 턴 사이 유휴 → stale |
| `_HEARTBEAT_STALE_CYCLES_IN_TOOL` | 40 (=1200s) | 같은 도구 고착 → stale |
| 만료 워처 주기 | 300s | 파이널라이즈·스윕·프룬 |
| `suspend_recently_active` 창 | 120s | 크래시 시 복구 대상 판정 |
| 고착 루프 임계 | 3회 연속 재시작 | → `suspended` 하드 와이프 |
| 만료 파이널라이즈 재시도 | 3회 | 초과 시 강제 마킹 |

---

## 참조

- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — 본 조사의 유일한 1차 소스
- [issue #344 — Multi-Agent Architecture (umbrella, closed)](https://github.com/NousResearch/hermes-agent/issues/344)
- [issue #413 — Cross-CLI Agent Orchestration](https://github.com/NousResearch/hermes-agent/issues/413)
- 관련 사내 문서 — [[260803-solosquad-architecture-redesign]] §0.0.7(미결 대장) · §B1 · §C1 · §C3 · §D2 ·
  [[260514-harness-pattern-adoption]] · [[260605-ochestrator-session]] ·
  `docs/trend-record/2026-05-11-baseline-survey.md` §3(Hermes 1차 조사, 3개월 전)
