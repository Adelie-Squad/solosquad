# 멀티 리포지토리 작업 — SoloSquad 실행 모델 설계와 레퍼런스 전수 조사

> **청자:** SoloSquad 개발자(본인). 내부 실행 모델(cwd·메모리·repo 해소)의 설계 메모이며,
> 확정 기획(PRD)이 아니라 방향 탐색이다. 채택 시 별도 PRD(`v1.4-multi-repo-execution.md`)로 승격.
>
> **문서 목적.** SoloSquad 는 "1인 창업자가 메신저로 AI 팀을 부려 **여러 repo 를 넘나드는
> 통합 작업**을 시킨다"를 지향한다. 그런데 실제 코드는 skill·agent·workflow·cron·chief 가
> repo 를 **제각각 다르게** 해소하고, 멀티 repo 를 제대로 다루는 건 chief 대화뿐이며 goal·cron
> 은 단일 repo 조차 깨져 있다. 본 문서는 ⑴ 현황을 코드로 정밀 진단하고, ⑵ 업계 레퍼런스
> (monorepo/polyrepo · 멀티 repo 도구 · AI 에이전트 멀티 repo 컨텍스트 · cross-repo 원자
> 변경 · 멀티 에이전트 오케스트레이션)를 전수 조사하며, ⑶ 네 자산(skill·agent·workflow·cron)
> 각각의 멀티 repo 기술 설계 + **장점·한계**를 분석하고, ⑷ 공통 실행 컨텍스트 모델을 고안한다.
>
> **조사 방법 주의.** 현황은 2026-06-21 코드 직독(병렬 Explore 3종) 근거이며 file:line 표기.
> 레퍼런스는 같은 날 WebSearch 7건 결과로, 1차 출처 링크는 말미 §Sources. verbatim 인용 전
> 라이브 재확인 권장.

---

## 목차

1. 문제 정의 — SoloSquad 실행 모델 현황 진단
2. 레퍼런스 조사 (업계)
3. 공통 실행 컨텍스트 모델 (제안)
4. 기능별 멀티 repo 기술 설계 + 장점·한계 (skill·agent·workflow·cron)
5. 우선순위·단계
6. 오픈 이슈
7. Sources

---

## 1. 문제 정의 — SoloSquad 실행 모델 현황 진단

### 1.1 repo 는 "복사"가 아니라 "경로 참조"다 (핵심 전제)

repo 는 워크스페이스 안에 복사·심볼릭되지 않는다. `<org>/repositories/<slug>.yaml` 에
`path: /abs/경로` 만 적히고 **실제 코드는 외부 절대경로에 그대로** 산다(v0.9.1+ path-reference,
`src/cli/add-repo.ts:245-260`, `src/util/config.ts:509-543`). `resolveRepoCwd` 가 slug→절대
경로를 풀고(`src/util/paths.ts`), `listOrgRepoSlugs` 가 org 의 전 repo 를 열거한다
(`src/bot/repo-registry.ts:13-26`).

> **귀결:** repo 는 org 디렉토리 *밖*에 있다. 따라서 "org 루트에서 상대경로로 repo 에 닿는다"는
> 성립하지 않는다. 세션이 repo 에 닿으려면 그 절대경로를 **명시적으로 노출**(`--add-dir`)해야 한다.

### 1.2 세 실행 경로가 repo 를 제각각 해소한다

| 경로 | cwd | repo 접근 | repo 목록 주입 | 멀티 repo |
|---|---|---|---|---|
| **chief 대화** | org 루트 (`chief-runner.ts:622`) | **전 repo `--add-dir`** (`collectRegisteredRepoPaths`, `chief-runner.ts:580`) + `@slug` 마커 | 부분(spawn-assembler 가 단일 repo AGENTS/CLAUDE/README) | ✅ 유일하게 제대로 |
| **goal** | org 루트 (`goal-runner.ts:162`) | `--add-dir` **없음** | 없음 | ❌ 외부 repo 에 못 닿음 |
| **cron** | `resolveOrgCwd` → 단일 repo… 인데 path-reference 면 `repositories/<slug>` 디렉토리가 없어 fallback → **org 루트** | `--add-dir` 없음, `runClaude(prompt,cwd)` 단일 | **0줄** | ❌ repo 코드 자체를 못 봄 |

세 경로가 **공유하는 repo 해소 로직이 없다.** chief 만 `--add-dir` + 마커 라우팅으로 멀티 repo
를 다루고, goal 은 add-dir 누락으로 외부 repo 를 아예 못 보며, cron 의 `resolveOrgCwd`
(`workflow-resolver.ts:106`)는 `path.join(orgDir,"repositories",slug)` 로 *레거시 디렉토리*만
찾아 path-reference repo 에선 fallback 으로 org 루트에 떨어진다(코드도, 매니페스트도 못 봄).

