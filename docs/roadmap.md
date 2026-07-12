# SoloSquad 개발 현황 & 로드맵

> 릴리스된 버전, 진행 중인 계획, 결정 로그, 외부 참고자료를 한 자리에 모은 롤링 문서.

**최종 업데이트:** 2026-05-20 (v0.8.7 릴리스)

---

## 1. 릴리스 현황

### npm에 배포된 버전 (사용 가능)

| 버전 | 날짜 | 주요 내용 | 문서 |
|---|---|---|---|
| `v0.0.0` ~ `v0.1.5` | 초기 ~ 2026-04-21 | 코어 + 크로스 플랫폼 + hotfix 연쇄 | `v0.1-*.md` |
| `v0.2.0` ~ `v0.2.4` | 2026-04-23 ~ | GitHub-aligned 레이아웃 + 마이그레이션 + 메신저 통합 | `v0.2.*-*.md` |
| `v0.3.0` | 2026 Q2 | PM 모드 + 멀티 에이전트 오케스트레이션 + 슬래시 5종 | `v0.3-pm-mode-orchestration.md` |
| `v0.4.0` | 2026 Q2 | 자율 goal-runner + Data Reconciliation + `solosquad goal` CLI 7종 | `v0.4-autonomous-engine.md` |
| `v0.5.0` ~ `v0.5.1` | 2026 Q2 | 워크플로우 메이커 + 4채널 trigger + analyze 파이프라인 | `v0.5-workflow-maker.md` |
| `v0.6.0` | 2026-05-14 | 디폴트 워크플로우 튜닝 + Team=Domain + Org Layer + FTS5 archive + hot-reload | `v0.6-default-workflow-tuning.md` |
| `v0.7.0` | 2026-05-15 | Uninstall & Lifecycle — farewell archive(WAL-safe SQLite) + REVOKE-CHECKLIST + `solosquad uninstall`/`logout` + class A 불가침 | `v0.7-uninstall-lifecycle.md` |
| `v0.8.0` | 2026 Q2 | 멀티 유저 메신저 (handle 기반 채널 페어 `command-<handle>` / `works-<handle>`, 봇 multiplicity, author-guard) | `v0.8-multiuser-messenger.md` |
| `v0.8.1` | 2026 Q2 | Security & Lifecycle Pair — `solosquad import <zip>` + `archive verify/info/list` + api-stability §4 약속 | `v0.8.1-security-lifecycle-pair.md` |
| `v0.8.2` | 2026 Q2 | Dev Capability — SKILL `dev_capability: true` + dev_permissions + PR flow + push/merge confirmation gate | `v0.8.2-dev-capability.md` |
| `v0.8.3` | 2026 Q2 | Onboarding UX + Observability — logger 확장 + `solosquad logs` CLI + `add repo --dry-run` byte-identical 보장 | `v0.8.3-onboarding-ux-observability.md` |
| `v0.8.4` | 2026 Q2 | CLI Surface Reduction — `--mode` 패턴 통일(uninstall·import) + `backup` subgroup + deprecation alias + init walk-up 분기 | `v0.8.4-cli-surface-reduction.md` |
| `v0.8.5` | 2026-05-18 | Onboarding QA & Release-Gate — init.ts hardcoded version 회귀 fix + wizard 문구 정합(handle/name/role/provider 헬프) + master-guide v0.6→v0.8.5 backfill + 3-docs pre-publish gate(`prepublishOnly` 강제) | `v0.8.5-onboarding-qa.md` |
| `v0.8.6` | 2026-05-20 | migrate Hotfix + Agent push 범위 박제 — `migrate.ts:8` `CLI_VERSION_TARGET = "0.4.0"` 회귀 fix + master-guide §10.4 uninstall safe sequence + §10.5 *에이전트는 push까지·PR은 사용자 웹 UI* + PR API 자동화 v1.x 슬롯 박제 | `v0.8.6-migrate-hotfix-pr-workflow.md` |
| `v0.8.7` | 2026-05-20 | Tiny Stabilization — master-guide §3.11 `dev_capability` 4-level enum → boolean+dev_permissions 정합 (docs drift fix) + `test/migrate-default-target.test.ts` 회귀 catcher. v0.9 안정화 6축 권장안은 오버스펙으로 영구 skip | `v0.8.7-tiny-stabilization.md` |
| `v0.9 plan` | 2026-05-20 | Workspace ↔ Repository 관계 재설계 plan only (코드 0건). Hermes·Codex 비교 + 모델 B (path reference) default 선택 + 자동화 UX 4종 + 워크스페이스 위치 가이드 박제 | `v0.9.1-workspace-repo-relationship.md` |
| ~~`v0.9.0`~~ | ~~2026-05-20~~ | ~~burn~~ — publish 직후 unpublish, npm time 객체에 영구 기록. 코드 자체는 v0.9.1과 동일. 사용 가능한 버전은 v0.9.1부터 | — |
| `v0.9.1` | 2026-05-21 | Model B 구현 + npm 패키지에 master-guide 포함 + Step 1 prerequisites 보강 — `repo.yaml.path` 필드 신설 / `resolveRepoCwd` 외부 경로 분기 / `solosquad add repo --path <ext>` flag + cwd 인식 자동 / `solosquad init` Step 5.1 path-reference 분기 prompt / `solosquad doctor` 외부 path 존재 검증. `docs/manual/` → top-level `manual/`로 이동해 npm 패키지에 포함. master-guide §4.2 Step 1에 *의존성 종합 표* + *환경변수 종합 표* + *자원·네트워크 하한* 박스 3개 추가 (KO/EN). backward-compat: 기존 `<workspace>/<org>/repositories/<slug>/` 트리 영구 동작 | `v0.9.1-workspace-repo-relationship.md` |
| **`v0.9.2`** | **2026-05-21** | **Uninstall precheck self-match hotfix (Windows)** — `solosquad uninstall`이 봇이 안 도는데도 `bot/schedule appears to be running (pid X, Y)`로 차단하던 Windows 한정 버그 수정. WMI 쿼리 `Get-CimInstance Win32_Process \| Where-Object { $_.CommandLine -match 'solosquad' -and ... }` 의 `-Command` 인자가 자기 자신의 CommandLine에 두 정규식 리터럴을 포함해 *powershell.exe가 스스로를 매칭*. `$_.Name -eq 'node.exe'` 가드 추가로 해결. `test/lifecycle-precheck.test.ts` 회귀 catcher (3회 호출 결과 동일성). 스키마 변경 0건, `--force` 우회 사용자에게도 무해 | `v0.9.2-precheck-self-match-hotfix.md` |

### 현재 설치 가능 버전: npm `0.9.2` (publish 직전 단계; 0.9.0은 npm burn)

**다음 마일스톤:** v0.9.3+ — backward-compat 마이그레이션 명령 (`solosquad migrate --externalize-repos`, opt-in). 이후 v1.0 정식 출시는 *코드 변경 없이 5분 manual sweep + tag* 형식.

> **문서 파일명 vs npm 버전:** `docs/v0.2.2-*.md` / `docs/v0.2.3-*.md`는 **작업 블록 라벨**. 실제 npm 출시 번호는 semver를 따릅니다.

---

## 2. 제품 목표 (Product Goals) — 2026-05-15 박제

SoloSquad의 **출시 시점 약속 (v1.0)**과 **포스트 출시 진화**를 끌고 갈 3축. 각 릴리스는 이 3축 중 어느 부분을 채우는지 명시.

### 2.1 멀티 프로덕트 — 1인 / 소규모 창업자 / n잡 시나리오

**대상 사용자**:
- 1인 창업자 (1 product)
- 소규모 팀 창업자 (1~5명, 같은 메신저 서버에 모임)
- **n잡 사용자** — 직장 + 멀티 직장 + 사이드 프로젝트 + 부업 동시 운영
- 다중 product를 한 머신·한 SoloSquad 워크스페이스에서 분리 관리

**구현 매핑**:
- v0.2.x: workspace + multi-org + multi-repo 토폴로지 (✓)
- v0.6: Org Layer specialization (`<org>/core`·`agent-profile.yaml`·`domain/`) — org별 톤·정책·도메인 격리 (✓)
- v0.8.0: 메신저 multi-user (같은 Discord/Slack에 N명) — n잡 멤버가 같은 메신저에 모일 때 (✓ 출시)
- v1.x (별도 slot, 번호 TBD): **일정 관리 + 메모** — n잡 사용자의 시간·기억 관리. 지식 온톨로지와 같은 결

**일정·메모는 별도 미래 버전 slot** (2026-06-25 정정): 당초 v1.3에 박제했으나, 실제 1.3.x
라인(1.3.0~1.3.8)은 *primitive·문서 작성체계 내재화*로 전개됨(§2.3 line 참조) → 일정/메모는
v1.3에서 분리해 별도 버전에서 진행. v0.x~v1.2까지는 product/창업 워크플로우에 집중, 캘린더·
todo·노트는 그 별도 인프라 slot에서.

### 2.2 24/7 멀티 에이전트 팀 — Conversation-only operation

**핵심 약속**: 사용자가 코드를 직접 보지 않고, 메신저 대화만으로 자동화된 멀티 에이전트 팀을 운영할 수 있다.

**구현 매핑**:
- v0.3: PM 모드 + 슬래시 5종 + 멀티 에이전트 오케스트레이션 (✓)
- v0.4: 자율 goal-runner (밤새 자율 사이클) (✓)
- v0.5: 워크플로우 메이커 (메신저-네이티브 SKILL 작성 + 4채널 trigger) (✓)
- v0.6: 8-layer JIT spawn + Org Layer specialization (✓)
- v0.7: 라이프사이클 완결 (uninstall/archive) (✓)
- **v0.8.2: dev_capability** — 에이전트가 코드 수정 + PR까지 자율 수행 (대화만으로 dev 작업 완결, 기획 완료)
- v1.x: 더 깊은 자율 사이클 (multi-product cross-goal, 인간 승인 지점 더 정교화)

**보안 원칙**: 사용자가 코드를 안 보더라도 *위험 작업은 명시 승인*. v0.8.2의 push/merge confirmation gate, v0.4의 modifiable_paths 화이트리스트, v0.8.0의 author-guard 모두 이 정합.

### 2.3 애자일 / 실험 중심 기획

**다루는 도메인** (specialist agent들이 1차 시민으로):
- **PMF 검증** — `pmf-planner`, `data-analyst`, `user-researcher`
- **GTM** — `gtm-strategist`, `paid-marketer`, `content-writer`, `brand-marketer`
- **A/B 테스트** — `data-analyst`, `feature-planner` (실험 등록·결과 추적)
- **비즈니스 모델 (가격·결제 연동)** — `business-strategist`, `policy-architect`, `api-developer` (Stripe·PayPal 등 통합)
- **마케팅 / 홍보 / 브랜딩** — `growth` 팀 4건
- **차별화 / 포지셔닝** — `brand-marketer`, `pmf-planner`, `business-strategist`

**구현 매핑**:
- v0.5: 4 디폴트 워크플로 (PMF Discovery / Feature Expansion / Rebranding / Rapid Prototype) (✓)
- v0.5: 워크플로우 메이커 — 사용자 도메인의 *암묵지를 SKILL/워크플로우로* (✓ — 본인 입력 형태)
- v0.6: trajectory miner — 반복 패턴 자동 SKILL 추출 (제안만, ROI 게이트 v0.8.3) (✓)
- **v1.3.x 라인 = primitive·문서 작성체계 내재화** (2026-06-25 박제) — 암묵지 → primitive
  (skill·agent·workflow·goal·cron·docs) 작성·관리 표준을 squad에 내재화. 사전 기획이 아니라
  v1.3.0(messenger UX)에서 출발해 패치로 누적된 라인: 1.3.1 stabilization → 1.3.2 매니저+validate
  → 1.3.3·1.3.4 cron → 1.3.5 planning workflows → 1.3.6 skill·agent authoring → 1.3.7
  workflow·goal·cron authoring → 1.3.8 docs management. (당초 v1.3에 두려던 일정/메모는 별도
  slot으로 이동 — §2.1.)

### 2.4 출시 시점 약속 vs 포스트 출시 진화

| 축 | v1.0 약속 | v1.x 진화 |
|---|---|---|
| 멀티 프로덕트 | multi-org·multi-repo·multi-user (v0.2~v0.8.0 완결) | v1.x 일정·메모 — 별도 slot (지식 온톨로지와 같은 결; 당초 v1.3 → 1.3.x가 primitive 내재화로 전개돼 분리) |
| **24/7 자율 팀 — 본 축이 v1.x leading indicator** | dev_capability + 5종 specialist + 자율 goal (v0.4·v0.8.2) | 인간 승인 지점 정교화·multi-product cross-goal — Q1 박제(b) |
| 실험 중심 기획 | 4 디폴트 워크플로 + 5 기본 goal + 25 specialist + 워크플로우 메이커 | **실험 인프라 신설 (Amplitude 패턴 차용 — Q7 박제)** + 워크플로우/goal/cron 고도화 |

**Leading indicator (Q1 박제 b)**: **24/7 자율 팀** 축이 leading. 측정 지표 = 사용자 메신저 대화 중 *작업 변환률*(대화→워크플로우/goal/cron) · 자동 PR 성공률 · 자율 goal cycle 수 · dev_capability 활용도. 멀티 프로덕트(a)·실험 기획(c)은 자율 팀이 작동해야 의미가 있는 lagging 지표.

### 2.5 기능간 시너지 · 역할 · 시스템 구조

본 문서(roadmap)의 책임은 **시너지·역할·구조·비전**을 명시하는 것. 상세 기획·개발 계획은 `docs/plan/vx.x.x-<theme>.md` 의 leaf 문서에 위임. PM orchestration도 사용자 문의에 응답할 때 본 구조를 따른다 (roadmap = "어디에 속하는가", vx.x.x = "어떻게 만들어지는가").

**시너지 다이어그램**:

```
   사용자 ↔ 메신저 (Discord/Slack) ────┐
                                     ▼
                            ┌── PM 오케스트레이션 ──┐  ← 핵심 통로
                            │  (사용자가 시스템을  │     사용자 통제 수단
                            │   소통·지시·통제)    │
                            └──────────┬──────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
          [대화]                    [작업 3분류]            [메모리·학습]
       (작업 아님 —              (PM이 인지하면          (jsonl + FTS5 +
        아이디어 구체화·            works 채널에           trajectory miner)
        현황 확인)                  스레드 생성)
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
           워크플로우                  goal                   cron
        (task 단위 지시)         (장기 목표 —              (반복 작업)
                                  하루 이상)
                                       │
                                       ▼
                                  PM이 워크플로우+cron 조합으로
                                  자율 진행 (사용자 중간 지시로
                                  추가/변경/생략 가능)
```

**시스템 역할 (boundary — 달성 vs 미달성)**:

| 달성하고자 하는 것 | 달성하지 않는 것 (v0.x~v1.0) |
|---|---|
| 사용자가 코드 보지 않고 메신저로 24/7 자동화 팀 운영 | IDE 대체 — 사용자는 필요 시 직접 코드도 봄 |
| 1인/소규모/n잡 사용자의 멀티 프로덕트 동시 운영 | enterprise SSO·multi-tenant SaaS — 솔로 사용자 1급, 팀은 N개 1인의 형태 |
| 애자일/실험 중심 기획 자동화 (PMF·GTM·A/B·포지셔닝·배포) | 모든 도메인 specialist — 25명 한도, 도메인은 frontmatter로 확장 |
| 메신저 셋업·운영 오류 최소화 (사용자 직접 설정 최소) | 메신저 인프라 자체 (Discord/Slack을 만들지 않음) |
| 자동 PR 생성 + 사용자 승인 머지 | 자동 머지 (영구 거부 — v0.8.2 박제) |
| 일정·메모·암묵지 → 지식 온톨로지로 통합 (v1.x+) | 외부 SaaS 종속 (Notion·Calendar는 MCP로만 연결, 데이터 원본은 사용자) |

