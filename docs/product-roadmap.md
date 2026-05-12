# SoloSquad 개발 현황 & 로드맵

> 릴리스된 버전, 진행 중인 계획, 결정 로그, 외부 참고자료를 한 자리에 모은 롤링 문서.

**최종 업데이트:** 2026-05-12

---

## 1. 릴리스 현황

### npm에 배포된 버전 (사용 가능)

| 버전 | 날짜 | 주요 내용 | 문서 |
|---|---|---|---|
| `v0.0.0` | 초기 | 코어 구조 | — |
| `v0.1.0` | — | 크로스 플랫폼 (Windows/macOS/Linux) | `v0.1-cross-platform.md` |
| `v0.1.1` | — | QA 하드닝 | `v0.1.1-qa-hardening.md` |
| `v0.1.2` | — | npm 퍼블리시 | `v0.1.2-npm-publish.md` |
| `v0.1.3` | 2026-04-21 | **hotfix** — `dotenv/config` 로드 누락 수정 | `v0.2.1-messenger-debugging.md` |
| `v0.1.4` | 2026-04-21 | **hotfix** — `solosquad update`의 `package.json` 경로 해석 오류 수정 | 동일 |
| `v0.1.5` | 2026-04-21 | **hotfix** — Windows에서 `claude.cmd` 실행 시 ENOENT | 동일 |
| `v0.2.0` | 2026-04-23 | GitHub-aligned 레이아웃 재편 + 마이그레이션 프레임워크 | `v0.2.2-terminology-layout.md`, `v0.2.3-migration-process.md` |

### 현재 설치 가능 버전: npm `1.2.x` (문서 라벨 `v0.2.4`)

**다음 배포:** `v0.2.1` — v0.2.0 배포 직후 발견된 UX·구조 이슈 해결 + `add org/repo/sync` 명령 도입.

> **문서 파일명 vs npm 버전:** `docs/v0.2.2-*.md` / `docs/v0.2.3-*.md`는 **작업 블록 라벨**. 실제 npm 출시 번호는 semver를 따릅니다.

---

## 2. v0.2.1 블록 — 배포 대기 (2026-04-23)

**핵심 아이디어:** v0.2.0 에서 드러난 UX 버그 수정 + org/repo 관리 CLI 완성 + cross-repo 런타임 기반 + 회귀 테스트.

### 2.1 포함 변경 사항

| 영역 | 내용 |
|---|---|
| **버그 수정** | `solosquad migrate --dry-run` unknown option 해소. 모든 CLI 명령 시작 시 layout 버전 배너(v0.1.x → v0.2.x 사용자도 감지) |
| **구조 변경** | `<org>/repositories/` 중간 계층 도입. 시스템 폴더(`memory/`, `workflows/`, `slack/`)와 코드 저장소 분리. `repository/` 단수 대신 복수형 유지 |
| **신규 CLI** | `solosquad add org <name>` — 워크스페이스에 조직 추가<br>`solosquad add repo <url\|path>` — clone 또는 등록(외부 경로 이동 지원, org 자동 판정)<br>`solosquad sync` — repositories/ 스캔 + `.org.yaml` 동기화 + legacy `.git` 감지 & 정리 안내 |
| **런타임 (A2)** | `src/bot/workflow-resolver.ts` — `resolveOrgCwd()` — 활성 workflow stage 의 `target_repo` → main-role repo → 레거시 루트 순 fallback. 봇·스케줄러 모두 교체 |
| **Init 개선** | Step 5.1 저장소 다중 등록 루프 — URL/경로 반복 입력 |
| **마이그레이션** | `1.2.0 → 1.2.1` no-op 스크립트: 각 org 에 `repositories/` 폴더 자동 생성 + workspace.yaml 버전 갱신 (기존 v0.2.0 사용자 silent 업그레이드) |
| **회귀 테스트 (A3)** | `test/migration-v0.1-to-v0.2.test.ts` — dry-run / apply / multi-messenger / rollback / idempotent / chain to 1.2.1 (6 케이스) |

### 2.2 설계 결정 (2026-04-23)