### 1.3 메모리는 org 단위 공유 (이건 오히려 잘 맞는다)

`<org>/memory/*.jsonl`(decisions·signals·experiments·hypotheses·cron-runs…)는 **org 단위**다
(`src/util/scaffold.ts:8-17`). repo 별 메모리는 없다. 통합 작업에서 결정·시그널이 repo 경계를
넘으므로 **공유 브레인은 올바른 선택**이다. 다만 "이 결정이 어느 repo 관련인지" 필터가 없다.

### 1.4 지정(targeting) 문법이 제각각

- chief: `@slug` 멘션 → `[target_repo:<s>]`/`[target_repos:<a>,<b>]` 마커(`mention-parser.ts:23-81`)
- workflow stage: `target_repo`(단수, `workflow-resolver.ts:6-14`)
- goal: frontmatter `target_repo`(단수·nullable, `goal-parser.ts:43-48`)
- cron: 없음

→ 네 경로가 "어느 repo 에서 작업할지"를 서로 다른 키·다른 카디널리티로 표현한다.

**요약 진단:** 멀티 repo 는 chief 대화에만 *우연히* 되고, 나머지는 단일 repo 조차 깨졌으며,
repo 해소·지정·매니페스트 주입이 **표준화되어 있지 않다.** 이것이 근본 문제다.

---

## 2. 레퍼런스 조사 (업계)

### 2.1 monorepo vs polyrepo — 그리고 "AI 시대의 새 규칙"

- **원자적 변경의 비대칭.** monorepo 는 UI·백엔드·API·DB 마이그레이션·문서를 **한 커밋**으로
  묶어 cross-cutting 변경을 원자적으로 처리하고 되돌리기 쉽다. polyrepo 는 같은 일을 하려면
  **별도 조정 계층**이 필요하다(Spacelift, Graphite).
- **정량 휴리스틱.** PR 의 **>30% 가 팀(=repo) 경계를 넘으면** monorepo 가 마찰을 줄이고,
  **<10% 면** polyrepo 가 건강한 경계를 강제한다(Spacelift).
- **AI 가 바꾸는 것.** 대형 컨텍스트 LLM 은 monorepo/polyrepo 트레이드오프를 *없애지* 않고
  **무엇이 더 중요한지를 바꾼다.** monorepo 에선 에이전트가 스택 전반의 패턴을 관찰해 일관된
  코드를 생성한다(Augment Code, "AI's New Rules").

> **SoloSquad 함의:** SoloSquad 는 본질적으로 **polyrepo + 조정 계층**이다(여러 외부 repo 를
> org 라는 상위 단위로 묶음). 업계 결론대로 polyrepo 의 약점(원자적 cross-repo 변경)을 메우는
> **조정 계층을 우리가 직접 제공**해야 한다 — 그게 org 메모리 + 공통 실행 컨텍스트의 역할.

### 2.2 멀티 repo 관리 도구 — "매니페스트"라는 공통 패턴

- **git submodules** — 부모 repo 안에 자식 repo 를 특정 커밋으로 고정 포함. 결합 느슨·생애주기
  분리에 적합하나 동기화가 번거롭다.
- **git subtree** — 자식 repo 사본을 디렉토리로 삽입, 양방향 sync. 결합 강할 때.
- **Google `repo` 도구** — **manifest 파일**로 "이 프로젝트를 구성하는 repo 집합"을 선언하고
  통합 워크스페이스에서 전 repo 에 일괄 git 작업(AOSP 용). → **매니페스트 = repo 로스터**.
- **meta · gita · gr** — 여러 repo 를 한 번에 checkout·sync·심볼릭하는 CLI.

> **SoloSquad 함의:** `<org>/repositories/*.yaml` 가 이미 **Google repo 의 manifest 와 같은
> 역할**(slug·role·path 로스터)이다. 부족한 건 이 매니페스트를 **에이전트 프롬프트에 주입**해
> "어떤 repo 가 있고 무슨 역할인지" 알리는 단계다.

### 2.3 AI 에이전트의 멀티 repo 컨텍스트 — 두 갈래 접근

- **검색·인덱스 기반 (Sourcegraph Cody/Amp).** Search API + 임베딩으로 **로컬·원격 다수 repo**
  에서 관련 스니펫을 끌어와 LLM 에 주입. 멀티 repo·전 코드베이스 컨텍스트가 *엔터프라이즈
  차별점*. Amp 는 Sourcegraph 코드 그래프 위 에이전틱 도구.
