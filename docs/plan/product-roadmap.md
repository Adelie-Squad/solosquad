# SoloSquad 개발 현황 & 로드맵

> 릴리스된 버전, 진행 중인 계획, 결정 로그, 외부 참고자료를 한 자리에 모은 롤링 문서.

**최종 업데이트:** 2026-05-15 (v0.7.0 릴리스)

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
| **`v0.7.0`** | **2026-05-15** | **Uninstall & Lifecycle** — farewell archive(WAL-safe SQLite) + REVOKE-CHECKLIST + `solosquad uninstall`/`logout` + class A 불가침 + 마이그레이션 인프라 안정화 | `v0.7-uninstall-lifecycle.md` |

### 현재 설치 가능 버전: npm `0.7.0`

**다음 마일스톤:** `v1.0.0` — 정식 출시. v0.7로 라이프사이클이 닫히고 install ↔ uninstall 2단으로 완결되었으므로, v1.0은 *공개 사용자 약속* (안정 API + breaking change 정책)을 시작하는 슬롯.

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
- v0.8.0: 메신저 multi-user (같은 Discord/Slack에 N명) — n잡 멤버가 같은 메신저에 모일 때 (기획 완료, 구현 대기)
- v1.3: **일정 관리 + 메모** — n잡 사용자의 시간·기억 관리. 별도 plan slot

**일정·메모는 v1.3에 박제**: v0.x~v1.2까지는 product/창업 워크플로우에 집중. 캘린더·todo·노트는 v1.3에서 별도 인프라.

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
- **v1.x: 워크플로우/goal/루틴 고도화** — 암묵지 → SKILL/워크플로우 자동화 강화. 별도 ideation 진행 중

### 2.4 출시 시점 약속 vs 포스트 출시 진화

| 축 | v1.0 약속 | v1.x 진화 |
|---|---|---|
| 멀티 프로덕트 | multi-org·multi-repo·multi-user (v0.2~v0.8.0 완결) | v1.3 일정·메모 |
| 24/7 자율 팀 | dev_capability + 5종 specialist + 자율 goal (v0.4·v0.8.2) | 인간 승인 지점 정교화·multi-product cross-goal |
| 실험 중심 기획 | 4 디폴트 워크플로 + 25 specialist + 워크플로우 메이커 | 워크플로우/goal/루틴 고도화 (별도 plan slot) |

---

## 3. 장기 로드맵 (2026-05-12 재배치, **v1.0 정식 출시 도입**)

### 3.1 프리-런치 (v0.x)

