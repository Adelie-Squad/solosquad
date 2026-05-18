# SoloSquad — Architecture & Design

> 현재 구현된 시스템 아키텍처, 멀티세션 조율, 메모리 구조를 정리한 기술 문서.

> **현재 출시 버전: v0.7.0 (2026-05-15)**. 본 문서는 v0.2.x까지의 핵심 토폴로지를 상세히 기술하고, v0.3~v0.7는 §13 "릴리스별 추가 사항"에서 압축 요약 + 각 plan 문서 링크로 다룹니다. 더 자세한 내용은 `docs/plan/v0.3-*.md` ~ `docs/plan/v0.7-*.md` 참조.

---

## 1. 시스템 개요

TypeScript + Node.js 기반 npm 패키지. 1인 창업자를 위한 24/7 AI 비서 시스템.

```bash
npm install -g solosquad
solosquad init          # 워크스페이스 초기화 (+ 첫 org + 다수 repo 루프)
solosquad bot           # 메신저 봇 실행
solosquad schedule      # 자동 스케줄러
solosquad update        # npm 최신 버전 확인 + 자동 업데이트
solosquad doctor        # 환경 진단
solosquad status        # 대시보드
solosquad run-routine   # 수동 루틴 실행
solosquad migrate       # 워크스페이스 레이아웃 업그레이드 (버전 간 이관)
solosquad add org       # 워크스페이스에 조직 추가
solosquad add repo      # 저장소 clone(URL) 또는 등록(로컬 경로)
solosquad sync          # <org>/repositories/ ↔ .org.yaml 동기화 + legacy 정리
```

---

## 2. 코드 구조

```
package.json                     → npm 패키지 (solosquad)
bin/solosquad.ts                 → CLI 진입점 (.solosquad/.env 우선 로드)
src/
  cli/
    index.ts                     → commander 프로그램 + preAction 배너 + 명령 등록
    init.ts                      → 워크스페이스 초기화 (+ 첫 org + repo 등록 루프)
    bot.ts (index)               → 메신저 봇 시작
    schedule.ts (index)          → 스케줄러 시작
    status.ts                    → 대시보드
    update.ts                    → 자체 업데이트 + 마이그레이션 감지
    doctor.ts                    → 환경/토큰/레이아웃 진단
    run-routine.ts               → 루틴 수동 실행
    migrate.ts                   → 마이그레이션 실행기 / rollback / backup 관리
    add-org.ts                   → 조직 추가 (scaffoldOrg 호출)
    add-repo.ts                  → 저장소 clone/이동/등록 (scaffoldRepoYaml 호출)
    sync.ts                      → repositories/ 스캔 + legacy `.git` 정리 프롬프트
  bot/
    agent-router.ts              → 60+ 키워드 → 25 에이전트 라우팅
    claude-runner.ts             → Claude Code --print 서브프로세스 실행 (SAFETY preamble 주입)
    workflow-resolver.ts         → 활성 workflow stage target_repo → main repo → legacy-root cwd 해석
    index.ts                     → 봇 메인 (어댑터 생성 → 핸들러 연결 → 시작)
  messenger/
    base.ts                      → MessengerAdapter / MessageContext 인터페이스
    discord-adapter.ts           → discord.js 기반
    slack-adapter.ts             → @slack/bolt Socket Mode 기반
    telegram-adapter.ts          → node-telegram-bot-api 기반
    index.ts                     → 단일 메신저 팩토리 (복수 지정 시 첫 번째로 축소 경고)
  scheduler/
    routines.ts                  → 5개 루틴 정의 (cron 표현식)
    memory.ts                    → JSON 블록 추출 → JSONL append (중복 방지)
    index.ts                     → node-cron 등록 + org cwd 해석 후 루틴 실행
  migrations/
    types.ts                     → Migration / MigrationPlan / BackupMeta 인터페이스
    detect.ts                    → workspace 버전 감지 + findWorkspaceRoot (walk-up)
    backup.ts                    → 마이그레이션 전 전체 스냅샷 + rollback
    runner.ts                    → 체인 해결 → dry-run/apply + verify
    index.ts                     → 마이그레이션 레지스트리 + resolveChain
    scripts/
      0.1.x-to-0.2.0.ts          → 레이아웃 재편 (.solosquad/, product→org, projects→workflows)
      0.2.0-to-0.2.1.ts          → 각 org 에 repositories/ 생성 + workspace.yaml 버전 갱신
  util/
    config.ts                    → .env / workspace.yaml / .org.yaml / repo.yaml I/O
    paths.ts                     → 에셋/워크스페이스/org/repo 경로 해석 + RESERVED_ORG_CHILDREN
    platform.ts                  → 크로스 플랫폼 유틸 (OS 감지, CRLF 정규화, 명령어 존재)
    git.ts                       → clone/remote 추출/URL 판별/언어 감지
    scaffold.ts                  → scaffoldOrg / scaffoldRepoYaml 공통 헬퍼
    logger.ts                    → chalk 기반 로거
assets/                          → npm 에 번들, init 시 `.solosquad/` 아래로 복사
  agents/{team}/{agent}/SKILL.md → 에이전트 정의 (25개)
  routines/*.md                  → 루틴 프롬프트
  templates/                     → PRD 3종, 핸드오프, 상태, 세션 컨텍스트 5종, 질문 템플릿 (11개)
  core/                          → 오너 프로필, 원칙, 스타일
test/
  env-load.test.ts               → dotenv 로딩 + shell override 경고 회귀
  migration-v0.1-to-v0.2.test.ts → fixture 기반 마이그레이션 회귀 (dry-run/apply/rollback/idempotent/chain)
```

---

## 3. 컨텍스트 계층 (v0.2.0+)

```
Layer 0: Universal (.solosquad/core/)
  OWNER.md, PRINCIPLES.md, VOICE.md
  → 모든 org/repo 세션에 공유

Layer 1: Organization (<workspace>/<org>/)
  .org.yaml, memory/, workflows/, <messenger>/, repositories/
  memory/hypotheses.jsonl, experiments.jsonl, decisions.jsonl, signals.jsonl
  memory/routine-logs/  (모든 루틴 실행 결과)
  → 조직 단위 격리. 다른 조직의 메모리·워크플로우 불가시.

Layer 2: Repository (<workspace>/<org>/repositories/<repo>/)
  .git/, .solosquad/repo.yaml (role, language, linked_org, remote_url)
  (소스 코드)
  → 코드 편집·commit 의 실제 단위. Claude 세션 cwd 가 여기로 떨어짐.

Layer 3: Workflow (<workspace>/<org>/workflows/<id>/)
  _status.yaml (stages: target_repo per stage)
  prd.md, stage-N-<name>/artifacts, _handoff.md
  → Orchestrator 가 만드는 단계별 협업 인스턴스. 여러 repo 에 걸친 작업 조율.
```