---

## 3. 기능 위계 (Feature Hierarchy)

§2의 3축을 capability 단위로 펼친 위계. 각 leaf는 (a) 현재 상태, (b) 다루는 plan 문서, (c) 목표 + 도달 수준의 TBD 표시를 가진다. 사용자(개발자 본인)가 leaf별로 *목표와 도달 수준*을 답하면 본 doc에 박제 — 후속 v1.x plan의 입력.

> **표기**: ✓ 출시됨 · ◐ 기획 완료/구현 대기 · ○ 기획 미수(ideation 필요) · `Q.XXX` 사용자 답변 대기

### 3.1 멀티 프로덕트 운영

#### 3.1.1 워크스페이스 구조 (workspace · org · repo 3-Layer)
- **현재**: ✓ v0.2.x — workspace + multi-org + multi-repo. v0.6 Org Layer specialization. v0.7 클래스 A 사용자 코드 불가침
- **plan**: `v0.2.2-terminology-layout.md`, `v0.6-default-workflow-tuning.md` §2.2, `v0.7-uninstall-lifecycle.md` §4
- **Q.WS**: 목표 / 도달 수준 TBD

#### 3.1.2 멀티 유저 메신저
- **현재**: ✓ v0.8.0 출시 — `command-<handle>` / `works-<handle>` 채널 페어 + 봇 multiplicity (1 user = 1 bot) + author-guard + broadcast 옵션 B
- **plan**: `v0.8-multiuser-messenger.md`
- **목표 (UX 핵심)**: 사용자가 *오류 없이* 봇을 메신저에 연결 + *최소 설정*으로 채널 즉시 활용. 사용자가 코드를 직접 보지 않고 메신저로 모든 작업을 하므로 셋업·UX 정책이 결정적
- **해소된 과거 문제 (v0.8.0)**: (a) Slack 채널 미생성 (`is_private: true` + `auth.test` 기반), (b) 멀티 유저 채널명 충돌(handle 키), (c) 생성자 외 명령 가능(author-guard), (d) UX 정책 부재(channel-bootstrap + handle 충돌 명시적 거부)
- **v0.8 polish (구 v0.8.4 흡수, 2026-05-15)**: `@bot help` 메신저 내부 매뉴얼 + `solosquad init --verify` e2e 검증 + sticky welcome 메시지 + `messenger ensure-channels` 복구 + wizard 단계 6→4 축소 + broadcast cross-user 작업 공유 feed — `v0.8-multiuser-messenger.md` §3.8~§3.13 (별도 v0.8.4 plan 폐기, v0.8 단일 plan으로 흡수)

#### 3.1.3 일정 관리 + 메모
- **현재**: ○ v1.x 별도 slot (번호 TBD — 당초 v1.3에서 분리, 2026-06-25 정정. 1.3.x는 primitive 내재화 라인이 됨, §2.3)
- **plan**: `v1.x-schedule-memo.md` (예정)
- **목표**: 일정 관리 = 멀티 프로덕트의 각 마일스톤 + 개발 진행상황 알림 + 캘린더 앱(Google Calendar 등) 연동으로 개인 일정 통합. *사용자의 완벽한 비서 역할*. 메모 = 일상 생각을 메모 앱(Apple Notes / Obsidian / Notion) 연동해 시스템에서 즉시 읽고 구체적 기획·아이디어로 변환
- **포지셔닝**: **지식 온톨로지(v1.2)와 같은 결**. 사용자가 워크스페이스 위계에서 자신의 지식을 SoloSquad로 모아 SKILL/agent/워크플로우/goal/cron의 성능을 지속 개선해 나간다. 모든 것을 *지식의 관점*에서 관리 — v1.2 지식 온톨로지가 그래프 백엔드 인프라 제공 → v1.x(별도 slot)가 일정·메모를 그 위에 layer로 얹음

### 3.2 24/7 멀티 에이전트 팀

#### 3.2.1 PM 오케스트레이션 (시스템의 핵심 통로)
- **현재**: ✓ v0.3 — long-lived PM session per (user, org) + 슬래시 5종 (`/think /plan /build /review /ship`) + Task tool 위임 + workflow reconciler + `solosquad pm/workflow/rollback` CLI
- **plan**: `v0.3-pm-mode-orchestration.md`
- **역할**: **사용자가 시스템과 소통하고 지시하고 작업하는 핵심 통로**. 사용자는 PM을 통해 시스템을 통제한다. 메신저 메시지는 1차 입력 → PM이 의도 파싱 → 분기 (대화 vs 작업 3분류) → 작업이면 specialist 위임. 본 기능이 무너지면 24/7 자동화 팀 약속이 깨짐
- **목표 / 도달 수준 TBD (Q.PM)**: 자세한 도달 수준은 v1.x ideation 진행 중

#### 3.2.2 25 specialist agents
- **현재**: ✓ v0.1~v0.6 — 4팀 × 25 SKILL.md. v0.5 frontmatter(triggers·collab_pattern·loop_mode·budget). v0.6 Team=Domain + KNOWLEDGE.md co-location + Org Layer modifier
- **plan**: `v0.5-workflow-maker.md`, `v0.6-default-workflow-tuning.md` §2.1/§2.2
- **Q.SP**: 목표 / 도달 수준 TBD — 25명 sufficient or 확장 필요?

#### 3.2.3 자율 goal-runner (장기 목표, 하루 이상)
- **현재**: ✓ v0.4 — 2계층(goal.md + AGENTS.md) + cycle loop + 3단계 가드레일 + CONFIRMING + `goal verify`. CLI 7건
- **plan**: `v0.4-autonomous-engine.md`, `v1.x-workflow-goal-routine-evolution.md` (예정)
- **정의**: **하루를 넘는 장기 목표**. PM이 목표 달성을 위해 *워크플로우 + cron*을 조합해 자율 진행. 사용자가 중간에 워크플로우/cron을 추가/변경/생략 지시 가능
- **기본 탑재 goal 5종** (박제): **PMF 검증 / GTM / A/B 테스트 / 포지셔닝 / 배포**
- **모델 박제 (Q5)**: org당 *여러 goal* 가능. 단 **한 조직에서 동시 active goal은 1개** — 다른 goal은 paused/queued. `solosquad goal run <id>`는 active goal이 있으면 거부. 구현: `<org>/goals/.active-goal` 세마포어 (v1.x goal-runner 고도화)
- **인간 승인 지점 박제 (Q4)**: **(d) cycle 결과 ack** 기본. 단 (i) cycle 진행 중 PM이 `works-<handle>`에 *중간 상태 통지* 지속 (대화 가능한 형태), (ii) 사용자가 보다가 "X 방향 바꿔"·"이 cycle 중단" 같은 *중간 개입* 가능 → PM이 인지 → 다음 cycle 반영 또는 즉시 중단. 화이트리스트 옵션: 특정 goal/SKILL을 "fire-and-forget" 마킹 시 중간 통지 생략 + 자동 ack. v0.4 CONFIRMING 상태머신 확장 — v1.x 정식 plan
- **여전히 TBD**: multi-product cross-goal (1 goal이 여러 org reference) — n잡 사용자 cross-product 자율 최적화 — v1.x ideation 계속

#### 3.2.4 dev capability
- **현재**: ◐ v0.8.2 기획 완료 — SKILL `dev_capability: true` + `dev_permissions` (Bash allowlist/denylist) + PR flow + push/merge confirmation gate. engineering 5 SKILL 박제 + workspace 마스터 토글
- **plan**: `v0.8.2-dev-capability.md`
- **Q.DC**: 목표 / 도달 수준 TBD

#### 3.2.5 워크플로우 메이커
- **현재**: ✓ v0.5 — `_meta/workflow-maker` SKILL (CLARIFY→DRAFT→SANDBOX_PROMPT→AWAIT_CONFIRM→APPLIED) + paperclip budget cap + spec-gate → `goal.md` auto-emit. v0.6 trajectory + freq miner (제안만)
- **plan**: `v0.5-workflow-maker.md`, `v0.6-default-workflow-tuning.md` §3, `v1.x-workflow-goal-routine-evolution.md` (예정)
- **암묵지 → SKILL 1차 source 박제 (Q2 b)**: **사용자 명시 슬래시** — `/create <name>` 또는 PM 대화 중 자연어 "이거 SKILL로 저장해" 인식. 정확도 우선. v0.6 freq miner(반복 패턴 자동 감지)는 *backup* — 사용자가 명시 안 한 패턴은 *제안만* (자동 등록 안 함)
- **2·3차 source (후속 슬롯)**: 외부 자료 import (Notion·Obsidian·MCP — v1.2 지식 온톨로지 정합) → goal-runner keep/discard 역추출 (장기)

#### 3.2.6 메모리 + 학습
- **현재**: ✓ v0.2.4 JSONL append (signals/experiments/decisions/routine-logs) → v0.6 FTS5 cold archive + PM compaction + trajectory miner + freq keyword miner
- **plan**: `v0.6-default-workflow-tuning.md` §3·§4
- **Q.ML**: 목표 / 도달 수준 TBD — trajectory 자동 등록 활성화 게이트 (v0.8.3에서 ROI 4지표 측정 후 결정)

#### 3.2.7 작업 3분류 — 워크플로우 / goal / cron (PM이 인지 + works 채널 스레드)

**대화 vs 작업 구분** (사용자가 명확히 인지해야 함):

| 분류 | 정의 | PM 처리 |
|---|---|---|
| **대화** | 아이디어 구체화·작업 현황 확인·기타 자유 응답 | command-<handle> 채널 안에서 *바로 응답*. 메모리 jsonl에는 기록되지만 works 스레드 생성 안 함 |
| **워크플로우** | task 단위 지시 — "~ 페이지 디자인 개선해줘", "qa해줘", "~ 시장 조사해줘" | PM이 작업으로 인지 → works-<handle> 채널에 *스레드 생성* + specialist 위임 + 진행/완료 보고 |
| **goal** | 하루 이상 장기 목표 — PMF 검증·GTM·A/B 테스트·포지셔닝·배포 | PM이 goal로 인지 → `solosquad goal run` 백그라운드 사이클 시작 → works-<handle> 스레드에 진행 보고 |
| **cron** | 반복 작업 — cron 스케줄 + LLM 또는 결정적 실행 | 명시적 명령으로 추가/제거. 실행 시점에 works 스레드 또는 broadcast 채널에 결과 보고 |

**구분 룰 (README + manual에 명시 의무)**:
- PM이 대화 중 *작업이라고 인지*하면 그 시점부터 작업으로 분기 — works 채널에 스레드 생성됨이 사용자에게 visible signal
- 사용자가 의도적으로 "대화만 하고 싶다" 명시 가능 (예: `/think` 슬래시는 항상 대화 분기)
- 작업 3분류는 *상호 배타적 아님* — goal이 워크플로우·cron을 *조합*해 자율 진행. 사용자가 goal을 새 생성하거나 진행 중 goal에 워크플로우/cron 추가/변경/생략 지시 가능

**plan 문서**: 본 분류 자체는 product-roadmap 차원의 *비전*. 상세 구현(PM의 분류 휴리스틱·works 스레드 명명 규칙·README 가이드) 은 v0.9+ slot에서 다룬다 — 별도 vx.x.x plan 필요. (현재는 v0.3 PM 모드 + v0.4 goal-runner + v0.5 워크플로우 메이커 + v0.2.4 cron이 각각 *분리 동작*)

#### 3.2.8 디폴트 cron 정책 (2026-05-15 박제)

**디폴트 제공 cron = 3건만**:

| cron | 시간 | 목적 |
|---|---|---|
| **Morning Brief** | 08:00 (workspace timezone) | 사용자에게 오늘의 시작 brief — 활성 goal·진행 중 워크플로우·signal 요약 |
| **Evening Brief** | 18:00 | 오늘 결정·완료 사항 + 내일 우선순위 |
| **PM Compaction** | 23:00 | PM session 외부화 (`memory/pm-skills/`) — 컨텍스트 관리 인프라 |

**영구 제거 (v0.8.5)**: Signal Scan (12:00) · Experiment Check (16:00) · Weekly Review (Sun 20:00) · `v06-retrospective-stats`. 사유: 분석 cron은 *디폴트로 강제하기엔 노이즈가 큼* + *비-디폴트로만 유지해도 결국 사용자 도메인 prompt가 있어야 의미 있어서 cron 슬롯을 차지할 가치 없음*. 도메인 분석은 사용자가 작성하는 워크플로우/goal로 표현. v0.2.4 박제 시점에 *제안*만으로 추가됐던 4건을 v0.8.5에서 자산·코드·cron 등록 모두 제거. 기존 워크스페이스의 `background_routines` 키는 forward-compat 위해 *읽기는 무시*로 유지. trajectory miner + freq miner는 별도 인프라 — `pm-compaction` cron 내부에서 호출, 독립 cron 아님.

**유지** (housekeeping, 디폴트 제공 외): `system-housekeeping` (v0.8.5 통합 — 단일 cron 00:00에 ① FTS5 cold archive rotation [구 archive-rotate, v0.6 §4] + ② 로그 retention 14일 [구 log-rotate, v0.8.3] 순차 실행, try/catch 격리). 이는 *시스템 무결성*에 필요 — 디폴트 분석 cron은 아니지만 인프라이므로 항상 활성. v0.8.5 이전 2건 분리는 통합 — UI 표시 1행, 결정적 함수는 2개 분리 유지(코드 동일).

**개인화 박제 (Q6 — 사용자별)**: 디폴트 3 cron 모두 *사용자별 발송*. 각 사용자의 timezone·활성 설정에 따라 자기 봇이 자기 `works-<handle>` 채널에 발송.
- morning brief: 08:00 (각 사용자 timezone 기준)
- evening brief: 18:00 (동일)
- pm compaction: 23:00 (PM session per user라서 자연스레 사용자별)
- workspace 공유 broadcast 채널이 활성화된 경우(§3.6 v2 cross-user feed) brief 요약은 broadcast에도 1회 추가 push (designated 봇만 — 중복 방지)

**구현 결과 (v0.8.5)**:
- `assets/routines/signal-scan.md` · `experiment-check.md` · `weekly-review.md` · `v06-retrospective-stats.md` 4건 *완전 삭제*
- `src/scheduler/routines.ts` ROUTINES 배열: 분석 4건 제거 + 인프라 2건 통합 → 총 9→4 (morning-brief / evening-brief / pm-compaction / system-housekeeping)
- `src/scheduler/index.ts` `resolveSchedules` switch에서 3 case 제거 (signal-scan / experiment-check / weekly-review), 미사용 `weeklyToCron` import 정리
- `src/util/config.ts` `applyWorkspaceDefaults`가 더 이상 `background_routines` 기본값을 주입하지 않음 — load 시 `ws.background_routines`는 있으면 그대로 전달, 없으면 undefined
- `src/util/config.ts` `DEFAULT_WORKSPACE_SETTINGS.background_routines` 상수는 *historical 0.2.1→0.2.4 migration* immutability를 위해 유지 (`@deprecated` 박제)
- `src/scheduler/v06-stats-extract.ts` + `test/v06-stats-extract.test.ts` 삭제 (extractV06Stats 미사용)
- `src/messenger/base.ts` `SYSTEM_THREADS`에서 `system-daily-signals`·`system-experiments`·`system-weekly-review` 제거 (system-errors만 유지)
- `assets/templates/goal.md` `## Signal Trigger` 절 제거 (goal-parser는 optional이라 호환)
- per-user 등록 모델은 *분리 슬롯* — 현재 활성 cron 5건이 모두 user yaml의 timezone·brief 시간으로 이미 동작

### 3.3 애자일 / 실험 중심 기획