- **`repositories/` 중간 계층 도입** — OpenClaw / Ralph / Hermes 조사 결과 피어 프로젝트들은 시스템 폴더와 코드를 한 층에 섞지 않음. GitHub flat 관례에 집착할 이유가 약하다고 판단. 시스각적 분리 + 이름 충돌 방지.
- **`add repo` org 자동 판정** — 단일 org 면 자동, 복수 org 면 cwd 기반 추론 or 질문. 반복 질문 피로 최소화 + 오인 가능성 0.
- **Legacy `.git` 정리 타이밍** — 마이그레이션 스크립트가 아닌 `solosquad sync` 에서 처리. 이미 마이그레이션 끝낸 사용자가 자기 페이스로 정리 가능. Normalize / Keep legacy 양 옵션 제공.
- **단수 vs 복수 폴더명** — `repositories/`, `workflows/` 복수 유지. 내용물(다수)과 이름이 일치하는 게 자연스럽고, 기존 yaml 필드(`products:`, `repos:`)와의 일관성 유지.

### 2.3 배포 절차

1. ✓ 코드 구현 (B1, B2, A1, A2, A3)
2. ✓ `npx tsc --noEmit` — 컴파일 통과
3. ✓ `node --test test/*.test.ts` — 8/8 통과
4. ✓ 문서 반영 (v0.2.2 스펙, update-migration-guide, CLAUDE.md)
5. ✓ `package.json` 1.2.0 → 1.2.1
6. ⏳ `npm publish` (OTP 필요)

### 2.4 미구현 (차기)

- Cross-repo workflow 조율(의존 repo 간 PR 타이밍 자동화) — 현재는 `target_repo` per stage 까지만
- Monorepo 감지 (`apps/frontend`, `apps/backend` 분할)
- 채널명 → org 라우팅 정교화 (현재는 기존 product 매핑 로직 재사용)
- Orchestrator 가 workflow 상태를 바꾸는 자동화 ( stage `in_progress` 전환)

---

## 3. 장기 로드맵 (2026-05-12 재배치, **v1.0 정식 출시 도입**)

### 3.1 프리-런치 (v0.x)

| 버전 | 주제 | 문서 |
|---|---|---|
| `v0.3.x` | PM 모드 + 멀티 에이전트 오케스트레이션 (계층적, depth=1) — 슬래시 5종, `solosquad rollback`, 8-layer spawn 인터페이스 | `docs/v0.3-pm-mode-orchestration.md` |
| `v0.4.x` | 밤새 자율 작업 완료 엔진 (autoresearch + Data Reconciliation + 3단계 가드레일 program.md) | `docs/v0.4-autonomous-engine.md` |
| `v0.5.x` | 워크플로우 메이커 (4채널 trigger, stateless/stateful 분리, 빈도 카운팅 auto-load) | `docs/v0.5-workflow-maker.md` |
| `v0.6.x` | 디폴트 워크플로우 튜닝 + **토폴로지 재편**(Team=Domain, Org Layer specialization, Workspace Knowledge) + 메모리 아카이브(FTS5) | `docs/v0.6-default-workflow-tuning.md` |

### 3.2 정식 출시 마일스톤

| 버전 | 주제 | 비고 |
|---|---|---|
| **`v1.0.0`** | **정식 출시 (formal launch)** | v0.6까지 안정화 + 솔로 파운더 자기 사용 검증 완료. 안정 API 약속과 breaking change 정책이 v1부터 시작 |

### 3.3 포스트-런치 (v1.x)

| 버전 | 주제 | 문서 |
|---|---|---|
| `v1.1.x` | 대시보드 상호작용 (대시보드 자체는 별도 리포 `solopreneur-dashboard` + `solopreneur-api`) | `docs/v1.1-dashboard-interaction.md` |
| `v1.2.x` | 사용자 지식·암묵지 온톨로지 + MCP 외부 연결 (Notion·Obsidian·API·타 에이전트) | `docs/v1.2-knowledge-ontology.md` |

### 3.4 재배치 사유 (2026-05-12)