### Workspace 감지 로직

CLI 는 실행 CWD 에서 **위로 올라가며** `.solosquad/` 폴더가 있는 첫 디렉토리를 워크스페이스 루트로 인식 (npm 의 `package.json` 탐색과 동일한 패턴). 루트 이름은 자유.

v0.1.x 레거시 워크스페이스는 `agents/` + `routines/` + `core/` 3개 폴더 동시 존재로 감지.

---

## 4. 메신저 어댑터

### 원칙: 한 워크스페이스 = 한 메신저 플랫폼 = 한 봇 계정 (v0.2.0+)

`MESSENGER` 환경변수는 **단일 값**만 허용:

```
MESSENGER=discord        # Discord
MESSENGER=slack          # Slack
MESSENGER=telegram       # Telegram
```

`MESSENGER=discord,slack` 같은 복수 지정은 v0.2.0 에서 제거됨. 마이그레이션 시 자동으로 첫 번째 값만 남김 (`saveEnv` 로 collapse). 여러 플랫폼을 쓰고 싶으면 **워크스페이스를 여러 개** 운영:

```
~/solopreneur/   .solosquad/.env → MESSENGER=slack
~/founder-bot/   .solosquad/.env → MESSENGER=discord
```

### 어댑터 인터페이스

모든 플랫폼이 동일한 `MessengerAdapter` 를 구현:
- **bot 모드**: 명령 채널 메시지 수신 → `handleCommand(userInput, product/org, ctx)` 호출
- **notifier 모드**: 스케줄러가 루틴 결과를 채널로 전송

채널 매핑은 **조직 레벨** (`<org>/<messenger>/config.yaml`):
```yaml
channels:
  daily-brief: C01234567
  signals: C02345678
  experiments: C03456789
```

---

## 5. 에이전트 라우팅

`src/bot/agent-router.ts` 의 `AGENT_ROUTES` 딕셔너리:
- 60+ 한국어/영어 키워드 → 25 에이전트 매핑
- 메시지에서 키워드 탐지 → 해당 에이전트의 SKILL.md 로드 → 프롬프트에 주입
- 매칭 없으면 일반 모드로 폴백

---

## 6. CLI 런타임 해석 (resolveOrgCwd)

봇·스케줄러가 Claude 세션을 spawn 할 때 **어느 디렉토리에서 실행할지** 결정하는 로직 (`src/bot/workflow-resolver.ts`).

### 우선순위

```
1. 활성 workflow stage 의 target_repo
   └ <workspace>/<org>/workflows/<id>/_status.yaml 에서 in_progress 또는
     depends_on 이 모두 completed 인 pending stage 를 찾아 그 target_repo 사용
   └ cwd = <workspace>/<org>/repositories/<target_repo>/

2. role=main 의 repo
   └ <org>/repositories/*/.solosquad/repo.yaml 중 role=main 선택
   └ main 이 없으면 첫 번째 repo

3. Legacy 루트
   └ 위 둘 모두 없으면 <org>/ 자체 (v0.1.x 에서 넘어온 "org=repo" 구조 지원)
```

### 예시 흐름

```
사용자 Slack 메시지 (채널: #bv-ai-native-po-owner-command)
  ↓
메신저 어댑터가 org 판정 (채널명 매핑) → bv-ai-native-po
  ↓
resolveOrgCwd("<ws>/bv-ai-native-po/")
  ↓
  활성 workflow 있음? → no
  role=main repo 있음? → <ws>/bv-ai-native-po/repositories/web/
  ↓
runClaude(prompt, "<ws>/bv-ai-native-po/repositories/web/")
```

Cross-repo workflow 의 경우 stage 별로 target_repo 가 다르면 각 stage 가 해당 repo 에서 실행되며 handoff 만 `workflows/<id>/stage-N-*/` 에 기록.

---

## 7. 자동 루틴 + 메모리

### 스케줄

| 시간 (KST) | 루틴 | 채널 | 메모리 타겟 |
|------------|------|------|-----------|
| 06:00 매일 | Morning Brief | #daily-brief | - |
| 12:00 매일 | Signal Scan | #signals | signals.jsonl |
| 16:00 매일 | Experiment Check | #experiments | experiments.jsonl |
| 22:00 매일 | Daily Log | #daily-brief | decisions.jsonl |
| 일 20:00 | Weekly Review | #weekly-review | decisions.jsonl |

### JSONL 메모리 스키마

| 파일 | 필드 | 용도 |
|------|------|------|
| `hypotheses.jsonl` | id, statement, risk, method, status, date | 가설 관리 |
| `experiments.jsonl` | id, hypothesis_id, method, result, signal_strength, date, next_action | 실험 기록 |
| `decisions.jsonl` | date, decision, alternatives, reasoning, emotion_weight | 의사결정 기록 |
| `signals.jsonl` | date, source, type, content, relevance, action | 외부 시그널 |

### 메모리 저장 흐름 (v0.2.0+: org 레벨)

```
resolveOrgCwd → repo 또는 org 루트에서 Claude 실행
  ↓ 결과 문자열
  → ```json 블록 자동 추출 → <org>/memory/<schema>.jsonl append (중복 방지, 날짜 보강)
  → <org>/memory/routine-logs/{id}-{timestamp}.md (모든 실행 기록)
  → 메신저 채널 전송 (연결된 플랫폼)
