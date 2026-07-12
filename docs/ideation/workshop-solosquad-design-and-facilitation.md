# SoloSquad 워크샵 — 설계 의도 해설 + 진행 안내 (발표자/진행자용)

> **이 문서의 위치.** 참가자용 개요는 [`workshop-solosquad-description.md`](./workshop-solosquad-description.md)다.
> 본 문서는 그 짝이 되는 **발표자/진행자용**으로, 두 가지를 한다:
>
> 1. **Part A — 설계 의도 해설.** "왜 이렇게 만들었나"를 *개발자 1인칭*으로 풀어,
>    발표자가 각 결정의 의도·트레이드오프·반증 조건을 그대로 말할 수 있게 한다.
> 2. **Part B — 진행 안내 + 실습 템플릿.** 온보딩 → workflow → cron → 메신저 연결 →
>    클라우드 배포를 90~120분 안에 굴리는 run sheet 와, *주제를 못 정한 참가자*용 복붙
>    템플릿.
>
> **근거.** 구조·기능 서술은 **v1.3.11 코드/문서 직독**, 클라우드 배포·헬스알림은
> **v1.3.12 PRD**(`docs/prd/v1.3.12_docker-cloud-deploy-and-health-notify.md`) 기준.
> 명령어는 `src/cli/` 직독으로 검증했고 file:line 을 병기한다. 본 문서는 교보재(ideation)이며
> 확정 PRD 가 아니다.
>
> **1인칭 표기 규약.** "나는 ~하려 했다 / 의도는 ~" 는 *개발자(SoloSquad 저자)*의 목소리다.
> 발표 시 그대로 인용해도 되도록 적었다.

---

## 목차

**Part A — 설계 의도 해설**
- A1. 문제정의 프레임워크 — 무엇을·왜 그렇게 구성했나
- A2. 기본 구조/기능 — 워크스페이스·멀티 repo·cwd·메모리·기획 워크플로우의 설계 의도
- A3. OpenClaw / Hermes Agent 대비 — 24/7 설계에서 무엇이 다른가
- A4. PM Skills / gstack 대비 — 기획 방법의 차별점과 가치
- A5. AI 기획 에이전트의 한계와, 그걸 극복하려고 넣은 설계
- A6. 트러블슈팅 — 용어 정의·배포/마이그레이션 규칙·오케스트레이션 개념(agent/workflow·main/sub)

**Part B — 워크샵 진행 안내**
- B1. 진행 개요 (타임테이블 90/120분)
- B2. 온보딩 실습 (`init` → `doctor` → `bot`)
- B3. 메신저 연결 실습 (Discord)
- B4. workflow 실습 (기획 1패스)
- B5. cron 실습 (매일 아침 브리프)
- B6. 클라우드 배포 실습 (Railway, v1.3.12)
- B7. 주제 못 정한 참가자용 템플릿 (복붙)
- B8. 흔한 막힘과 처치 (진행자 치트시트)

**부록**
- 부록 A — AI 에이전트 기본 개념·용어 사전 (토폴로지·메모리·세션·agent vs workflow·라우터·
  HITL·에스컬레이션·퀄리티 게이트·프롬프트/컨텍스트/하네스/루프 엔지니어링 …)
- 부록 B — 최신 에이전트 기술 트렌드·사례 (2026-06-26 확인, 1차 출처 + 신뢰도 등급)

---

# Part A — 설계 의도 해설

## A1. 문제정의 프레임워크 — 무엇을·왜 그렇게 구성했나

### A1.1 "출력기계"가 아니라 "루프"로 만든 이유

내가 SoloSquad 의 코어 철학을 한 줄로 박은 건 이거다 (`AGENTS.md` §Core Philosophy):

```
Output ≠ Goal. Output = Means to achieve the goal.
```

대부분의 사람은 LLM 에게 "PRD 써줘"라고 한 번 묻고 결과를 받는다. **나는 그걸 의도적으로
거부했다.** 한 장의 산출물은 목표가 아니라 목표를 향한 *수단*일 뿐이고, 기획은 본질적으로
"한 번 묻고 닫는 대화"가 아니라 *검증-반증을 반복하는 루프*이기 때문이다. 그래서 문제정의를
"프롬프트 한 줄"이 아니라 **강제된 절차(프레임워크)**로 박제했다.

### A1.2 RO-PNA 6-Phase 를 골격으로 쓴 의도

골격은 RO-PNA PMF 게임의 6-Phase 다:

```
P1. SCQA    Situation·Complication·Question·Answer 추출
P2. 5-Whys  근본 원인 1문장
P3. MECE    후행/선행 문제 분해
P4. TDCC    후행지표·선행문제·기회·인과·미지
P5. XYZ     검증 가능한 가설 (X%의 Y가 T안에 Z, 왜냐 R)
P6. 1-pager PRD synthesis (요구사항 taxonomy + review gate)
```

**왜 이 프레임워크였나.** "감"이 아니라 *반증 가능한 가설*까지 끌고 가는 절차여서다. P5 의
XYZ 형식("X%의 Y가 T 안에 Z 한다, 왜냐하면 R")은 측정 가능하고 틀릴 수 있게 만든다 — 이게
기획 에이전트가 단독 LLM 과 갈리는 결정적 지점이다.

### A1.3 "모놀리식 → 레고블록"으로 해체한 의도 (v1.3.5~1.3.7)

초판에서 나는 6-Phase 를 **단일 `problem-definition` 스킬**(6단계를 한 덩이로 쥔 체인)으로
만들었다. **이게 실수였다.** 부분 재사용이 안 됐다 — "개선 기획"이나 "데이터 분석" 맥락에서
SCQA 만, 5-Whys 만 꺼내 쓸 수가 없었다.

그래서 v1.3.7 에서 **"workflow essence" 원칙**으로 쪼갰다:

> **목표 + 근거 + 방법 → 결론 → handoff** 가 있는 다단계면 → **workflow**.
> "그냥 행위"인 단일 사고도구면 → **skill**.

이 기준으로 재배치한 결과:
- `scqa` · `five-whys` · `tdcc` → **workflow 로 승격**(독립 호출·합성 가능)
- `mece` · `xyz-hypothesis` → **skill 로 유지**

**의도:** 6-Phase 를 "강제된 한 줄 순서"에서, Chief 가 맥락에 맞춰 *조립하는 레고 블록*으로
바꾸는 것. 그래서 진입점도 모놀리식 5종을 전부 retire 하고 **2 main + 9 sub
(Workflow-of-Workflows)**로 재편했다:
- `new-build` (main): `idea-refinement`(또는 입력이 구체적이면 `requirements-analysis`로
  교체) → `market-research` → `hypothesis`
- `improvement` (main): `kpi-check` → `data-analysis` → `hypothesis`

### A1.4 "4규약"을 장식에서 하중부담으로 올린 의도 (v1.3.6)

프레임워크의 진짜 알맹이는 6-Phase 순서가 아니라, 워크플로우가 **강제하는 4가지 규약**
(`pm_conventions`)이다. v1.3.6 에서 나는 이걸 *주석 같은 장식*에서 **validator 가 파싱·강제하는
정식 필드(load-bearing)**로 승격시켰다:

| 규약 | 의미 | 내가 이걸 강제한 이유 |
|---|---|---|
| **anti_sycophancy** | 가설은 *"입장 + 반증 조건"* 형식 강제 | LLM 의 기본값은 아첨이다. "X 라 판단, Y 가 사실이면 입장 바뀜"을 강제해야 반증 가능해진다 |
| **hard_gate** | P1 4필드·P2 ≥3단계·P4 5필드·confidence ≥60 미달 시 다음 단계 차단 | 어설픈 기획이 통과해서 다음 단계를 오염시키는 걸 막는다 |
| **post_labeling** | 프레임워크를 *선처방* 안 하고, 자연스러운 사고를 사후에 명명 | 도구가 사고를 가두면 안 된다 (RO-PNA 원칙①) |
| **minimum_approaches: 2** | 최소 2개 접근 비교 | 단일안 확증편향 방지 |

그리고 못 푼 건 추측으로 메우지 않고 **`open_questions[]`** 에 `{question, blocking}` 으로
적어 비동기로 사용자에게 묻게 했다(spec-kit `/clarify` 와 동형). **의도:** "모른다"를 정직하게
드러내는 게 기획 품질의 일부다.

> **발표 한 줄(A1):** "나는 기획을 *프롬프트*가 아니라 *반증을 강제하는 구조*로 만들었다.
> 프레임워크가 RO-PNA 일 필요는 없다 — 핵심은 ⑴ 반증조건 ⑵ 하드게이트 ⑶ 사후라벨링 ⑷ 복수접근을
> validator 로 박제하고, ⑸ 재사용·합성 가능한 작은 조각으로 쪼개는 것이다."

---

## A2. 기본 구조/기능 — 설계 의도와 중요하게 고려한 점

### A2.1 워크스페이스 3계층 — "무엇을 어디에 둘지"의 토폴로지

```
Layer 0: Workspace / Universal   ← 나라는 사람 · 보편 자산 (도구 무관)
Layer 1: Organization (<org>/)   ← 사업/프로젝트 1개 단위
Layer 2: Repository              ← 실제 제품 코드 (org 디렉토리 밖!)
```

**내가 3계층으로 나눈 의도 — 세 가지 질문에 답하려고:**