- 종전 v1.x로 표기되던 **프리-런치 작업 전체를 v0.x로 일괄 다운시프트**. v1.0을 "정식 출시" 마일스톤으로 예약. 현재까지의 코어는 *솔로 파운더 자기 사용*을 위한 빠른 반복 단계이며, *공개 사용자 약속*은 v0.6 완료 시점에 시작.
- PM 모드를 **v0.3**으로 앞당김 — 메신저 인터랙션 패러다임 전환이 다른 모든 기능의 진입점이라서.
- 자율 엔진을 **v0.4**로 — PM이 자율 루프의 진행자이므로 PM 직후가 자연스럽다.
- 구 스킬 분석기 + 스킬 자유도 → **v0.5 워크플로우 메이커**로 통합. 두 트랙이 같은 `SKILL.md` 프론트매터·라우팅·머지 로직을 공유. 통합으로 표면적 절반.
- **v0.6**은 두 트랙으로 분리. (a) 시간 의존 — v0.3~v0.5 실전 데이터로 디폴트 워크플로우 4종 튜닝 + 핸드오프 3변형 표준화(회고, v0.5 출시 4-6주 뒤). (b) 시간 무관 인프라 — Team=Domain 폴더 재편·Organization Layer specialization(`<org>/agent-profile.yaml`·`core/`·`domain/`)·Workspace Knowledge Layer(`.solosquad/knowledge/`)·FTS5 cold archive·trajectory→skill 제안. 인프라 트랙은 v0.5 출시 즉시 착수 가능. 2개 트랙 함께 진행하여 v1.0 정식 출시 전 워크스페이스 토폴로지를 안정화.
- **v1.1 대시보드 상호작용** — 웹 대시보드 자체는 별도 리포에서 개발(릴리스 주기·기술 스택·보안 영역 분리). 본 리포는 *상호작용 클라이언트·인박스만* 제공.
- **v1.2 지식 온톨로지** — 마지막에 둔 이유: (a) MCP·A2A 등 외부 통합 스펙(2025-11)이 안정되길 기다리고, (b) 그 전에 누적된 메모리/이벤트 데이터를 그래프 백엔드로 인덱싱하는 게 의미 있어서.

### 3.5 npm 버전 vs 문서 라벨

| 영역 | 정책 |
|---|---|
| **npm 패키지 버전** | semver 그대로 유지 (현재 npm `latest` = 1.2.x). 과거 출시본을 unpublish 하지 않음 |
| **문서 라벨 / 내부 내러티브** | 본 표 기준 `v0.x` ~ `v1.x` 사용. 동일 git 커밋이지만 *서사적 버전*은 다를 수 있음 |
| **마이그레이션 스크립트 파일명** | `src/migrations/scripts/`의 파일명은 npm 실제 버전 유지 (`1.1.x-to-1.2.0.ts` 등). 사용자 워크스페이스의 version 라벨과 매칭하기 위함 |
| **package.json bump 시점** | v0.6 완료 시 npm `1.x` → `1.0.0` 재정렬 또는 `0.6.x`로 다운브랜드 결정 (별도 결정 필요) |

---

## 4. 결정 로그 (주요)

- **2026-05-12 (오후 4th)** — **v1.1.x 레거시 폴더 정리** (커밋 `0c3bb18`). `33c30c3 Add npm bundled assets`(v1.2.0 refactor) 시점에 청소되어야 했지만 누락된 루트 레거시 5개 폴더(`agents/ core/ routines/ templates/ orchestrator/`) + 빈 `projects/` + v1.1.x bash 스크립트 2개를 제거. **dev 환경 path 해결 버그 동반 수정** — `src/util/paths.ts`가 레거시 루트를 먼저 찾아 `assets/`를 그림자 처리, 23개 미만 agent set + 옛 routines로 작동하던 문제 해소. `.gitignore`·`.npmignore`에서 사망 패턴 정리. **사용자 영향 0** — 해당 폴더들은 이미 `.npmignore` 제외 대상이라 npm 패키지에 포함된 적 없음.
- **2026-05-12 (오후 3rd)** — **워크스페이스 토폴로지 재편 결정** (v0.6 §2.1~§2.3 신설). 누적 5턴 design 대화에서 제기된 3가지 긴장 해소:
  - (a) "동일 역할 specialist가 N개 org에 중복" — **Team=Domain 통합** (§2.1). `agents/_teams/{team}/TEAM_KNOWLEDGE.md` 평행 hierarchy 제거 → `agents/{team}/KNOWLEDGE.md` co-location. 직교 도메인 태그(`domains: [...]` frontmatter) 안 거부 — 두 분류 레이어 병행 부담 회피, team 폴더 자체가 도메인.
  - (b) "조직별 톤·강조점 다른데 SKILL override는 복잡" — **Organization Layer Specialization** (§2.2). `<org>/core/`·`<org>/agent-profile.yaml`·`<org>/domain/` 3종 신설. 25 SKILL override 대신 modifier yaml 1파일. spawn-time 8-layer JIT injection으로 SKILL은 워크스페이스 불변 유지.
  - (c) "리포 스킬이 워크스페이스까지 2단계 위로 올라가는 어색함" — v0.5 analyzer 'role' destination을 workspace agent → `<org>/agent-profile.yaml`로 정정. 리포 스킬은 1단계만 위로 (조직 위계).
  - **Workspace Knowledge Layer** (§2.3) — `.solosquad/knowledge/`·`assets/knowledge/` 신설. 사용자 누적 craft·의사결정 프레임워크·도메인 용어집을 agent SKILL과 분리. 외부 안의 `repo-data-context` 컨셉을 *물리 리포 분리 없이* 폴더로 차용.
  - **외부 안 명시적 거부**: 3-repo 물리 분리 / LangGraph v3 / MCP 기반 내부 스킬 레지스트리 / Vector+Graph DB hybrid — 모두 솔로 컨텍스트에 오버엔지니어링. 차용 가치 있는 3종은 흡수(Educational Nudge 행동 패턴 / 도메인 데이터 단일 출처 컨셉 / `repo-data-context` 분리 발상을 폴더로 변환).
  - v0.3 §3.3 spawn 인터페이스를 처음부터 8-layer로 작성 → v0.3 출시 시점에는 layer 1/2/4/5/6 noop, v0.6 자산 도입 시 자동 활성. 릴리스 간 인터페이스 churn 회피.