```

**중요:** 루틴은 특정 repo 에서 실행될 수 있지만 **메모리 저장은 항상 org 레벨**. 여러 repo 를 아우르는 의사결정·시그널이 단일 소스에 축적.

---

## 8. 멀티 세션 팀 조율

> Orchestrator SKILL.md 의 프롬프트 규칙으로 동작.
> `_status.yaml` + `_handoff.md` 기반 조율은 사람이 세션을 직접 실행하는 방식입니다.

### 조율 구조 (v0.2.0+ Workflow 모델)

```
┌──────────────────────────────────────────┐
│    Orchestrator 세션 (조율만, org 루트)      │
└────────┬────────────┬────────────┬───────┘
         │            │            │
    ┌────▼─────┐ ┌────▼─────┐ ┌───▼──────┐
    │Experience│ │ Strategy │ │ Engineering│
    │ 세션     │ │ 세션     │ │  세션      │
    └──────────┘ └──────────┘ └──────────┘
         │            │            │
         └────────────┼────────────┘
                      ▼
         <org>/workflows/<id>/   (공유 파일시스템)
            _status.yaml
            stage-N-<name>/
              _handoff.md
              artifacts/
```

**원칙:**
1. Orchestrator 는 조율만 (실행 X)
2. 각 팀은 독립 세션에서 실행
3. 파일 시스템 = 세션 간 통신 채널
4. `_handoff.md` 가 맥락 전달 표준
5. 각 stage 는 `target_repo` 를 가질 수 있어 **단일 workflow 가 여러 repo 에 걸침** (cross-repo workflow)

### 핸드오프 프로토콜

```markdown
# Handoff: [출발 에이전트] → [도착 에이전트]

## Summary — 핵심 발견 3줄 요약
## Artifacts — 생성된 산출물 목록
## Key Decisions — 결정 사항과 근거
## Context for Next Agent — 다음 에이전트가 알아야 할 맥락
## Open Questions — 미해결 질문
## Dependencies — 선행 조건
```

### 워크플로우 상태 추적 (`_status.yaml`)

```yaml
workflow_id: model-y-refresh
project: autopilot                     # .org.yaml products[] slug
stages:
  - id: stage-1-vision
    team: engineering
    agents: [data-engineer]
    target_repo: autopilot-vision      # ← 이 stage 는 autopilot-vision repo 에서 실행
    status: in_progress
    depends_on: []

  - id: stage-2-planner
    team: engineering
    agents: [backend-developer]
    target_repo: autopilot-planner     # ← 다른 repo
    status: pending
    depends_on: [stage-1-vision]
    upstream_handoff: workflows/model-y-refresh/stage-1-vision/_handoff.md
```

### 병렬 실행 패턴 (PMF 탐색)

```
Phase 1 — 리서치 (병렬)
├── [Experience] User Researcher + Desk Researcher
└── [Strategy] Idea Refiner

Phase 2 — 기획 + 브랜딩 (병렬)
├── [Strategy] PMF Planner → Feature Planner
└── [Growth] Brand Marketer

Phase 3 — 디자인
└── [Experience] UX Designer → UI Designer

Phase 4 — 개발
└── [Engineering] FDE or Frontend + Backend

Phase 5 — QA + 마케팅 (병렬)
├── [Engineering] QA Engineer
└── [Growth] GTM Strategist + Content Writer

Phase 6 — 런칭 (QA Go 판정 + 마케팅 완료 후)
└── [Growth] Paid Marketer
```

직렬 9T → 병렬 6T (~33% 단축)

### 세션 시작

```bash
# Orchestrator (PRD 생성) — org 루트 또는 target repo 에서
cd <workspace>/<org> && claude

# Experience Team (병렬)
claude --prompt "workflows/<id>/sessions/experience/CLAUDE.md 읽고 작업 시작"