1. **"나"는 한 번만 적게 한다 (Layer 0).** 톤·선호·의사결정 원칙은 프로젝트마다 반복하면
   안 된다. `user/voice.md` 한 곳에 적고, 새 사업을 시작해도 그대로 상속된다.
2. **사업은 격리한다 (Layer 1).** org 마다 `core/`·`domain/`·`memory/` 가 분리돼야
   "본업"과 "사이드 프로젝트"의 결정·시그널이 섞이지 않는다 (n잡 시나리오).
3. **코드는 복사하지 않는다 (Layer 2).** 이게 A2.2 의 핵심 — 워크스페이스는 ~50MB config
   폴더로 남고, 실제 코드는 사용자의 원래 dev 트리에 그대로 산다.

**스폰 시점 컨텍스트 조립(8-layer JIT).** 에이전트가 깨어날 때 8개 레이어를 우선순위 순으로
주입하고, `max_context_tokens`(기본 80000) 도달 시 **낮은 우선순위부터 drop** 하며 그 결정을
`memory/spawn-decisions.jsonl` 에 기록한다. agent identity·org core·agent-profile 는 절대
drop 하지 않는다.

> **내가 중요하게 본 점:** "모든 걸 한 프롬프트에" 욱여넣으면 컨텍스트가 폭증한다. 무엇을
> 영속(L0)·무엇을 사업별(L1)·무엇을 JIT 주입할지 *먼저 나누는 게* 폭증을 막는 유일한 구조적
> 답이다.

### A2.2 멀티 리포지토리 — 통합 작업을 가능케 한 5개 결정

"1인 창업자가 메신저로 AI 팀을 부려 여러 repo 를 넘나드는 통합 작업을 시킨다" — 이게 내가
지향한 그림이다. 그걸 위해 내린 5개 설계 결정:

**(1) repo 는 "복사"가 아니라 "경로 참조" (Model B).**
`<org>/repositories/<slug>.yaml` 에 `path: /abs/경로` 만 적고 실제 코드는 외부 절대경로에
그대로 둔다. `resolveRepoCwd` 가 slug→절대경로를 푼다. → **이유는 A6.3 의 피봇 스토리.** 초기엔
repo 를 워크스페이스 *안에* 강제했다가 솔로 사용자 4 시나리오가 전부 깨져서 갈아엎었다.

**(2) cwd 와 디렉토리 노출 = `--add-dir`.**
SoloSquad 는 Agent SDK 가 아니라 **Claude Code 를 child process 로 띄운다**(`claude --print`).
그래서 repo 접근은 `--add-dir` 노선이 정답이다. Chief 대화는 org 의 전 repo 를 `--add-dir`
로 노출한다(`collectRegisteredRepoPaths`). 스폰되는 Claude 의 cwd 와, 그 프로세스가 *닿을 수
있는* 디렉토리는 별개 문제다 — 이 구분을 놓쳐서 v1.2.6 에서 사고가 났다(A6.3 참조).

**(3) 매니페스트 주입 — "디렉토리만 추가한다고 멀티 repo 가 아니다".**
`--add-dir` 는 *파일 접근*만 준다. 에이전트는 **무슨 repo 가 있고 무슨 역할인지**도 알아야
통합 작업을 한다. 그래서 `repositories/*.yaml`(slug·role·path)를 "repo 매니페스트"로 프롬프트에
주입한다. (VS Code multi-root 가 디렉토리만 주고 매니페스트를 안 줘서 멀티 repo 추론에 실패한
것이 반면교사다.)

**(4) 지정 문법 — "비우면 전체, 적으면 그것들".**
`@slug` 멘션을 `[target_repo:<s>]`/`[target_repos:<a>,<b>]` 마커로 변환한다
(`src/bot/mention-parser.ts`, **LLM 호출 0회**). 라우팅에 LLM 을 안 쓴 건 의도다 — 결정적이고
비용 0 이어야 하는 부분에 모델을 끼우지 않았다.

**(5) 메모리는 org 공유, 코드 컨벤션은 repo 파일.**
`<org>/memory/*.jsonl` 은 org 단위 공유 브레인이다. 통합 작업에서 결정·시그널이 repo 경계를
넘으므로 공유가 맞다. 반대로 repo-로컬 지식은 각 repo 의 AGENTS.md/CLAUDE.md 가 담당한다.

### A2.3 메모리 — hot/cold 2층으로 나눈 의도

메모리는 **hot(JSONL append) + cold(FTS5 archive, 365일)** 2층이다. 단계 간 상태 공유는
*실시간 채팅/벡터DB 가 아니라* 버전관리되는 `memory/decisions.jsonl` + `_handoff.md` 로 넘긴다.

**내가 벡터DB 를 안 쓴 이유:** GitHub Squad 의 "드롭박스" 패턴(라이브 동기화 대신 버전관리되는
`decisions.md` 에 append)과 같은 결론에 도달했다. 솔로 규모에서 기획 에이전트의 상태 공유는
**버전관리되는 마크다운/JSONL 이 정답**이다 — diff 로 볼 수 있고, git 으로 되돌릴 수 있고,
인프라가 0 이다.

### A2.4 기획 워크플로우 설계 — workflow/goal/cron 의 역할 분담

기획을 실행하는 "오케스트레이터"는 3종이고, 나는 이걸 *같은 추상의 세 변종*으로 설계했다:

| primitive | 정체 | 언제 쓰나 (내 의도) |
|---|---|---|
| **workflow** | 결정적 다단계 체인 (stage DAG) | 순서·의존이 명시되고 재현돼야 할 때 (기획 1패스) |
| **goal** | 자율-반복 cycle (metric 수렴) | 무인 반복으로 지표를 수렴시킬 때 |
| **cron** | 정기 자동 실행 | org 횡단 관측(주로 읽기)을 정시에 |

셋 다 **agent(행위자 WHO) + skill(방법 HOW)** 을 조립해 일한다. (goal = 자율-반복 workflow.)
이 분리가 핵심이다 — 같은 skill·agent 라이브러리 위에서 결정적/반복/정시 세 방식으로 조립된다.

> **발표 한 줄(A2):** "내 설계의 일관된 의도는 *소유하지 않고 얹는다*다. 코드를 복사하지 않고
> (경로참조), 라우팅에 모델을 안 끼우고(0회), 상태를 벡터DB 가 아니라 git 으로 관리한다. 솔로
> 규모에선 절제가 곧 차별성이다."

---

## A3. OpenClaw / Hermes Agent 대비 — 24/7 설계에서 무엇이 다른가

레퍼런스를 볼 때 내가 던진 질문은 항상 같았다: **"이걸 통째로 쓸까"가 아니라 "내 사용자(=솔로)
맥락에 이 결정의 트레이드오프가 맞나"**. 그래서 *차용/거절*을 명시적으로 갈랐다.

### A3.1 OpenClaw — 하네스/cron UX (차용) vs 삭제 디폴트 (거절)