#### 3.3.1 디폴트 워크플로 (task 단위 지시)
- **현재**: ✓ v0.5 — PMF Discovery / Feature Expansion / Rebranding / Rapid Prototype 4종 + v0.6 회고로 튜닝
- **plan**: `v0.5-workflow-maker.md`, `v0.6-default-workflow-tuning.md` §1
- **정의**: **task 단위 지시** — PMF·GTM 같은 *장기 목표 (goal)*과 구분. 사용자가 "이 작업해줘"로 시작하는 *유한한* 단위
- **기본 탑재 워크플로** (박제 + 신규 후보):
  - ✓ **시장 조사** — 시장 규모·경쟁사·레퍼런스 → 보고서 생성 (`Desk Researcher`·`Business Strategist`·`Brand Marketer`)
  - ✓ **디자인** — UXUI 개선·디자인 시스템·컴포넌트 (`UI Designer`·`UX Designer`·`Creative Frontend`)
  - ✓ **화면 개발** — 디자인 → 코드 변환 + 통합 (`FDE`·`Creative Frontend`·`API Developer`)
  - ✓ **QA** — 회귀 테스트·검수·버그 reproduce (`QA Engineer`)
  - ✓ **배포** — 빌드·릴리스·rollback (`Cloud Admin`·`Backend Developer`)
  - 기존 4종(PMF/Feature/Rebrand/Prototype)은 *복합 워크플로* 또는 *goal로 승격*해 위 5종을 묶는 형태로 v0.9+ 재정렬 후보
- **goal vs 워크플로우 구분 (사용자 의도 박제)**:
  - **goal** = 하루 이상 + 명시적 metric + PM이 워크플로우·루틴 조합 자율 진행
  - **워크플로우** = task 단위 + 유한 단계 + 사용자가 직접 지시 후 PM이 specialist 위임
  - PMF 검증·GTM·포지셔닝은 *goal* (하루 이상). 시장조사·디자인·화면개발·QA는 *워크플로우* (수 시간 ~ 1일)

#### 3.3.2 specialist 도메인 커버리지
- **현재**: ✓ 25 SKILL이 다루는 도메인:
  - PMF: `pmf-planner`, `user-researcher`, `data-analyst`
  - GTM: `gtm-strategist`, `paid-marketer`, `content-writer`, `brand-marketer`
  - BM: `business-strategist`, `policy-architect`, `api-developer`
  - 차별화·포지셔닝: `brand-marketer`, `pmf-planner`, `business-strategist`
- **plan**: `assets/agents/{team}/{agent}/SKILL.md` 25건
- **Q.SC**: 목표 / 도달 수준 TBD — 각 도메인이 깊이 충분?

#### 3.3.3 실험 인프라 (Amplitude 패턴 차용)
- **현재**: ◐/○ — `<org>/memory/experiments.jsonl` (v0.2.4)만 존재. 실험 등록·결과 추적·통계 분석 별도 인프라는 미설계
- **plan**: `v1.x-workflow-goal-routine-evolution.md` §실험 인프라 (예정)
- **결정 박제 (Q7 a)**: **별도 인프라 신설**. `<org>/experiments/<id>/` 디렉토리 (manifest.yaml + variants + metric + duration + sample_target) + cron으로 결과 fetch + decision-gate. v0.4 goal-runner의 measurer 패턴 차용
- **레퍼런스 — Amplitude AI agents** (사용자 지정): "Ask Amplitude" / "Compose" 등의 데이터 분석 자동화 agent 기술. 차용 패턴:
  - 자연어 → metric/segment 자동 query
  - 자동 anomaly detection·funnel·cohort 분석
  - statistical significance 자동 check (p-value·confidence interval)
  - 결정을 *권고*로 변환 ("이 segment에서 conversion -X% — Y 가설 테스트 권고")
- **흐름**: 사용자/specialist가 실험 정의 → 자동 query·결과 fetch → significance check → 통과 + delta ≥ threshold면 *권고*, 미달이면 *추가 cycle 또는 abandon 권고* → 사용자 ack 후 결정
- **goal 5 기본 중 PMF 검증·A/B 테스트와 정합** — 본 인프라가 있어야 자율 사이클 가능

#### 3.3.4 결제 연동 (BM)
- **현재**: ○ — `api-developer`·`business-strategist` SKILL이 *spec/integration code 작성*은 가능하지만 SoloSquad 자체 결제 인프라 없음
- **plan**: 미수 (v1.x ideation — Stripe·PayPal API 키 관리·거래 데이터 분석 vs 사용자가 직접 통합?)
- **Q.PAY**: 목표 / 도달 수준 TBD

### 3.4 라이프사이클 + 운영

#### 3.4.1 install (init · migrate · update · doctor)
- **현재**: ✓ v0.1~v0.2.4 — `solosquad init` (wizard) + `migrate` (workspace schema 정합) + `update` (npm latest 확인 + self-update) + `doctor` (환경 진단 + `--ci`·`--messenger-check`). v0.8.3에서 update/migrate 흐름도 명확화
- **plan**: `v0.1-cross-platform.md`, `v0.2.3-migration-process.md`, `v0.8.3-onboarding-ux-observability.md` §7
- **Q.IN**: 목표 / 도달 수준 TBD

#### 3.4.2 uninstall + farewell archive
- **현재**: ✓ v0.7 — 5분류(A/A*/B/C/D/E) + WAL-safe SQLite backup + REVOKE-CHECKLIST + PII-NOTICE + lockfile + journal idempotent + cleanup matrix
- **plan**: `v0.7-uninstall-lifecycle.md`
- **Q.UN**: 목표 / 도달 수준 TBD

#### 3.4.3 import + archive verify
- **현재**: ◐ v0.8.1 기획 완료 — `solosquad import <zip>` (--merge default) + `solosquad archive verify/info/list`
- **plan**: `v0.8.1-security-lifecycle-pair.md` §4·§5
- **Q.IMP**: 목표 / 도달 수준 TBD

#### 3.4.4 observability (logger · logs CLI)
- **현재**: ◐ v0.8.3 기획 완료 — logger 확장(레벨·파일·rolling) + `solosquad logs` CLI + 4 운영 jsonl 통합 조회
- **plan**: `v0.8.3-onboarding-ux-observability.md` §5
- **Q.OB**: 목표 / 도달 수준 TBD

#### 3.4.5 API stability
- **현재**: ◐ v0.8.1 기획 완료 — 6 schema_version의 bump 룰 + deprecation 1 minor. v1.0에서 약속 발효
- **plan**: `v0.8.1-security-lifecycle-pair.md` §6, `docs/policy/schema-stability.md` 예정
- **Q.API**: 목표 / 도달 수준 TBD

### 3.5 보안 + 권한

#### 3.5.1 사용자 코드 불가침 (클래스 A)
- **현재**: ✓ v0.7 — repositories/ 트리는 enumerate 자체 안 함, A* whitelist 길이 1
- **plan**: `v0.7-uninstall-lifecycle.md` §4
- **Q.SEC1**: 도달 (확정. 추가 변경 없음 — 영구 정책)

#### 3.5.2 dev_capability + workspace 마스터 토글
- **현재**: ◐ v0.8.2 기획 완료 — SKILL 박제 + workspace `dev_capability.enabled` 마스터
- **plan**: `v0.8.2-dev-capability.md` §3
- **Q.SEC2**: 목표 / 도달 수준 TBD

#### 3.5.3 push/merge confirmation gate
- **현재**: ◐ v0.8.2 기획 완료 — 자동 머지 영구 거부 + 30분 timeout + audit log
- **plan**: `v0.8.2-dev-capability.md` §5
- **Q.SEC3**: 목표 / 도달 수준 TBD

#### 3.5.4 시크릿 마스킹 + 외부 자원 revoke 안내
- **현재**: ✓ v0.7 — .env *TOKEN/*KEY 패턴 매칭 + REVOKE-CHECKLIST.md 동적 생성 (Discord app ID·Slack 채널·~/.claude/projects)
- **plan**: `v0.7-uninstall-lifecycle.md` §7·§8
- **Q.SEC4**: 도달 (확정)

#### 3.5.5 audit log
- **현재**: ✓ — `<org>/memory/{agent-costs, migration-costs, spawn-decisions, stop-hook-events}.jsonl` 4종 + dev-confirmations.jsonl(v0.8.2)
- **plan**: `v0.6-default-workflow-tuning.md` §2.2·§4
- **Q.SEC5**: 목표 / 도달 수준 TBD — 외부 SIEM sink 필요?

#### 3.5.6 워크플로우 인간 승인 지점 (approval_gates)
- **현재**: ○ — push/merge confirmation gate(v0.8.2)는 있지만 워크플로우 단계 일반 승인 모델 미설계
- **plan**: 미수 (v1.x ideation)
- **Q.SEC6**: 목표 / 도달 수준 TBD — 단계 시작/종료/PRD 변경/cycle 결과 중 어디서 게이트?

#### 3.5.7 사용자별 권한 (per-handle) — Q3 박제: 불필요
- **현재**: ○ — author-guard(v0.8.0)는 채널 owner 검증만. dev_capability(v0.8.2)는 SKILL 단위 박제
- **결정 (Q3 박제 — 불필요)**: 사용자별 차등 권한 모델 *추가하지 않음*. 워크스페이스 전체에 단일 정책 (SKILL `dev_capability` × workspace 마스터 토글). 사용자별 차등이 필요하면 *별도 워크스페이스*로 분리 권고
- **이유**: 솔로/소규모/n잡 시나리오에서 권한 매트릭스 복잡도 < 워크스페이스 분리 단순성. 대규모 enterprise SSO·multi-tenant는 v0.x~v1.0 약속 영역 외 (boundary §2.5 명시)

---

## 4. 사용자 시나리오

§3 기능들이 *실제 사용 시점*에 어떻게 엮이는지 narrative로 정리. 각 시나리오의 *관련 기능* 표기로 위계와 cross-reference.

### S1. 솔로 창업자 — 첫 install부터 첫 PMF Discovery

```
1. alice가 product idea를 막 정함. 1인 창업
2. brew install node git → npm install -g solosquad
3. mkdir ~/solosquad && cd ~/solosquad && solosquad init
   - wizard: workspace 이름·timezone·메신저 선택(Discord)
   - bot token 입력 → handle "alice" 감지
   - 첫 org 생성: "my-saas" → ~/solosquad/my-saas/ 자동 scaffold
4. Discord에 봇 초대. #command-alice + #works-alice 자동 생성
5. solosquad bot (백그라운드 실행)
6. 메신저에 입력: "PMF Discovery 워크플로우 시작. B2B SaaS 인사이트 관리 도구"
   - PM이 PRD 생성 → Research → Planning → Design → Build → Launch 5 stage 위임
   - 각 stage 종료 시 _handoff.md → 다음 stage
   - #works-alice에 진행 상황 thread
7. 1주 후 morning brief에 누적 signal 보고
8. v0.6 freq miner가 alice의 반복 패턴 감지 → SKILL 제안 (수동 승인)
```
관련 기능: §3.4.1, §3.1.1, §3.1.2(솔로 1급 시민), §3.2.1, §3.3.1, §3.3.2, §3.2.6

### S2. n잡 사용자 — 직장 + 사이드 2개 동시 운영

```
1. alice는 직장 다님 + 사이드 앱 A + 부업 컨설팅
2. 머신에 3 워크스페이스 분리:
   - ~/dayjob-prep/   (org "dayjob")  → 채용 트래킹·이력서 워크플로
   - ~/side-app/      (org "side")    → MVP 빌드·PMF 워크플로
   - ~/consulting/    (org "consult") → 고객별 deliverable 워크플로
3. 각각 다른 Discord 봇 토큰 (3 봇 application). 메신저 server는 같아도 OK 또는 분리
4. 각 워크스페이스가 자기 cron으로 brief
5. 메신저에서 채널 페어로 격리:
   - #command-alice-dayjob / #works-alice-dayjob  (실제 명명은 §3.1.2 handle 기반이므로 별도 봇 별도 채널)
6. 각 product의 메모리·workflows·goals 완전 분리
```
관련 기능: §3.1.1(워크스페이스 분리), §3.1.2(봇 multiplicity), §3.1.3(v1.x 일정/메모 — 시간 충돌 관리)

### S3. 소규모 팀 (3명) — 같은 Discord 서버

```
1. alice·bob·charlie가 같은 Discord 서버에서 product 협업
2. 각자 자기 머신·자기 워크스페이스·자기 봇 application
3. 같은 org slug "team-product"로 alice→add org "team-product",
   bob/charlie는 alice의 워크스페이스 가져오는 게 아니라 *각자 자기 워크스페이스에 동일 org 추가*
   (시스템상은 같은 이름의 다른 org. 코드는 git remote으로 공유)
4. Discord 채널: #command-alice/-bob/-charlie + #works-alice/-bob/-charlie
   = 6 채널. 비공개 + 초대만
5. (선택) #solosquad-broadcast opt-in으로 daily brief 공유
   designated 봇: alice의 봇 (workspace.yaml `broadcast_owner_handle: alice`)
```
관련 기능: §3.1.2, §3.5.7(사용자별 권한 — TBD), §3.4.5

### S4. dev capability 사용 — 메신저로 PR까지

```
1. alice가 #command-alice에 "결제 모듈 Stripe 통합해줘. PR까지 만들어줘"
2. PM이 의도 파싱 → Backend Developer SKILL spawn (dev_capability: true)
3. BD가 repo cwd로 이동 → 코드 분석 → src/payments/ 추가 → 테스트 작성 → npm test 실행
4. git checkout -b feat/stripe-payment → commit → 
   푸시 *직전* PM이 alice에게 confirmation 요청 ("git push origin feat/stripe-payment? [y/N]")
5. alice "y" → 푸시 → gh pr create
6. PR URL이 #works-alice에 회신 ("PR #42 https://github.com/...")
7. alice가 외부 git host에서 PR 리뷰 → 직접 merge (자동 머지는 영구 거부)
```
관련 기능: §3.2.4, §3.2.1, §3.5.2, §3.5.3, §3.3.4(결제 — TBD)

### S5. 자율 goal — 밤새 자율 사이클

```
1. alice가 signup_cvr 개선이 막힘
2. solosquad goal new cvr-optim
   → AGENTS.md(워크스페이스 영속 가이드) + goal.md(휘발성 의도)
3. solosquad goal run cvr-optim --hours 8
   → background PM session bg-cvr-optim-<runId> 시작
4. cycle loop:
   - pre-cycle git-snapshot
   - PM이 Task tool로 stage spawn
   - evaluator metric 측정 → keep/discard
   - tracker results.tsv append
   - runtime guard 비용·시간·discard streak 체크
   - CONFIRMING 상태머신 (2회 연속 keep → CONVERGED → ship)
5. 다음 아침 morning brief: "cycle 7회, best signup_cvr +12%, 후보 candidate 추출"
6. alice가 #command-alice에서 "goal cvr-optim status" → 결과 확인 → 채택 또는 새 cycle
```
관련 기능: §3.2.3, §3.2.1, §3.5.5(audit log)

### S6. 마이그레이션 시나리오 — v0.7 → v0.8

```
1. alice가 v0.7로 운영 중. 채널은 #owner-command + #workflow (legacy)
2. npm 0.8.0 출시 발표
3. solosquad update → CLI v0.8.0 설치
4. solosquad doctor:
   "CLI v0.8.0, workspace v0.7.0 — solosquad migrate --apply 권고"
5. solosquad migrate --dry-run → 어떤 키가 추가될지 표시
   ~/.solosquad-backups/<ts>.tar.gz 자동 백업 예고
6. solosquad migrate --apply:
   - workspace.yaml version 0.7→0.8 + messenger 키 추가
   - <org>/.solosquad/users/alice.yaml 자동 생성
   - 자동 backup
7. solosquad bot 재시작: #command-alice + #works-alice 자동 생성
   legacy #owner-command / #workflow는 봇이 더 이상 listen 안 함 (수동 archive 권고)
```
관련 기능: §3.4.1, §3.1.2

### S7. uninstall — farewell

```
1. alice가 SoloSquad를 그만 쓰고 싶음. 데이터는 보관
2. solosquad uninstall --dry-run
   → 무엇이 archive로 / 무엇이 삭제 / 무엇이 손대지 않을지 (repositories/는 절대 안 건드림)
3. solosquad uninstall:
   - precheck: PM/scheduler PID·git drift·workspace git tree·archive 디스크 free 검증
   - WAL-safe SQLite backup → tmp
   - <org>/repositories/<repo>/.solosquad/repo.yaml surgical 추출
   - archive zip 생성 (~/solosquad-archive-myws-<ts>.zip):
     archive.yaml + manifest.tsv + workspace/ + orgs/ + credentials/env.template(masked) +
     REVOKE-CHECKLIST.md + PII-NOTICE.md + manual-revoke-required/*
   - cleanup: .solosquad/·org 자산 삭제. repositories/<repo>/ 트리는 byte-identical
   - REVOKE-CHECKLIST.md를 workspace root에도 사본
4. alice가 archive zip을 안전한 곳에 보관 + REVOKE-CHECKLIST.md대로 Discord/Slack/Anthropic
   토큰 revoke
5. (후일) 다른 머신에서 solosquad import <archive.zip> --merge로 복원 (v0.8.1)
```
관련 기능: §3.4.2, §3.4.3, §3.5.4

### S8. 암묵지 → SKILL 자동 추출 (현재는 제안만)

```
1. alice가 모든 새 워크플로 시작 시 같은 질문 던짐:
   "타깃 segment는?" / "경쟁사 ARPU는?" / "LTV/CAC 목표는?"
2. v0.6 freq keyword miner가 30일 후 N-gram 패턴 감지 (3회 이상 반복)
3. 다음 author 루프에서 PM이 author cooldown 통과 후 제안:
   "이 3개 질문을 'kickoff-questions' SKILL로 자동 로드할까요? frontmatter-only 모드"
4. alice 승인 → SKILL.md draft 생성 → SANDBOX_PROMPT 검토 → APPLIED
5. 다음부터 새 워크플로 시작 시 4채널 freq 자동 로드
6. v0.8.3 ROI 4지표 측정:
   - 30일 제안 N ≥ 5
   - 채택률 ≥ 60%
   - 채택 SKILL의 30일 사용률 ≥ 평균
   - reject cooldown 패턴 < 30%
   → 통과 시 v0.9에서 자동 등록 활성화 (현재는 제안만)
```
관련 기능: §3.2.5, §3.2.6, §3.2.2

---

## 5. 장기 로드맵 (2026-05-12 재배치, **v1.0 정식 출시 도입**)

### 5.1 프리-런치 (v0.x)

| 버전 | 주제 | 문서 | 상태 |
|---|---|---|---|
| `v0.3.x` | PM 모드 + 멀티 에이전트 오케스트레이션 (계층적, depth=1) — 슬래시 5종, `solosquad rollback`, 8-layer spawn 인터페이스 | `docs/plan/v0.3-pm-mode-orchestration.md` | ✓ 출시 |
| `v0.4.x` | 밤새 자율 작업 완료 엔진 (Codex `/goal` + `AGENTS.md` 2계층, Data Reconciliation, 3단계 가드레일, `solosquad goal <verb>` CLI) | `docs/plan/v0.4-autonomous-engine.md` | ✓ 코드 흡수 (v0.5/v0.6 내) |
| `v0.5.x` | 워크플로우 메이커 (4채널 trigger, stateless/stateful 분리, 빈도 카운팅 auto-load) | `docs/plan/v0.5-workflow-maker.md` | ✓ 출시 |
| `v0.6.x` | 디폴트 워크플로우 튜닝 + **토폴로지 재편**(Team=Domain, Org Layer specialization, Workspace Knowledge) + 메모리 아카이브(FTS5) | `docs/plan/v0.6-default-workflow-tuning.md` | ✓ 출시 (2026-05-14) |
| `v0.7.x` | Uninstall & Lifecycle (Farewell Archive) — `solosquad uninstall`/`logout`, 데이터 5분류(A/A*/B/C/D/E), 사용자 코드 불가침, WAL-safe SQLite backup, REVOKE-CHECKLIST 자동 생성, journal-기반 idempotent 재개, concurrent-uninstall lockfile, PII-NOTICE 동봉 | `docs/plan/v0.7-uninstall-lifecycle.md` | ✓ 출시 (2026-05-15) |
| **`v0.8.0`** | **Multi-User Messenger** — 같은 Discord 서버·Slack 워크스페이스에 N명 설치. `command-<handle>` / `works-<handle>` 채널 페어, 봇 multiplicity (1 user = 1 bot application), author-guard, broadcast 옵션 B (opt-in + designated 봇만 발송), handle 충돌 명시적 거부 | `docs/plan/v0.8-multiuser-messenger.md` | ✓ 출시 |
| `v0.8.1` | Security & Lifecycle Pair — npm audit 7건 해소(undici/discord.js), `solosquad import <zip>` (archive 페어 완결), `solosquad archive verify/info/list`, API stability 정책 문서 신설, SKILL.md `schema_version: 1` 백필 | `docs/plan/v0.8.1-security-lifecycle-pair.md` | ✓ 출시 |
| `v0.8.2` | Dev Capability — SKILL frontmatter `dev_capability`+`dev_permissions`, Bash allowlist/denylist, push/merge confirmation gate (자동 머지 영구 거부), engineering 5 SKILL 박제 활성, workspace 마스터 토글, gh CLI 인증 점검 | `docs/plan/v0.8.2-dev-capability.md` | ✓ 출시 |
| `v0.8.3` | Onboarding UX + Observability — `solosquad add repo --dry-run` + 기존 리포 마이그레이션 5단계 가이드, master-guide §3/§6/§8/§9/§10 v0.7→v0.8 재정합, logger 확장(레벨·파일·rolling) + `solosquad logs` CLI, trajectory 자동 등록 ROI 게이트 결정 박제 | `docs/plan/v0.8.3-onboarding-ux-observability.md` | ✓ 출시 |
| `v0.8 후속 polish` | **메신저 UX polish (구 v0.8.4 명목 흡수)** + broadcast cross-user 작업 공유 feed + goal 1-active-per-org 모델 + 디폴트 cron 3건 축소. 별도 minor/patch 버전 미고정, v0.8 단일 plan(`v0.8-multiuser-messenger.md` §3.8~§3.13 + §3.6 v2)에서 다음 patch가 흡수 구현 | `docs/plan/v0.8-multiuser-messenger.md` §3A | 기획 완료, 구현 대기 |
| `v0.8.4` | **CLI Surface Reduction** — `uninstall` 플래그 8→5 (`--mode <full\|keep\|archive-only>`로 3-state mode 단일화, `--scrub-content` 폐기), `add repo --inspect` alias 제거, `import --merge`/`--replace` → `--mode <merge\|replace>`, `agent validate --corpus` 내부 이동, `solosquad backup list\|delete\|purge` subgroup 신설(`migrate --list-backups`/`--delete-backup`/`uninstall --also-purge-backups` 흡수), v1.0 surface freeze 체크리스트 박제. v1.0 진입 전 마지막 비파괴적 플래그 정리 슬롯 — api-stability §4 "Removing a flag is major" 발효 직전 | `docs/plan/v0.8.4-cli-surface-reduction.md` | 기획 완료, 구현 대기 |
| `v0.9.x` | 안정화 + 자체 사용 검증 — 1주~1개월 self-dogfood, i18n 정책, `.github/ISSUE_TEMPLATE/`, trajectory 자동 등록 활성화(v0.8.3 4지표 통과 시), 디폴트 cron cleanup 마이그레이션 | `docs/plan/v0.9-self-use-and-i18n.md` (예정) | 기획 미수 |