| 버전 | 주제 | 문서 | 상태 |
|---|---|---|---|
| `v0.3.x` | PM 모드 + 멀티 에이전트 오케스트레이션 (계층적, depth=1) — 슬래시 5종, `solosquad rollback`, 8-layer spawn 인터페이스 | `docs/plan/v0.3-pm-mode-orchestration.md` | ✓ 출시 |
| `v0.4.x` | 밤새 자율 작업 완료 엔진 (Codex `/goal` + `AGENTS.md` 2계층, Data Reconciliation, 3단계 가드레일, `solosquad goal <verb>` CLI) | `docs/plan/v0.4-autonomous-engine.md` | ✓ 코드 흡수 (v0.5/v0.6 내) |
| `v0.5.x` | 워크플로우 메이커 (4채널 trigger, stateless/stateful 분리, 빈도 카운팅 auto-load) | `docs/plan/v0.5-workflow-maker.md` | ✓ 출시 |
| `v0.6.x` | 디폴트 워크플로우 튜닝 + **토폴로지 재편**(Team=Domain, Org Layer specialization, Workspace Knowledge) + 메모리 아카이브(FTS5) | `docs/plan/v0.6-default-workflow-tuning.md` | ✓ 출시 (2026-05-14) |
| `v0.7.x` | Uninstall & Lifecycle (Farewell Archive) — `solosquad uninstall`/`logout`, 데이터 5분류(A/A*/B/C/D/E), 사용자 코드 불가침, WAL-safe SQLite backup, REVOKE-CHECKLIST 자동 생성, journal-기반 idempotent 재개, concurrent-uninstall lockfile, PII-NOTICE 동봉 | `docs/plan/v0.7-uninstall-lifecycle.md` | ✓ 출시 (2026-05-15) |
| **`v0.8.0`** | **Multi-User Messenger** — 같은 Discord 서버·Slack 워크스페이스에 N명 설치. `command-<handle>` / `works-<handle>` 채널 페어, 봇 multiplicity (1 user = 1 bot application), author-guard, broadcast 옵션 B (opt-in + designated 봇만 발송), handle 충돌 명시적 거부 | `docs/plan/v0.8-multiuser-messenger.md` | 기획 완료, 구현 대기 |
| `v0.8.1` | Security & Lifecycle Pair — npm audit 7건 해소(undici/discord.js), `solosquad import <zip>` (archive 페어 완결), `solosquad archive verify/info/list`, API stability 정책 문서 신설, SKILL.md `schema_version: 1` 백필 | `docs/plan/v0.8.1-security-lifecycle-pair.md` | 기획 완료, 구현 대기 |
| `v0.8.2` | Dev Capability — SKILL frontmatter `dev_capability`+`dev_permissions`, Bash allowlist/denylist, push/merge confirmation gate (자동 머지 영구 거부), engineering 5 SKILL 박제 활성, workspace 마스터 토글, gh CLI 인증 점검 | `docs/plan/v0.8.2-dev-capability.md` | 기획 완료, 구현 대기 |
| `v0.8.3` | Onboarding UX + Observability — `solosquad add repo --dry-run` + 기존 리포 마이그레이션 5단계 가이드, master-guide §3/§6/§8/§9/§10 v0.7→v0.8 재정합, logger 확장(레벨·파일·rolling) + `solosquad logs` CLI, trajectory 자동 등록 ROI 게이트 결정 박제 | `docs/plan/v0.8.3-onboarding-ux-observability.md` | 기획 완료, 구현 대기 |
| `v0.9.x` | 안정화 + 자체 사용 검증 — 1주~1개월 self-dogfood, i18n 정책, `.github/ISSUE_TEMPLATE/`, trajectory 자동 등록 활성화(v0.8.3 4지표 통과 시) | `docs/plan/v0.9-self-use-and-i18n.md` (예정) | 기획 미수 |

### 3.2 정식 출시 마일스톤

| 버전 | 주제 | 비고 |
|---|---|---|
| **`v1.0.0`** | **정식 출시 (formal launch)** | v0.6까지 안정화 + 솔로 파운더 자기 사용 검증 완료. 안정 API 약속과 breaking change 정책이 v1부터 시작 |

### 3.3 포스트-런치 (v1.x)

| 버전 | 주제 | 문서 |
|---|---|---|
| `v1.1.x` | 대시보드 상호작용 (대시보드 자체는 별도 리포 `solopreneur-dashboard` + `solopreneur-api`) | `docs/plan/v1.1-dashboard-interaction.md` |
| `v1.2.x` | 사용자 지식·암묵지 온톨로지 + MCP 외부 연결 (Notion·Obsidian·API·타 에이전트) | `docs/plan/v1.2-knowledge-ontology.md` |
| **`v1.3.x`** | **일정 관리 + 메모** — n잡 사용자 시간·기억 관리. 캘린더 통합·todo·노트 인프라. `docs/plan/v1.3-schedule-memo.md` 예정 | (기획 미수) |
| `v1.x` (별도) | 워크플로우 / goal / 루틴 *고도화* — 암묵지→스킬 자동화 강화·워크플로우 메이커 보안 모델 (권한 관리·인간 승인 지점·goal 패턴 참고). 별도 ideation 진행 중 | (기획 미수) |

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
| **npm 패키지 버전** | semver 그대로 유지 (현재 npm `latest` = 0.2.x). 과거 출시본을 unpublish 하지 않음 |
| **문서 라벨 / 내부 내러티브** | 본 표 기준 `v0.x` ~ `v1.x` 사용. 동일 git 커밋이지만 *서사적 버전*은 다를 수 있음 |
| **마이그레이션 스크립트 파일명** | `src/migrations/scripts/`의 파일명은 npm 실제 버전 유지 (`0.1.x-to-0.2.0.ts` 등). 사용자 워크스페이스의 version 라벨과 매칭하기 위함 |
| **package.json bump 시점** | v0.6 완료 시 npm `1.x` → `1.0.0` 재정렬 또는 `0.6.x`로 다운브랜드 결정 (별도 결정 필요) |