| | 차용 (adopt) | 거절 (reject) |
|---|---|---|
| **무엇** | `update`/`doctor` CLI + npm 배포, cron lifecycle UX(create/edit/start-stop/delete) | "전체 삭제 디폴트" 안티패턴 (Issue #6289) |

**내 cron 설계:** OpenClaw + Hermes 의 cron UX 를 참조해 `cron new/edit/enable/disable/
delete/run/runs` 전 라이프사이클 + dead-man's-switch + one-shot 까지 갖췄다. **하지만
uninstall 은 삭제가 아니라 farewell archive(WAL-safe SQLite backup)가 디폴트**다 — OpenClaw 가
uninstall 시 전체 삭제를 디폴트로 둬서 비복구 데이터를 날린 걸 반면교사로 삼았다.

### A3.2 Hermes Agent — 메모리 아키텍처 (차용) vs 샌드박스 격리 (거절)

| | 차용 (adopt) | 거절 (reject) |
|---|---|---|
| **무엇** | hot+cold FTS5 메모리, trajectory→skill 자동 요약, WAL-safe SQLite backup | **모델 C (Hermes sandbox)** — 격리 샌드박스 teammate |

**내가 샌드박스를 거절한 이유:** 솔로 founder 에겐 오버스펙이다. 대신 **IDE 옆 direct
working-tree + dev-confirm 게이트**(Codex 패턴)를 택했다 — 솔로는 에이전트 커밋을 *실시간으로
보는 게* 자연스럽기 때문이다. (multi-user/cloud 로 진화하면 v2.x 슬롯에서 재검토하도록 박제해뒀다.)

### A3.3 24/7 설계에서 결정적으로 다른 점 (v1.3.12 헬스알림)

24/7 자율 cron 은 4종을 빌트인으로 둔다: 아침 브리프 · 저녁 브리프 · Chief compaction(23:00) ·
system-housekeeping(00:00). 여기까지는 업계 공통이다. **내가 다르게 간 지점은 "봇이 죽으면
어떻게 아느냐"다.**

v1.3.12 에서 나는 **heartbeat + watchdog** 모델을 넣었다
(`docs/prd/v1.3.12_docker-cloud-deploy-and-health-notify.md` §6.3):
- 봇이 **turn-독립적 `setInterval`(30s)**로 `<workspace>/.solosquad/bot.heartbeat` 에 타임스탬프를 쓴다.
- cron 데몬 안의 watchdog 가 staleness 를 폴링한다: `now - mtime > 120s` 면 `🔴 Bot no response`
  를 Discord `#status` 채널에 게시한다.
- 부팅 시 `🟢 online`, SIGTERM drain 시 `🟡 draining` 을 announce.

**왜 외부 uptime 모니터(B)나 process-manager 훅(C)을 거절했나:**
- 외부 모니터(B)는 *대화 채널*에 안 닿는다 — 보통 이메일/웹훅으로 빠진다. 사용자는 메신저를
  보고 있는데 거기로 안 온다.
- systemd `OnFailure`(C)는 VPS 전용이다 — Docker/Railway 엔 없다.
- **heartbeat+watchdog 는 Railway/Docker/VPS 어디서나 동작하고(portable), 메신저에 직접
  닿고, 새 인그레스 포트가 필요 없다.**

**내가 가장 신경 쓴 한 가지 — false positive 방지:** 5분짜리 긴 Chief 턴이 *오경보를 내면 안
된다*. 그래서 heartbeat 를 turn-end 가 아니라 **turn-독립 setInterval** 로 박았다(턴이 멈춰도
계속 틱). 임계값은 3×주기+마진(30s 주기 → 120s 임계). "5분 턴이 watchdog 를 통과한다"가 hard
gate 테스트다.

> **발표 한 줄(A3):** "차별성은 더 많은 기능이 아니라 *분별*이다. OpenClaw 의 cron UX 는
> 차용하되 삭제 디폴트는 거절, Hermes 의 메모리는 차용하되 샌드박스는 거절. 그리고 24/7 의
> 진짜 빈틈인 *봇이 조용히 죽는 문제*를, 외부 모니터가 아니라 메신저에 직접 닿는 heartbeat 로
> 메웠다."

---

## A4. PM Skills / gstack 대비 — 기획 방법의 차별점과 가치

### A4.1 gstack (Garry Tan) — Six Forcing Questions

**특징:** PMF 진입 전 6항목 자가검증 — Demand Reality(관심 ≠ 수요) · Status Quo(진짜 경쟁자) ·
Desperate Specificity · Narrowest Wedge · Observation & Surprise · Future-Fit. 슬래시 체인으로
연결된다.

**내가 차용한 것:** 이 6개 질문을 **PMF 진입 게이트**로 그대로 들였다 — 컨텍스트로 답할 수
있어야 통과, 아니면 회귀.

**내가 다르게 한 것:** gstack 은 사람이 슬래시로 *순차 호출*하는 체인이다. 나는 이걸 Chief 가
**맥락 추론으로 진입**하고, hard_gate 가 *통과 못 하면 자동 회귀*시키는 구조로 바꿨다. 사람이
"다음 단계 호출"을 기억할 필요가 없다.

### A4.2 phuryn/pm-skills — auto-load + slash 듀얼 트리거

**특징:** PM 스킬을 auto-load 와 슬래시 둘 다로 트리거.

**내가 차용한 것:** 스킬을 "절차 지식"으로 박제하는 발상.

**내가 다르게 한 것 — 세 가지가 핵심 가치다:**

1. **validator 강제.** pm-skills 는 스킬을 *제공*한다. 나는 스킬이 지켜야 할 규약
   (anti-sycophancy·hard_gate·post-labeling·복수접근)을 **validator 가 파싱·강제**하게 했다
   (v1.3.6). 즉 "좋은 기획 절차"가 권고가 아니라 *통과 못 하면 막히는 게이트*다.
2. **작성 표준의 내재화(manager-as-authority).** "무엇이 좋은 primitive 인가"의 ~70% 공통
   표준을 `skills/skill-core/primitive-core.md` 에 두고, 5개 manager(skill/agent/workflow/
   goal/cron)가 이걸 참조하는 **작성 권한**을 갖는다. + **anti-reskin originality gate**
   (8-word shingle, FAIL≥40%)로 "이름만 바꾼 복제 스킬"을 거른다.
3. **상주성.** pm-skills 는 IDE 안의 스킬이다. SoloSquad 의 스킬은 **메신저에 상주하는 팀**이
   24/7 cron 으로 호출한다 — 사람이 칠 때만 동작하는 게 아니다.

> **발표 한 줄(A4):** "gstack·pm-skills 는 *좋은 질문/스킬*을 준다. 내가 더한 가치는 그걸
> ⑴ validator 로 강제하고 ⑵ 작성 표준을 내재화해 품질을 자가검증하고 ⑶ 메신저에 상주시켜
> 사람 없이도 돌게 한 것이다. *방법*이 아니라 *방법을 강제하는 시스템*이 차별점이다."

---

## A5. AI 기획 에이전트의 한계와, 그걸 극복하려고 넣은 설계

기획 에이전트를 만들며 내가 *가장 무서워한 실패 모드*들과, 각각에 대해 넣은 방어막:

| 내가 본 한계 (실패 모드) | 극복하려고 넣은 설계 |
|---|---|
| **아첨(sycophancy)** — LLM 은 사용자가 듣고 싶은 말을 한다 | `anti_sycophancy` 규약: 가설은 *"입장 + 반증 조건"* 형식 강제. validator 가 검사 |
| **어설픈 기획의 전파** — 부실한 P1 이 다음 단계를 오염 | `hard_gate`: 필드 수·confidence ≥60 미달 시 다음 단계 진입 차단 |
| **도구가 사고를 가둠** — 프레임워크 선처방이 자유로운 사고를 막음 | `post_labeling`: 프레임워크는 사후 명명만. 먼저 생각하고 나중에 라벨 |
| **확증편향** — 단일안을 정당화 | `minimum_approaches: 2` 강제 |
| **추측으로 빈칸 메우기** — 모르는 걸 그럴듯하게 지어냄 | `open_questions[]`: 못 푼 건 `{question, blocking}` 으로 모아 비동기 질문 |
| **컨텍스트 폭증** — 다 넣으면 토큰이 터진다 | 8-layer JIT + 우선순위 drop + spawn-decision 로그 |
| **무한재귀** — 워크플로우가 서로를 호출하다 폭주 | cycle/depth guard (v1.3.5) |
| **Goodhart** — 지표를 최적화하다 목표를 잃음 | goal validator 가 metric provenance·termination·Goodhart guardrail 검사 (v1.3.7) |
| **무인 쓰기의 위험** — cron/goal 이 사람 없이 코드를 망가뜨림 | dev-confirm 게이트 + `modifiable_paths` 화이트리스트 + author-guard. cron 기본은 *읽기* |
| **봇이 조용히 죽음** — 24/7 인데 죽은 줄 모름 | heartbeat + watchdog → MTTA ≤120s (A3.3, v1.3.12) |
| **비가역 배포 사고** — `npm publish`/uninstall 은 되돌릴 수 없다 | pre-publish docs 게이트(6-doc) + `--dry-run` 강제 + uninstall=archive 디폴트 |

> **발표 한 줄(A5):** "AI 기획 에이전트의 한계는 대부분 *모델이 그럴듯하게 틀리는 것*이다.
> 내 방어막의 공통 원리는 ⑴ 틀릴 수 있게 만들고(반증조건) ⑵ 틀린 채 전파 못 하게 막고
> (하드게이트) ⑶ 모르는 걸 정직하게 드러내고(open_questions) ⑷ 비가역 행동 앞엔 자동 게이트를
> 세우는 것이다."

---

## A6. 트러블슈팅 — 용어·배포/마이그레이션·오케스트레이션 개념

### A6.1 용어/이름 정의 — "어휘 부채는 기능 부채만큼 비싸다"

내가 실제로 갈아엎은 네이밍 피봇:
- **routine + schedule → cron** (v1.3.3): built-in 은 *routine*, 사용자 작성은 *schedule* 로
  불러 혼란. 하나의 명사 **cron** 으로 통일.
- **asset → primitive** (v1.3.6~7): 5종 통칭을 *asset* 으로 부르니 외부 "에셋"과 충돌. 
  **primitive**(skill·agent·workflow·goal·cron)로 통일. 곁들여 `workflow-maker →
  workflow-manager`, `asset-review → primitive-review`, `skill-core/core.md →
  primitive-core.md`.
- **CLI 입구 정리:** `solosquad asset …` 는 deprecate(v2.0 제거 예정), 명사 없는 top-level
  **`solosquad validate [kind]`** 로 승격.

> **교훈(내 원칙):** 같은 개념엔 같은 이름. 어휘가 흔들리면 사용자도 코드도 헷갈린다.

### A6.2 배포/마이그레이션 규칙 — "비가역 작업 앞엔 자동 게이트"

**npm 0.9.0 burn 사고가 이 규칙의 출발점이다.** v0.9.0 을 publish 직후 unpublish 했지만 npm
time 객체에 *영구 기록*돼, 사용 가능한 첫 버전이 v0.9.1 부터가 됐다. `npm publish` 는 비가역이다.

그래서 내가 세운 규칙:
- **pre-publish docs 게이트.** `npm run docs-check` 가 `prepublishOnly` 에서 강제. v1.3.8 에서
  4→6 으로 확장: roadmap·architecture·CHANGELOG·README 필수 + manual 조건부 + **PRD 존재 +
  `docs/`-leak invariant** (`scripts/check-docs-freshness.ts`).
- **마이그레이션은 dry-run 디폴트.** `solosquad migrate` 는 `--dry-run` 이 기본, `--apply`
  해야 실제 적용. `--rollback`·백업 보관도 있다.
- **번들 자산은 사용자 자산과 격리.** 그래서 squad 재편(4팀/25→5팀/19, v1.3.6) 같은 대형
  리네임도 **마이그레이션 없이 minor 로 ship** 할 수 있었다 — 번들 actor 이름이 org-layer
  사용자 actor 와 안 섞이기 때문.
- **uninstall = archive 디폴트** (A3.1).

> **릴리스 워크플로우(내 운영 규칙):** 준비 시 tag·push 까지 자동으로, 단 `npm publish` 는
> *사람의 행위*로 남긴다(비가역이라). "배포했어" 신호 후 PR 머지.

### A6.3 오케스트레이션 구조/개념 — agent vs workflow, 그리고 main/sub

이건 워크샵에서 가장 헷갈려하는 부분이라 개념을 명확히 정의해뒀다.

**(1) 오케스트레이션 위계.**
```
사용자 ↔ 메신저 (#command-<handle>)
        ▼
   Chief (core 팀 · 유일한 user-facing 오케스트레이터)
        │  Claude Code 네이티브 Task 툴로 위임
        ▼
   4 팀 supervisor (main): product-manager · engineer · business-strategy · marketer
        ▼
   specialist × 14 (product 3 · engineering 7 · business 2 · brand 2)
```

**(2) agent vs workflow — WHO vs HOW·WHEN.** 내가 둘을 가른 기준:
- **agent** = *행위자(WHO)*. 전문 페르소나 + 위임 그래프. skill 을 *쓰고*, 다른 agent·workflow
  를 호출한다.
- **workflow / goal / cron** = *오케스트레이터(HOW·WHEN)*. agent 와 skill 을 **조립**해
  일한다. 같은 추상의 세 변종 — 결정적(workflow) / 반복(goal) / 정시(cron).
- **skill** = *방법(HOW)*. 재사용 절차 지식.

호출은 **양방향**이다: agent 가 workflow 를 부를 수도, workflow 의 stage 가 agent 를 부를 수도.

**(3) main vs sub — "타입이 아니라 호출 위치다".** 이게 내가 의도적으로 잡은 개념이고, 가장
자주 오해받는다:
- workflow 가 *다른 workflow 안에서* 불리면 → **sub-workflow**. 단독 실행하면 같은 게 **main**.
- agent 가 *다른 agent 가 스폰하면* → **sub-agent**. 단독이면 main.
- 즉 `scqa` 는 `new-build` 안에선 sub 지만, 사용자가 직접 호출하면 main 이다.

**왜 이렇게 정의했나:** main/sub 를 *고정 타입*으로 박으면 재사용이 막힌다. "호출 위치로 결정"
하면 같은 primitive 가 단독으로도, 조립 부품으로도 쓰인다 — 이게 Workflow-of-Workflows
(A1.3)를 가능케 한 개념적 토대다.

**(4) repo scope 규칙(공통).** workflow=stage별 `target_repos` · cron=`repos:`(기본 전체) —
**모두 비우면 전 repo, 적으면 그 repo**. (A2.2-(4)의 `@slug` 라우팅과 같은 원칙.)

> **관통 패턴(내 디버깅 루프):** 모든 피봇은 ⑴ dogfood 로 발견 → ⑵ 레퍼런스 비교로 방향 결정
> → ⑶ 마이그레이션 + 회귀 테스트로 안전 이행 → ⑷ CHANGELOG/ideation 에 *거절 사유까지* 박제.
> 6개월 뒤의 나(또는 다음 에이전트)가 같은 길을 다시 파지 않게.

---

# Part B — 워크샵 진행 안내

## B1. 진행 개요 (타임테이블)

> **성공 기준 (참가자에게 먼저 선언):** 데모가 아니라 *내일 아침 메신저에 브리프가 떠 있는
> 것*. 상주하는 파트너의 최소 증거.

**MVP 목표:** **skill 1개(절차) + cron 1개(매일 신호 요약)** = 충분히 "상주 파트너". agent/
workflow/goal 은 작업이 복잡해지면 추가.

### 90분 코스 (로컬 중심)
| 시간 | 블록 | 산출물 |
|---|---|---|
| 0–10 | B1 전제 공유 (Part A1 의 "Output ≠ Goal") | — |
| 10–25 | B2 온보딩 (`init`→`doctor`) | 워크스페이스 + 첫 org |
| 25–40 | B3 메신저 연결 (Discord) | `#command`·`#works` 채널 |
| 40–60 | B4 기획 1패스 (메신저에서 "이 아이디어 기획해줘") | 1-pager PRD + `open_questions[]` |
| 60–75 | B5 cron 1개 (`cron new --at`) | 다음날 아침 브리프 예약 |
| 75–90 | B8 회고 — "무엇을 *거절*할지" (Part A3 방식) | 거절 결정 박제 |

### 120분 코스 (클라우드 배포 포함)
위 90분 + **90–120: B6 Railway 클라우드 배포** (24/7 상주 + 헬스알림).

---

## B2. 온보딩 실습 (`init` → `doctor` → `bot`)

**캐노니컬 first-run 시퀀스** (`src/cli/index.ts`):

```bash
# 1) 8-step 대화형 위저드: 워크스페이스+org+repo+메신저까지 한 번에
solosquad init          # src/cli/init.ts:794

# 2) 진단 — 모든 체크 통과 확인
solosquad doctor        # src/cli/doctor.ts ; --discord 로 Discord 5-hop 집중 진단
solosquad doctor --discord

# 3) 봇 시작 (자동 재기동 래퍼 권장)
solosquad bot --supervise   # src/cli/index.ts:84

# 4) (별도 프로세스) cron 데몬
solosquad cron start    # ※ 구 `solosquad schedule` (v1.3.3 개명) — 옛 문서 보면 헷갈림 주의

# 5) 확인
solosquad status
solosquad chat "안녕"   # 터미널에서 Chief 와 대화 테스트
```

**`init` 이 만드는 것 (8 step):** `.solosquad/workspace.yaml`, `.solosquad/.env`(토큰),
번들 디렉토리(agents/skills/teams/crons/knowledge/user), `<org>/.org.yaml`,
`<org>/repositories/<slug>.yaml`(repo 등록 시), 사용자 식별 `.solosquad/users/<handle>.yaml`,
Discord invite URL.

**repo 경로참조 등록 (기존 프로젝트 폴더에서):**
```bash
solosquad add repo                 # cwd 가 git repo 면 자동 인식 (src/cli/add-repo.ts:164)
solosquad add repo /abs/path --org <slug>
# → <org>/repositories/<slug>.yaml 에 path: 만 기록. 복사 안 됨을 보여줄 것 (Part A2.2-(1))
```

> **진행자 포인트:** `add repo` 후 워크스페이스 폴더 크기를 보여줘라(~수십 MB). "코드는 복사
> 안 된다"는 Model B 의 핵심을 *눈으로* 확인시키는 게 이 실습의 알맹이다.

---

## B3. 메신저 연결 실습 (Discord)

`init` 의 **Step 3.5** 에서 토큰을 받지만, 워크샵에선 미리 봇을 만들어 오게 하면 빠르다.

**사전 준비 (참가자 숙제로):**
1. Discord Developer Portal → New Application
2. Bot → Reset Token → 토큰 복사 (`.env` 의 `DISCORD_TOKEN`)
3. Privileged Gateway Intents → **MESSAGE CONTENT 활성화** (이거 안 켜면 메시지 못 읽음 — 1순위 막힘)
4. 권한: View Channels · Send Messages · Read Message History · Create Public Threads

**연결:**
```bash
# init 도중 자동으로 받거나, 사후에 invite URL 생성:
solosquad discord invite-url        # src/cli/discord.ts:36 ; --print-only 로 URL만
solosquad doctor --discord          # 5-hop 진단으로 연결 검증
```

**생성되는 채널** (`deriveChannelNames()`):
- `#command-<handle>` — 오너 전용 명령 채널 (여기에 말 건다)
- `#works-<handle>` — 백그라운드 결과(브리프·워크플로우 산출물) 배달 채널

> **진행자 포인트:** 메신저 연결의 가치는 "코드를 안 봐도 운영된다(conversation-only)"는 것.
> `#command` 에 한국어로 말 걸어보게 하라.

---

## B4. workflow 실습 — 기획 1패스

`#command-<handle>` 에 자연어로:
```
이 아이디어 기획해줘: <참가자 아이디어 한 줄>
```

**관찰 포인트 (참가자에게 짚어줄 것):**
1. Chief 가 **명확화 질문(≤2)** 을 던진다 → answer.
2. `new-build` 워크플로우 진입 → `idea-refinement`(또는 구체적이면 `requirements-analysis`)
   → `market-research` → `hypothesis`.
3. `hard_gate` 가 부실 단계를 막는 걸 관찰 (confidence ≥60).
4. **`open_questions[]`** 이 어떻게 비동기 질문으로 돌아오는지 관찰 (Part A1.4).
5. 결과(1-pager PRD)는 `#works-<handle>` 로 배달.

**CLI 로 상태 보기:**
```bash
solosquad workflow list
solosquad workflow show <id> --events 8     # src/cli/workflow.ts
```

> **진행자 포인트:** "가설"이 *XYZ 형식(X%의 Y가 T안에 Z, 왜냐 R)*으로 나오는지 보여줘라.
> 단독 LLM 의 "좋은 생각이네요"와 *반증 가능한 가설*의 차이가 여기서 드러난다 (Part A1.2).

---

## B5. cron 실습 — 매일 아침 신호 요약

```bash
# 매일 아침 8시 브리프 (한 번에 끝나는 게 아니라 매일 반복)
solosquad cron new daily-signal --cron "0 8 * * *" --kind user-brief
#   ↑ src/cli/cron.ts:156 ; --at "20m" 면 20분 뒤 1회 실행(데모용 즉시 확인)
#   생성물: <org>/crons/daily-signal.yaml + .md (프롬프트 본문은 사용자가 채움)

solosquad cron show daily-signal
solosquad cron run daily-signal        # 지금 즉시 실행해 결과를 #works 로 확인
solosquad cron list
```

**워크샵 데모 팁:** `--cron "0 8 * * *"` 는 내일 아침까지 기다려야 하니, 데모는
`--at "2m"`(2분 뒤 1회) 로 만들어 `#works-<handle>` 에 뜨는 걸 즉석 확인시키고, 진짜 매일
브리프는 위 cron 으로 따로 만들게 하라.

**cron 본문(`.md`) 채우기 — 4규약을 넣는 자리:** 아침 브리프 프롬프트에 "추측 금지, 못 푼 건
open_questions 로", "입장+반증조건" 을 명시하면 Part A1.4 규약이 cron 에도 적용된다.

> **성공 신호:** 다음날 아침 `#works-<handle>` 에 브리프가 떠 있으면 = "상주하는 파트너"의
> 최소 증거 달성 (B1 성공 기준).

---

## B6. 클라우드 배포 실습 — Railway (v1.3.12, 120분 코스)

> 로컬은 Mac 만 24/7 가능하다. 나머지 참가자가 *진짜 상주*를 보려면 클라우드가 필요하다.
> v1.3.12 는 **Railway 를 1순위(Option A)** 로 잡았다 — GitHub 연동 1-click, VPC/IAM 복잡도
> 없음, `$5/월 선불(Hobby) + 사용량`으로 비용이 투명. (GCP=비용 불투명, VPS=OS 하드닝 부담,
> serverless=Discord 게이트웨이 WebSocket 이 sleep 에서 못 깸 → 전부 거절.)

**배포 절차 (Approach A):**
```bash
# 1) README/manual 의 "Deploy on Railway" 버튼 → GitHub OAuth → 프로젝트 생성

# 2) Railway 대시보드에서 env 설정
railway variables set MESSENGER=discord
railway variables set DISCORD_TOKEN=<token>
railway variables set ANTHROPIC_API_KEY=<key>
railway variables set OWNER_NAME=YourName
railway variables set TZ=Asia/Seoul
railway variables set NODE_OPTIONS=--max-old-space-size=1024   # 비용/메모리 캡

# 3) 컨테이너 접속해 대화형 init 1회
railway ssh
solosquad init        # (※ 현재 init 은 대화형 — SSH 1스텝 필요. 비대화형 --yes 는 차기 minor)
exit

# 4) Railway 가 bot + cron 두 서비스를 자동 기동
```

**Railway 아키텍처:**
```
GitHub repo → Railway project
   ├── bot service   (solosquad bot)
   ├── cron service  (solosquad cron start)   ← 구 `schedule` 아님 주의
   └── volume (/workspace: agents/ .solosquad/ memory/ 영속)
```

**헬스알림 확인 (v1.3.12 의 자랑거리):** 배포 후 `#status` 채널에 `🟢 online` 이 뜬다.
봇을 강제 종료(`kill -9`)하면 **120초 내** `🔴 Bot no response (heartbeat … stale)` 가
같은 채널에 뜬다. 긴 작업(5분 턴)에도 오경보가 안 나는지 보여주면 Part A3.3 의 설계 의도가
체감된다.

> **진행자 주의:** v1.3.12 시점에 `docker-compose.yml`·매뉴얼 일부에 **구 `solosquad
> schedule`** 잔재가 남아 있을 수 있다(PRD 가 수정 대상으로 명시). 참가자가 그 문서를 보면
> `solosquad cron start` 로 바꿔 말해줘라.

---

## B7. 주제 못 정한 참가자용 템플릿 (복붙)

> 90분 안에 "내 도메인 절차"를 못 정하는 참가자가 항상 있다. 아래 3개 중 하나를 그대로
> 복붙해 출발시키면 멈추지 않는다.

### 템플릿 ① — "매일 아침 경쟁/시장 신호 브리프" (가장 안전, 누구나)
`#command` 에:
```
매일 아침 8시에, 내 사업 "<한 줄 설명>" 과 관련된 어제의 시장/경쟁 신호를 3개 이하로
요약해줘. 규칙: (1) 추측을 사실로 적지 말 것, 못 찾으면 "확인 안 됨". (2) 각 신호는
"이게 우리한테 의미하는 바 1문장 + 그게 틀렸다고 볼 조건 1문장" 형식. (3) 예상 밖 발견
1개 이상 포함.
```
→ 그대로 `cron new daily-signal --cron "0 8 * * *" --kind user-brief` 의 `.md` 본문으로.

### 템플릿 ② — "내 도메인 기획 스킬 1개" (skill 박제 실습)
`#command` 에:
```
내 반복 작업 "<예: 신규 기능 결정, 콘텐츠 기획, 고객 인터뷰 정리>" 를 SKILL 로 만들어줘.
pm_conventions 4규약 다 넣어: anti_sycophancy(입장+반증조건), hard_gate(필수필드 미달 시
중단), post_labeling(사후 명명), minimum_approaches=2. 못 푸는 건 open_questions[] 로.
```
→ Chief→skill-manager 가 `SKILL.md` 작성. `solosquad validate skill` 로 검증.

### 템플릿 ③ — "한 줄 아이디어 → 기획 1패스" (workflow 실습)
`#command` 에:
```
이 아이디어 기획해줘: "<한 줄>". 명확화 질문은 2개까지만. 가설은 XYZ 형식
(X%의 Y가 T안에 Z, 왜냐 R)으로 끝내줘.
```
→ `new-build` 진입, 1-pager PRD + open_questions 관찰 (B4 와 동일).

> **선택 가이드(진행자가 1문장으로):** "아직 사업이 흐릿하면 ①, 반복 작업이 있으면 ②,
> 구체적 아이디어가 하나 있으면 ③."

---

## B8. 흔한 막힘과 처치 (진행자 치트시트)

| 증상 | 원인 | 처치 |
|---|---|---|
| 봇이 메시지를 못 읽음 | Discord **MESSAGE CONTENT intent** 미활성 | Developer Portal → Bot → Privileged Intents 켜기 |
| `add-dir`/외부 repo 못 읽음 | Claude trust 가 working-dir 까지 안 감 / stream-json 호환 / Windows 개행 | v1.3.10~11 에서 수정됨 — 최신 버전 확인. `solosquad update` |
| `solosquad schedule` 가 unknown command | v1.3.3 에서 `cron start` 로 개명 | `solosquad cron start` 로 |
| cron 결과가 안 옴 | 채널이 `#workflow`(없음)로 잘못 가리킴(구버전) | v1.3.4+ 는 `#works-<handle>`. 최신화 |
| Railway 배포 후 봇 안 뜸 | env 미설정 / init 미실행 | `railway ssh` → `solosquad init` 1회 |
| 비용 걱정 | always-on RAM 이 주 비용 | `NODE_OPTIONS=--max-old-space-size=1024` 캡 |
| init 멈춤(클라우드) | init 이 대화형이라 SSH 필요 | `railway ssh` 안에서 실행 (비대화형 `--yes` 는 차기 minor) |
| 진단 한 방 | — | `solosquad doctor` / `solosquad doctor --discord` |

> **진행자 폐회 멘트(Part A 회수):** "오늘 만든 건 PRD 생성기가 아니다. **구조(워크스페이스)
> + 기억(메모리) + 절차(워크플로우) + 분업(오케스트레이션)** 네 기둥이 모여 *상주하는 파트너*가
> 됐다. 집에 가서 ⑴ 무엇을 영속·사업별·JIT 로 나눌지, ⑵ 무엇을 *거절*할지 — 이 둘만 정하면
> 자기만의 기획 에이전트가 시작된다."

---

# 부록 A — AI 에이전트 기본 개념·용어 사전

> **용법.** 각 용어를 ⑴ *업계 정의*로 먼저 설명하고 ⑵ **(SoloSquad)** 표시로 이 프로젝트가
> 그 개념을 어떻게 구현했는지 매핑한다. 개념 교육과 케이스 스터디를 한 자리에서 잇는 게
> 워크샵의 교수법이다. 정의의 1차 근거는 부록 B 의 Anthropic/LangChain 출처다.

## A. 컨텍스트 계열 — "무엇을 모델에 넣는가"

**프롬프트 엔지니어링 (prompt engineering)** — LLM 에 주는 *지시문*을 최적으로 쓰고 구성하는
일. 단일 호출의 입력 문장을 다듬는 좁은 작업.

**컨텍스트 엔지니어링 (context engineering)** — *추론 중* 모델에 들어가는 **토큰 집합 전체를
큐레이션·유지**하는 일(시스템 프롬프트·도구·메모리·외부 데이터 모두 포함). 다중 턴·장기 작업의
핵심으로, 업계의 무게중심이 "프롬프트 작성"에서 "컨텍스트 상태 관리"로 이동했다.
**(SoloSquad)** 8-layer JIT 주입 + 우선순위 drop 이 정확히 이 작업이다 (A2.1).

**컨텍스트 윈도우 (context window)** — 모델이 한 번에 볼 수 있는 토큰 한도.
**(SoloSquad)** `max_context_tokens`(기본 80000)로 관리하고 초과 시 낮은 우선순위부터 버린다.

**컨텍스트 부패 (context rot)** — 토큰이 늘수록 모델의 정확한 회상이 *저하*되는 현상
(트랜스포머의 n² 토큰쌍 관계에서 기인). "많이 넣을수록 좋다"가 틀린 이유.
**(SoloSquad)** "가능한 한 작은 고신호 토큰 집합" 원칙으로 모든 걸 욱여넣지 않는다.

**압축 (compaction)** — 대화 이력을 요약·재초기화해 컨텍스트를 비우되 핵심(결정·미해결
버그·구현 세부)은 보존하는 기법. **(SoloSquad)** 빌트인 cron `chief-compaction`(23:00)이
완료된 워크플로우를 외부화하고 Chief 세션을 압축한다.

**Just-in-time(JIT) 컨텍스트** — 모든 데이터를 사전 로드하지 않고 *경량 식별자*(파일 경로·
쿼리·링크)만 들고 있다가 런타임에 도구로 동적 로드하는 방식("점진적 공개"). **(SoloSquad)**
repo 를 복사하지 않고 `path:` 참조만 갖는 Model B(A2.2) + 스폰 시점 조립이 이 사상이다.

**하네스 엔지니어링 (harness engineering)** — LLM *바깥*의 스캐폴딩(상태 인계·세션 분리·도구·
루프·게이트)을 설계하는 일. 모델은 그대로 두고 *그 주위 구조*로 능력을 끌어올린다.
**(SoloSquad)** 프로젝트 전체가 "Claude Code 를 child process 로 띄우고 그 위에 입힌 하네스"
라는 정의(§6 description) 자체다.

**루프 엔지니어링 (loop engineering)** — 에이전트의 *반복 구조*(언제 다시 돌고, 언제 멈추고,
무엇을 누적하는지)를 설계하는 일. find→verify→synthesize, loop-until-dry, evaluator-optimizer
같은 패턴. **(SoloSquad)** goal 의 cycle loop(metric 2연속 keep→수렴)과 workflow 의 stage
DAG + cycle/depth guard 가 루프 설계물이다.

## B. 구조 계열 — "누가 어떻게 배치되는가"

**토폴로지 (topology)** — 에이전트·팀·컨텍스트가 *어떻게 배치되고 연결되는지*의 구조.
두 층위가 있다: ⑴ *컨텍스트 토폴로지*(무엇을 어디 두나) ⑵ *행위자 토폴로지*(누가 누구에게
위임하나). **(SoloSquad)** ⑴ = 워크스페이스 3계층(A2.1), ⑵ = Chief→4 supervisor→14
specialist(A6.3).

**세션 (session)** — 에이전트의 한 *생애*(컨텍스트 윈도우 하나의 수명). 닫히면 휘발하는 게
기본. 장기 작업은 세션을 *넘어* 상태를 인계해야 한다. **(SoloSquad)** Chief 세션은 org 단위로
영속되고, `_handoff.md` + `decisions.jsonl` 로 세션 경계를 넘어 상태를 넘긴다. `chief reset`/
`chief compact` 로 세션 수명을 관리.

**메모리 (memory)** — 컨텍스트 윈도우 *밖*의 지속 저장. 업계 표준 3종 스코프:
- *episodic*(특정 과거 상호작용) · *semantic*(사실·선호) · *procedural*(학습된 행동·규칙).
- 저장 방식 논쟁: **벡터DB vs 파일/마크다운**(부록 B-4). **(SoloSquad)** hot JSONL +
  cold FTS5 archive, 그리고 상태 공유는 *버전관리되는 마크다운/JSONL*("드롭박스" 패턴, A2.3)
  — 벡터DB 를 의도적으로 안 썼다.

**에이전트 vs 워크플로우 (agent vs workflow)** — Anthropic 정의: **워크플로우** = LLM·도구가
*사전 정의된 코드 경로*로 오케스트레이션되는 시스템(결정적). **에이전트** = LLM 이 *자신의
프로세스를 스스로 동적으로 지시*하는 시스템(자율적). 차이는 자율성의 정도다. **(SoloSquad)**
workflow primitive(stage DAG, 결정적) vs agent primitive(페르소나+위임, 자율) 구분이 이
정의를 그대로 따른다 (A6.3-(2)).

**라우터 (router)** — 입력을 *분류해* 전문화된 후속 경로로 보내는 컴포넌트(Anthropic 5대
워크플로우 패턴 중 "routing"). 관심사 분리가 목적. **(SoloSquad)** ⑴ `mention-parser` 가
`@slug`→repo 라우팅(LLM 0회, 결정적), ⑵ Chief TRIAGE 가 chat/workflow/cron/goal 로 분류.
라우팅에 모델을 안 끼운 부분(멘션)과 끼운 부분(triage)을 의도적으로 갈랐다.

**서브에이전트 (sub-agent)** — 오케스트레이터가 스폰하는 *격리된 컨텍스트*의 하위 에이전트.
집중 작업 후 **응축된 요약(보통 1–2K 토큰)만** 반환해 상위 컨텍스트를 아낀다. **(SoloSquad)**
Chief 가 Task 툴로 specialist 를 스폰하고, 각자 `_handoff.md` 요약만 넘긴다.

**핸드오프 (handoff)** — 에이전트가 컨텍스트·제어권을 다음 에이전트에 *명시적으로 넘기는*
행위(OpenAI Agents SDK 의 핵심 추상). **(SoloSquad)** Handoff Protocol — 완료 시
`_handoff.md`(Summary·Artifacts·Key Decisions·Context·Open Questions)를 써서 인계.

**메인 vs 서브 (main vs sub)** — 타입이 아니라 *호출 위치*. 단독 실행하면 main, 다른
오케스트레이터 안에서 불리면 sub. **(SoloSquad)** `scqa` 는 `new-build` 안에선 sub-workflow,
직접 호출하면 main (A6.3-(3)). 이 정의가 Workflow-of-Workflows 를 가능케 한다.

## C. 제어·안전 계열 — "어떻게 통제하는가"

**HITL (Human-in-the-Loop)** — 에이전트 실행을 *일시정지*시키고 사람의 결정을 받는 패턴.
LangChain 의 4가지 옵션: ① approve(승인) ② edit(수정 후 실행) ③ reject(피드백과 거부)
④ respond(질문에 응답). LangGraph 는 `interrupt()`로 실행을 멈추고 checkpointer 에 상태를
저장했다가 `Command(resume=...)`로 재개. **(SoloSquad)** dev-confirm 게이트 + 파괴적 CRUD
"적용 전 확인" + 명확화 질문(≤2)이 HITL 구현이다. 메신저가 곧 interrupt 채널.

**에스컬레이션 (escalation)** — 에이전트가 *스스로 풀 수 없는* 사안을 상위(사람 또는 상위
에이전트)로 올리는 것. **(SoloSquad)** ⑴ 모델→사람: 컨텍스트로 못 푸는 항목을 `open_questions[]`
로 모아 비동기 질문(A1.4). ⑵ 하위→상위 에이전트: specialist 가 Chief 로 결과를 합성 보고.
추측으로 빈칸을 메우는 대신 *정직하게 위로 올리는* 게 설계 의도.

**퀄리티 게이트 / 평가자 (quality gate / evaluator)** — 산출물이 기준을 넘어야 다음으로
보내는 검문소. 대표 패턴 **evaluator-optimizer**(한 LLM 이 생성, 다른 LLM 이 평가 피드백을
루프). **LLM-as-judge** 모범사례는 "차원별로 격리된 judge 로 채점"(한 judge 가 전부 채점 X).
**(SoloSquad)** ⑴ `hard_gate`(필드 수·confidence ≥60 미달 시 차단) ⑵ validator 의
anti-reskin originality gate ⑶ goal validator 의 Goodhart guardrail. 워크플로우의 4규약
자체가 박제된 퀄리티 게이트다 (A1.4, A5).

**가드레일 (guardrails)** — LLM 입출력을 가로채 안전 검사·정책을 적용하는 층(NeMo Guardrails,
Guardrails AI). 모더레이션·jailbreak/injection 탐지. **(SoloSquad)** `modifiable_paths`
화이트리스트 + author-guard + cron 기본 읽기 전용이 솔로 규모의 경량 가드레일.

## D. 표준·기법 계열

**도구 사용 (tool use / function calling)** — 모델이 외부 함수를 호출해 행동(검색·파일 IO·
API)하는 능력. 에이전트의 손발. **(SoloSquad)** `--add-dir` 파일 접근 + CLI 명령이 도구면.

**MCP (Model Context Protocol)** — 모델/에이전트를 외부 도구·데이터에 연결하는 *개방 표준*
("AI 연결의 USB-C"). 2025-12 Linux Foundation 산하 재단에 기부돼 업계 공통 인프라가 됨
(부록 B-8). **(SoloSquad)** 본 워크스페이스도 다수 MCP 서버(Sanity·Figma·Notion 등)에
ToolSearch 로 접근한다.

**ReAct / Reflexion** — 추론-행동을 교차하거나(ReAct), 실패를 자기성찰해 다음 시도를 고치는
(Reflexion) 에이전트 플래닝 계보. "피드백 있는 플래닝"의 대표. **(SoloSquad)** RO-PNA 의
기대-현실 비교 + 예상밖 발견(원칙③④)과 post-labeling 이 같은 결의 자기성찰 루프.

**Spec-Driven Development (SDD)** — "vibes 가 아니라 spec 으로" — 구현 전에 명세→명확화→계획→
태스크를 산출물로 고정하는 방법론(GitHub spec-kit, AWS Kiro). **(SoloSquad)** 기획 워크플로우가
PRD 산출 + `open_questions[]` 명확화로 같은 사상을 따른다(spec-kit `/clarify` 와 동형).

> **발표 한 줄(부록 A):** "이 용어들은 추상론이 아니다. SoloSquad 의 *모든* 설계 결정이 이 중
> 하나의 구현이다 — 토폴로지는 3계층, 메모리는 드롭박스, 퀄리티 게이트는 hard_gate, HITL 은
> 메신저. 용어를 배우는 가장 빠른 길은 '내 시스템에선 이게 어디 있나'를 찾는 것이다."

---

# 부록 B — 최신 에이전트 기술 트렌드·사례 (2026-06-26 확인)

> **신뢰도 표기.** ✅ 1차 출처(공식 repo/문서/엔지니어링 블로그/논문, 안심 인용) · ⚠️ 2차 출처
> (교차검증 권장) · ❓ 확인 안 됨(인용 시 1차 재확인 필수). 본 문서 품질 규칙(§9.3 description:
> 1차 출처 + 캡처 일시, 추측을 사실로 표기 금지)을 준수한다.

## B-1. 패러다임 전환 — "프롬프트"에서 "컨텍스트·하네스"로 (✅)

업계 무게중심이 *프롬프트 엔지니어링*에서 **컨텍스트 엔지니어링**으로 이동했다 — 추론 중
토큰 집합 전체를 큐레이션하는 것. 장기 작업의 3대 기법은 **compaction**(이력 요약·재초기화),
**structured note-taking**(컨텍스트 밖 영속 메모), **sub-agent**(격리 컨텍스트→1–2K 요약만
반환)다. `context rot`(토큰↑→회상↓) 때문에 "작고 고신호인 토큰 집합"이 원칙.
- Anthropic, *Effective context engineering for AI agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, *Effective harnesses for long-running agents*(2단계 구조: 초기화+코딩 에이전트, `claude-progress.txt`+git 으로 상태 인계) — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- **(SoloSquad 좌표)** 3기법 모두 구현됨: compaction=빌트인 cron, note-taking=memory JSONL,
  sub-agent=Task 위임. "하네스" 정의 자체가 프로젝트 정체성.

## B-2. 오케스트레이션 프레임워크 지형 — 그래프 vs 핸드오프 (✅ 패턴 / ⚠️ 버전)

두 지배 패턴: **그래프 기반**(LangGraph — 상태기계로 분기·복구 정밀 제어) vs **핸드오프 기반**
(OpenAI Agents SDK — 에이전트가 제어권을 명시 이양). CrewAI=역할 기반 crew, AutoGen/AG2=대화
기반. Anthropic **Claude Agent SDK**(2025-09 Claude Code SDK→개명, 코딩 전용 아님 명확화)는
서브에이전트를 기본 지원.
- Anthropic, *Building agents with the Claude Agent SDK*(✅) — https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
- 프레임워크 비교(⚠️ 2차) — https://composio.dev/content/openai-agents-sdk-vs-langgraph-vs-autogen-vs-crewai
- ❓ **확인 안 됨**: LangGraph/AutoGen/CrewAI 구체 GA 버전·날짜, Google ADK 1차 자료.
- **(SoloSquad 좌표)** 프레임워크를 *쓰지 않고* Claude Code 를 child process 로 띄우는 노선 —
  Anthropic 의 "프레임워크는 추상화로 디버깅을 어렵게 한다, API 직접 사용으로 시작하라" 조언과 정합.

## B-3. 에이전트 vs 워크플로우 — 5대 패턴 (✅, 강한 1차)

Anthropic *Building Effective Agents* 의 분류가 사실상 표준 어휘가 됐다: **워크플로우**(사전
정의 코드 경로) vs **에이전트**(LLM 자기 지시). 5대 워크플로우 패턴: ⑴ prompt chaining
⑵ routing ⑶ parallelization(sectioning/voting) ⑷ orchestrator-workers ⑸ evaluator-optimizer.
- https://www.anthropic.com/research/building-effective-agents
- **(SoloSquad 좌표)** primitive 의 workflow/goal/cron = "오케스트레이터" 3변종이 이 패턴들의
  구체화(workflow=chaining+orchestrator-workers, goal=evaluator-optimizer 루프, routing=Chief TRIAGE).

## B-4. 메모리 아키텍처 — 파일 vs 벡터 논쟁 (✅)

표준 3종 스코프(episodic/semantic/procedural). **Letta(구 MemGPT)** 는 OS 메모리 영감의 3계층
(core=RAM / archival=벡터 디스크 / recall=이력). 주목할 1차 벤치: **Letta "Is a Filesystem
All You Need?"** — 단순 *파일* 저장이 LoCoMo **74.0%** 로 Mem0 그래프 메모리 **68.5%** 를
능가. 주장: "성공은 검색 정교함이 아니라 *도구를 잘 쓰는지*에 달렸다, 단순 도구가 학습데이터에
많아 더 잘 쓰인다."
- https://www.letta.com/blog/benchmarking-ai-agent-memory/ (✅)
- 메모리 스코프/Letta 계층 정리(⚠️ 2차) — https://vectorize.io/articles/mem0-vs-letta
- **(SoloSquad 좌표)** 이 벤치가 SoloSquad 의 "벡터DB 대신 버전관리 마크다운/JSONL" 결정을
  사후 정당화한다(A2.3) — 정교한 검색보다 *git 으로 보이고 되돌릴 수 있는* 단순함을 택함.

## B-5. 멀티에이전트 — 언제 득이고 언제 독인가 (✅, 강한 1차)

Anthropic 멀티에이전트 리서치 시스템(orchestrator-worker): Opus 리드+Sonnet 서브 구성이 단일
Opus 대비 **+90.2%**(내부 평가). **비용: 일반 챗 대비 ~15배 토큰**, 토큰량이 성능 분산의 **80%**
설명. **핵심 단서:** "에이전트들이 *같은 컨텍스트를 공유*해야 하거나 *의존성이 많은* 도메인은
오늘날 멀티에이전트에 부적합 — 체인 의존 워크플로우는 단일 에이전트/결정론 파이프라인이 우세."
- https://www.anthropic.com/engineering/multi-agent-research-system
- **(SoloSquad 좌표)** 이 단서가 설계를 직접 가른다: 기획의 *순차 의존* 단계는 결정적
  **workflow**(단일 파이프라인)로, *독립 탐색*은 병렬 서브에이전트로 — 무지성 멀티에이전트화를
  피한 근거.

## B-6. HITL·퀄리티 게이트 실무 (✅)

**HITL** — LangChain 미들웨어 4옵션(approve/edit/reject/respond) + LangGraph `interrupt()`/
`Command(resume)` + 영속 checkpointer. **퀄리티 게이트** — evaluator-optimizer(Anthropic
cookbook 노트북 존재) + LLM-as-judge "차원별 격리 채점" 모범사례. **가드레일** — NVIDIA NeMo
Guardrails(프로그래머블, jailbreak/injection 탐지).
- LangChain HITL — https://docs.langchain.com/oss/python/langchain/human-in-the-loop · interrupt 블로그 https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt
- Anthropic *Demystifying evals*(LLM-as-judge 차원별 격리) — https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents · cookbook https://github.com/anthropics/anthropic-cookbook/blob/main/patterns/agents/evaluator_optimizer.ipynb
- NeMo Guardrails — https://github.com/NVIDIA-NeMo/Guardrails (❓ "오버헤드 40%↓" 등 일부 수치는 2차만, 확인 안 됨)
- **(SoloSquad 좌표)** Chief 의 명확화 질문=interrupt, hard_gate=evaluator gate, dev-confirm=approve 옵션.

## B-7. 24/7 백그라운드 에이전트 출시 현황 + AI 기획/PM 도구·SDD

**백그라운드 코딩 에이전트(2025–2026):**
- OpenAI **Codex** 클라우드 에이전트(✅ 2025-05-16, 격리 샌드박스 병렬 실행) — https://openai.com/index/introducing-codex/
- GitHub **Copilot coding agent** GA(✅ 이슈 할당→PR) — https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/
- Cognition **Devin 2.0**(⚠️ 2025-04, $500→$20/월, Interactive Planning) — https://docs.devin.ai/get-started/devin-intro
- Anthropic **Claude Code 자율화**(✅ 2025-09-29: Checkpoints/`/rewind`·Subagents·Hooks·Background tasks) — https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously
- **Agent Skills 오픈 표준**(✅ 지시문·스크립트·리소스 폴더를 동적 발견/로딩) — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- **Claude Code 스케줄링 3종**(✅ 공식 docs, code.claude.com — *직접 경쟁 레퍼런스*):
  - **`/loop`**(세션 스코프, GA, v2.1.72+) — 고정 간격(`/loop 5m …`) 또는 *self-paced*(1분~1시간
    중 Claude 가 매 반복 조건 보고 자가 결정). 현재 대화에 상주, recurring 은 7일 후 만료, `--resume`
    복원. — https://code.claude.com/docs/en/scheduled-tasks
  - **Cloud Routines**(✅ **research preview**) — 프롬프트+repo+커넥터를 저장해 Anthropic 클라우드에서
    무인 실행(랩톱 꺼져도). 트리거: schedule(최소 1시간)/API 엔드포인트/GitHub 이벤트. `/schedule`
    또는 `claude.ai/code/routines`. — https://code.claude.com/docs/en/routines
  - **Desktop scheduled tasks**(✅ 로컬, 앱 열려 있을 때, 최소 1분, 로컬 파일 접근) — https://code.claude.com/docs/en/desktop-scheduled-tasks

**AI 기획/PM 도구 + Spec-Driven Development:**
- Anthropic 공식 **PM 스킬 플러그인**(⚠️ 기능은 2차 경유: write-spec/synthesize-research/
  metrics-review 등 6스킬) — https://snyk.io/articles/7-claude-skills-product-managers/
- 오픈소스 **Product-Manager-Skills**(✅ repo) — https://github.com/deanpeters/Product-Manager-Skills
- **GitHub Spec Kit**(✅ constitution→specify→clarify→plan→tasks→implement, 30+ 에이전트 지원) — https://github.com/github/spec-kit
- **AWS Kiro**(✅ 에이전트형 IDE, EARS 수용기준, spec→design→tasks) — https://kiro.dev/docs/specs/
- ❓ "Gartner 2026 PM 70% AI 의존" 등 수치는 원출처 미확인.
- **(SoloSquad 좌표)** 24/7 백그라운드는 cron+goal 로, PM 스킬은 planning 계열 19 skill 로,
  SDD 는 기획 workflow+PRD+open_questions 로 이미 구현 — 다만 **솔로 1인·메신저 상주·org 영속**
  이라는 *조합*이 차별점(부록 B 의 어떤 단일 제품도 이 셋을 함께 주지 않음).
- **(차용/거절 — Claude Code 스케줄링 대비, A3 와 같은 결):** Claude Code 의 `/loop` self-paced
  와 Cloud Routines(무인·클라우드 실행)는 SoloSquad cron/goal 과 *수렴*하는 발상이다. **차용:**
  self-pacing·무인 클라우드 실행·GitHub 이벤트 트리거는 SoloSquad cron 의 진화 방향과 같다
  (v1.3.12 Railway 가 이미 그쪽). **거절/차별:** Claude Code 의 셋은 *세션/개인 개발자* 단위이고
  배달이 터미널·웹이다. SoloSquad 는 **org 영속 + 메신저(`#works-<handle>`) 배달 + heartbeat
  알림**으로 "코드 안 보는 솔로 창업자"에 맞췄다 — 같은 cron 기능도 *누구에게·어디로* 가 다르다.

## B-8. MCP 표준화 (✅)

**Model Context Protocol** = 에이전트↔외부 도구/데이터 개방 표준. **2025-12 Anthropic 이
Linux Foundation 산하 Agentic AI Foundation(AAIF)에 기부**(Block·OpenAI 공동 창립) → 단일
벤더 프로토콜에서 업계 공통 인프라로 전환. OpenAI(2025-03)·Google DeepMind(2025-04) 채택.
- https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
- ❓ "월 다운로드 9,700만/서버 1만+" 채택 규모 통계는 2차만 — 1차 재확인 권장.
- **(SoloSquad 좌표)** primitive(skill/agent) 라이브러리는 MCP 와 *상보적* — MCP 가 외부 연결
  표준이면, primitive 는 그 위에서 "좋은 절차·페르소나"를 박제하는 워크스페이스 표준.

## 트렌드 종합 — SoloSquad 의 좌표 한 장

| 트렌드 (2026) | 업계 방향 | SoloSquad 의 선택 |
|---|---|---|
| 프롬프트→컨텍스트·하네스 | 토큰 큐레이션·compaction·sub-agent | 8-layer JIT + 빌트인 compaction + Task 위임 (정합) |
| 그래프 vs 핸드오프 SDK | 프레임워크 채택 | 프레임워크 *비채택*, Claude Code child process (절제) |
| 멀티에이전트 | 강력하나 ~15배 비용 | 순차 의존=단일 workflow, 독립=병렬 (선별 적용) |
| 메모리 | 벡터/그래프 정교화 | 파일/JSONL 드롭박스 (Letta 벤치가 사후 지지) |
| HITL·게이트 | interrupt·LLM-judge·가드레일 | 메신저 interrupt + hard_gate + dev-confirm |
| 24/7 백그라운드 | 코딩 에이전트 클라우드화 | cron/goal + Railway 배포 + heartbeat 알림 (v1.3.12) |
| SDD·PM 스킬 | spec-kit·Kiro·PM 플러그인 | 기획 workflow+PRD+open_questions, 19 planning skill |

> **발표 한 줄(부록 B):** "SoloSquad 는 트렌드를 *발명*하지 않았다 — 컨텍스트 엔지니어링·
> 멀티에이전트·HITL·SDD 는 다 업계 흐름이다. 차별성은 이것들을 **솔로 1인 창업자가 메신저로
> 부리는 영속 팀**이라는 하나의 조합으로 *절제해서* 묶은 것이다. 어떤 단일 제품도 이 조합을
> 통째로 주지 않는다."

---

## Sources

**참가자용 짝 문서**
- `docs/ideation/workshop-solosquad-description.md` — 참가자용 개요(본 문서의 짝)

**내부 1차 (직독)**
- `AGENTS.md` — Core Philosophy, 3-Layer Context, 8-layer JIT spawn, Handoff Protocol
- `docs/prd/v1.3.12_docker-cloud-deploy-and-health-notify.md` — Railway 배포 + heartbeat/
  watchdog 헬스알림(§2/§6.1~6.5/§8)
- `src/cli/init.ts:794` · `src/cli/doctor.ts` · `src/cli/add-repo.ts:125` · `src/cli/cron.ts:98`
  · `src/cli/workflow.ts` · `src/cli/discord.ts:36` · `src/cli/index.ts` — CLI 명령 surface
- `skills/skill-core/primitive-core.md` — primitive 작성 표준 + pm_conventions 4규약
- `src/cron/crons.ts` — 빌트인 cron 4종 ; `src/bot/goal-validate.ts` — goal validator
- `CHANGELOG.md` — v0.9(Model B 피봇·npm burn), v1.2.6(trust working-dir), v1.3.3(cron 통일),
  v1.3.6~7(primitive·squad 재편·authoring), v1.3.10~11(--add-dir hotfix)
- `.claude/rules/git-workflow.md` — pre-publish docs 게이트(4→6 확장)

**외부 레퍼런스 (`README.md` References)**
- OpenClaw — cron lifecycle UX(차용) / 전체삭제 디폴트 #6289(거절)
- Hermes Agent (Nous Research) — hot+cold FTS5 메모리(차용) / sandbox 모델(거절)
- gstack (Garry Tan) — Six Forcing Questions
- phuryn/pm-skills — auto-load + slash 듀얼 트리거
- RO-PNA/pna-builders — PMF 6-Phase·5대 원칙
- github/spec-kit — specify→clarify→tasks (open_questions 정합)

**부록 B 트렌드 1차 출처 (2026-06-26 확인 — 상세 URL·신뢰도 등급은 부록 B 본문 각 항목)**
- Anthropic Engineering — *Building Effective Agents*, *Effective context engineering*,
  *Effective harnesses for long-running agents*, *Multi-agent research system*,
  *Demystifying evals*, *Building agents with the Claude Agent SDK*, *Agent Skills*
- Anthropic News — *Enabling Claude Code to work more autonomously*(2025-09-29),
  *Donating MCP / Agentic AI Foundation*(2025-12)
- Claude Code docs(code.claude.com) — *Scheduled tasks `/loop`*(GA), *Routines*(research
  preview, cloud), *Desktop scheduled tasks*(local) — 직접 경쟁 스케줄링 레퍼런스(부록 B-7)
- LangChain/LangGraph docs — Human-in-the-loop 미들웨어 · `interrupt()` 블로그
- Letta — *Benchmarking AI agent memory*(파일 vs 벡터, LoCoMo)
- GitHub — *Spec Kit* repo + spec-driven development 블로그 · *Copilot coding agent* GA
- OpenAI — *Introducing Codex*(2025-05) ; AWS — *Kiro* docs ; NVIDIA — *NeMo Guardrails* repo
- arXiv — ReflAct(2505.15182) · Auto-Eval Judge(2508.05508) · AgentGen(2408.00764) 등 플래닝 연구
- ⚠️/❓ 표기 항목(프레임워크 버전·MCP 통계·PM 70%·NeMo 수치 등)은 인용 전 1차 재확인 필요