### 5.2 정식 출시 마일스톤

| 버전 | 주제 | 비고 |
|---|---|---|
| **`v1.0.0`** ✓ 출시 (2026-05-21) | **정식 출시 (formal launch)** | `schema-stability.md` 공개 약속 발효 + 42 CLI 명령 surface freeze + 진입 흐름 정합 2건 흡수 (`solosquad init` Step 1.5에 Claude login 흡수 + repo 등록 path-reference 단일화). 메신저는 Discord 단일, Slack은 post-v1.0 슬롯. 자세히 `docs/plan/v1.0-official-launch.md` |
| **`v1.0.1`** ✓ 출시 (2026-05-22) | **첫 patch — discord deprecation + 다중-repo 라우팅** | (a) discord.js `ready`→`clientReady` deprecation fix (v15 silent-failure 사전 차단), (b) repo `role` prompt 제거 — 사용자 메시지 routing 에 일절 관여 안 했던 cargo cult 필드, (c) `@<slug>` mention pre-processor + PM SKILL.md "Multi-Repo Intent" 신설 — GitHub Slack `@<repo>` 패턴, routing 비용 0, *"한 agent 가 여러 repo"* 포지셔닝과 일관성 회복. 자세히 `docs/plan/v1.0.1-discord-ready-deprecation.md` |
| **`v1.0.2`** ✓ 출시 (2026-05-22) | **Discord author-guard 정합 + 온보딩 reorder** | v1.0.1 publish 직전 발견된 author-guard false positive 해소 — `Discord username: seungw1n.` (trailing dot) 같은 케이스가 채널명 charset `[a-z0-9_]` 와 *영구 mismatch* 임을 정직히 박제, Discord author identity 는 *gate 아닌 audit log* 로 강등. **handle = SoloSquad 유일 canonical user ID** 로 격상. 동시에 온보딩 narrative 정합: Step 5.2 (handle) → Step 3.5 (메신저 토큰 직후) 이동 + *"다른 멤버와 다르게"* guidance 추가. Slack 동등 fix 는 v1.0.3 슬롯. 자세히 `docs/plan/v1.0.2-discord-author-guard-decoupling.md` |
| **`v1.0.3`** ✓ 출시 (2026-05-22) | **Discord 5-bug fix — migrate · sudo · guild-org binding · update next-step · category rename** | v1.0.2 publish 직후 사용자 dogfood 가 노출한 *연속 5건* 함정. (A) `versionMatches` slice 산수 → patch-level migration 영구 차단 해소, (B) `npmGlobalInstallCmd` UID 추측 → prefix 권한 체크로 nvm/brew false sudo 제거, (D) guild-org binding 의 v0.1.x 서버명 휴리스틱 → `ownOrgSlug` 직접 사용, (E) `update` post-install workspace lag 안내 신설, (F) Discord 카테고리 이름 `"AI Team Reports"` → `"solosquad"` (legacy 매칭 유지). 6번째 누적 fix — *외부 자유 입력 ↔ 내부 슬러그 문자열 비교* + *v0.1.x vocab 잔재* 두 패턴 정직 박제. Slack 동등 author-guard 제거는 v1.0.4 슬롯. 자세히 `docs/plan/v1.0.3-discord-triple-bug-fix.md` |
| **`v1.0.4`** ✓ 출시 (2026-05-23) | **Discord config.yaml 자동 생성 + Slack author-guard 통째 cleanup + 5-hop 진단 메시지** | v1.0.3 Bug D fix 자가비판 박제 — `syncGuildProductMapping` 의 *서버명 휴리스틱* 만 제거하고 *file-existence early-return* 분기는 그대로 둬서 사용자가 v1.0.3 설치 후에도 *"No product linked to this server"* 받음. v1.0.4 = (G) load-or-empty + auto-write 패턴으로 진짜 fix — 봇이 자기 정보로 `<org>/discord/config.yaml` *첫 시작 시 자동 작성*. (H) v1.0.2 약속의 마무리 — Slack 어댑터 author-guard 호출 제거 + `src/bot/author-guard.ts` + `test/author-guard.test.ts` 통째 삭제. (P 일부) *9-reference 조사 (OpenClaw / Claude Code Channels / LangChain / AutoGen / Composio / llmcord / openai-gpt-discord-bot / LibreChat / AnythingLLM)* 합의 Best Practice 5 도입 — generic "No product linked" → 5-hop 진단 메시지 (ownOrgSlug / config.yaml 부재 / guild_id 미박제 / guild_id 불일치 / loadProducts 미포함). 7번째 누적 fix + plan §7.2 에 조사 결과 박제. 나머지 L+M+N+O 는 v1.0.5 ~ v1.1 슬롯. 자세히 `docs/plan/v1.0.4-messenger-config-auto-create.md` |
| **`v1.1.0`** ✓ 출시 (2026-05-27) | **Multi-Agent Team Architecture — Chief + 4 main + 20 specialist + 18 skill + 4 team** | Single PM session 패러다임을 Team-Centric Multi-Agent 로 격상. **Chief** (org-level supervisor, 사용자 대면) + **PM** (workspace-bundle, 자율 product manager, 사용자와 직접 대화 안 함) 역할 분리. 20 specialist 평탄 (4 병합 + paid→performance rename). 18 skill (problem-definition 6-Phase / discovery / planning / reflection / orchestration). 9-layer JIT + team OKR 자동 inject. open_questions[] 프로토콜 (PM↔Chief async batch). Chief 6+1 stage state machine. Goal queue (1-active-per-org semaphore). 4 workflow templates. Leading indicator 5 지표. 사용자 직면 버그 fix — `solosquad init` / `add-org` / `sync` 가 `.claude/agents/` 채우게 함. 외부 reference: Hermes V2 + gstack (Garry Tan) + RO-PNA pna-builders + phuryn pm-skills. 메신저 연결은 v1.2 별도. 자세히 `docs/prd/v1.1-multi-agent-team-architecture.md` |
| **`v1.3.1`** ✓ 출시 (2026-06-18) | **Legacy asset cleanup — v1.1 리오그가 절반만 끝낸 구 `assets/` 비우기 + post-release CI/deps 하드닝** | 사용자 대면 기능 0 의 안정화 릴리스. **CI/deps** — `node-cron` 3→4 (TS 재작성으로 `uuid` 의존 제거 → moderate 2건 소멸, override 불요), `npm audit` moderate 비차단 가시화, Node baseline `>=20`/matrix `[20,22]`/`fail-fast:false`. **`assets/agents/` 제거** — v1.1 이 캐노니컬 로스터를 top-level `agents/`(main+specialists)로 옮긴 뒤 안 지워진 구 taxonomy(25개) 삭제, `init` 이 로스터 2벌 복사하던 오염 해소, 죽은 `collab_pattern` 테스트·스크립트 은퇴. **구 `assets/` 정리** — `routines/`→top-level `schedules/` 배선(v1.1 `getSchedulesDir` 는 죽은 코드였음), `knowledge/`·`core/` fallback 을 bundle 로, v0.3 `orchestrator/` Chief 정체성 문서(→`agents/main/chief/SKILL.md` 로 대체) 제거, `templates/` 22개 전부 정리 — 15개 은퇴(pre-v1.1 워크플로 스캐폴드) + 7개 live 는 owning 코드에 문자열 상수로 인라인(파일 이동이 동반하는 번들 화이트리스트 회귀까지 원천 차단). `assets/` 에는 `docker/`+`.env.example` 만 잔존, v1.1 §1.2 체크박스 종료. **기획(docs-only)** — SKILL.md 작성법 크로스벤더 조사 + v1.3.2 도메인 매니저 PRD. 782 test green, tarball 동작 무변. 자세히 `docs/prd/v1.3.1-legacy-asset-cleanup.md` |
| **`v1.3.11`** 구현 완료 (2026-06-25) | **Windows `--add-dir` 누락 핫픽스 (hotfix on 1.3.10)** | 1.3.10 업데이트 후에도 Windows 봇이 등록 repo 못 읽던 2차 결함. **근본원인:** Windows `spawn(shell:true)` 명령문 조립 시, 줄바꿈 든 `--append-system-prompt` 가 cmd.exe 명령을 끊어 뒤의 `--add-dir` 소실(1.3.10 이 고친 stream-json 무시와 별개; macOS/Linux 비영향). **수정:** 시스템 프롬프트를 temp 파일로 빼 `--append-system-prompt-file` 사용 → 멀티라인이 명령줄에 안 올라가 --add-dir 보존. 회귀 테스트. 마이그레이션 no-op. Windows 1.3.10 사용자는 1.3.11 로 업그레이드. 자세히 `docs/prd/v1.3.11_windows-add-dir-prompt-newline-hotfix.md` |
| **`v1.3.10`** 구현 완료 (2026-06-25) | **봇 권한 UX + claude-code `--add-dir`/stream-json 호환 수정** | 운영 안정화 patch(authoring 테마 직교, 1.3.1 동형). 세 봇 결함이 "등록 repo 못 읽음/작업마다 승인"으로 수렴. **(A)** claude 2.1.x 가 `--input-format stream-json` 입력에서 `--add-dir` 무시 → 봇 입력을 plain-text stdin 으로 전환(출력 스트리밍 유지), 회귀 테스트. **(B)** 안전 작업(repo CRUD·Bash·WebFetch·git commit·feature push) 승인 0; protected push·PR merge/close 만 게이트(`classifySensitive` 재정의, feature push=allow). **(C)** Chief 시스템 프롬프트 환각 "허용 눌러주세요" 제거. 마이그레이션 no-op(spawn 매 턴 재생성). 987 test green. 자세히 `docs/prd/v1.3.10_bot-permission-ux-and-add-dir-fix.md` |
| **`v1.3.9`** 구현 완료 (2026-06-25) | **마이그레이션 충돌 핫픽스 + 버전 3자리 모델 정정** (hotfix on 1.3.8) | dogfood `migrate --apply`(1.2.9→1.3.8)가 번들 `1.3.2→1.3.3`에서 verify 실패로 노출. **(A)** `moveDir` 재귀 병합+충돌 처리 — `.solosquad/{schedules,routines}`를 같은 `crons/`로 접을 때 동명 항목이 남던 결함 수정(더 새 schedules 채택, 중복 드롭=백업 보존), 회귀 테스트 추가. **(B)** 마이그레이션 1.3.2~1.3.8 재검토(블로킹은 1.3.2→1.3.3 하나). **(C)** 버전 항상 3자리(4자리 금지), 핫픽스=다음 patch+자체 핫픽스양식 PRD; `prd` 스킬에 3자리 규칙+핫픽스 양식 반영, `1.3.8.1` 표현 제거. v1.3.8 은 결함 포함 상태로 npm 게시됨 → 1.3.9 는 그 위 동일-day 핫픽스(1.3.8 사용자는 1.3.9 로 업그레이드). 자세히 `docs/prd/v1.3.9_migration-collision-hotfix.md` |
| **`v1.3.8`** 구현 완료 (2026-06-25) | **문서 관리 체계 + `docs` 스킬 — 문서 스코프 repo 단위 확정 + 두 계층 분리 + 작성 8규칙** | 1.3.x "primitive·문서 작성체계 내재화" 의 docs 조각. **(A) 스코프 = repository 단위** — docs·버전 repo 종속(각 repo 자기 `package.json`·`docs/`·CHANGELOG·manual, 독립 x/y/z, 작업≠배포). 두 직교 축: 외부/내부(`package.json.files` 강제) + **repo 계층**(prd·architecture·roadmap·README·CHANGELOG·manual) vs **org 워크스페이스 계층**(ideation·reports=cross-repo). 단일 repo(SoloSquad)는 두 계층 같은 `docs/` 로 접힘. **(B) `docs` 스킬** 분류·명명·PRD↔release버전 1:1(핫픽스=다음 patch 3자리+핫픽스양식 PRD)·게이트·INDEX·shape 분기의 단일 큐레이션 권위(`prd`=per-PRD writer 역할 분리, PM 자율체인 `g) docs`). **(C) `prd` 8규칙** R1–R5 + **R6–R8**(AI 제품 PRD 분기[허용 답변 범위·Eval Plan]·완성도 척도·Given-When-Then AC; ideation 260625 21소스). **(D) 게이트 6종 조건부** 4→6(roadmap·architecture·CHANGELOG·README + manual 조건부 + PRD 존재 + docs/ 누출 불변식). **(E) 재정비** architecture·roadmap → `docs/` 승격, reports/ 신설 + 3 INDEX(산재 리포트 fix-forward). 마이그레이션 `1.3.7-to-1.3.8`(org 계층 강제 시드, repo 계층 무영향=class A 보존). bundle-only. 자세히 `docs/prd/v1.3.8_docs-management.md` |
| **`v1.3.7`** 구현 완료 (2026-06-24) | **workflow/goal/cron 작성법 내재화 + 번들 워크플로 재구성** | v1.3.6 의 작성권위 패턴을 나머지 3 primitive 로 확장 + 워크플로 재구성 + goal validator. **(A) 단일 코어** `skill-core/core.md`→`primitive-core.md`(§0 분류·조립 = skill·agent 워크스페이스 베이스 / workflow·goal·cron org 조립물[베이스 참조] · §2 암묵지 인터뷰 초안앵커 4-mode · §4 **워크플로 본질 원칙**[목표·근거·방법→결론→핸드오프; 단순 행위=skill] + 기획 **3대 편향 가드**[자기부정·학습편향·확증편향] · §5 rubric). **(B) 매니저 권위+인터뷰** workflow/goal/cron 격상·skill 인터뷰·Chief `[creation_case:N]` 마커(마이그레이션 1급 = 분석→초안→코드에 없는 WHY 추출). **(C) 워크플로 재구성** 레거시 4종+problem-definition monolith 폐기, scqa/five-whys/tdcc skill→워크플로 승격(흡수), mece/xyz skill 유지, idea/market/kpi 본질원칙 재서술(kpi-check = 정렬 게이트). **(D) goal validator** `validateGoal` + `solosquad validate` 5종 커버. published 1.1.0-to-1.2.6 마이그레이션 obsolete seed 제거(user-authorized immutable 예외). bundle-only·사용자 무영향(minor). 981 test green. 자세히 `docs/prd/v1.3.7-workflow-goal-cron-authoring-internalization.md` |
| **`v1.3.6`** 구현 완료 (2026-06-23) | **작성법 내재화 + 자산 자가개선 골격 + 스쿼드 조직 재편(5팀)** | 네 줄기. **(A) 작성 권위** — "좋은 skill/agent"의 표준을 매니저 skill(skill-manager·agent-manager)에 박제하고 공통 ~70%를 공유 코어 `skills/skill-core/core.md`로 단일화(매니저별 `references/`는 도메인 델타만). 검증기 정렬(예약어 anthropic/claude·vague·트리거절·본문 500줄 + 8-word shingle originality 게이트 `src/analyze/originality.ts`), `pm_conventions`·`category` decorative→load-bearing. **(B) 자가개선 골격** — eval 채점(`eval-corpus.ts`: trigger-rate·A/B·train/val split)·refine 게이트(`refine-gate.ts`: held-out 채택·edit 예산·rejected buffer)의 결정적 코어. **판단은 세션의 Claude(Task judge), 산술만 코드** — 별도 API 아님. ②경험층 메모리는 v1.4.0. **(C) CLI** — `asset *` deprecation(→v2.0) + cross-kind 검증을 top-level `solosquad validate` 로 승격. **(D) 스쿼드 재편** — 5팀(core·product·engineering·business·brand), agent 25→19(개명·5건 통합·fde 제거·product-designer/sales/creative-designer 신설), skill 개명(okr·prd·wbs·primitive-review·interview-script) + governance skill(design-system·policy). 번들 actor 개명이나 org overlay 격리로 사용자 무영향(minor). 975 test green. 자세히 `docs/prd/v1.3.6-skill-agent-authoring-internalization.md` + `docs/ideation/260623-squad-org-restructure.md` |
| **`v1.3.5`** 구현 완료 (2026-06-22) | **기획 워크플로우 + 자산 매니저 일관성 — 2 메인/6 서브 합성 + 5자산 CRUD 정렬** | 두 워크스트림. **(A) 기획 워크플로우** — 명사 3종(agent=행위자·workflow=공정·skill=방법, main/sub=호출 위치)으로 기획 도메인 재정렬. 단일 `problem-definition` 을 5개 프레임워크 skill(scqa·five-whys·mece·tdcc·xyz-hypothesis)로 분할, `_workflow/<id>` 서브워크플로 합성(순환/깊이 가드). **2 메인**(new-build·improvement) + **6 서브**(idea-refinement·requirements-analysis·market-research·kpi-check·data-analysis·hypothesis) — 메인 선택은 Chief 맥락 추론 + 애매하면 되묻기. prd-writer 2 양식 + 요구사항 3유형(개발·콘텐츠·리포트, 디자인 내포, 핵심내용+체크리스트) + 리뷰 게이트. 신규 `market-research` skill→`<org>/docs/reports/` 리포트. **(B) 자산 매니저 일관성** — `workflow-maker`→`workflow-manager` 개명(유일 `-maker` 잔재), 매니저=skill 5종 통일(`*-manager` agent 안 만듦, 코드는 결정적 백엔드), cron org 종속(`<org>/crons/`+migration), uniform CLI 바닥(skill/agent/workflow `new`). 947 test green. 자세히 `docs/prd/v1.3.5-planning-workflows.md` |
| **`v1.3.4`** ✓ 출시 (2026-06-21) | **Cron reliability — 배달 버그 수정 + 실패 보고 + timezone/jitter 가드 + 대화형 cron-manager** | 무인 실행을 신뢰 가능하게. **채널 버그** — 빌트인/유저 cron 이 init 이 만들지 않는 `#workflow` 로 post 해 조용히 유실되던 것을 `works-<handle>`(broadcast owner→sole/first user 해소)로 정정; 개인화 brief 의 opt-in 게이트 제거(모든 유저 수신). **실행·실패 보고** — 실패 시 사유와 함께 채널 게시(`[SILENT]` 무관, 연속 실패 노이즈 가드), dead-man's-switch 도 `works-<handle>` 로("실행 누락 감지"). **timezone** — `src/util/timezone.ts`(프리셋·검증·퍼지 제안), `cron new/edit --timezone`, `CRON_TZ_INVALID`. **지터+가드** — `maxRandomDelay`(빌트인 brief 0–120s 기본), `CRON_TOO_FREQUENT`(<5분)·`CRON_DST_WINDOW`·`CRON_JITTER_*`. **미리보기** — `cron new/edit/show` 가 다음 5회 발화(`nextRuns`). **확인+대화형 CRUD** — `cron new/edit` 적용 전 확인(`--yes`), chief cron-manager 섹션(자산 재사용 우선·없으면 생성). **개명** — `pm-compaction→chief-compaction`(코드 전용), `src/scheduler→src/cron`. 927 test green. 자세히 `docs/prd/v1.3.4-cron-mastery.md` |
| **`v1.3.3`** ✓ 출시 (2026-06-19) | **Cron terminology unification — routine·schedule 용어를 단일 cron 으로 통합** | 5개 자산 중 schedule 매니저 + 빌트인 routine 을 단일 명사 cron 으로 통합. 코드 식별자·CLI(`solosquad cron start\|run\|list\|new\|show\|validate`, 구 `schedule`/`schedules`/`run-routine` 대체)·번들 디렉토리 `crons/`·데이터 경로(`.solosquad/crons`, `memory/cron-logs`) 일괄 개명. 1.3.2→1.3.3 마이그레이션이 기존 워크스페이스 디렉토리 자동 이전, `getCronsDir` 가 레거시 override 를 계속 read(무중단). 875 test green. 자세히 `docs/prd/v1.3.3-cron-terminology.md` |
| **`v1.3.2`** ✓ 출시 (2026-06-19) | **Asset lifecycle managers (skill·agent·workflow·goal·schedule) + 에셋 채택** | 5개 1급 자산에 공통 매니저 추상(validate/list/show + 공유 graph·validation·guardrail·naming 코어). **agent 매니저 신설**(`validate --graph` — 위임 그래프 검증). **에셋 채택** — `adopt <repo> [--apply] [--classify]` 가 외부 repo 의 skill/agent/workflow/schedule 발견·검증·additive 채택(namespace), 번들 스코프 cwd-독립 결정화. **CLI 정리(conversational-first)** — 통합 입구 `asset list\|show\|validate <kind>` + `commands` 일람; LLM 동사(review·생성보조)는 `asset-review` 스킬·author 루프로 이관해 CLI 에서 제거; `skill-author→skill-manager` 개명; `analyze repo`→`adopt` deprecate. 870 test green. 자세히 `docs/prd/v1.3.2-asset-managers-validate.md` |
| **`v1.3.0`** ✓ 출시 (2026-06-16) | **메신저 UX 대개편 — dev-confirm 승인 게이트 + 인터랙션 컴포넌트 + 산출물 파일화** | Chief 와 상호작용하는 방식 전체를 끌어올리는 안전망 합류 (누르기 전 확인 → 누른 직후 되돌리기 → 작업 중 🛑 중단). **Part A** — v0.8.2 이후 dormant 였던 dev-confirm 게이트 라이브화: PreToolUse hook 이 `git push`/`gh pr merge|close` 가로채 보호 브랜치(main/master/develop) 직 push 차단, feature 브랜치는 `pending-confirms/<id>.json` 파일 IPC → 봇이 ✅승인/❌거절 카드 게시 → 승인 시 push 진행 + `dev-confirmations.jsonl` 에 커밋해시·workflow-id 매핑. 실패정책: timeout=차단 / hook 오류=fail-open (보호 브랜치는 항상 차단). hook 단독 게이트 (승인된 push 가 정적 deny 에 막히지 않도록 dev-ON push deny 제거, settings 작성 실패 시에만 fail-closed fallback). config `pm.git`. push 알림은 영구 비범위 (GitHub→메신저 네이티브 webhook 위임). **Part B** — 텍스트 y/n 퇴출: `discord-approval` (✅/❌ + 2단계 거절 확인 + 클릭 후 비활성화), `discord-choice` (버튼 ≤5 / 셀렉트 6+ + 되돌리기 유예), `askApproval`/`askChoice` + bridge poster (Slack 텍스트 폴백). 🛑 중단 + 실시간 stage narration (P0) 선행 머지. **Part C P1** — 긴 답변(≥1500자) `<org>/artifacts/` 저장(git 버전) + Discord 첨부·카드. 비범위(후속): P3 토큰 스트리밍 · 리액션 토글④ · Slack Block Kit 패리티 · 커밋 trailer 스탬프 · P2 아카이브 채널. 790 test green. 자세히 `docs/prd/v1.3.0-dev-confirm-gate-live.md` |
| **`v1.2.10`** ✓ 작성 (2026-06-16) | **Consolidation Cleanup — 직전 버전이 남긴 잔재 정리** | v1.1·v1.2.9 가 남긴 미완·투기성 산출물을 걷어내 클린 베이스라인 확보(새 기능 0). 3 Part patch (hot-path 무변경). **Part A** — v1.1 PM→Chief 리브랜딩 잔재 정리: CLI `chief status/reset/compact` 정규화 (`pm …` 숨김 deprecated alias), 이벤트 `pm.*`→`chief.*` (read-compat), `PmConfig`→`ChiefConfig`, SKILL 정체성 갱신. 영속 계약 (yaml `pm:` 키 · `pm-compaction` 루틴 · `system-pm-compaction` 스레드 · `memory/pm-skills/`) 은 KEEP (후속 마이그레이션). **Part C** — v1.2.9 의 `git-<handle>` VCS 채널 + 자체 push 알림 (`git-event-notify.ts`) 롤백. 결정: SoloSquad 는 알림 기능에 관여하지 않는다 — 필요한 건 push 승인 게이트 (→v1.3.0) 뿐이고 완료 알림은 GitHub→Discord 네이티브 webhook 이 우월. 코드만 제거, 기존 `channels.git` yaml/채널은 inert 방치 (마이그레이션 0). dev-confirm 게이트 KEEP. **Part D** — `deploy/docker/` repo-self-hosting dogfood 스택 제거 (컨테이너는 로컬 src 아닌 npm published 실행 → "repo 를 도커로" 멘탈 모델 허상). 사용자 Docker 는 1급 기능 무손상: `assets/{Dockerfile,docker-compose.yml}` → `assets/docker/` 단일 홈 + `stop_grace_period`·`~/.solosquad`·`~/.solosquad-backups` 병합 (퇴행 0), init 은 워크스페이스 루트로 복사 (목적지 불변). 세션 오케스트레이션은 v1.4.0 으로 분리. 자세히 `docs/prd/v1.2.10-consolidation-cleanup.md` |
| **`v1.2.9`** ✓ 작성 (2026-06-01) | **Discord Application ID 자동 감지 + Invite URL 1-click 복구** | v1.2.6 가 설계한 *OAuth Invite URL 1-click* 온보딩이 **잘못된 API 필드 1개** 때문에 처음부터 죽어있던 것을 정정. `fetchBotIdentity` 가 `GET /users/@me` 응답에서 `application_id` 를 읽었으나 **봇 User 객체에는 그 필드가 없음** → `appId` 영구 undefined → (1) 앱 ID prompt 부재 (2) init 종료 시 invite URL 미출력 (3) `discord invite-url` 실패. v1.2.9 = 정식 엔드포인트 `GET /oauth2/applications/@me` 로 app id 자동 감지 (실패 시 봇 user id 폴백 — Discord 봇은 두 snowflake 동일) + Step 3.5 에 **명시적 Application ID 확인 prompt** 신설 (감지값 Enter 수락 / 실패 시 붙여넣기) + `doctor --discord` Hop 2 동반 수정. CLI freeze 침범 0, schema breaking 0. 자세히 `docs/prd/v1.2.9-discord-app-id-and-invite-url-fix.md` |
| **`v1.2.8`** ✓ 출시 (2026-05-29) | **Bot spawn `--add-dir` for registered repos** | v1.2.6 이후 dogfood — 봇이 `cwd=<org>` 에서 spawn 되면 `C:\Dev\<repo>` 등 path-reference 등록된 외부 repo 에 접근 못 함 ("리포지토리 접근 권한 없음" + Chief 가 사용자에게 `/add-dir` 수동 실행 요청). v1.2.7 가 chief-runner spawn 에 `--add-dir <abs-path1> <abs-path2> ...` 자동 추가 — `<org>/repositories/*.yaml` 의 `path:` 필드를 모두 읽어 한 번에 전달. 워크스페이스 schema 변경 0, runtime 만 패치. Migration `1.2.6→1.2.7` = pure version bump |
| **`v1.2.6`** ✓ 출시 (2026-05-28) | **Messenger Connection (Chief on Discord, auto-connect first)** | v1.1.0 *내부 에이전트 격상* 위에 *외부 가시 UX* 만 얹음. **조직 1개당 1 Chief 봇** (`OrgYaml.chief_name` org 단위, Developer Portal Bot 이름과 동일 권장) + **OAuth Invite URL 1-click** (`solosquad discord invite-url` 합성 + 브라우저 자동 open + clipboard fallback; 권장 permissions bitfield 10건, verification trigger 6건 배제) + **handle 기반 채널 portability** (멀티 Discord 서버 / 추후 Slack 동일 `command-<handle>` / `works-<handle>` 자동 재사용) + **owner-only 게이트** (`message.author.id === messenger_user_id`; v1.0.2 의 *실제* 사유 = 채널명이 user-id 라 봇 인식 실패가 handle 기반 채널로 해소된 이상 reversal 정당, 신규 설치 = ON / 업그레이드 = OFF neutral) + **TRIAGE kind 분기** (Chief 가 `[kind:chat|workflow|schedule|goal]` 마커 출력 → chat 은 command 채널 평탄, 작업 단위는 `works-<handle>` 에 task card embed + thread, stage narration `🗂 작업 분해 / 📤 dispatch / ❓ open_questions` 가 thread 내부) + **`solosquad add-org` 가 완전 동작 상태 부트스트랩** (Chief 이름 + v1.1.0 위계 전체 + problem-definition workflow 기본 시드 + 메신저 inline 연결) + **`solosquad doctor --discord` 5-hop diagnostic** (token shape → REST `/users/@me` → bot_user_id match → guild membership proxy → command 채널 ID, 각 hop attributable + actionable). guildCreate onboarding embed + 2 button (Auto-create / Manual choose), `/chat` slash command 등록 (intent 거부 fallback). CLI freeze 침범 0, schema breaking 0. 53 신규 test (728/728 pass). v1.2.1 위임: referencedMessage chain + thread token budget (둘 다 thread 연속성 인프라 선행 필요). 자세히 `docs/prd/v1.2-messenger-connection-discord-first.md` |