---

## 4. 결정 로그 (주요)

- **2026-05-15 (제품 목표 박제 + 명령어 축소 결정)** — (a) **§2 제품 목표 3축** 박제: 멀티 프로덕트(1인/소규모/n잡) · 24/7 멀티 에이전트 팀(코드 안 보고 대화로 운영) · 애자일·실험 중심 기획(PMF·GTM·A/B·BM·마케팅·포지셔닝). (b) **일정 관리·메모는 v1.3 슬롯**에 박제 — v0.x~v1.2까지는 product/창업 워크플로우에 집중, 캘린더·todo·노트는 v1.3에서 별도 인프라(별도 plan). (c) **워크플로우/goal/루틴 고도화**는 별도 v1.x 슬롯 — ideation 진행 중(사용자에게 7건 질문 던짐: 우선순위 leading indicator·암묵지 source·권한 모델·인간 승인 지점·multi-product goal 모델·루틴 개인화·실험 인프라). (d) **`solosquad logout` 제거 결정** — v0.7에서 gh CLI 패턴 차용으로 추가했지만 실제 가치 < 복잡도: 봇 정지는 `Ctrl+C`, 시크릿 마스킹은 사용자 수동 또는 messenger 콘솔 revoke로 충분, `logout.lock`은 dev_capability(v0.8.2)·workspace 마스터 토글로 대체 가능. v0.8.3에서 제거 + master-guide에서 절차 안내. (e) **업데이트 ↔ 마이그레이션 구분** 명확화: `solosquad update`(npm latest 확인 + 자동 self-update) vs `solosquad migrate`(워크스페이스 schema 정합). v0.8.3에서 master-guide §6에 흐름도 추가 + doctor가 mismatch 감지 시 어느 쪽을 권고할지 명시. 영향 받는 docs: 본 entry + v0.8-multiuser-messenger.md(n잡 use case 언급) + v0.8.2-dev-capability.md(워크플로우 메이커 보안 노트) + v0.8.3-onboarding-ux-observability.md(logout 제거 + update/migrate 구분 절 추가).
- **2026-05-15 (v0.7.0 출시)** — **install ↔ uninstall 2단 라이프사이클로 완결**. 사유: v0.6까지 사용자 데이터가 누적되었지만 "도구를 제거하면서 데이터를 들고 떠나는" 경로 부재 → 사용자 코드 손상 위험·수동 정리 부담. 핵심 결정: (a) **`solosquad reset`·`solosquad clean` 같은 "초기화" 명령은 영구히 추가하지 않는다** — 재설치는 *uninstall + farewell archive + 새 워크스페이스 init*으로 자연 표현. (b) **사용자 코드(`<org>/repositories/<repo>/`) 절대 불가침** — uninstall의 어떤 플래그로도 변경/삭제 대상 아님. 옵션 자체를 두지 않음 (OpenClaw 안티패턴 회피, Issue #6289). (c) **archive 강제 sequencing** — uninstall은 항상 farewell archive를 먼저 생성. `--no-archive` 같은 플래그 없음. (d) **WAL-safe SQLite backup**(Hermes 차용) + **logout/uninstall 분리**(gh CLI 차용) + **`--keep-state` 매트릭스**(gstack 차용). (e) **PII-NOTICE.md 자동 동봉** + opt-in `--scrub-content` (자동 스크럽은 false-negative 위험으로 v1.x). (f) **journal-기반 idempotent 재개** + **concurrent-uninstall lockfile** + **PM/scheduler PID 거부** (`--force` 없이는). 영향 받는 코드: `src/lifecycle/{classify,manifest,sqlite-backup,lockfile,journal,precheck,repo-meta,revoke-checklist,cleanup,archive}.ts` (10 신규 모듈), `src/cli/{uninstall,logout}.ts` (2 신규 명령), `src/cli/doctor.ts`(v0.7 점검 항목 추가), `src/migrations/scripts/0.6.0-to-0.7.0.ts`(version bump + workspace.yaml.uninstall 기본값). 영향 받는 docs: 본 entry + architecture.md(§"v0.7 lifecycle" 절 추가) + master-guide.html("Uninstall" 절 추가) + AGENTS.md(향후 사용자 갱신).
- **2026-05-13 (오후)** — **워크스페이스 영속 가이드를 AGENTS.md 단일 출처로 통일**. 직전 결정(AGENTS.md + CLAUDE.md 공존)을 폐기. 사유: (1) 같은 위계에 두 파일이 있으면 사용자가 "어디 적어야 하지" 혼란 + 두 출처 발산 위험. (2) AGENTS.md는 Codex·Aider·Cursor·최신 Claude Code 모두 fallback 인식하는 cross-tool de facto 표준. (3) 단일 출처는 v0.4 신뢰 앵커(human-only 편집) 정신과 정합. 변경 내용: v0.4 doc §4.2 — AGENTS.md가 워크스페이스 단일 영속 가이드. SoloSquad가 CLAUDE.md를 더 이상 생성·갱신하지 않음. 마이그레이션은 기존 CLAUDE.md 컨텐츠를 AGENTS.md로 1회 복사 후 CLAUDE.md 원본은 untouched(사용자가 수동 삭제 결정). `solosquad doctor`가 향후 CLAUDE.md 발견 시 "더 이상 사용되지 않음" 안내 출력. master-guide §3.4 + §3.5 Layer 0 표 동기 갱신. 영향 받는 파일: docs/plan/v0.4-autonomous-engine.md, docs/manual/master-guide.html, docs/plan/product-roadmap.md(본 entry).
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

## 5. 관련 문서

- **종합 개념서 (HTML, 사용자 진입점):** `docs/manual/concept-guide.html` — 컨셉·아키텍처·온보딩·메신저 연결·명령어·운영 가이드·트러블슈팅·FAQ·용어 사전을 메뉴별로 정리. 브라우저로 직접 열어 사용. 구 `docs/manual/setup-guide.md` + `docs/manual/update-migration-guide.md` 내용을 모두 흡수 (2026-05-12 두 md 파일 삭제)
- **아키텍처:** `docs/architecture.md`
- **클라우드 배포 (VPS + systemd):** `docs/cloud-deployment.md`
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
- https://developers.openai.com/codex/use-cases/follow-goals — Codex `/goal` 휘발성 의도 + 모델은 시작·완료만 (v0.4 2계층 구조의 절반)
- https://developers.openai.com/codex/agents-md/ — `AGENTS.md` cross-tool 영속 가이드 표준 (v0.4 2계층 구조의 나머지 절반)
- https://github.com/karpathy/autoresearch — 메트릭 게이트 + git rollback의 운영 패턴 원조 (v0.4가 어휘는 안 차용하고 동작 패턴만 차용)
- https://github.com/phuryn/pm-skills — auto-load + slash 듀얼 트리거 (v0.5 4채널 trigger 영향)
- https://github.com/openclaw/openclaw — npm 퍼블리시 + `update`/`doctor` 패턴
- https://github.com/666ghj/MiroFish — 멀티 에이전트 시뮬레이션 (관찰만, 솔로 도메인에 not-applicable)
- https://github.com/anthropics/claude-code — Claude Code CLI 공식