- **디렉토리 노출 기반 (Claude Code `--add-dir`).** 한 세션에 **여러 작업 디렉토리**를 추가 —
  "monorepo/마이크로서비스용 핵심 명령". 추가된 디렉토리의 `.claude/agents/` 도 함께 스캔되고,
  `settings.json` 의 `additionalDirectories` 로 상시 로드 가능. Boris Cherny 권장 패턴: "한 repo
  에서 시작해 `--add-dir` 로 다른 repo 를 보게 + **권한까지 부여**". 영속화(`.claude-workspace`)
  는 아직 feature request.
- **VS Code multi-root 의 한계(반면교사).** AGENTS.md 를 자동 주입하고
  `chat.useCustomizationsInParentRepositories` 로 부모 repo 커스터마이즈를 발견하지만, **agent
  모드는 사실상 단일 폴더에 갇혀** 멀티 루트에서 repo 간 추론·변경을 못 한다(공개 이슈
  #318936/#311148). → "디렉토리만 추가한다고 멀티 repo 가 되는 게 아니다. **추론·변경 권한과
  매니페스트가 같이 가야** 한다"는 교훈.

> **SoloSquad 함의:** 우리는 SDK 가 아니라 **Claude Code 를 child process 로 띄운다**(`claude
> --print`, `claude-runner.ts:26`). 따라서 **`--add-dir` 노선이 정답**이다. chief 는 이미 전 repo
> 를 add-dir 한다 — 이걸 goal·cron·workflow 로 **일반화**하면 된다. 검색·인덱스(Cody) 노선은
> 과하다(외부 인프라 필요). 단, VS Code 의 실패에서 보듯 **매니페스트 주입 + 쓰기 권한**을 함께
> 줘야 진짜 멀티 repo 가 된다.

### 2.4 cross-repo 원자적 변경 — polyrepo 의 핵심 난제

- **Gerrit Topics** — 여러 repo 의 변경을 같은 *topic* 으로 묶어 **동시 submit**(빌드 깨짐 방지).
- **Gerrit `Depends-On:`** — 커밋 메시지에 다른 변경의 ID 를 적어 cross-repo 의존 선언.
- **Graphite Stacked PRs/Diffs** — 변경의 단위를 PR 이 아니라 **개별 커밋**으로 만들어, 앞 PR
  머지를 안 기다리고 쌓아 올린다.

> **SoloSquad 함의:** 통합 작업이 N개 repo 를 건드리면 **repo 마다 별도 커밋**(각 repo 가 독립
> git 루트)이 불가피하다. "한 작업 = N repo 커밋"을 묶는 **논리적 topic**(작업 id) 개념과,
> push/PR 시 **repo 인지 dev-confirm 게이트**가 필요하다(Gerrit topic 의 경량 버전).

### 2.5 멀티 에이전트 오케스트레이션 — 역할 분업으로 대규모 변경

- AutoGen·CrewAI 등은 **전문 에이전트 분업**으로 대규모 리팩터를 수행 — 아키텍처 분석 / 코드
  마이그레이션 / 테스트 검증을 각기 다른 에이전트가(Kinde, CIO).
- 학술: *Multi-Agent Coordinated Rename Refactoring*(arXiv 2601.00482), *Lita*(2509.25873),
  WhatsCode(WhatsApp 대규모 GenAI 배포, 2512.05314) — "자율 태스크 오케스트레이션 + 동적
  컨텍스트 조립"으로의 이동.

> **SoloSquad 함의:** SoloSquad 의 chief→PM→specialist **스폰 모델이 이미 이 분업 구조**다.
> 부족한 건 sub-agent 에게 "이 작업의 in-scope repo 집합 + 각 절대경로"를 **일관되게 전달**하는
> 배선. 즉 멀티 에이전트는 있는데 **멀티 repo 컨텍스트 전파**가 빠졌다.

### 2.6 여러 레포를 넘나드는 에이전트 워크플로우 (GitHub 생태계 — 가장 농밀한 레퍼런스)

이 영역은 GitHub 생태계에 표준형이 가장 잘 정립돼 있고, SoloSquad 설계와 **거의 1:1 로 매핑**된다.

**(a) 오케스트레이터 + 워커 패턴 (중앙 제어 레포).** gh-aw(GitHub Agentic Workflows)의 멀티레포
예제가 표준형이다 — 중앙 제어 레포의 **오케스트레이터+워커 쌍**으로 커스텀 Dependabot 설정을
여러 레포에 롤아웃한다. `dependabot-rollout-orchestrator.md` 가 **어디에** 롤아웃할지를 정하고
(Filter→Categorize→Prioritize→Dispatch: 기존 `dependabot.yml` 유무 파싱, Simple/Complex/
Conflicting/Security 분류, simple→security→complex 우선순위화, repo 별 워커 디스패치),
`dependabot-rollout.md` 워커가 각 레포를 분석해 맞춤 PR 을 만든다. 워커는 **JSON 페이로드를
받아 독립 워크플로 런으로 비동기 실행**된다. org 전반 config 표준화·보안 패치 롤아웃에 적합.

**(b) 사이드 레포 패턴 (자동화 로직 분리).** 자동화 로직을 본체에서 떼어 **격리된 사이드 레포**
에서 돌린다 — 메인 레포의 이슈 트리아지를 사이드 레포에서 실행하거나, 대상 코드베이스를
로컬에 **체크아웃해 린터·복잡도 검사**를 돌려 actionable 이슈를 만든다. *수정하고 싶지 않은
레포*에 대한 품질 게이트로 쓴다(읽기·관측 전용).

**(c) 상태 동기화는 라이브가 아니라 "드롭박스".** 멀티에이전트의 가장 깨지기 쉬운 부분 —
대부분의 오케스트레이션은 실시간 채팅/벡터DB 조회로 에이전트를 동기화하려다 부서진다. GitHub
**Squad** 는 라이브 동기화를 포기하고 **"드롭박스" 패턴**을 쓴다: 라이브러리 선택·네이밍 규칙
같은 모든 아키텍처 결정을 레포의 **버전 관리되는 `decisions.md` 에 구조화 블록으로 append**
하고, 모든 에이전트가 다음 기동 시 그 파일을 읽는다. `.squad/` 폴더에 `team.md`·`routing.md`·
`decisions.md`(공유 브레인)·agent charter/history·logs 를 둔다. *"마크다운 파일을 팀의 공유
두뇌로 삼는다 — 영속성·가독성·완벽한 감사 추적, 재접속·재시작 후 컨텍스트 복구."*

> **SoloSquad 정합성(중요):** SoloSquad 의 `memory/decisions.jsonl` + `_handoff.md` 가 **정확히
> 이 드롭박스 패턴**이다. 즉 우리 상태 모델은 업계 best-practice 와 **이미 정합적**이고, 라이브
> 동기화를 추가할 필요가 없다. 멀티 repo 로 확장해도 "공유 브레인은 org 메모리"라는 §3.4 결정이
> Squad 와 같은 결론. 단, Squad 의 `routing.md`(에이전트 라우팅)·agent `charter.md` 처럼 **구조를
> 더 명시화**할 여지는 참고.

**(d) 레포 구조 맵을 먼저 읽는다.** 멀티레포 피처 개발의 실제 흐름(Bishoy Youssef) — 에이전트가
**`AGENTS.md` 를 읽어 레포 구조를 파악**하고, 영향받는 레포(user-service·shared-common·
admin-dashboard·customer-portal)를 식별한 뒤, 모든 레포에 브랜치를 만들고, **의존성 순서로
cross-reference 달린 PR** 을 생성한다.

> **SoloSquad 정합성:** SoloSquad 의 `AGENTS.md`(워크스페이스 가이드) + repo 매니페스트(§3.3)가
> 정확히 이 "구조 맵 먼저 읽기" 역할. 매니페스트 주입이 이 패턴의 전제다.

**(e) 전용 스킬도 이미 존재.** `cross-repo-orchestration` 스킬(ClaudePluginHub)은 skill·템플릿·
agent·하니스 정책을 **git 매개 또는 명세(spec) 매개** 워크플로우로 여러 레포에 동기화하고,
**repo 범위 작업 항목으로의 분해 · 웨이브(wave) 실행 · cross-repo 계약 · 세션 추적**으로 멀티레포
캠페인을 조율한다. 권고: **git 매개로 시작**하되 조직 규모에서 git 동기화가 버거워지면 repo 가
**명세 매니페스트로 의존성을 선언**하고 플랫폼 오케스트레이터가 변경을 전파(spec 매개)로 이행.

> **SoloSquad 정합성:** "웨이브 실행"은 우리 **workflow 의 stage DAG**(§4.3)와 같고, "repo 범위
> 작업 항목 분해"는 chief 의 **DECOMPOSE 스테이지**와 같다. 이 스킬을 SoloSquad 번들 skill 로
> 흡수할 후보(§4.1).

**(f) 엔터프라이즈 규모 패턴.** 수백 개 레포에서 순차 스캔이 몇 시간 걸리는 문제를, 오케스트레이터
가 **레포 부분집합을 각각 맡는 여러 에이전트를 병렬 실행**해 균등 분배로 푼다(보안 스캔 등). 단
조직·cross-repo 워크플로우는 규모에서 **신중한 권한 관리 · rate limiting · 다른 분석 렌즈**가
필수.

> **SoloSquad 정합성:** §4.2 의 "repo 별 fan-out" 이 바로 이 분배 패턴. SoloSquad 는 1인 창업
> 규모라 수백 repo 는 아니나, **scope 분할 + 병렬 + rate/권한 가드**는 그대로 차용.

**소결 — 재설계가 아니라 배선이다.** GitHub 생태계의 다섯 패턴(오케스트레이터+워커 / 사이드
레포 / 드롭박스 상태 / 구조 맵 먼저 / 전용 스킬+웨이브)이 SoloSquad 의 **chief→sub-agent
스폰 · memory+_handoff · AGENTS.md · workflow stage** 와 거의 그대로 대응한다. 우리에게 없는 건
새 아키텍처가 아니라 **① repo 매니페스트 주입 · ② 전 경로 공통 리졸버 · ③ scope 지정 문법 통일**
세 가지 배선이다.

---

## 3. 공통 실행 컨텍스트 모델 (제안)

핵심 한 줄: **네 경로(chief·goal·cron·workflow)가 동일한 "실행 컨텍스트 리졸버" 하나를 공유**
하고, 그 기본값을 **"전 repo(멀티)"**로 둔다. 지정 시에만 좁힌다.

### 3.1 단일 리졸버 — `resolveExecutionContext(org, targetSpec?)`

흩어진 셋(`resolveOrgCwd`, chief 의 `collectRegisteredRepoPaths`, goal 의 맨 org-root)을 하나로
통합. 반환:

- `cwd` — 세션 위치
- `addDirs` — 노출할 repo 절대경로 목록(path-reference 라 필수; `resolveRepoCwd` 경유 →
  cron 의 org-root 추락 버그 자연 소멸)
- `repoManifest` — 프롬프트 주입용 repo 로스터(slug·role·path·remote·한 줄 설명)
- `scope` — 이번 작업 in-scope repo 집합

### 3.2 기본 = 전 repo, 지정 = 그 repo (일관 멘탈 모델)

- **지정 없음 → 멀티:** cwd = org 루트, `addDirs` = org 전 repo. 에이전트가 org repo 세트 전체
  를 본다(Claude Code 권장 패턴 + Google repo manifest 합).
- **지정 있음 → 좁힘:** 대상 repo 만 addDirs. 정확히 1개면 cwd = 그 repo(+ org 루트를 addDir
  해 메모리 접근 보존).
- **지정 문법 통일 — "비우면 전체, 적으면 그것들":**
  - chief: `@slug` → `[target_repos:…]` (존재)
  - cron: `crons/<id>.yaml` 에 `repos: [a,b]` (생략 = 전체)
  - workflow stage: `target_repo` → `target_repos` 확장
  - goal: `target_repo` → `target_repos` 확장(생략 = 전체)

### 3.3 repo 매니페스트를 모든 프롬프트에 주입

`--add-dir` 는 *파일 접근*만 준다. 에이전트는 **무슨 repo 가 있는지도** 알아야 통합 작업을
한다(VS Code 의 실패 교훈). `repositories/*.yaml` → 표준 "repo 매니페스트" 컨텍스트 레이어를
cron·goal·workflow·chief **전부**에 주입. spawn-assembler 의 단일-repo 컨텍스트를 "org 전체
로스터"로 일반화. **cron 의 최대 결핍점이 정확히 이것.**

### 3.4 메모리 = org 공유 유지 + repo 태그

`<org>/memory/*.jsonl` 는 공유 브레인으로 **그대로**(통합 작업의 자산). 레코드에 **선택적 `repo`
필드** 추가 → "@repo-a 관련 결정만" 필터 가능. 저장 구조 불변·하위호환. repo-로컬 지식은 외부
repo 자신의 AGENTS.md/CLAUDE.md 가 담당(이미 읽음) → **공유 메모리=org, 코드 컨벤션=repo 파일**.

### 3.5 멀티 repo 쓰기·커밋 규약

- repo 마다 **별도 커밋**(각자 독립 git 루트). 한 작업의 N repo 변경을 **논리적 topic(작업 id)**
  로 묶어 메모리에 기록(Gerrit topic 경량판).
- **dev-confirm 게이트를 repo 인지로 확장** — push/PR 을 repo 별 확인 또는 배치 확인.

---

## 4. 기능별 멀티 repo 기술 설계 + 장점·한계

> 네 자산 모두 §3 의 공통 리졸버를 **소비**한다. 아래는 자산별 특수 설계와 trade-off.

### 4.1 Skill (재사용 절차 지식)

- **멀티 repo 설계:** skill 은 "어떻게"를 담은 프롬프트 절차다. 자체로 repo 를 고르지 않고,
  **호출 컨텍스트의 scope 를 상속**한다. skill 본문은 "in-scope repo 매니페스트를 읽고 각 repo
  에 대해 단계를 반복"하도록 작성(repo-agnostic). 워크스페이스 오버라이드 skill 은 특정 repo
  스택에 특화될 수 있으나, 번들 skill 은 repo 중립 유지. **선례:** ClaudePluginHub 의
  `cross-repo-orchestration` 스킬(§2.6e)이 "repo 범위 분해 · 웨이브 실행 · cross-repo 계약 ·
  세션 추적"을 한 skill 로 묶은 형태 → SoloSquad 번들 skill 흡수 후보.
- **장점:** 한 번 쓴 절차(예: "전 repo 의존성 업데이트", "전 repo 보안 점검")를 **N repo 에 일괄**
  적용 → polyrepo 일관성 확보(monorepo 의 "일관 패턴" 이점을 절차로 모사).
- **한계:** repo 마다 스택·컨벤션이 다르면 단일 절차가 안 맞을 수 있음(예: 한 repo 는 pnpm, 다른
  repo 는 cargo). → skill 이 **repo.role/language 매니페스트로 분기**하거나, repo 별 AGENTS.md 에
  위임해야 함. 절차의 "원자성" 부재(중간 repo 에서 실패 시 부분 적용).

### 4.2 Agent (전문 페르소나 + 위임 그래프)

- **멀티 repo 설계:** chief 가 scope 를 정해 sub-agent 를 스폰할 때, **각 sub-agent 에 in-scope
  repo 의 절대경로 + 매니페스트 전달**(현재 spawn-assembler 가 단일 repo 만 → 다중으로 확장).
  분업 모드 두 가지: ⑴ **repo 별 fan-out**(repo A 는 engineer-A, repo B 는 engineer-B 병렬), ⑵
  **cross-repo 단일 에이전트**(한 에이전트가 전 repo addDir 받아 통합 변경 — API+소비자 동시
  수정). 업계의 "아키텍처분석/마이그레이션/테스트검증 분업"을 repo 축으로도 적용.
- **장점:** 진짜 통합 작업 가능 — "공유 라이브러리 시그니처 바꾸고 3개 소비 repo 동시 수정"을
  한 에이전트(cross-repo) 또는 조율된 팀(fan-out)으로. SoloSquad 스폰 모델과 천연 적합.
- **한계:** 컨텍스트 폭증(N repo × 코드 → 토큰·비용·정확도 저하; Cody 가 검색·인덱스로 푸는
  이유). 위임 그래프 복잡도↑(repo×agent 매트릭스). 쓰기 충돌(두 에이전트가 같은 repo 동시 수정).
  → scope 를 **작업에 꼭 필요한 repo 로 좁히는 규율** + worktree 격리(병렬 쓰기) 필요.

### 4.3 Workflow (결정적 다단계 체인)

- **멀티 repo 설계:** stage 별 `target_repos` 로 **단계마다 repo scope 를 다르게**. 예: stage1
  `[shared-lib]` 시그니처 변경 → stage2 `[app-a, app-b]` 소비처 수정 → stage3 `[전체]` 통합
  테스트. stage 핸드오프에 "앞 단계가 만진 repo·변경 요약" 전달. workflow.yaml 스키마에
  `target_repos` 추가(기존 단수 `target_repo` 하위호환 흡수).
- **장점:** cross-repo 변경의 **순서·의존을 명시적으로** 표현(Gerrit topic 의 의존 그래프를
  워크플로 DAG 로). 결정적이라 재현·검증 쉬움. 단계별 scope 로 컨텍스트 폭증 억제.
- **한계:** 진짜 *원자성*은 없음 — 단계가 순차라 stage2 실패 시 stage1(shared-lib) 은 이미 커밋
  됨 → 롤백·보상 트랜잭션 설계 필요. 워크플로 작성 부담(repo 의존을 사람이 DAG 로 표현).

### 4.4 Cron (정기 자동 실행)

- **멀티 repo 설계:** `crons/<id>.yaml` 에 `repos:`(생략=전체). 정기 작업이 org 전 repo 를 순회
  — 예: "매일 아침 전 repo 의 어제 커밋·열린 PR·CI 상태 통합 브리핑", "매주 전 repo 의존성
  드리프트 점검". 프롬프트에 매니페스트 주입 → cron 이 비로소 repo 들을 *본다*. 결과는
  `works-<handle>` 로(별도 v1.3.4 §F2 참조).
- **장점:** **org 전체의 횡단 관측**이 cron 의 천직 — 단일 repo 도구(Dependabot 등)가 못 주는
  "내 사업 전체의 오늘" 한 장. 사람이 N repo 를 일일이 안 봐도 됨.
- **한계:** 무인 실행이라 **scope 폭증 시 비용·시간 폭증**(timeout 180s, repo 많으면 부족) →
  cron 은 "읽기·요약" 위주로, 쓰기 통합 작업은 workflow/goal 로 유도. 무인 멀티 repo *쓰기* 는
  위험(확인자 부재) → cron 쓰기는 dev-confirm 과 충돌, 기본 read-only 권장.

### 4.5 비교 요약

| 자산 | repo scope 결정 주체 | 멀티 repo 강점 | 핵심 한계 |
|---|---|---|---|
| **skill** | 호출 컨텍스트 상속 | 절차의 N-repo 일괄 적용 | 스택 이질성·부분 적용 |
| **agent** | chief 가 스폰 시 지정 | 진짜 통합 변경(cross-repo) | 컨텍스트 폭증·쓰기 충돌 |
| **workflow** | stage 별 `target_repos` | 순서·의존 명시(DAG) | 원자성 부재·작성 부담 |
| **cron** | `repos:`(기본 전체) | 횡단 관측(읽기) | 무인 쓰기 위험·timeout |

**공통 관통 원리:** ① 기본 멀티·지정 시 좁힘, ② 매니페스트 주입 필수, ③ scope 를 작업에 꼭
필요한 만큼만(컨텍스트·비용·충돌 관리), ④ 쓰기는 repo 별 커밋 + repo-인지 확인.

---

## 5. 우선순위·단계

1. **공통 리졸버 + repo 매니페스트 주입** — `resolveExecutionContext` 신설, 네 경로 이전.
2. **goal/cron 버그 해소** — add-dir 누락(goal)·org-root 추락(cron)을 리졸버로 동시 수정.
3. **지정 문법 통일** — cron `repos:` / workflow·goal `target_repos` / chief 마커(존재).
4. **메모리 repo 태그** — 레코드 `repo?` 필드 + 필터.
5. **멀티 repo 쓰기 규약** — repo 별 커밋 + 작업 topic + repo-인지 dev-confirm.
6. (선택) **scope 자동 추론** — 매니페스트 + 작업 내용으로 in-scope repo 제안(LLM, 확인 게이트).

> cron 의 v1.3.4 §G(멀티 repo)·§F2(채널)는 본 공통 모델의 **소비자**로 격하된다. 즉 cron 단독
> 작업이 아니라, 이 횡단 모델을 먼저 세우고 cron 이 그 위에 얹히는 순서가 옳다.

---

## 6. 오픈 이슈

- **기본 cwd 단순화 여부** — "항상 org 루트 + 전 repo add-dir" 단일 규칙 vs "대상 1개면 그 repo
  를 cwd". 단순화가 디버깅·일관성에 유리(권장). 결정 필요.
- **컨텍스트 폭증 대응** — repo 가 많아지면(예: 10+) 전 repo add-dir 가 토큰·비용·정확도를 해친다.
  Cody 식 검색·인덱스 도입 임계는? 당장은 "scope 좁힘 규율 + 매니페스트(전체)+코드(scope)"로 분리.
- **원자성·롤백** — cross-repo 변경의 부분 실패 보상. workflow 단계 롤백 vs 작업 topic 단위 revert.
- **병렬 쓰기 격리** — fan-out agent 가 같은 repo 동시 수정 시 worktree(`git worktree`) 격리 필요 여부.
- **path-reference 의 git 가정** — repo 가 git 이 아닐 수도(문서 repo 등). 커밋 규약의 예외 처리.

---

## 7. Sources

**monorepo/polyrepo & AI 규칙**
- [Monorepo vs. Polyrepo (Spacelift)](https://spacelift.io/blog/monorepo-vs-polyrepo)
- [Monorepo vs Polyrepo: AI's New Rules (Augment Code)](https://www.augmentcode.com/learn/monorepo-vs-polyrepo-ai-s-new-rules-for-repo-architecture)
- [Monorepo vs. polyrepo pros/cons/tools (Graphite)](https://graphite.com/guides/monorepo-vs-polyrepo-pros-cons-tools)
- [Monorepos vs Polyrepos (Vercel Academy)](https://vercel.com/academy/production-monorepos/monorepos-vs-polyrepos)

**멀티 repo 관리 도구**
- [Git Submodules vs Google's Repo Tool (Edureka)](https://www.edureka.co/blog/git-submodules-versus-googles-repo-tool)
- [MonoRepo vs MultiRepo vs Submodule vs Subtree (Mammadzada)](https://raminmammadzada.medium.com/monorepo-vs-multirepo-vs-git-submodule-vs-git-subtree-3fde1af15b76)
- [Managing Git projects with submodules and subtrees (Opensource.com)](https://opensource.com/article/20/5/git-submodules-subtrees)

**AI 에이전트 멀티 repo 컨텍스트**
- [How Cody provides remote repository awareness (Sourcegraph)](https://sourcegraph.com/blog/how-cody-provides-remote-repository-context)
- [The anatomy of an AI coding assistant (Sourcegraph)](https://sourcegraph.com/blog/anatomy-of-a-coding-assistant)
- [Claude Code --add-dir guide (ClaudeLog)](https://claudelog.com/faqs/--add-dir/)
- [Claude Code /add-dir: The Monorepo Command (Vincent's Blog)](https://blog.vincentqiao.com/en/posts/claude-code-add-dir/)
- [Boris Cherny on --add-dir across repos (Threads)](https://www.threads.com/@boris_cherny/post/DWfjvGZFH8b/use-add-dir-to-give-claude-access-to-more-folders-when-working-across-multiple)
- [VS Code: agent across multiple workspace folders (issue #318936)](https://github.com/microsoft/vscode/issues/318936)
- [VS Code: multi-root cross-repo change tracking + worktrees (issue #311148)](https://github.com/microsoft/vscode/issues/311148)

**cross-repo 원자적 변경**
- [Gerrit: Submitting Changes Across Repositories by Topics](https://gerrit-review.googlesource.com/Documentation/cross-repository-changes.html)
- [Gerrit/Cross-repo dependencies (MediaWiki)](https://www.mediawiki.org/wiki/Gerrit/Cross-repo_dependencies)
- [Stacked Diffs (Pragmatic Engineer)](https://newsletter.pragmaticengineer.com/p/stacked-diffs)

**멀티 에이전트 오케스트레이션**
- [Multi-Agent Workflows for Complex Refactoring (Kinde)](https://www.kinde.com/learn/ai-for-software-engineering/ai-agents/multi-agent-workflows-for-complex-refactoring-orchestrating-ai-teams/)
- [4 AI Solutions for Multi-Service Refactoring (Augment Code)](https://www.augmentcode.com/guides/4-ai-solutions-for-multi-service-refactoring)
- [Multi-Agent Coordinated Rename Refactoring (arXiv 2601.00482)](https://arxiv.org/pdf/2601.00482)
- [From vibe coding to multi-agent AI orchestration (CIO)](https://www.cio.com/article/4150165/from-vibe-coding-to-multi-agent-ai-orchestration-redefining-software-development.html)

**여러 레포 에이전트 워크플로우 (GitHub 생태계)**
- [Multi-Repository Examples (GitHub Agentic Workflows / gh-aw)](https://github.github.com/gh-aw/examples/multi-repo/)
- [Orchestrator-Ops pattern (gh-aw)](https://github.github.com/gh-aw/patterns/orchestrator-ops/)
- [CentralRepoOps pattern (gh-aw)](https://github.github.com/gh-aw/patterns/central-repo-ops/)
- [github/gh-aw (repo)](https://github.com/github/gh-aw)
- [How Squad runs coordinated AI agents inside your repository (GitHub Blog) — "dropbox" decisions.md](https://github.blog/ai-and-ml/github-copilot/how-squad-runs-coordinated-ai-agents-inside-your-repository/)
- [bradygaster/squad (repo)](https://github.com/bradygaster/squad)
- [cross-repo-orchestration skill — git-mediated/spec-mediated, wave execution (ClaudePluginHub)](https://www.claudepluginhub.com/skills/russmiles-ai-literacy-superpowers-ai-literacy-superpowers/cross-repo-orchestration)
- Bishoy Youssef — multi-repo feature-dev workflow (AGENTS.md as repo structure map) *(출처: 사용자 제공, URL 미확인)*