### 5.3 포스트-런치 (v1.x)

| 버전 | 주제 | 문서 |
|---|---|---|
| **`v1.1.0`** ✓ 출시 | **Multi-Agent Team Architecture** — Chief + 4 main + 20 specialist + 18 skill + 4 team. assets/ 폴더 unwrap → 루트 5 디렉토리 (`agents/main` + `agents/specialists`, `skills/`, `user/`, `teams/`, `schedules/`). 팀 4축 재편 (product/engineering/design/marketing). 기존 PM session → **Chief 격상** (org 위계 + 도메인 전문가 겸업) + PM 부활 (workspace bundle, 자율 product manager). 9-layer JIT (team OKR Layer 4a 추가). open_questions[] 프로토콜. Chief 6+1 stage state machine. Hermes V2 + gstack (Garry Tan) + RO-PNA pna-builders + phuryn pm-skills 통합. Harness §7.5 4 권고 흡수. *L2~L5 만 — L1(메신저)은 v1.2* | `docs/prd/v1.1-multi-agent-team-architecture.md` |
| **`v1.2.6`** ✓ 출시 (2026-05-28) | **Messenger Connection (Chief on Discord, auto-connect first)** — 조직 1개당 1 Chief 봇 (Chief 이름 `OrgYaml.chief_name`) + OAuth Invite URL 1-click + handle 기반 채널 멀티-메신저 portable + owner-only 게이트 (v1.0.2 reversal) + TRIAGE kind 분기 → works-handle task card + thread + stage narration + `solosquad add-org` 가 v1.1.0 위계 + problem-definition workflow 기본 시드까지 완전 부트스트랩 + `solosquad doctor --discord` 5-hop. CLI freeze 침범 0 (`add-org` v1.1 신설). 53 신규 test, 728/728 pass | `docs/prd/v1.2-messenger-connection-discord-first.md` |
| **`v1.2.1`** | **메신저 thread 연속성** — referencedMessage chain + LRU cache + thread token budget guard. messageCreate 가 thread 메시지 수신 + thread→workflow_id reverse lookup 인프라 신설 (v1.2.6 의 작업 1개=thread 1개 모델에 *연속 대화*가 얹힘). Slack adapter 동일 슬롯 | (기획 미수 — `docs/prd/v1.2.1-messenger-thread-continuity.md` 예정) |
| **`v1.x`** (별도 slot) | **일정 관리 + 메모** — n잡 사용자 시간·기억 관리. 캘린더 통합·todo·노트 인프라. (당초 v1.3 → 1.3.x가 primitive 내재화 라인으로 전개돼 분리, 2026-06-25 §2.1) `docs/prd/v1.x-schedule-memo.md` 예정 | (기획 미수) |
| **`v1.4.x`** (우산 교체, 2026-07-12) | **가상 시장 수요검증 시뮬레이션** — 합성 페르소나로 관심/전환(결제)/이탈 행동을 구분 구현하고, 5개 실제 사례(Dropbox·Zappos·New Coke·IBM·Buffer) 익명화 백테스트로 실세계 유효성 입증. codex goal + Fable 로 4h+ 장기 자율 research(가설→실험→검증), 산출 `/reports`. §2.3 애자일·실험 기획의 심화. *(출시된 v1.4.0~1.4.2 = 1.3.x 안정화 tail 재분류)* | 우산 `docs/prd/v1.4.0_virtual-market-demand-simulation.md` + 첫 patch `docs/prd/v1.4.3_simulation-core-payment-and-backtest.md` |
| **`v1.5.0`** (통합 우산) | **오케스트레이션 세션 관리 + 커스터마이즈 Reconciliation** — Track A(구 1.4.x 세션 잔여): 토큰 임계 세션 회전(S-2b)·GC(S-3b, 재정의)·공통 실행 컨텍스트 리졸버(S-6)·per-repo 워커 세션(S-4)·하이브리드 역할분리(S-5)·cron 자산 통합(S-7). Track B(구 v1.5.0): user-global overlay(M1)·`update --reconcile` 3-way(M2)·health-gated rollback(M3)·플러그인 정렬(M4 PoC). | `docs/prd/v1.5.0_session-orchestration-and-customization.md` |
| **`v1.6.0`** (보류) | **클라우드 배포 + health 알림** — Railway 기본 승격·원클릭 템플릿·봇 세션 watchdog | `docs/prd/v1.4.5_docker-cloud-deploy-and-health-notify.md`(연기) |
| `v1.x` (cascade-shifted) | **구 v1.1 대시보드 상호작용** (web 대시보드 클라이언트·인박스, 별도 리포 `solopreneur-dashboard`+`solopreneur-api`) | `docs/prd/v1.x-dashboard-interaction.md` |
| `v1.x` (cascade-shifted) | **구 v1.2 지식·암묵지 온톨로지 + MCP 외부 연결** (Notion·Obsidian·API·타 에이전트) | `docs/prd/v1.x-knowledge-ontology.md` |
| `v1.x` (별도) | **LLM backend 추상화** — Claude 단일 호출에서 multi-backend 로 | `docs/prd/v1.x-llm-backend-abstraction.md` |
| `v1.x` (archived) | 워크플로우 / goal / cron *고도화* — Q1~Q7 ideation 7건 완전 흡수 후 본 슬롯은 *역사적 reference* 로 격하 (v1.1 plan §0 박제) | `docs/prd/v1.x-workflow-goal-routine-evolution.md` |