- **2026-05-12 (오후, 2nd)** — **보고서×Baseline 비교 결과를 v0.3~v0.6 스펙에 통합**. `docs/reference/AI_Agent_Harness_Report.md`(개념·어휘)와 `docs/trend-record/2026-05-11-baseline-survey.md`(실측·우선순위)를 비교 → 보고서는 추상 어휘 출처, Baseline은 구현 우선순위 출처로 역할 분리. 통합 결과: v0.3에 차용 어휘 매핑표 + 슬래시 5종 + git rollback / v0.4에 Data Reconciliation provenance + 3단계 가드레일 program.md 스키마 + signal-scan active trigger / v0.5에 stateless-vs-stateful frontmatter + 4채널 trigger(slash/keyword/freq/explicit) + 빈도 카운팅 auto-load / v0.6 placeholder 해소 — 핸드오프 3변형(hierarchical/graph/dynamic) + trajectory→skill 제안 + FTS5 cold archive. 거부 항목: 보고서식 사전 가드레일 3계층 구축(솔로 비용 과다), 시맨틱 임베딩 버스(25 agent 규모에 과잉), Salesforce Lineage GUI(이미 git diff Markdown으로 정렬됨), Hermes trajectory 자동 등록(v0.6은 제안만).
- **2026-05-12 (오후)** — **버전 라벨 일괄 다운시프트**: 프리-런치 작업 전체를 `v0.x.x`로 재라벨. `v1.0.0`을 정식 출시 마일스톤으로 예약. 종전 v1.7 웹 대시보드는 v1.1로 이동하되 **콘텐츠 변경** — 대시보드 자체는 별도 리포(`solopreneur-dashboard`/`solopreneur-api`)에서 개발하므로 본 리포는 *상호작용 인터페이스만*. 종전 v1.8 지식 온톨로지는 v1.2로 이동(콘텐츠 유지). 문서 파일명 14개 일괄 rename + 모든 .md 내부 v1.X → v0.X 일괄 치환. npm 실제 출시 버전은 immutable이므로 그대로(1.2.x).
- **2026-05-12** — 장기 로드맵 v0.3~v1.2 재배치. PM 모드를 v0.3으로 앞당기고, 스킬 분석기 + 스킬 자유도를 v0.5(워크플로우 메이커)로 통합. 빈 v0.6은 디폴트 워크플로우 튜닝 슬롯으로 전환. 웹 대시보드 v1.1, 지식 온톨로지 v1.2 (Founder Layer + MCP 외부 연결로 범위 확장). 사유: 메신저-네이티브 패러다임이 다른 모든 기능의 진입점이며, 통합 가능 스펙 두 개를 합쳐 표면적 축소.
- **2026-04-23** — `<org>/repositories/` 중간 계층 도입. 피어 프로젝트(OpenClaw/Ralph/Hermes) 조사에서 "시스템 폴더 + 코드 섞기" 패턴이 없음을 확인. GitHub flat 관례 재현 논거 철회.
- **2026-04-23** — `add repo` 의 org 판정은 "단일=자동, 복수=cwd→질문" 하이브리드. 묻지 않는 편의 vs 오인 방지 균형.
- **2026-04-23** — Legacy `.git` (v0.1.x 시절 product=repo) 정리는 `sync` 에서 사용자 선택(Normalize vs Keep). 마이그레이션 스크립트는 건드리지 않음 (이미 1.2.0 사용자 존재).
- **2026-04-22** — 한 워크스페이스 = 한 메신저 플랫폼. 복잡한 멀티 어댑터 동시 운영을 단순화. 복수 플랫폼 사용자는 워크스페이스를 여러 개 만들어 분리.
- **2026-04-22** — Organization 자동 clone 기능 제거 (v0.3+로 연기 검토). 사용자가 직접 `git clone`.
- **2026-04-22** — Workspace 루트 이름은 사용자 지정(`.solosquad/` 폴더 감지 기반). 기본 이름 `solosquad`, 페르소나 분리용 다중 루트 허용.
- **2026-04-22** — Windows 기본 경로 `~/Documents/solosquad-repos` 폐기. v0.2.0 단일 트리 루트로 통일.
- **2026-04-22** — 문서 파일명(v0.2.2, v0.2.3 등)은 작업 블록 라벨로 유지하고, npm 버전은 semver에 맞춰 v0.1.5 다음 점프를 `v0.2.0`으로 정함. 문서 라벨 ↔ npm 버전은 1:1 매칭 아님.
- **2026-04-21** — 버전 표기는 `vN.N.N` 3자리 고정. 2자리(`v0.2`)는 문서 내 참조 약어로만, 공식 릴리스는 항상 3자리.
- **2026-04-21** — v0.1.3~v0.1.5는 작은 hotfix 연쇄로 빠르게 출시 (dotenv·update·Windows claude.cmd).