# Strategy Team (병렬)
claude --prompt "workflows/<id>/sessions/strategy/CLAUDE.md 읽고 작업 시작"
```

---

## 9. 에이전트 → 팀 매핑

| Stage | 팀 | 에이전트 경로 |
|-------|-----|-------------|
| Research | Experience | `.solosquad/agents/experience/user-researcher/SKILL.md`, `desk-researcher/SKILL.md` |
| Branding | Growth | `.solosquad/agents/growth/brand-marketer/SKILL.md` |
| Planning | Strategy | `pmf-planner/`, `feature-planner/`, `scope-estimator/` |
| Design | Experience | `ux-designer/`, `ui-designer/` |
| Development | Engineering | `architect/`, `fde/`, `creative-frontend/`, `backend-developer/`, `api-developer/` |
| QA | Engineering | `qa-engineer/SKILL.md` |
| Security | Engineering | `security-engineer/SKILL.md` |
| Marketing | Growth | `gtm-strategist/`, `content-writer/`, `paid-marketer/` |
| Analysis | Strategy | `data-analyst/SKILL.md` |

---

## 10. 마이그레이션 프레임워크 (v0.2.0+)

구조·용어·스펙 업그레이드가 반복될 것을 전제로, 버전 간 워크스페이스 이관을 **안전·예측가능·되돌릴 수 있게** 만드는 범용 프레임워크.

### 설계 원칙

| 원칙 | 구현 |
|---|---|
| Detect-first | `detectWorkspaceVersion()` 가 `.solosquad/workspace.yaml` 또는 legacy 마커 감지 |
| Dry-run by default | `solosquad migrate` 기본 동작 = 계획만 출력. 실제 변경은 `--apply` |
| Backup before mutation | `createBackup()` 로 전체 스냅샷 → `~/.solosquad-backups/<ISO>-v<from>/` |
| Idempotent | 이미 마이그레이션된 워크스페이스에 재실행해도 no-op |
| Reversible | `solosquad migrate --rollback` 으로 백업에서 복원 |
| Versioned | 각 전환이 독립 스크립트 (`scripts/<from>-to-<to>.ts`) |
| Chainable | `resolveChain(source, target)` 로 `0.1.x → 0.2.0 → 0.2.1` 자동 연결 |

### Migration 인터페이스

```ts
interface Migration {
  from: string;                                   // "0.1.x", "0.2.0"
  to: string;                                     // "0.2.0", "0.2.1"
  description: string;
  detect(workspace: string): Promise<boolean>;
  plan(workspace: string): Promise<MigrationPlan>;
  apply(workspace: string, plan: MigrationPlan): Promise<void>;
  verify(workspace: string): Promise<VerifyResult>;
}
```

### 현재 등록된 마이그레이션

1. **0.1.x → 0.2.0** (`scripts/0.1.x-to-0.2.0.ts`)
   - `agents/`, `routines/`, `core/`, `templates/`, `orchestrator/` → `.solosquad/` 하위로 이동
   - `.env` → `.solosquad/.env`
   - 각 product (REPOS_BASE_PATH 아래) → 워크스페이스 루트의 org 디렉토리로 이동
   - `projects/` → `workflows/`
   - `.org.yaml` 자동 생성
   - 복수 `MESSENGER` 값 → 첫 번째로 축소
   - `REPOS_BASE_PATH` 제거
   - `workspace.yaml` 생성

2. **0.2.0 → 0.2.1** (`scripts/0.2.0-to-0.2.1.ts`)
   - 각 org 에 `repositories/` 폴더 생성 (이후 `add repo` / `sync` 가 쓸 경로)
   - `workspace.yaml.version` 0.2.0 → 0.2.1 stamp (배너 억제)

### Legacy `.git` 정리는 `sync` 책임

v0.1.x 에서 product=repo 였던 자취로 **migration 직후 org 루트에 `.git/` 가 남음**. 마이그레이션 스크립트는 이를 강제로 이동하지 않음 (이미 0.2.0 에서 작업 중인 사용자 보호). 대신 `solosquad sync` 가 감지해서 사용자에게 옵션 제공:
- **Normalize** → `.git/` 및 코드를 `<org>/repositories/<org-slug>/` 로 이동
- **Keep legacy** → 현재 위치 유지 + `<org>/.solosquad/repo.yaml` 을 org 루트에 생성

### 회귀 테스트

`test/migration-v0.1-to-v0.2.test.ts` 가 fixture 기반으로:
- dry-run 시 워크스페이스 무변화
- apply 시 기대 레이아웃
- 복수 MESSENGER 축소
- rollback 으로 원복
- 재실행 시 no-op
- 0.1.x → 0.2.1 체인 (repositories/ 생성 + workspace.yaml 버전)

6 케이스 전부 통과.

---

## 11. 크로스 플랫폼 지원 (v0.1)

Windows, macOS, Linux 3개 OS 에서 동일하게 동작하는 CLI.

### `src/util/platform.ts`

| 함수 | 역할 |
|------|------|
| `commandExists(cmd)` | 명령어 존재 확인 (Unix: `command -v`, Windows: `where`) |
| `normalizeLine(content)` | CRLF → LF 정규화 |
| `parseJsonl(content)` | CRLF-safe JSONL 파싱 |
| `parseTsv(content)` | CRLF-safe TSV 파싱 |
| `npmGlobalInstallCmd(pkg)` | sudo 자동 판단 (Unix: root 여부 체크, Windows: 불필요) |
| `globalConfigDir()` | OS 별 설정 디렉토리 (Windows: `%APPDATA%/solosquad`, Unix: `~/.solosquad`) |
| `platformInfo()` / `shellName()` | 진단용 플랫폼/셸 정보 |

`defaultReposPath()` 는 v0.2.0 에서 obsolete 처리 (REPOS_BASE_PATH 제거로 사용처 없음).

### Claude 서브프로세스 호출 (Windows 대응)

`src/bot/claude-runner.ts` 가 Windows 에서 `claude.cmd` (npm wrapper) 를 실행할 때 PATHEXT 문제를 피하기 위해 `shell:true` + argv 를 커맨드 문자열로 합침 (Node DEP0190 회피). Unix 계열은 `execFile` 직접 호출.

### 줄바꿈 정규화

`.gitattributes` 로 Git 저장소 내 모든 텍스트 파일을 LF 로 강제. 런타임에서는 `normalizeLine()` 으로 CRLF 파일도 안전하게 파싱.

적용 위치: `config.ts` (.env 파싱), `memory.ts` (JSONL 파싱), `migrations/scripts/*` (.env rewriting).

### CI/CD

`.github/workflows/ci.yml`: GitHub Actions 매트릭스
- OS: `ubuntu-latest`, `macos-latest`, `windows-latest`
- Node: 18, 20, 22
- 빌드 + smoke test (`npm install -g . && solosquad doctor --ci`)

---

## 12. 업데이트 전략 (OpenClaw 방식)

```bash
solosquad update                    # npm 최신 버전 확인 → 자동 업데이트
solosquad update --channel dev      # 개발 채널
solosquad doctor                    # 환경 진단 (Node, Docker, Claude, 토큰, 레이아웃)
solosquad migrate                   # (구조 변경 시) 워크스페이스 이관 — 기본 dry-run
solosquad migrate --apply           # 실제 적용 (자동 백업)
solosquad migrate --rollback        # 백업 복원
```

### 동작

- npm registry 최신 버전 조회 (`npm view solosquad version`)
- 로컬 `package.json` 버전과 비교
- CLI 가 업데이트되면 워크스페이스 버전과 비교 → breaking 레이아웃 차이 있으면 `migrate --dry-run` 안내
- **모든 CLI 명령 시작 시** preAction hook 이 워크스페이스 버전 ≺ CLI 버전 인 경우 경고 배너 (0.2.1+ 부터). migrate/update/doctor 는 배너 제외 (무한 루프/노이즈 방지).
- `npmGlobalInstallCmd()` 로 OS 에 맞는 설치 명령 생성 (Linux/macOS: sudo 자동 판단)

### 알려진 한계

v0.1.x → v0.2.0 으로 건너가는 **바로 그 업데이트** 에서는 마이그레이션 경고 로직이 실행되지 않음 (해당 코드는 v0.2.0 에 처음 들어갔기 때문). v0.2.0+ 부터의 업데이트는 항상 배너.

---

## 13. 릴리스별 추가 사항 (v0.3 → v0.7 — 압축 요약)

본 문서의 §1~§12는 v0.2.x까지의 핵심 토폴로지를 다룬다. 이후 릴리스에서 추가된 모듈·계층·CLI는 plan 문서에 자세히 기술되어 있으며, 여기서는 architecture-impacting 변경만 한눈에 본다.

### 13.1 v0.3 — PM 모드 + 멀티 에이전트 오케스트레이션
- `src/bot/pm-runner.ts` — long-lived Claude Code PM 세션 (per user × org)
- `src/bot/{workflow-reconciler, agents-builder, session-store, slash-commands, git-snapshot, workspace-meta}.ts` — workflow 라이프사이클·SKILL 동기화·세션 매핑·5종 슬래시·pre-spawn 스냅샷
- 슬래시 5종: `/think /plan /build /review /ship`
- `src/cli/{pm,workflow,workflow-focus,rollback}.ts` — pm/workflow/rollback 운영 CLI
- `<org>/workflows/<wf-id>/` — `_status.yaml` + `PRD.md` + `stage-N-*/_handoff.md` + `_events.jsonl`
- 자세히: `docs/plan/v0.3-pm-mode-orchestration.md`

### 13.2 v0.4 — 자율 goal-runner (코드상 v0.5/v0.6 내 흡수 구현)
- `src/engine/{goal-parser, agents-md-loader, guards, evaluator, tracker, reconciliation, goal-runner, program-parser, stop-hook-adapter}.ts` (3,576 LOC)
- 2계층 분리: 휘발성 의도 `<org>/goals/<goal-id>/goal.md` + 영속 가이드 `<workspace>/AGENTS.md` (Codex `/goal` + `AGENTS.md` 차용)
- Goodhart 방지: agent spawn의 modifiable_paths 화이트리스트는 `src/engine/**`, `AGENTS.md`, 현재 `goal.md`, `<org>/goals/<id>/results.tsv`를 포함하지 않음
- CLI: `solosquad goal new/list/show/run/status/stop/verify`
- 자세히: `docs/plan/v0.4-autonomous-engine.md`

### 13.3 v0.5 — 워크플로우 메이커 + analyze 파이프라인
- 4채널 trigger: slash / keyword / freq auto-load / explicit PM call
- `src/bot/agent-router.ts` — frontmatter의 `triggers.keyword`로 boot-time 라우트 빌드 (구 hardcoded `AGENT_ROUTES` 제거)
- 25 SKILL.md 전체에 `triggers.keyword`·`collab_pattern`·`metric_dependencies` 등 frontmatter
- `src/analyze/{scanner, classifier, ledger, applier, workflow-matcher}.ts` — repo 분석 → ledger → 4종 워크플로 매칭
- `src/cli/{agent, analyze, readiness, detect-v05-usage}.ts`
- 자세히: `docs/plan/v0.5-workflow-maker.md`

### 13.4 v0.6 — 디폴트 워크플로우 튜닝 + Org Layer + FTS5 archive
- **Team=Domain 통합** (§2.1): `agents/_teams/{team}/TEAM_KNOWLEDGE.md` 평행 hierarchy 폐지 → `agents/{team}/KNOWLEDGE.md` co-location
- **Organization Layer Specialization** (§2.2): `<org>/core/{PRINCIPLES,VOICE}.md`, `<org>/agent-profile.yaml` (defaults + 25 agent별 narrowing-only modifier, `schema_version: 1`), `<org>/domain/`
- **Workspace Knowledge Layer** (§2.3): `.solosquad/knowledge/` + bundled `assets/knowledge/`
- **8-layer JIT spawn**: `src/bot/spawn-assembler.ts` — 토큰 cap 기본 80,000 + 우선순위 drop + `spawn-decisions.jsonl` 인덱싱
- **Agent budget envelope**: `src/bot/agent-budget.ts` — `<org>/memory/agent-costs.jsonl` 누적 + daily/weekly cap
- **FTS5 cold archive** (§4): `src/memory/{archive-db, archive-rotate, archive-search, route-event-sink}.ts` — JSONL hot(7d) → SQLite cold(365d) + route fallback
- **Trajectory + Freq miner** (§3): `src/scheduler/{trajectory-extractor, freq-keyword-miner}.ts` — 30일 패턴 추출 → SKILL 제안 (v0.5 `applyDraft()` 재사용)
- **Hot-reload + CI PR 봇** (S6.A/B): `src/bot/{fs-watcher, reload-policy}.ts` + `scripts/skill-pr-review/`
- **better-sqlite3 ^12.10.0** 의존성 추가
- 자세히: `docs/plan/v0.6-default-workflow-tuning.md`

### 13.5 v0.7 — Uninstall & Lifecycle (Farewell Archive)

**핵심 결정**: `solosquad reset`·`solosquad clean` 같은 "초기화" 명령은 영구히 추가하지 않는다. 라이프사이클은 install ↔ uninstall 2단으로 닫는다.

**데이터 5분류** (§4):

| 클래스 | 예시 | 처리 |
|---|---|---|
| A | `<org>/repositories/<repo>/` | **불가침** — 어떤 플래그로도 변경/삭제 0. 트리 enumerate조차 안 함 |
| A\* | `<repo>/.solosquad/repo.yaml` | surgical 추출 → archive `orgs/<org>/repos/<repo>/repo.yaml` 후 `.solosquad/` 컨테이너만 제거. 화이트리스트 길이 1, repo 다른 파일 SHA1 대조 assertion |
| B | memory/·workflows/·goals/·knowledge/·domain/·core/·AGENTS.md | archive 후 삭제 (또는 `--keep-workspace` 시 디스크 보존) |
| C | workspace.yaml·.org.yaml·sessions·.claude/agents/ | 메타만 archive + 삭제 |
| D | .env 시크릿 | 마스킹된 `env.template`만 archive + 디스크 삭제 |
| E | ~/.claude/projects/·~/.solosquad-backups/·메신저 외부 자원 | 손대지 않음. `REVOKE-CHECKLIST.md`로 안내 |

**신규 모듈**:
```
src/lifecycle/
├── classify.ts            → 5분류 walker (repositories/ 트리 차단)
├── manifest.ts            → SHA256 + manifest.tsv (streaming 동시 계산)
├── sqlite-backup.ts       → WAL-safe better-sqlite3 backup() API
├── lockfile.ts            → 원자적 acquire + stale PID 감지 (concurrent uninstall 차단)
├── journal.ts             → uninstall.journal.jsonl append-only + idempotent 재개
├── precheck.ts            → 8개 항목(repo git drift·PM PID·disk free·workspace git tree 등) 검증
├── repo-meta.ts           → A* 추출 (whitelist 길이 1)
├── revoke-checklist.ts    → .env에서 Discord app ID·Slack workspace ID·Claude projects 경로 추출
├── cleanup.ts             → 클래스별 삭제 + journal 통합 + --keep-workspace 매트릭스 + SHA1 assertion
└── archive.ts             → archiver streaming zip writer + PII-NOTICE + scrub 옵션

src/cli/
├── uninstall.ts           → 5플래그(--dry-run --archive-only --keep-workspace --also-purge-backups --scrub-content) + 0-4 단계 오케스트레이션
└── logout.ts              → 가벼운 logout (PM/scheduler PID 거부 + logout.lock + 시크릿 마스킹 + sessions _archived/로)

src/cli/doctor.ts          → v0.7 점검 추가 (stale lock·PM PID·archive 디렉토리 free space·npm 훅 경고)

src/migrations/scripts/0.6.0-to-0.7.0.ts → version bump + workspace.yaml.uninstall 기본값
```

**Archive 포맷** (v0.7 §6):
- `archive.zip/{archive.yaml, manifest.tsv, REVOKE-CHECKLIST.md, PII-NOTICE.md, workspace/, orgs/<slug>/(memory|workflows|goals|domain|core|repos), credentials/env.template, manual-revoke-required/*.md}`
- `archive.yaml`: `schema_version: 1`, `solosquad_version: "0.7.x"`, `import_compat.min_solosquad_version: "0.7.0"`, `max_schema_version_supported: 1`, `archive_format: "zip-v1"`
- `manifest.tsv`: 모든 entry path · SHA256 · size · class · notes (streaming 동시 계산)

**의존성**: `archiver ^7.0.1` (streaming zip — `adm-zip` OOM 회피로 선택). `better-sqlite3`는 v0.6에서 이미 추가됨.

**lockfile 경로**: `<workspace>/.solosquad/uninstall.lock` (uninstall 동안) / `<workspace>/.solosquad/logout.lock` (logout 후 — bot/schedule 진입 차단)

자세히: `docs/plan/v0.7-uninstall-lifecycle.md`

### 13.6 v0.8 시리즈 — Multi-User + Security + Dev Capability + UX

v0.8은 *4 patch 시리즈*로 분할 출시 (v0.8.0/0.8.1/0.8.2/0.8.3). 병렬 worktree agent 4개로 동시 구현 + 순차 머지.

#### 13.6.1 v0.8.0 — Multi-User Messenger
**모델 변경**: "1 워크스페이스 = 1 owner = 1 봇 = 2 채널" 가정 깸. 같은 Discord/Slack 서버에 N명 설치 가능.

**신규 모듈**:
```
src/bot/
├── user-registry.ts        → <org>/.solosquad/users/<handle>.yaml 파서 + bot_user_id 매칭
├── author-guard.ts         → command-<handle>/works-<handle> owner 검증 + ephemeral DM
├── channel-bootstrap.ts    → bot startup 자기 yaml 매칭 + 채널 페어 자동 생성
src/messenger/
└── broadcast.ts            → opt-in broadcast 채널 + designated 봇만 발송
src/cli/
├── init.ts                 → Step 5.2 handle 추출 + user yaml 작성
├── messenger.ts            → broadcast-handover 명령
└── doctor.ts               → runMultiUserChecks (yaml 매칭·채널 존재·designation)
src/bot/
└── spawn-assembler.ts      → Layer 5 user yaml 주입 (handle/display_name/channels)
src/migrations/scripts/
└── 0.7.0-to-0.8.0.ts       → workspace.yaml.messenger + 첫 user yaml 시드
```

**박제 결정**:
- 봇 1명당 1 application (공유 token 거부 — rate-limit/duplicate reply)
- Handle 충돌 명시적 거부 (silent suffix 안 함)
- broadcast 기본 off (opt-in)
- legacy `owner-command`/`workflow` 채널 alias 작업 0 (v0.7 사용자 base 0 전제)

자세히: `docs/plan/v0.8-multiuser-messenger.md`

#### 13.6.2 v0.8.1 — Security & Lifecycle Pair
**라이프사이클 페어 완결 + 보안 SLA**:
- npm audit 7 (3 moderate + 4 high) → 0 (discord.js 14.16→14.26 + undici 6.21→6.24 + overrides for axios/lodash/path-to-regexp/follow-redirects)
- `.github/workflows/ci.yml`에 `npm audit --audit-level=high` 게이트

**신규 모듈** (lifecycle pair 완결):
```
src/cli/
├── import.ts               → solosquad import <archive.zip> (dry-run + --merge[default]/--replace)
└── archive.ts              → solosquad archive verify/info/list
src/lifecycle/
├── import.ts               → unpack + journal idempotent + verify
├── archive-reader.ts       → yauzl 기반 pure-JS zip reader (archiver는 writer-only)
└── merge-strategy.ts       → jsonl dedup + workflows/goals id 충돌 거부 + AGENTS.imported.md
src/migrations/scripts/
└── 0.8.0-to-0.8.1.ts       → SKILL.md schema_version 1 백필
scripts/
└── inject-skill-schema-version.ts → idempotent backfill (CI 게이트 — SCHEMA_VERSION_MISSING 경고)
docs/
└── api-stability.md        → 6 schema_version의 bump 룰 + 1-minor deprecation 기간
```

**의존**: `yauzl ^3.3.0` (devDeps — archive verify/import reader)

자세히: `docs/plan/v0.8.1-security-lifecycle-pair.md`

#### 13.6.3 v0.8.2 — Dev Capability
**24/7 자율 팀 코드 액션 능력**: SKILL frontmatter에 `dev_capability` + `dev_permissions` 신설. 메신저로 코드 수정 + commit + push + PR 생성 end-to-end. **자동 머지 영구 거부**.

**신규/확장**:
```
src/bot/
├── skill-parser.ts (확장)  → dev_capability + dev_permissions (bash allow/deny + merge.auto: true 영구 거부)
├── spawn-assembler.ts (확장) → applyDevPermissions(): read-only/dev-enabled/workspace-disabled reason 트래킹
├── claude-process.ts (확장) → --allowed-tools + bashAllowlist/Denylist pre-check
└── dev-confirm.ts (신규)   → git push/gh pr merge 감지 + 30분 timeout + <org>/memory/dev-confirmations.jsonl
src/util/
└── config.ts (확장)        → DevCapabilityConfig + DEFAULT_DEV_CAPABILITY_DENYLIST (rm -rf /, sudo, chmod 777, ...)
src/cli/
└── doctor.ts (확장)        → gh --version + gh auth status
assets/
└── orchestrator/SKILL.md   → "Engineering Spawn Template (v0.8.2)" 7-단계 PR 흐름 절
src/migrations/scripts/
└── 0.8.1-to-0.8.2.ts       → workspace.yaml.dev_capability 기본값 + 5/20 SKILL frontmatter verify
scripts/
└── inject-dev-capability.ts → idempotent SKILL 박제 (25/25 idempotent)
```

**박제 (5 engineering SKILL true / 나머지 20 false)**:
| 팀 | true | 비고 |
|---|---|---|
| engineering | backend-developer · fde · api-developer · creative-frontend · qa-engineer | 핵심 coding actor |
| engineering | architect · cloud-admin · data-engineer · data-collector · security-engineer | advice/review only |
| strategy / growth / experience / meta | (전부 false) | non-coding |

**Workspace 마스터 토글**: `workspace.yaml.dev_capability.enabled` (기본 true). `false` 시 모든 SKILL dev 액션 0.

자세히: `docs/plan/v0.8.2-dev-capability.md`

#### 13.6.4 v0.8.3 — Onboarding UX + Observability
**5 축**:

**기존 리포 마이그레이션 UX**:
- `solosquad add repo <path> --dry-run` / `--inspect` / `--keep-original`
- `src/util/repo-inspect.ts` — 위험 시나리오 5종 (lsof / 심링크 / 절대경로 / slug 충돌 / IDE 활성)
- 5단계 가이드 (commit → init → dry-run → 이동 → sync)

**logger 확장 + observability**:
```
src/util/logger.ts (확장)   → SOLOSQUAD_LOG_LEVEL/FORMAT=json/FILE=1, 14일 rolling
src/cli/logs.ts (신규)      → solosquad logs --level/--tail/--follow/--since/--type
                              type: runtime/costs/spawn/stop-hook/dev-confirm/migration
assets/routines/log-rotate.md → 매일 00:30 retention
```

**`solosquad logout` 제거**:
- `src/cli/logout.ts` deprecation stub만. v0.7에서 추가됐던 명령 가치 < 복잡도
- `src/lifecycle/lockfile.ts`에서 `logoutLockPath()` 제거 + `src/bot/index.ts`의 logout.lock 차단 제거
- 대체: `Ctrl+C` (봇 정지) + .env 수동 마스킹 + messenger 콘솔 revoke (REVOKE-CHECKLIST 안내)

**doctor 확장**:
- `recommendForVersionMismatch()` + `compareSemver()` — CLI > workspace → migrate 권고, CLI < workspace → update 권고
- master-guide §6에 update↔migrate 흐름도

**Master-guide rebase**:
- §3/§4/§6/§8/§9/§10 v0.7+v0.8 모델 흡수 (+182 lines)
- v0.8.0/0.8.1/0.8.2/0.8.3 절 신설

**Trajectory ROI 측정**:
- `scripts/measure-trajectory-roi.ts` (일회성) — v0.6 §3.X 4지표 측정. 결과는 v0.9 자동 등록 활성화 게이트로

**Migration 0.8.2 → 0.8.3**: trajectory.auto_register 키 + log-rotate routine 등록.

자세히: `docs/plan/v0.8.3-onboarding-ux-observability.md`

#### 13.6.5 v0.8 시리즈 통합 — 회귀 + 머지 결과
- 병렬 4 agent worktree → 순차 머지 (v0.8.0 → 0.8.1 → 0.8.2 → 0.8.3)
- 충돌 영역: `src/cli/index.ts` (명령 등록) · `src/cli/doctor.ts` (점검 추가) · `src/bot/spawn-assembler.ts` · `src/bot/skill-parser.ts` · `src/migrations/index.ts` · CHANGELOG.md
- 최종 회귀: **556/556** 그린 (기존 452 + v0.7 신규 + v0.8 신규 ~104)
- 사용자 코드 불가침 룰(v0.7 클래스 A) 계승: v0.8.3 `add repo --dry-run`도 byte-identical 보장

#### 13.6.6 v0.8 후속 polish (단일 plan 통합 — 구 v0.8.4 흡수)
v0.8.4 별도 plan은 *메신저 polish 한정*으로 폐기되고 `v0.8-multiuser-messenger.md` §3A로 흡수. *CLI surface reduction* 스코프는 v0.8.4가 별도 plan으로 부활(`v0.8.4-cli-surface-reduction.md`):
- uninstall 플래그 8 → 5 (`--mode <full|keep|archive-only>` 일원화) + `--scrub-content` 제거
- `import --merge`/`--replace` → `--mode <merge|replace>`
- `add repo --inspect` deprecation
- `agent validate --corpus` dev-only로 이동 (`npm run test:corpus`)
- `backup list|delete|purge` subgroup 신설 (migrate·uninstall의 백업 플래그 흡수)
- `solosquad init` walk-up 시 3-way prompt (cwd default + 기존 워크스페이스 / custom)
- v1.0 surface freeze 체크리스트 박제

#### 13.6.7 v0.8.5 — Onboarding QA & Release-Gate
v0.8.4 출시 직후 fresh init을 실제로 돌려본 결과 박제 patch (`docs/plan/v0.8.5-onboarding-qa.md`):

**핵심 회귀 fix**:
- `src/cli/init.ts:29`의 `SOLOSQUAD_VERSION = "0.4.0"` 하드코딩 → `src/util/version.ts`로 분리, `package.json` 동적 참조. v0.4 이후 모든 신규 사용자가 fresh init 직후 migration 경고를 받던 회귀 종료

**3-docs pre-publish gate**:
- master-guide.html이 v0.6.0 기준으로 정지 → v0.8.5까지 backfill
- `scripts/check-docs-freshness.ts` + `npm run docs-check` 신설 — `prepublishOnly`에서 `package.json.version`이 product-roadmap·architecture·master-guide 3건에서 발견되지 않으면 publish 차단
- `.claude/rules/git-workflow.md`에 게이트 룰 박제

**wizard 문구 정합**:
- Step 2 "Initialize Workspace" → "Create Workspace" (생성 의도 명확화)
- 부모에 `.solosquad/` 없을 때 redundant CWD prompt 제거 (mkdir로 이미 결정한 디렉터리를 또 묻지 않음)
- 각 prompt 위에 *왜 묻는지* 헬프 1줄: name/role(PM·agent 톤), messenger(1 워크스페이스 1 메신저), handle(`[a-z0-9_]+`만, 채널 페어 명명), org(사업 단위), provider(host 추정)
- Slack scope 안내에서 `channels:manage` 굵게 + "Reinstall to Workspace" 경고 강조 (`missing_scope` 마찰 해소)

**master-guide §4 보강**:
- 버전 헤더 v0.6.0 → v0.8.5 + 누적 변경 흡수 (v0.7 uninstall, v0.8.0~v0.8.4 시리즈)
- §4.2 Step 5 워크스페이스 *생성* 문구 + mkdir 예시를 placeholder(`my-saas` 같은 자유 이름)로
- §4.2.1 마법사 q&a 표 신설 (prompt × 왜 묻는가 × 입력 제약 × 저장 위치)
- §3.12 `.solosquad/` 위계 설명 절 (workspace/org/repo 3 단계 각각의 *시스템 메타 vs 사용자 콘텐츠* 분리 의도)
- §6.4 routine 표 5건으로 정리 (사용자 brief 3 + 인프라 2)

**routine 정리 9건 → 4건**:
- *분석 4건 영구 제거*: `signal-scan` · `experiment-check` · `weekly-review` · `v06-retrospective-stats`. product-roadmap §3.2.8(2026-05-15)의 "비-디폴트 유지" 결정을 v0.8.5에서 *영구 제거*로 escalate. 사유: 비-디폴트로 둬도 사용자 도메인 prompt가 있어야 의미, cron 슬롯·UI 자리 차지할 가치 없음
- *인프라 2건 통합*: `archive-rotate` + `log-rotate` → `system-housekeeping` (단일 cron 00:00). 둘 다 silent 결정적 housekeeping이라 분리 cron 둘 이유 없음. `rotateArchive()` + `rotateLogs()` 각각 try/catch 격리로 한쪽 실패가 다른 쪽 안 막음
- 코드: `assets/routines/*.md` 6건 삭제 + `system-housekeeping.md` 1건 신설, `ROUTINES` 9→4, `resolveSchedules` switch 정리, `v06-stats-extract.ts` + test 삭제, `SYSTEM_THREADS` 정리, `goal.md` Signal Trigger 절 제거
- backward-compat: `workspace.yaml.background_routines` 키 read-ignore. `applyWorkspaceDefaults`가 default 주입 중단

**migration 0.8.4 → 0.8.5**: schema 변경 없음, version bump only. 기존 워크스페이스의 `background_routines` 키는 untouched pass-through.

자세히: `docs/plan/v0.8.5-onboarding-qa.md`

### 13.7 v1.x 시리즈 (예고)

**v1.x — Workflow / Goal / Routine 고도화** (`docs/plan/v1.x-workflow-goal-routine-evolution.md`):
- Q1 leading indicator (24/7 자율 팀 측정): morning brief에 4 지표 inline
- Q2 암묵지 1차 source (사용자 명시): `/save-as-skill` + 자연어 인식
- Q4 goal cycle 중간 통지/개입: works-<handle> 스레드에 실시간 상태 + 사용자 메시지 폴링
- Q5 1 active goal per org: `<org>/goals/.active-goal` 세마포어 + `goal queue`
- Q6 루틴 사용자별: 디폴트 3 routine을 user yaml routines 설정 기반 per-user cron
- Q7 실험 인프라 (Amplitude 패턴 차용): `<org>/experiments/<id>/manifest.yaml` + 자동 query + significance check + 권고 변환

**그 외 v1.x**:
- v1.1: 대시보드 상호작용 (별도 리포)
- v1.2: 지식 온톨로지 + MCP
- v1.3: 일정 관리 + 메모

자세히: `docs/plan/v1.x-workflow-goal-routine-evolution.md`, `docs/plan/v1.1-dashboard-interaction.md`, `docs/plan/v1.2-knowledge-ontology.md`

### 13.8 기획 문서 목록 (v0.x → v1.x)

**v0.x 프리-런치 (구현 완료):**
- `docs/plan/v0.1-cross-platform.md` · `v0.1.1-qa-hardening.md` · `v0.1.2-npm-publish.md`
- `docs/plan/v0.2-safety-security.md` · `v0.2.1-messenger-debugging.md` · `v0.2.2-terminology-layout.md` · `v0.2.3-migration-process.md` · `v0.2.4-channel-consolidation.md`
- `docs/plan/v0.3-pm-mode-orchestration.md`
- `docs/plan/v0.4-autonomous-engine.md`
- `docs/plan/v0.5-workflow-maker.md`
- `docs/plan/v0.6-default-workflow-tuning.md`
- `docs/plan/v0.7-uninstall-lifecycle.md`
- `docs/plan/v0.8-multiuser-messenger.md` (구 v0.8.4 polish 흡수)
- `docs/plan/v0.8.1-security-lifecycle-pair.md`
- `docs/plan/v0.8.2-dev-capability.md`
- `docs/plan/v0.8.3-onboarding-ux-observability.md`
- `docs/plan/v0.8.4-cli-surface-reduction.md`
- `docs/plan/v0.8.5-onboarding-qa.md`

**v1.x 포스트-런치 (계획):**
- `docs/plan/v1.x-workflow-goal-routine-evolution.md` — Q1~Q7 ideation 통합 (workflow / goal / 루틴 진화 + Amplitude 실험 인프라)
- `docs/plan/v1.1-dashboard-interaction.md` — 대시보드 상호작용 (대시보드 자체는 별도 리포)
- `docs/plan/v1.2-knowledge-ontology.md` — 지식 온톨로지 + MCP 외부 연결
- `docs/plan/v1.3-schedule-memo.md` (예정) — 일정 관리 + 메모 (지식 온톨로지와 같은 결)

롤링 상태는 `docs/plan/product-roadmap.md`.

---

## 14. 레퍼런스

- [OpenClaw](https://github.com/openclaw/openclaw) — npm 패키지 배포 + update/doctor CLI 패턴
- [Ralph Loop (Huntley)](https://ghuntley.com/ralph/) — 자율 코딩 루프 패턴
- [Hermes Agent](https://github.com/nousresearch/hermes-agent) — 에이전트 프레임워크 (설정 폴더 ~/.hermes/)
- [MiroFish](https://github.com/666ghj/MiroFish) — 멀티에이전트 시뮬레이션, 데이터 분석/예측 확장 방향
- [autoresearch (Karpathy)](https://github.com/karpathy/autoresearch) — 메트릭 게이팅 + git rollback 운영 패턴 원조 (v0.4 차용)
- [OpenAI Codex `/goal`](https://developers.openai.com/codex/use-cases/follow-goals) + [`AGENTS.md`](https://developers.openai.com/codex/agents-md/) — v0.4 자율 실행의 2계층 구조 (volatile goal + persistent AGENTS.md) 채택 근거