### 5.4 재배치 사유 (2026-05-12)

- 종전 v1.x로 표기되던 **프리-런치 작업 전체를 v0.x로 일괄 다운시프트**. v1.0을 "정식 출시" 마일스톤으로 예약. 현재까지의 코어는 *솔로 파운더 자기 사용*을 위한 빠른 반복 단계이며, *공개 사용자 약속*은 v0.6 완료 시점에 시작.
- PM 모드를 **v0.3**으로 앞당김 — 메신저 인터랙션 패러다임 전환이 다른 모든 기능의 진입점이라서.
- 자율 엔진을 **v0.4**로 — PM이 자율 루프의 진행자이므로 PM 직후가 자연스럽다.
- 구 스킬 분석기 + 스킬 자유도 → **v0.5 워크플로우 메이커**로 통합. 두 트랙이 같은 `SKILL.md` 프론트매터·라우팅·머지 로직을 공유. 통합으로 표면적 절반.
- **v0.6**은 두 트랙으로 분리. (a) 시간 의존 — v0.3~v0.5 실전 데이터로 디폴트 워크플로우 4종 튜닝 + 핸드오프 3변형 표준화(회고, v0.5 출시 4-6주 뒤). (b) 시간 무관 인프라 — Team=Domain 폴더 재편·Organization Layer specialization(`<org>/agent-profile.yaml`·`core/`·`domain/`)·Workspace Knowledge Layer(`.solosquad/knowledge/`)·FTS5 cold archive·trajectory→skill 제안. 인프라 트랙은 v0.5 출시 즉시 착수 가능. 2개 트랙 함께 진행하여 v1.0 정식 출시 전 워크스페이스 토폴로지를 안정화.
- **v1.1 Multi-Agent Team Architecture** *(2026-05-24 cascade)* — *작업 흐름 자체의 재설계*. v1.0.x patch 시리즈와 *narrative 단절*. Hermes V2 5-layer 위 SoloSquad 25 SKILL 재배치 + Main+Specialist 분리 + Team Knowledge 명시화. Harness §7.5 4 채택 권고 흡수. **L2~L5 내부 아키텍처만** — L1(메신저)은 v1.2 로 분리해 표면 폭증 회피.
- **v1.2 메신저 연결 (Discord 우선)** *(2026-05-24 cascade)* — v1.1 L1 위임분. Channel topology · 9-hop diagnostic · Forum Channel · Echo guard. v1.0.4 G+H+P + L+M+N+O Best Practice 본 슬롯에 흡수. Slack 동등 fix 는 v1.2.x patch.
- **구 v1.1 대시보드 / 구 v1.2 온톨로지 → v1.x cascade-shifted** *(2026-05-24)* — 1인 dogfooder 단계에서 *내부 아키텍처 재설계가 dashboard·ontology 보다 leading indicator 가까움* (v1.x ideation Q1 b 박제). 두 슬롯은 v1.x slot 으로 이동 — 파일은 `v1.x-dashboard-interaction.md` / `v1.x-knowledge-ontology.md` 로 rename 완료.

### 5.5 npm 버전 vs 문서 라벨

| 영역 | 정책 |
|---|---|
| **npm 패키지 버전** | semver 그대로 유지 (현재 npm `latest` = 0.2.x). 과거 출시본을 unpublish 하지 않음 |
| **문서 라벨 / 내부 내러티브** | 본 표 기준 `v0.x` ~ `v1.x` 사용. 동일 git 커밋이지만 *서사적 버전*은 다를 수 있음 |
| **마이그레이션 스크립트 파일명** | `src/migrations/scripts/`의 파일명은 npm 실제 버전 유지 (`0.1.x-to-0.2.0.ts` 등). 사용자 워크스페이스의 version 라벨과 매칭하기 위함 |
| **package.json bump 시점** | v0.6 완료 시 npm `1.x` → `1.0.0` 재정렬 또는 `0.6.x`로 다운브랜드 결정 (별도 결정 필요) |

---

## 6. 결정 로그 (주요)

- **2026-07-12 (v1.4.x 우산 교체 — 세션 오케스트레이션 → 가상 시장 수요검증 시뮬레이션)** — 사용자 directive 로 **1.4.x 우산을 재정의**(R1 "우산 재정의 금지" 관례를 명시적 override). **① 1.4.x 신규 우산 = "가상 시장 수요검증 시뮬레이션의 효과성 검증"**(부제: 결제 행동 구현 + 사례 재현 백테스트). major(§2.3 애자일·실험 중심 기획)의 심화 — 합성 페르소나로 관심/전환(결제)/이탈 행동을 구분 구현하고, 5개 실제 사례(Dropbox·Zappos·New Coke·IBM·Buffer) 익명화 백테스트로 실세계 유효성 입증. codex goal + Fable 로 **4h+ 장기 자율 research**(가설→실험→검증 반복), 산출 `/reports`. 우산 PRD `v1.4.0_virtual-market-demand-simulation.md` + 첫 구현 patch `v1.4.3_simulation-core-payment-and-backtest.md`(시뮬레이션 코어 v0). **② 출시된 v1.4.0~v1.4.2 재분류** — 세션 오케스트레이션 "우산 시작"이 아니라 **직전 1.3.x 라인의 버그수정·안정화 tail**(발행 사실·CHANGELOG immutable, 서사만 재분류). 능동 세션 제어(회전·워커 분할·역할분리)는 하나도 미출시였음. **③ 세션 오케스트레이션 → v1.5.x 이관·통합** — 구 1.4.0 PRD 미출시 잔여(S-2b·S-3b·S-4·S-5·S-6·S-7) + 구 v1.5.0 커스텀 reconciliation(M1–M4)을 단일 우산 PRD `v1.5.0_session-orchestration-and-customization.md`로 병합. S-3b 는 코드 실측 결과(archive-rotate 이미 라이브) 착수 전 재정의 필요. **④ 클라우드 배포(구 v1.4.5) = v1.6.0 보류** 유지. **파일 정리:** 구 `v1.4.0-session-orchestration.md`·`v1.4.3_multi-repo-execution-context.md`·`v1.4.4_per-repo-worker-sessions.md`·`v1.5.0-customization-upstream-reconciliation.md` **삭제**(git 히스토리 보존). 영향 docs: 본 entry + `docs/prd/INDEX.md` + 신규 3 PRD.