---

## 5. 관련 문서

- **종합 개념서 (HTML, 신규):** `docs/manual/concept-guide.html` — 컨셉·아키텍처·온보딩·메신저 연결·명령어·용어 사전을 메뉴별로 정리. 브라우저로 직접 열어 사용
- **아키텍처:** `docs/architecture.md`
- **설치 가이드:** `docs/manual/setup-guide.md`
- **업데이트/마이그레이션 (사용자용):** `docs/manual/update-migration-guide.md`
- **클라우드 배포:** `docs/cloud-deployment.md`
- **메신저 디버깅 (v0.1.3 ~ v0.1.5 이력):** `docs/v0.2.1-messenger-debugging.md`
- **안전/보안:** `docs/v0.2-safety-security.md`
- **v0.2.2 구조 재편 스펙:** `docs/v0.2.2-terminology-layout.md`
- **v0.2.3 마이그레이션 프레임워크:** `docs/v0.2.3-migration-process.md`

---

## 6. 외부 레퍼런스

### 내부 참조 (이 리포)
- `docs/reference/AI_Agent_Harness_Report.md` — 추상 설계 어휘(Stateless/Stateful, P/E/T, JIT, 3패턴, 가드레일)의 출처
- `docs/trend-record/2026-05-11-baseline-survey.md` — 7개 피어 프로젝트 실측 비교 + SoloSquad 정합성 평가

### 외부 1차 출처 (스펙에서 직접 인용)
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents — initializer + coding agent 이중 하네스, context compaction
- https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk — subagent spawning + MCP SDK 1급 시민
- https://github.com/garrytan/gstack — 슬래시 체인(Think→Plan→Build→Review→Test→Ship→Reflect), v0.3 슬래시 5종 직접 차용원
- https://github.com/nousresearch/hermes-agent — trajectory→skill 자동 요약, hot+cold FTS5 archive (v0.6 §3·§4 차용)
- https://github.com/karpathy/autoresearch — 메트릭 게이트 + git rollback (v0.4 차용)
- https://github.com/phuryn/pm-skills — auto-load + slash 듀얼 트리거 (v0.5 4채널 trigger 영향)
- https://github.com/openclaw/openclaw — npm 퍼블리시 + `update`/`doctor` 패턴
- https://github.com/666ghj/MiroFish — 멀티 에이전트 시뮬레이션 (관찰만, 솔로 도메인에 not-applicable)
- https://github.com/anthropics/claude-code — Claude Code CLI 공식