- **2026-06-27 (v1.4.2 핫픽스 — `solosquad start` 봇 미기동)** — 1.4.1 의 `solosquad start`/`bot --with-cron` 가 스케줄러만 띄우고 봇이 안 뜨던 버그 수정(`startScheduler` 무한 keep-alive 를 봇 경로가 await 해 블록). `keepAlive` 옵션 분리. 클라우드 배포 PRD 초안은 1.4.2→**1.4.3** 으로 한 칸 더 밀림. 영향 docs: 본 entry + architecture §13.6.37 + CHANGELOG [1.4.2] + manual ko/en + `docs/prd/v1.4.2_start-cron-blocking-hotfix.md`.
- **2026-06-27 (v1.4.1 출시 — works-스레드 대화)** — v1.4.0 §11(메신저 표면)의 **Approach A** 출시. **시너지/역할:** "대화로 운영"의 *표면 확장* — 과제(works 스레드)에서 그대로 Chief와 대화. 디스코드 리스너가 command 채널만 받던 **코드 경계**(권한 문제 아님 — `SendMessagesInThreads`+`MessageContent` 이미 충족)를 풀어 works-스레드 메시지를 Chief로 라우팅하고 스레드 안에서 응답 + 스레드↔과제 컨텍스트 주입. **세션 = 단일 공유**(per-과제 격리 = 후속 Approach B). 영향 docs: 본 entry + architecture §13.6.36 + CHANGELOG [1.4.1] + manual ko/en + `docs/prd/v1.4.1_works-thread-chat.md`. *(앞 entry 정정: 클라우드 배포는 1.4.1→**1.4.2**로 한 칸 밀림 — 1.4.1 슬롯을 본 works-스레드 patch가 차지.)*
- **2026-06-27 (v1.4.0 출시 — 세션 오케스트레이션 재범위)** — 세션 오케스트레이션 PRD를 **비파괴 서브셋으로 재범위**해 v1.4.0 출시. **시너지/역할/비전:** v1.x 우산("24/7 대화 운영")의 *(a) 진입 마찰↓·(b) 가용성/관측 가시성↑* 축을 *기반*만 깖. 출시 = S-1(cron 외부경로 repo cwd) · S-2a(`chief.usage` 관측만) · §5.5(leading-indicator opt-in 프리셋 + `avg_context_tokens`) · §5.7(spawn-변경 세션 리셋 헬퍼) · S-3(`_log.md` durable + 3계층 메모리 정형화) · 🆕 세션 시작 마커. **결정:** *세션 교대(S-2b 토큰 임계 핸드오프+회전)와 GC 파괴적 삭제(S-3b)는 사이드이펙트(멀티턴 컨텍스트 증발·크래시-후-미전달 유실·아카이브前 삭제 데이터 유실) 검증 후 v1.4.x로 분리*. 클라우드 배포(구 1.3.12)는 1.4.1로 리넘버. 영향 docs: 본 entry + architecture §13.6.35 + CHANGELOG [1.4.0] + manual ko/en + `docs/prd/v1.4.0-session-orchestration.md`.

- **2026-05-27 (v1.1 §21 Directory & Role Re-architecture — chief 격상 + 5 specialist 병합 + routine→schedule)** — v1.1 plan (2026-05-24 commit) 위에 사용자 directive 흡수. (a) **assets/ 폴더 폐지** → workspace root 5 디렉토리 (`agents/`, `skills/`, `user/`, `team/`, `schedules/`, `templates/`). 기존 *bundled vs user* 위계 모호 해소 — 모든 자산이 *동일 루트* 에 평등 배치 + 3-tier search 그대로. (b) **agents/ 2-tier** — `main/` (4 main bot: chief·designer·engineer·marketer) + `specialists/{team}/` (20 specialists, 5 병합 후). (c) **팀 4축 재편** — strategy→chief / growth→marketing / experience→design / engineering 유지. (d) **PM session → chief 격상**: 기존 orchestrator/SKILL.md = workspace bundled chief template. **organization 위계 거주** — `<org>/agents/main/chief/SKILL.md` 로 copy 후 도메인 전문가화 customize. chief = *orchestrator + 도메인 전문가 겸업*. §14 Board of Agents 톤(이사회 의장)과 명명 일관. 용어 결정 — chief vs director vs head vs lead 중 **chief** (founder 와 충돌 0 + 단일 단어 + Board Chair 정합). (e) **skills/ 신설** — cross-agent leader tier 도구 (workflow-maker · search · verify · code-review · citation · screenshot). 구 `_meta/workflow-maker` 의 cross-team 예외 정책이 `skills/` 디렉토리 정책으로 확장. (f) **team/ 신설** — KNOWLEDGE.md 와 **OKR.md 신설**. 8-layer JIT 의 Layer 4a (team OKR) 신설. (g) **user/ 신설** — founder 정보 (구 core/owner-profile.md, voice.md 흡수). multi-user 의 `<org>/.solosquad/users/<handle>.yaml` 과 위계 분리. (h) **5 specialist 병합** — backend-developer+api-developer → **backend-engineer**, data-collector+data-engineer → **data-engineer**, idea-refiner+scope-estimator → **idea-scoper**, user-researcher+desk-researcher → **researcher**, brand-marketer+content-writer → **content-marketer**. 25 → 20 specialists. (i) **routine → schedule 어휘 통일** — `assets/routines/` → `schedules/`, CLI `run-routine` → `run-schedule` (alias 6개월). 영향 받는 docs: 본 entry + v1.1 plan §21 (220줄 amendment 신설) + §5.3 갱신 + architecture.md §13.7 갱신 + master-guide ko/en §6.1·§"v1.1" 절 갱신. 작업 단위 16 → 21 (#17~#21 추가 — assets unwrap + 4 main 신설 + skills/ 분리 + team/OKR + schedule 어휘).

- **2026-05-24 (v1.x 슬롯 cascade-shift + v1.1 mega-plan 분리)** — v1.x ideation Q1~Q7 답변(2026-05-15) + Hermes V2(2026-05-23) + Harness Report §7.5 + 7 framework supervisor 합의 + 2026-05-23 4-way HTML synthesis 5 입력 합성 결과, **신 v1.1 = Multi-Agent Team Architecture / 신 v1.2 = 메신저 연결(Discord 우선)** 로 결정. 구 v1.1(대시보드) / 구 v1.2(지식 온톨로지) 는 `v1.x-*` 로 cascade-shifted (파일 rename 완료). 분리 사유: (a) mega-plan `v1.1-multi-agent-messenger-collaboration.md` 가 *내부 아키텍처(L2~L5) + 메신저(L1) + Best Practice T~Z + Q~U 통합 → 표면 폭증* → L1 만 v1.2 로 분리하여 각 plan 가독성 회복, (b) 1인 dogfooder 단계 leading indicator (Q1 b — 24/7 자율 팀) 가 *내부 아키텍처 재설계*에 더 가깝고 대시보드는 *lagging indicator*, (c) v1.0.x patch 시리즈와 *narrative 단절* 명시(작업 흐름 자체의 재설계). 신 v1.1 plan = `docs/prd/v1.1-multi-agent-team-architecture.md` (874 lines, §17.3 작업 16건), 신 v1.2 plan = `docs/prd/v1.2-messenger-connection-discord-first.md` (745 lines). v1.x-workflow-goal-routine-evolution.md 의 §1~§6 은 v1.1 plan §0 박제 표로 *완전 흡수* → 원본은 *역사적 reference* 로 격하. 영향 받는 docs: 본 entry + §5.3 / §5.4 갱신 + architecture.md §13.7~§13.10 신설 + master-guide ko/en §6.1 "추후 추가 예정" 표 + §"v1.1/v1.2" 절 갱신.

- **2026-05-15 (밤 — v0.8.4 부활: CLI Surface Reduction)** — 같은 날 오후 박제한 "v0.8.4 plan 폐기" directive에 **amendment**: 그 폐기는 *메신저 UX polish* 한정이었음을 명시. uninstall 플래그 매트릭스(8→5) + `add repo --inspect` alias 제거 + `import` mode 패턴 정합 + `agent validate --corpus` 내부 이동 + `solosquad backup list|delete|purge` subgroup 신설은 **CLI 표면 reduction** 스코프로, v0.8 메신저 영역과 결이 다름. 부활 사유: `docs/policy/schema-stability.md` §4가 "Removing a flag is major"라 박제 → v1.0 진입 후엔 플래그 제거 불가. v0.8.4가 v1.0 freeze 전 **마지막 비파괴적 정리 슬롯**. 본 plan에서 v1.0 surface freeze 체크리스트도 박제(§10) — 12 top-level + 30 subcommands across 11 groups = 42 commands. Deprecation 정책: alias 도입 + warning(v0.8.4) → 제거(v1.0). 즉시 제거(SemVer 약속 발효 전이라 안전): `uninstall --scrub-content`(speculative), `agent validate --corpus`(dev-only). 영향 받는 docs: 본 entry + `docs/plan/v0.8.4-cli-surface-reduction.md` 신설 + `docs/policy/schema-stability.md` §4 갱신 + master-guide.html §6 + CHANGELOG. v0.8 후속 polish entry는 그대로 유지 — 본 v0.8.4와 별도 트랙.

- **2026-05-15 (저녁 — v1.x ideation 7건 박제)** — Q1/Q2/Q3/Q4/Q6/Q7 답변 박제 (Q5는 직전 오후 entry에서). (Q1 b) **leading indicator = 24/7 자율 팀** 축. 측정: 대화→작업 변환률·자동 PR 성공률·자율 goal cycle 수·dev_capability 활용도. 멀티 프로덕트(a)·실험(c)은 lagging — 자율 팀이 작동해야 의미. (Q2 b) **암묵지→SKILL 1차 source = 사용자 명시 슬래시**. `/save-as-skill <name>` 또는 PM 대화 자연어 인식. v0.6 freq miner는 backup(제안만, 자동 등록 안 함). 2·3차는 외부 자료 import(v1.2 지식 온톨로지 정합)·goal-runner keep/discard 역추출. (Q3 불필요) **사용자별 권한 차등 안 함** — 워크스페이스 단일 정책 유지. 솔로/소규모/n잡 시나리오에서 권한 매트릭스 복잡도 < 워크스페이스 분리 단순성. enterprise는 boundary 외(§2.5). (Q4 d 확장) **인간 승인 = goal cycle 결과 ack 기본 + 중간 통지 + 중간 개입 가능**. cycle 진행 중 PM이 `works-<handle>`에 상태 통지, 사용자가 "X 방향 바꿔" 입력 시 PM 인지 → 다음 cycle 반영 또는 즉시 중단. fire-and-forget 화이트리스트 옵션. v0.4 CONFIRMING 상태머신 확장 — v1.x 정식 plan. (Q6 사용자별) **루틴 사용자별 발송** — 디폴트 3건(morning brief 08:00·evening brief 18:00·pm compaction 23:00) 모두 각 user yaml 설정·timezone 기준·자기 `works-<handle>` 채널로. broadcast(§3.6 v2 cross-user feed) 활성 시 designated 봇이 요약만 1회 추가 push. (Q7 a + Amplitude) **별도 실험 인프라 신설** — `<org>/experiments/<id>/` (manifest·variants·metric·duration·sample_target) + cron 결과 fetch + decision-gate. **Amplitude AI agents(Ask Amplitude·Compose) 기술 차용**: 자연어→metric/segment 자동 query·anomaly/funnel/cohort 자동 분석·statistical significance check·결정을 권고로 변환. goal 5 기본 중 PMF 검증·A/B 테스트와 정합 — 본 인프라가 있어야 자율 사이클 가능. **신규 plan slot**: `docs/plan/v1.x-workflow-goal-routine-evolution.md` 작성 — Q1/Q2/Q4/Q5/Q6/Q7 통합 다룸. Q3(불필요)는 본 entry로 종료.

- **2026-05-15 (오후 — 사용자 4건 directives 박제)** — (a) **v0.8.4 plan 폐기, v0.8 단일 plan으로 흡수**. 별도 patch 버전 stamp 안 함. v0.8 시리즈 polish 작업은 *후속 patch*에서 흡수 구현. 사유: 메신저 UX polish는 v0.8.0 모델과 본질적으로 같은 영역이라 doc 분리할 가치 < 통합 plan 가독성. (b) **goal 모델 박제**: org당 N goals 가능하되, **1 org 동시 active goal = 1개**. 다른 goal은 paused/queued. `solosquad goal run`이 active 있으면 거부. 구현은 v1.x goal-runner 고도화 슬롯. (c) **broadcast 채널 정책 v2** (§3.6 v2 — cross-user 작업 공유 feed): 단순 brief 발송에서 *cross-user 작업 status feed*로 격상. 모든 봇이 자기 사용자 작업 status를 broadcast에 push, 다른 봇 PM이 자기 spawn context Layer 7/8에 inject — 결과적으로 alice/bob/charlie의 LLM이 서로의 R&R·진행상황을 자연 인지. 메신저 ACL은 그대로 (channel public/team-visible, push only). 구현: v0.8.0 1차에는 단순 brief만, status feed는 후속 patch (v1.x cross-user collaboration plan). (d) **디폴트 루틴 5종 → 3종 축소**: 유지 morning brief / evening brief / pm compaction. 삭제 signal-scan·experiment-check·weekly-review·v06-retrospective-stats. 사유: 분석 routine은 디폴트로 강제하기엔 노이즈 큼. trajectory/freq miner는 *인프라*로 유지 (사용자가 활성화). archive-rotate·log-rotate는 housekeeping이라 유지. 구현: assets/routines/ 파일 제거 또는 `examples/`로 이동, scheduler 디폴트 목록 수정, v0.9 마이그레이션에서 사용자 확인 후 disable 권장. 영향 받는 docs: 본 entry + v0.8-multiuser-messenger.md(§3.6 v2 + §3.8~3.13 흡수) + product-roadmap §3.1.2·§3.2.3·§3.2.8(루틴 정책 신설)·§5.1.

- **2026-05-15 (제품 목표 박제 + 명령어 축소 결정)** — (a) **§2 제품 목표 3축** 박제: 멀티 프로덕트(1인/소규모/n잡) · 24/7 멀티 에이전트 팀(코드 안 보고 대화로 운영) · 애자일·실험 중심 기획(PMF·GTM·A/B·BM·마케팅·포지셔닝). (b) **일정 관리·메모는 v1.3 슬롯**에 박제 — v0.x~v1.2까지는 product/창업 워크플로우에 집중, 캘린더·todo·노트는 v1.3에서 별도 인프라(별도 plan). (c) **워크플로우/goal/루틴 고도화**는 별도 v1.x 슬롯 — ideation 진행 중(사용자에게 7건 질문 던짐: 우선순위 leading indicator·암묵지 source·권한 모델·인간 승인 지점·multi-product goal 모델·루틴 개인화·실험 인프라). (d) **`solosquad logout` 제거 결정** — v0.7에서 gh CLI 패턴 차용으로 추가했지만 실제 가치 < 복잡도: 봇 정지는 `Ctrl+C`, 시크릿 마스킹은 사용자 수동 또는 messenger 콘솔 revoke로 충분, `logout.lock`은 dev_capability(v0.8.2)·workspace 마스터 토글로 대체 가능. v0.8.3에서 제거 + master-guide에서 절차 안내. (e) **업데이트 ↔ 마이그레이션 구분** 명확화: `solosquad update`(npm latest 확인 + 자동 self-update) vs `solosquad migrate`(워크스페이스 schema 정합). v0.8.3에서 master-guide §6에 흐름도 추가 + doctor가 mismatch 감지 시 어느 쪽을 권고할지 명시. 영향 받는 docs: 본 entry + v0.8-multiuser-messenger.md(n잡 use case 언급) + v0.8.2-dev-capability.md(워크플로우 메이커 보안 노트) + v0.8.3-onboarding-ux-observability.md(logout 제거 + update/migrate 구분 절 추가).
- **2026-05-15 (v0.7.0 출시)** — **install ↔ uninstall 2단 라이프사이클로 완결**. 사유: v0.6까지 사용자 데이터가 누적되었지만 "도구를 제거하면서 데이터를 들고 떠나는" 경로 부재 → 사용자 코드 손상 위험·수동 정리 부담. 핵심 결정: (a) **`solosquad reset`·`solosquad clean` 같은 "초기화" 명령은 영구히 추가하지 않는다** — 재설치는 *uninstall + farewell archive + 새 워크스페이스 init*으로 자연 표현. (b) **사용자 코드(`<org>/repositories/<repo>/`) 절대 불가침** — uninstall의 어떤 플래그로도 변경/삭제 대상 아님. 옵션 자체를 두지 않음 (OpenClaw 안티패턴 회피, Issue #6289). (c) **archive 강제 sequencing** — uninstall은 항상 farewell archive를 먼저 생성. `--no-archive` 같은 플래그 없음. (d) **WAL-safe SQLite backup**(Hermes 차용) + **logout/uninstall 분리**(gh CLI 차용) + **`--keep-state` 매트릭스**(gstack 차용). (e) **PII-NOTICE.md 자동 동봉** + opt-in `--scrub-content` (자동 스크럽은 false-negative 위험으로 v1.x). (f) **journal-기반 idempotent 재개** + **concurrent-uninstall lockfile** + **PM/scheduler PID 거부** (`--force` 없이는). 영향 받는 코드: `src/lifecycle/{classify,manifest,sqlite-backup,lockfile,journal,precheck,repo-meta,revoke-checklist,cleanup,archive}.ts` (10 신규 모듈), `src/cli/{uninstall,logout}.ts` (2 신규 명령), `src/cli/doctor.ts`(v0.7 점검 항목 추가), `src/migrations/scripts/0.6.0-to-0.7.0.ts`(version bump + workspace.yaml.uninstall 기본값). 영향 받는 docs: 본 entry + architecture.md(§"v0.7 lifecycle" 절 추가) + master-guide.html("Uninstall" 절 추가) + AGENTS.md(향후 사용자 갱신).
- **2026-05-13 (오후)** — **워크스페이스 영속 가이드를 AGENTS.md 단일 출처로 통일**. 직전 결정(AGENTS.md + CLAUDE.md 공존)을 폐기. 사유: (1) 같은 위계에 두 파일이 있으면 사용자가 "어디 적어야 하지" 혼란 + 두 출처 발산 위험. (2) AGENTS.md는 Codex·Aider·Cursor·최신 Claude Code 모두 fallback 인식하는 cross-tool de facto 표준. (3) 단일 출처는 v0.4 신뢰 앵커(human-only 편집) 정신과 정합. 변경 내용: v0.4 doc §4.2 — AGENTS.md가 워크스페이스 단일 영속 가이드. SoloSquad가 CLAUDE.md를 더 이상 생성·갱신하지 않음. 마이그레이션은 기존 CLAUDE.md 컨텐츠를 AGENTS.md로 1회 복사 후 CLAUDE.md 원본은 untouched(사용자가 수동 삭제 결정). `solosquad doctor`가 향후 CLAUDE.md 발견 시 "더 이상 사용되지 않음" 안내 출력. master-guide §3.4 + §3.5 Layer 0 표 동기 갱신. 영향 받는 파일: docs/plan/v0.4-autonomous-engine.md, manual/master-guide.html, docs/plan/product-roadmap.md(본 entry).
- **2026-05-13** — **v0.4 차용 구조를 Codex `/goal` + `AGENTS.md` 2계층으로 변경**. 종전 결정(Karpathy autoresearch의 `program.md`)을 폐기. 사유: "용어·개념을 새로 만들지 말고 최신 구조를 따르자" 원칙에 따른 에이전트 도구 용어 매핑 조사 결과 (1) "program"이 autoresearch 한정 어휘이고 (2) 2026-04 Codex CLI 0.128.0의 `/goal` + `AGENTS.md` 2계층이 더 모던하며 (3) `AGENTS.md`가 Aider·Codex·Cursor 진영의 cross-tool 표준이라 SoloSquad 사용자가 다른 도구 병용 시 호환을 자연스레 얻음. 주요 변경: `program.md` → `goal.md`, `<org>/programs/` → `<org>/goals/`, CLI `solosquad run --program <id>` → `solosquad goal <verb> <id>` 7개 서브커맨드(new/list/show/run/status/stop/verify), 워크스페이스 루트에 `AGENTS.md` 신설(CLAUDE.md와 공존, immutable_paths·modifiable_paths·Output 가드 디폴트 박제). autoresearch는 메트릭 게이팅·git rollback의 운영 패턴 원조로만 잔존 (어휘 미차용). 영향 받는 docs: v0.4 doc 전체 재작성, v0.5 doc의 v0.4 의존 표기, V0.3-INTEGRATION-TEST-PLAN.md의 out-of-scope 라인, architecture.md 레퍼런스 목록. 코드 변경은 별도 단계(현재 doc-first).
- **2026-05-12 (오후 4th)** — **v0.1.x 레거시 폴더 정리** (커밋 `0c3bb18`). `33c30c3 Add npm bundled assets`(v0.2.0 refactor) 시점에 청소되어야 했지만 누락된 루트 레거시 5개 폴더(`agents/ core/ routines/ templates/ orchestrator/`) + 빈 `projects/` + v0.1.x bash 스크립트 2개를 제거. **dev 환경 path 해결 버그 동반 수정** — `src/util/paths.ts`가 레거시 루트를 먼저 찾아 `assets/`를 그림자 처리, 23개 미만 agent set + 옛 routines로 작동하던 문제 해소. `.gitignore`·`.npmignore`에서 사망 패턴 정리. **사용자 영향 0** — 해당 폴더들은 이미 `.npmignore` 제외 대상이라 npm 패키지에 포함된 적 없음.
- **2026-05-12 (오후 3rd)** — **워크스페이스 토폴로지 재편 결정** (v0.6 §2.1~§2.3 신설). 누적 5턴 design 대화에서 제기된 3가지 긴장 해소:
  - (a) "동일 역할 specialist가 N개 org에 중복" — **Team=Domain 통합** (§2.1). `agents/_teams/{team}/TEAM_KNOWLEDGE.md` 평행 hierarchy 제거 → `agents/{team}/KNOWLEDGE.md` co-location. 직교 도메인 태그(`domains: [...]` frontmatter) 안 거부 — 두 분류 레이어 병행 부담 회피, team 폴더 자체가 도메인.
  - (b) "조직별 톤·강조점 다른데 SKILL override는 복잡" — **Organization Layer Specialization** (§2.2). `<org>/core/`·`<org>/agent-profile.yaml`·`<org>/domain/` 3종 신설. 25 SKILL override 대신 modifier yaml 1파일. spawn-time 8-layer JIT injection으로 SKILL은 워크스페이스 불변 유지.
  - (c) "리포 스킬이 워크스페이스까지 2단계 위로 올라가는 어색함" — v0.5 analyzer 'role' destination을 workspace agent → `<org>/agent-profile.yaml`로 정정. 리포 스킬은 1단계만 위로 (조직 위계).
  - **Workspace Knowledge Layer** (§2.3) — `.solosquad/knowledge/`·`assets/knowledge/` 신설. 사용자 누적 craft·의사결정 프레임워크·도메인 용어집을 agent SKILL과 분리. 외부 안의 `repo-data-context` 컨셉을 *물리 리포 분리 없이* 폴더로 차용.
  - **외부 안 명시적 거부**: 3-repo 물리 분리 / LangGraph v3 / MCP 기반 내부 스킬 레지스트리 / Vector+Graph DB hybrid — 모두 솔로 컨텍스트에 오버엔지니어링. 차용 가치 있는 3종은 흡수(Educational Nudge 행동 패턴 / 도메인 데이터 단일 출처 컨셉 / `repo-data-context` 분리 발상을 폴더로 변환).
  - v0.3 §3.3 spawn 인터페이스를 처음부터 8-layer로 작성 → v0.3 출시 시점에는 layer 1/2/4/5/6 noop, v0.6 자산 도입 시 자동 활성. 릴리스 간 인터페이스 churn 회피.
- **2026-05-12 (오후, 2nd)** — **보고서×Baseline 비교 결과를 v0.3~v0.6 스펙에 통합**. `docs/reference/AI_Agent_Harness_Report.md`(개념·어휘)와 `docs/trend-record/2026-05-11-baseline-survey.md`(실측·우선순위)를 비교 → 보고서는 추상 어휘 출처, Baseline은 구현 우선순위 출처로 역할 분리. 통합 결과: v0.3에 차용 어휘 매핑표 + 슬래시 5종 + git rollback / v0.4에 Data Reconciliation provenance + 3단계 가드레일 program.md 스키마 + signal-scan active trigger / v0.5에 stateless-vs-stateful frontmatter + 4채널 trigger(slash/keyword/freq/explicit) + 빈도 카운팅 auto-load / v0.6 placeholder 해소 — 핸드오프 3변형(hierarchical/graph/dynamic) + trajectory→skill 제안 + FTS5 cold archive. 거부 항목: 보고서식 사전 가드레일 3계층 구축(솔로 비용 과다), 시맨틱 임베딩 버스(25 agent 규모에 과잉), Salesforce Lineage GUI(이미 git diff Markdown으로 정렬됨), Hermes trajectory 자동 등록(v0.6은 제안만).
- **2026-05-12 (오후)** — **버전 라벨 일괄 다운시프트**: 프리-런치 작업 전체를 `v0.x.x`로 재라벨. `v1.0.0`을 정식 출시 마일스톤으로 예약. 종전 v1.7 웹 대시보드는 v1.1로 이동하되 **콘텐츠 변경** — 대시보드 자체는 별도 리포(`solopreneur-dashboard`/`solopreneur-api`)에서 개발하므로 본 리포는 *상호작용 인터페이스만*. 종전 v1.8 지식 온톨로지는 v1.2로 이동(콘텐츠 유지). 문서 파일명 14개 일괄 rename + 모든 .md 내부 v1.X → v0.X 일괄 치환. npm 실제 출시 버전은 immutable이므로 그대로(0.2.x).
- **2026-05-12** — 장기 로드맵 v0.3~v1.2 재배치. PM 모드를 v0.3으로 앞당기고, 스킬 분석기 + 스킬 자유도를 v0.5(워크플로우 메이커)로 통합. 빈 v0.6은 디폴트 워크플로우 튜닝 슬롯으로 전환. 웹 대시보드 v1.1, 지식 온톨로지 v1.2 (Founder Layer + MCP 외부 연결로 범위 확장). 사유: 메신저-네이티브 패러다임이 다른 모든 기능의 진입점이며, 통합 가능 스펙 두 개를 합쳐 표면적 축소.
- **2026-04-23** — `<org>/repositories/` 중간 계층 도입. 피어 프로젝트(OpenClaw/Ralph/Hermes) 조사에서 "시스템 폴더 + 코드 섞기" 패턴이 없음을 확인. GitHub flat 관례 재현 논거 철회.
- **2026-04-23** — `add repo` 의 org 판정은 "단일=자동, 복수=cwd→질문" 하이브리드. 묻지 않는 편의 vs 오인 방지 균형.
- **2026-04-23** — Legacy `.git` (v0.1.x 시절 product=repo) 정리는 `sync` 에서 사용자 선택(Normalize vs Keep). 마이그레이션 스크립트는 건드리지 않음 (이미 0.2.0 사용자 존재).
- **2026-04-22** — 한 워크스페이스 = 한 메신저 플랫폼. 복잡한 멀티 어댑터 동시 운영을 단순화. 복수 플랫폼 사용자는 워크스페이스를 여러 개 만들어 분리.
- **2026-04-22** — Organization 자동 clone 기능 제거 (v0.3+로 연기 검토). 사용자가 직접 `git clone`.
- **2026-04-22** — Workspace 루트 이름은 사용자 지정(`.solosquad/` 폴더 감지 기반). 기본 이름 `solosquad`, 페르소나 분리용 다중 루트 허용.
- **2026-04-22** — Windows 기본 경로 `~/Documents/solosquad-repos` 폐기. v0.2.0 단일 트리 루트로 통일.
- **2026-04-22** — 문서 파일명(v0.2.2, v0.2.3 등)은 작업 블록 라벨로 유지하고, npm 버전은 semver에 맞춰 v0.1.5 다음 점프를 `v0.2.0`으로 정함. 문서 라벨 ↔ npm 버전은 1:1 매칭 아님.
- **2026-04-21** — 버전 표기는 `vN.N.N` 3자리 고정. 2자리(`v0.2`)는 문서 내 참조 약어로만, 공식 릴리스는 항상 3자리.
- **2026-04-21** — v0.1.3~v0.1.5는 작은 hotfix 연쇄로 빠르게 출시 (dotenv·update·Windows claude.cmd).

---

## 7. 관련 문서

- **종합 개념서 (HTML, 사용자 진입점):** `manual/concept-guide.html` — 컨셉·아키텍처·온보딩·메신저 연결·명령어·운영 가이드·트러블슈팅·FAQ·용어 사전을 메뉴별로 정리. 브라우저로 직접 열어 사용. 구 `manual/setup-guide.md` + `manual/update-migration-guide.md` 내용을 모두 흡수 (2026-05-12 두 md 파일 삭제)
- **아키텍처:** `docs/architecture.md`
- **클라우드 배포 (VPS + systemd):** `manual/cloud-deployment.md`
- **메신저 디버깅 (v0.1.3 ~ v0.1.5 이력):** `docs/v0.2.1-messenger-debugging.md`
- **안전/보안:** `docs/v0.2-safety-security.md`
- **v0.2.2 구조 재편 스펙:** `docs/v0.2.2-terminology-layout.md`
- **v0.2.3 마이그레이션 프레임워크:** `docs/v0.2.3-migration-process.md`

---

## 8. 외부 레퍼런스

### 내부 참조 (이 리포)
- `docs/reference/AI_Agent_Harness_Report.md` — 추상 설계 어휘(Stateless/Stateful, P/E/T, JIT, 3패턴, 가드레일)의 출처
- `docs/trend-record/2026-05-11-baseline-survey.md` — 7개 피어 프로젝트 실측 비교 + SoloSquad 정합성 평가

### 외부 1차 출처 (스펙에서 직접 인용)
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents — initializer + coding agent 이중 하네스, context compaction
- https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk — subagent spawning + MCP SDK 1급 시민
- https://github.com/garrytan/gstack — 슬래시 체인(Think→Plan→Build→Review→Test→Ship→Reflect), v0.3 슬래시 5종 직접 차용원
- https://github.com/nousresearch/hermes-agent — trajectory→skill 자동 요약, hot+cold FTS5 archive (v0.6 §3·§4 차용)
- https://developers.openai.com/codex/use-cases/follow-goals — Codex `/goal` 휘발성 의도 + 모델은 시작·완료만 (v0.4 2계층 구조의 절반)
- https://developers.openai.com/codex/agents-md/ — `AGENTS.md` cross-tool 영속 가이드 표준 (v0.4 2계층 구조의 나머지 절반)
- https://github.com/karpathy/autoresearch — 메트릭 게이트 + git rollback의 운영 패턴 원조 (v0.4가 어휘는 안 차용하고 동작 패턴만 차용)
- https://github.com/phuryn/pm-skills — auto-load + slash 듀얼 트리거 (v0.5 4채널 trigger 영향)
- https://github.com/openclaw/openclaw — npm 퍼블리시 + `update`/`doctor` 패턴
- https://github.com/666ghj/MiroFish — 멀티 에이전트 시뮬레이션 (관찰만, 솔로 도메인에 not-applicable)
- https://github.com/anthropics/claude-code — Claude Code CLI 공식
