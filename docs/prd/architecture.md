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

#### 13.6.8 v0.8.6 — migrate Hotfix + Agent PR Workflow Doc
v0.8.5 release 직후 사용자 테스트에서 발견된 회귀 hotfix (`docs/plan/v0.8.6-migrate-hotfix-pr-workflow.md`):

**핵심 회귀 fix**:
- `src/cli/migrate.ts:8` `CLI_VERSION_TARGET = "0.4.0"` 하드코딩 → `SOLOSQUAD_VERSION` 동적 참조 (v0.8.5 `init.ts` 패턴 grep 누락)
- 영향: v0.4 이후 *1년 가까이* `solosquad migrate` (옵션 없이)가 `"Nothing to migrate."`로 silent no-op. doctor는 mismatch 잘 감지, 안내 따라가도 결과 없음 → workaround로 `--to 0.X.Y --apply` 명시 필요했음
- 동일 패턴 회귀 방지: grep 결과 src/cli 디렉터리 stale 버전 상수 추가 0건 확인. 향후 모든 버전 default는 `src/util/version.ts`의 `SOLOSQUAD_VERSION` import 강제

**master-guide 보강** (KO + EN 동일 박제):
- §4.2 Step 1에 *짧은* git 인증 callout — git 표준 흐름에 위임, SoloSquad 별도 절차 X 명시 (Windows GCM 자동 / macOS osxkeychain / Linux 별도 셋업)
- §10.4 Uninstall · 재설치 · 마이그레이션 회피 — npm v7+ 글로벌 hook 한계 대응, 안전한 uninstall 6단계, uninstall + reinstall로 migration chain 우회 흐름, 새 init 후 doctor 경고 7종 분류 표
- §10.5 봇·스케줄러·**에이전트 git 작업** — *v0.8.6 범위 = push까지* 명시 (PR 라이프사이클은 사용자 책임). 스케줄러 비자동 실행, push 전제 3건(git 인증·repo 등록·dev_capability), 에이전트 push 흐름 (compare URL 회신), 온보딩 추가 5건 (Step 1.5/7.5/7.7/8.5/8.7 — gh CLI 단계 제거)
- §10.1 트러블슈팅에 git push 인증 실패 항목 (OS별 3줄 안내 + GitHub 공식 docs 링크)
- v1.x followup callout — gh CLI 트랙 / MCP 트랙 / 다중-에이전트 토론 모두 v1.x 슬롯으로 분리

**v1.x 슬롯 설계 박제** — PR API 자동화 + 다중-에이전트 토론 (v0.8.6에서 *코드 0건*):
- **PR API 트랙 선택지**: gh CLI / MCP github server / REST API + curl 3종 비교 + workflow.yaml `pr_api: mcp|gh|none` 후보. `none`이 v0.8.6 기본 (사용자 웹 UI)
- workflow.yaml schema v2: `git_workflow` 섹션 (`branch_pattern`, `auto_pr`, `pr_api`) + `reviewers` 리스트 (agent + focus + timing)
- SKILL frontmatter 확장: `can_review_pr: true` + `review_focus: [...]` + `review_comment_template`
- 자동 흐름: stage 종료 → branch push → dev-confirm → PR (gh/MCP) → reviewers spawn round → PM aggregation → works-handle post → discussion round 2 (사용자 트리거) → merge gate (사용자 y)
- 영구 박제: `auto_merge: false` + `discussion_rounds` cap + 자동 머지 영구 거부
- `<org>/memory/pr-discussions.jsonl` + (MCP 트랙 선택 시) `<org>/memory/mcp-calls.jsonl` audit log + FTS5 인덱싱
- 코드: `src/engine/git-workflow.ts` + `src/engine/pr-reviewer.ts` 신설 슬롯. v1.x-workflow-goal-routine-evolution.md에 §추가

**migration 0.8.5 → 0.8.6**: schema 변경 없음, version bump only.

자세히: `docs/plan/v0.8.6-migrate-hotfix-pr-workflow.md`

#### 13.6.9 v0.8.7 — Tiny Stabilization
v0.8.5 + v0.8.6의 *stale 버전 상수 회귀* 패턴 회고 결과 *꼭 필요한 것 2건만* patch (`docs/plan/v0.8.7-tiny-stabilization.md`):

**발견된 drift 직접 수정**:
- master-guide §3.11 `dev_capability` 표현이 v0.8.2 design intent의 "4-level enum (read/propose/patch/pr)"을 따랐으나 *실제 코드는 boolean + dev_permissions sub-tree로 분리됨*. KO + EN 양쪽 §3.11 한 문단 직접 edit으로 코드 reality 반영

**회귀 catcher 1건**:
- `test/migrate-default-target.test.ts` (~30 lines) — v0.8.6 hotfix 클래스 (`CLI_VERSION_TARGET = "0.4.0"` 같은 stale literal default) 재발 방지. source inspection 기반 3 assertion (hardcoded literal 부재 / SOLOSQUAD_VERSION import 존재 / 동적 값이 semver)
- *narrow scope*: `migrate.ts` 한정. 같은 패턴이 다른 파일에 또 생기면 *그때 sibling test 추가*. lint rule 일반화는 *영구 skip*

**v0.9 안정화 6축 권장안 — 영구 skip 결정**: stale constant lint / migration chain E2E / doctor 확장 / archive round-trip / CLI surface drift 자동 검증 / docs-code drift sweep 인프라 모두 *오버스펙*으로 판정해 영구 skip. *문제 발견 → patch* 패턴 유지. v0.9 plan doc 작성 안 함.

**v1.0 publish 형식**: 코드 변경 없이 *5분 manual sweep + tag + api-stability §4 발효일 박제*. v1.0 plan doc도 그 시점에 작성.

**migration 0.8.6 → 0.8.7**: schema 변경 없음, version bump only.

자세히 (v0.8.5): `docs/plan/v0.8.5-onboarding-qa.md`
자세히 (v0.8.7): `docs/plan/v0.8.7-tiny-stabilization.md`

#### 13.6.10 v0.9 — Workspace ↔ Repository 관계 재설계 (plan only)
v0.8.5~v0.8.6 사용자 테스트에서 *repos-inside-workspace-tree* 강제가 솔로 사용자 4 시나리오 (이미 dev tree 보유 / 드라이브 경계 / 멀티 워크스페이스 repo 공유 / SoloSquad 자체 코드 작업) 모두 미해결임을 확인. **plan 박제 patch — 코드 변경 0건**. 구현은 v0.9.1+에서.

**peer agent 모델 비교**: Hermes (sandbox clone) vs Codex `/goal` (cwd direct) vs Copilot Workspace (cloud auto-fetch) vs SoloSquad (현재 트리 강제). 4 후보 (A move / B path-reference / C sandbox / D hybrid) 비교 후 **모델 B (path reference)** default 채택:
- `repo.yaml.path: <absolute-path>` 필드 신설
- `<workspace>/<org>/repositories/<repo>.yaml` 파일 (디렉터리 아님)
- `resolveRepoCwd`가 path 읽어 외부 경로로 cwd 결정 — 원본 사용자 dev tree 무변형
- 사용자 working tree 직접 작업 (Hermes 모델 C는 솔로 founder 1인에 오버스펙, v2.x slot 박제)

**워크스페이스 위치 멘탈 모델**: 모델 B 도입으로 워크스페이스가 ~ 50 MB config 폴더로 축소 → **1 user = 1 workspace + N orgs + N path-referenced repos**. 권장 위치 `~/solosquad/` (또는 짧은 이름). 멀티 워크스페이스는 *멀티 메신저 페르소나가 필요할 때만* advanced option (master-guide §9.2 유지).

**자동화 UX 4종**: ① cwd 인식 (default) — `cd <repo> && solosquad add repo` / ② `--path <ext>` 명시 flag / ③ `solosquad init` Step 5.1 확장 — path 입력 받기 / ④ `--discover <dir>` bulk 스캔 (사용자 명시 호출만). gh CLI 연동 (`--discover-github`)은 v1.x slot.

**backward-compat**: 현재 `<workspace>/<org>/repositories/<repo>/` 트리 사용자는 *영구 동작* — `resolveRepoCwd` legacy 분기 유지. 마이그레이션은 opt-in (`solosquad migrate --externalize-repos`, v0.9.2+).

**모델 C (sandbox) v2.x slot 박제 사유**: SoloSquad는 *솔로 founder teammate* 시나리오 — 사용자가 IDE 옆에서 에이전트 commit을 실시간 봄. Hermes의 multi-user / cloud platform 시나리오와 다른 결.

자세히: `docs/plan/v0.9.1-workspace-repo-relationship.md`

#### 13.6.11 v0.9.1 — Model B 구현 + master-guide npm 포함 + Step 1 prerequisites 보강
v0.9 plan (§13.6.10)의 추천 모델 B를 코드로 구현 + 부수 docs visibility fix.

> **Note**: 0.9.0은 2026-05-20에 publish-then-unpublish 됨. npm time 객체에 영구 기록 + 같은 번호 재사용 불가 (npm burn policy). 0.9.1이 Model-B path-reference 디자인의 첫 설치 가능 릴리스. 코드 자체는 0.9.0과 동일 + master-guide §4.2 Step 1 prerequisites 박스 3개 추가.

**Model B 구현**:
- `src/util/config.ts:RepoYaml`에 `path?: string` 필드 추가
- `src/util/paths.ts:resolveRepoCwd` 우선순위 재정의: (1) path-reference `<workspace>/<org>/repositories/<slug>.yaml` 파일이 있고 `path:` 가리키는 외부 디렉터리 존재 → 외부 경로 / (2) legacy `<workspace>/<org>/repositories/<slug>/` 트리 / (3) legacy 루트
- `src/cli/add-repo.ts`: `--path <external>` flag + cwd 자동 인식 (인자 없이 호출 시 cwd가 git repo면 path-reference 등록 제안) + `registerPathReference()` 신설 — workspace yaml + 외부 repo의 `.solosquad/repo.yaml` 두 파일 작성
- `src/cli/init.ts:registerRepoInline()`: 외부 path 입력 시 *path-reference / move 2-way prompt* (default = path-reference)
- `src/cli/doctor.ts:runPathReferenceChecks()`: 등록된 path-reference 각각의 외부 경로 존재 + `.git/` 검증 (warn-only)

**docs visibility fix (부수)**:
- `docs/manual/` → top-level `manual/`로 이동 (npm `files` 필드에 `manual/` 추가)
- `docs/`는 사용자 비노출 유지 (개발자 plan·architecture 등 dev-only)
- 사용자가 `npm install -g solosquad` 후 *로컬에서 master-guide HTML 접근 가능*
- 향후 `solosquad docs` CLI 명령 슬롯 (v0.9.x or v1.x)

**회귀 catcher**: `test/repo-path-reference.test.ts` (4 tests) — yaml의 path field가 외부 경로로 resolve / 외부 경로 없으면 legacy 폴백 / yaml 없이 legacy만 있어도 동작 / `RepoYaml.path` interface 필드 source-inspection

**backward-compat 보존**:
- 기존 `<workspace>/<org>/repositories/<slug>/` 트리 영구 동작
- v0.9.2+ slot: `solosquad migrate --externalize-repos` (현재 트리 → 외부 path-reference, opt-in)

**migration 0.8.7 → 0.9.1**: schema 변경 없음, version bump only. RepoYaml.path는 *옵셔널 추가*라 기존 yaml에 손 안 댐.

**v0.9.1 추가 — master-guide §4.2 Step 1 prerequisites 박스 3개** (KO/EN +46/+46 lines):
- 의존성 종합 표 (`solosquad doctor` 7개 도구 점검 — node·npm·git·claude·gh·pwsh·docker)
- 환경 변수 종합 표 (`.env` 11종 + `ANTHROPIC_API_KEY는 사용 안 함` 명시)
- 자원·네트워크 하한 callout (디스크/메모리/OS×arch/outbound/shell/타임존/npm 권한)

571/571 tests green (567 + 4 path-reference).

자세히: `docs/plan/v0.9.1-workspace-repo-relationship.md` (plan), code in `src/util/paths.ts` + `src/cli/add-repo.ts`

#### 13.6.12 v0.9.2 — Uninstall precheck self-match hotfix (Windows)

**`src/lifecycle/precheck.ts:detectLivePids` 한 줄 fix.** `solosquad uninstall`이 봇·스케줄러가 실제로 안 돌고 있는 환경에서도 `bot/schedule appears to be running (pid X, Y)`로 차단하던 Windows 한정 버그.

**원인**: WMI 쿼리

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'solosquad' -and
                 $_.CommandLine -match '(bot|schedule|run-routine)' } |
  Select-Object -ExpandProperty ProcessId
```

의 `-Command` 인자 문자열이 그 자체로 `'solosquad'`와 `'(bot|schedule|run-routine)'` 두 정규식 리터럴을 포함. 쿼리를 실행하는 powershell.exe의 CommandLine은 둘 다 매칭되므로 **자기 자신이 결과에 포함**. execSync마다 새 powershell.exe가 떠서 PID가 매 호출 바뀌는 증상. `process.pid` 필터는 node 프로세스만 제외하므로 무력.

**수정**: Where-Object 절 앞에 `$_.Name -eq 'node.exe'` 가드 추가. powershell.exe는 첫 술어에서 탈락 → regex match에 도달하지 않음.

**영향**:
- POSIX 경로(`pgrep -f`)는 영향 없음 — pgrep의 자기 자신 command line은 `solosquad (bot|schedule|run-routine)` 리터럴을 포함하지만 alternation 문자열이라 실제 `solosquad bot` 등으로 매칭되지 않음.
- 스키마 변경 0건. migration 0.9.1 → 0.9.2는 `workspace.yaml.version` bump only.
- `--force` 우회 사용자에게도 무해 (정직성 차단만 다시 활성).

**회귀 catcher**: `test/lifecycle-precheck.test.ts` — `detectLivePids` 3회 호출 결과의 동일성을 assert. 버그 존재 시 매 호출마다 새 phantom PID가 추가되어 deepEqual 실패.

572/572 tests green (571 + 1 v0.9.2 regression test).

자세히: `docs/plan/v0.9.2-precheck-self-match-hotfix.md` (plan), `CHANGELOG.md` §[0.9.2]

#### 13.6.13 v1.0.0 — Formal launch (2026-05-21)

**공개 사용자 약속이 시작되는 마일스톤.** `docs/api-stability.md`의 SemVer 정책이 발효되고, `v0.8.4-cli-surface-reduction.md §11`의 42-command CLI surface가 freeze. 진입 흐름 정합 *2 항목* 흡수 + 메신저 단일화 결정 박제.

**Activated**:
- `api-stability.md` "Effective as of v1.0.0 (2026-05-21)" 발효. 6개 `schema_version` 표면의 deprecation 정책이 v1.x.x bullet로 활성화.
- `workspace.yaml.version` ↔ SoloSquad CLI SemVer 1:1 추적. v0.x 자유 bump 종료.
- 42 CLI 명령 freeze — 명령 추가 = minor / 명령·플래그 제거 또는 rename = major (v2.0+).

**Changed — onboarding 정합 2건** (v1.0 plan §1.3):
1. `solosquad init` Step 1.5 신설 — Claude Code 인증 흡수. `commandExists("claude")` + `claude auth status --json` 점검 → 미로그인 시 `claude login` spawn (inherit stdio). 이미 인증된 사용자는 1초 스킵. 종전 *2-step* 마찰 제거.
2. repo 등록 *path-reference 단일화*. `solosquad init` Step 5.1 / `solosquad add repo` 의 URL clone + Move/Copy 분기 제거. 모든 입력이 `registerPathReference`로 funnel. git URL은 `clone first, then re-add` 거부 + 비-git 폴더는 `git init first` 거부. SoloSquad는 git clone semantics를 *책임지지 않음*.

**Scoped — Slack to post-v1.0**:
- README × 2 + master-guide × 2의 *Discord-first* 재정렬 + §5.1 Slack walkthrough *post-v1.0 슬롯* 배지.
- `src/messenger/slack-adapter.ts` 코드 보존 (v0.9.x 사용자 회귀 0) — SemVer 약속 외.
- 사유: invite gap (사용자 자동 invite 누락) + 6+ OAuth scope 요구 + workspace admin 게이팅 + v0.x dogfood가 Discord 중심 누적.

**Compatibility**:
- migration 0.9.2 → 1.0.0: workspace.yaml.version bump only, idempotent.
- legacy `<workspace>/<org>/repositories/<slug>/` 트리: `resolveRepoCwd` legacy 분기로 영구 동작.
- v0.9.1+ path-reference yaml: 그대로 동작.
- breaking change 0건 (사용자 데이터 면), 코드 surface 명령 추가/제거 0건.

572 → **573 tests green** (572 baseline + `test/v1.0-path-ref-only.test.ts` 3건).

자세히: `docs/plan/v1.0-official-launch.md`, `docs/api-stability.md` (발효 본문), `CHANGELOG.md` §[1.0.0]

#### 13.6.14 v1.0.1 — Discord deprecation + repo `role` 제거 + 다중-repo 라우팅 (2026-05-22)

**v1.0.0 publish 직후 첫 patch.** dependency-level deprecation 1건 + onboarding friction 1건 한 릴리스 흡수 + 그 자리 메우는 라우팅 메커니즘 신설. *"한 agent 가 여러 repo 를 다룬다"* 포지셔닝과 `role=main` 단일 default repo 가정 사이의 의미적 빚 동시 해소.

**Fixed — discord.js v15 readiness**:
- `src/messenger/discord-adapter.ts` — `client.on("ready", …)` → `client.on(Events.ClientReady, …)`.
- discord.js 14.26: `ready` alias deprecate (사유: gateway READY opcode 와 이름 충돌). v15: alias 완전 제거.
- v1.0.0 봇 시작 시 매번 출력되던 Node `DeprecationWarning` 사라짐 + v15 silent failure 사전 차단.

**Changed — `role` cargo cult 제거 + `@<slug>` 라우팅 신설**:
- repo `role` prompt 제거 (`solosquad init` Step 5.1 + `solosquad add repo`). 신규 등록은 silent `role = "main"`. `--role` flag 는 power-user override 로 유지하되 `warnDeprecated`.
- `workflow-resolver.ts` `pickMainRepoSlug` → `pickDefaultRepoSlug` (첫 등록 repo fallback). resolver reason `"main-repo"` → `"first-repo"`. 스케줄러 default cwd 결정에만 쓰임 — user-driven routing 은 PM 레벨로 단일화.
- `src/bot/mention-parser.ts` 신규 — `@<slug>` 메시지 mention 파서. 등록 slug 셋과 교집합 + Discord 핑 무시 + dedupe. routing 시점 LLM 호출 0.
- `src/bot/index.ts` slash pre-processor 다음에 mention pre-processor wiring. 마커 `[target_repo:<slug>]` (single) / `[target_repos:a,b]` (multi).
- `assets/orchestrator/SKILL.md` §"Multi-Repo Intent (v1.0.1+)" 신설 — PM 이 마커 honor, 단일 repo 자동, 모호하면 짧은 clarifying question, silent guessing 금지.

**Deprecated — schema/CLI surface (api-stability 정책 준수)**:
- `RepoYaml.role` 필드: `@deprecated` JSDoc. hard 제거 = v2.0 (schema "2-minor read window").
- `solosquad add repo --role` flag: `warnDeprecated`. 제거 = v2.0 (CLI surface freeze).

**Compatibility**:
- migration 1.0.0 → 1.0.1: workspace.yaml.version bump only, idempotent.
- 기존 `repo.yaml` 의 `role:` 그대로 read. resolver 가 더 이상 안 보지만 무해.
- 신규 등록도 `role: main` 자동 채움 → schema 호환 유지.
- breaking 0 (사용자 데이터·CLI surface 면), schema 변경 0.

573 → **588 tests green** (573 baseline + `test/v1.0.1-discord-ready.test.ts` 1 + `test/v1.0.1-mention-parser.test.ts` 8 + `test/v1.0.1-role-deprecated.test.ts` 4 — 일부 케이스는 다중 assertion 묶음으로 14건 effective).

자세히: `docs/plan/v1.0.1-discord-ready-deprecation.md`, `CHANGELOG.md` §[1.0.1]

#### 13.6.15 v1.0.2 — Discord author-guard 정합 + 온보딩 reorder (2026-05-22)

**v1.0.1 publish 직전 발견된 author-guard false positive 의 박제 fix + 동시에 온보딩 narrative 정합 회복.** *"Discord username = SoloSquad handle"* 이라는 v0.8 §3.4 의 암묵 invariant 가 두 charset 의 영구 불일치 (`Discord username: seungw1n.` vs handle `[a-z0-9_]`) 로 깨졌음을 정직 박제. **handle 을 SoloSquad 유일 canonical user identifier 로 격상**, Discord author identity 는 *gate 아닌 audit log* 로 강등.

**Fixed — Discord author-guard 영구 제거**:
- `src/messenger/discord-adapter.ts` `isAuthorizedAuthor` 가드 블록 제거 + audit log 1줄 추가.
- `seungw1n.` 류 *Discord username 에 `.` 포함* 사용자의 자기 추방 false positive 영구 0.
- 친구 협업 케이스 (owner 가 자기 채널에 친구 초대 후 친구 메시지) 도 같이 풀림.
- `src/bot/author-guard.ts` 는 *유지* (Slack 어댑터 의존). `@deprecated since v1.0.2 (Discord)` JSDoc + v1.0.3 통째 제거 예고.

**Changed — onboarding wizard reorder (Step 3.5 신설)**:
- Step 5.2 (handle) → **Step 3.5** (메신저 토큰 직후) 이동. narrative 단절 해소.
- `registerUserIdentity` 모놀리식 → 3-phase 분리 (`fetchBotIdentity` + `promptHandleSelection` + `saveUserYamlForChoice`).
- handle prompt guidance 추가 — *"unique in your messenger server, different from other members' usernames or display names"*.
- Step renumber: 3.5→4 (Timezone), 4→5 (workspace.yaml, silent), 5→6 (Org), 5.1→6.1 (Repos), 5.2 *삭제*, 6→7, 6.5→7.5, 7→8.

**Slack scope** — 본 v1.0.2 변경 0. 동등 fix 는 v1.0.3 슬롯 (post-v1.0 분리 release).

**Compatibility**:
- migration 1.0.1 → 1.0.2: workspace.yaml.version bump only, idempotent.
- `UserYaml` schema 변경 0. user yaml 무손상.
- breaking 0 (데이터·CLI surface 면).

588 → **596 tests green** (588 baseline + `test/v1.0.2-discord-author-guard-removed.test.ts` 5 + `test/v1.0.2-init-handle-order.test.ts` 3).

자세히: `docs/plan/v1.0.2-discord-author-guard-decoupling.md`, `CHANGELOG.md` §[1.0.2]

#### 13.6.16 v1.0.3 — Discord 5-bug fix (2026-05-22)

**v1.0.2 publish 직후 사용자 dogfood 검증에서 *연속 5건* 함정 노출 → 일괄 fix.** 다섯 건 모두 *권위 결정자 (Discord ACL · prefix 권한 · ownOrgSlug · workspace.yaml.version) 를 무시하고 약한 문자열 비교·옛 vocab 으로 다시 추측* 하는 동일 패턴. v1.0.2 author-guard incident 와 같은 정신으로 *결정자 직접 사용 + 옛 vocab 은 backward compat lookup 만*.

**Fixed**:
- **Bug A** — `src/migrations/detect.ts:versionMatches` slice 산수. `X.Y.Z.x` 패턴이 exact `X.Y.Z` 매치하도록 한 줄. 본 사용자 *v1.0.0 → v1.0.x migrate 영구 차단* 해소 + 옛 8건 patch-exact 패턴 누적 함정 동시 해소.
- **Bug B** — `src/util/platform.ts:npmGlobalInstallCmd`. UID 추측 → `npm config get prefix` + `fs.accessSync(W_OK)` 실제 권한 체크. nvm/Homebrew/fnm/asdf 사용자 false sudo 권유 사라짐.
- **Bug D** — `src/messenger/discord-adapter.ts:syncGuildProductMapping`. `guild.name.includes(product.slug)` v0.1.x 휴리스틱 제거 → `this.ownOrgSlug` (v0.8 `resolveBotIdentity` 결과) 직접 사용. 사용자 *서버 이름이 SoloSquad 내부 슬러그 포함해야 함* 가정 폐기. 부팅 시 `[Discord] Bound guild <name> (<id>) → org=<slug>` 명시 로그.

**Changed**:
- **Bug E** — `src/cli/update.ts:updateCommand` post-install 분기에 workspace lag 검사 + `Next step: solosquad migrate --apply` 명시 출력. update→doctor→migrate 3-step round-trip → update 한 흐름 내 안내로 단축.
- **Bug F** — `src/messenger/discord-adapter.ts:ensureChannels` 카테고리 이름. 신규 `"solosquad"`, lookup 은 `["solosquad", "AI Team Reports"]` 둘 다. v0.1.x agent-team-as-product vocab 잔재 정리 + 기존 사용자 채널 부모 관계 보존.

**Compatibility**:
- migration 1.0.2 → 1.0.3: workspace.yaml.version bump only, idempotent.
- v1.0.0 / v1.0.1 / v1.0.2 워크스페이스 *모두* 1.0.3 CLI 로 단번에 migrate 가능 (Bug A fix 가 chain 전부 통과).
- 기존 `discord/config.yaml.guild_id` + `"AI Team Reports"` 카테고리 무손상.
- Slack 사용자: 변경 0 (v1.0.4 슬롯).
- breaking 0, schema 변경 0, CLI surface 변경 0.

596 → **613 tests green** (596 baseline + `test/v1.0.3-version-matches.test.ts` 5 + `test/v1.0.3-npm-install-cmd.test.ts` 3 + `test/v1.0.3-guild-org-binding.test.ts` 4 + `test/v1.0.3-update-next-step.test.ts` 2 + `test/v1.0.3-category-name.test.ts` 3).

**Spec retraction** — 본 patch 가 박제하는 *반복 패턴 6번째 누적 fix*. v1.0.2 + v1.0.3 의 6 incident 공통 root cause 두 갈래: (a) 외부 자유 입력 ↔ 내부 슬러그 문자열 비교, (b) v0.1.x 잔재 vocab/UX. 향후 회귀 catcher 설계 가이드라인 — 두 패턴 모두 trip-wire 대상.

자세히: `docs/plan/v1.0.3-discord-triple-bug-fix.md`, `CHANGELOG.md` §[1.0.3]

#### 13.6.17 v1.0.4 — Discord config.yaml 자동 생성 + Slack author-guard 통째 cleanup (2026-05-22)

**v1.0.3 Bug D fix 자가비판 박제 + 약속된 Slack cleanup 마무리.** v1.0.3 의 `syncGuildProductMapping` fix 가 *root cause 의 절반만* 잡음 — 서버명 휴리스틱은 제거했지만 *file-existence silent early-return* 분기는 남겨둠. `scaffoldOrg` 가 `<org>/discord/config.yaml` 을 never 작성하므로 모든 fresh `solosquad init` 워크스페이스가 그 분기에 차단. 사용자가 v1.0.3 설치 후에도 *"No product linked to this server"* 받음.

**Fixed — Bug G**:
- `src/messenger/discord-adapter.ts:syncGuildProductMapping` — `if (!fs.existsSync(configFile)) return;` silent bail 제거. load-or-empty 패턴 (`fs.existsSync ? load : {}`) + `mkdirSync(configDir, recursive: true)` + dirty 플래그로 변경 있을 때만 writeFile.
- 봇 첫 시작 시 자동으로 `<org>/discord/config.yaml` 생성 + `guild_id` + `channels` 박제 + `[Discord] Bound guild <name> (<id>) → org=<slug>` 로그.
- `getProductByGuild` 동작 변경 0 (주석만 갱신).

**Removed — Bug H** (v1.0.2 Discord 대칭 마무리):
- `src/messenger/slack-adapter.ts` author-guard import + 가드 블록 (~22줄) 제거 + audit log (`[Slack Bot] message in ... from author id=...`) 추가.
- `src/bot/author-guard.ts` 파일 통째 삭제 (Slack 이 마지막 소비자였음).
- `test/author-guard.test.ts` 파일 통째 삭제. v1.0.2 catcher 의 마지막 case 는 *역전 형태로 보존* — 파일 *부재* assert 로 변경해 v1.0.2 → v1.0.4 의 *deletion 순차* 사실 박제.

**Compatibility**:
- migration 1.0.3 → 1.0.4: workspace.yaml.version bump only, idempotent.
- 기존 `discord/config.yaml` 있는 사용자: 변경 0 (idempotent).
- 기존 `discord/config.yaml` 없는 사용자 (대다수): 봇 첫 시작 시 자동 작성.
- Slack 사용자: false positive 영구 0.
- breaking 0, schema 변경 0, CLI surface 변경 0.

순 테스트: 613 → **619 green** (+12 신규 − 6 삭제).

**Added — Best Practice P 일부 적용 (9-reference 조사 결과 즉시 흡수)**:
- `discord-adapter.ts` 의 *generic "No product linked"* 메시지 → `diagnoseProductByGuildFailure` 5-hop 진단 메시지로 교체. ownOrgSlug / config.yaml 부재 / guild_id 미박제 / guild_id 불일치 / loadProducts 미포함 각각 명시.
- plan §7.2 에 9-reference 조사 (OpenClaw / Claude Code Channels / LangChain / AutoGen / Composio / llmcord / openai-gpt-discord-bot / LibreChat / AnythingLLM) 박제. *(b) Runtime pairing* 이 주류 표준. SoloSquad 가 (b) 의 *자동 캡처* 만 채택하고 *명시 approve* 부재 → v1.0.2 ~ v1.0.4 의 4번 누적 회귀 root cause.
- 나머지 best practice (L 페어링 + approve CLI / M snowflake branded types / N silent early-return 전수 제거 / O token precedence) 는 v1.0.5 ~ v1.1 슬롯 후보.

**Spec retraction** — v1.0.3 plan §6 *반복 패턴* 에 **3번째 변형** 추가: *권위 결정자가 있는데도 옛 기록 파일 유무로 silently bail 하는 코드*. `if (!fs.existsSync(x)) return;` 류 silent bail 도 trip-wire 대상. **v1.0.4 가 Best Practice P 일부 도입으로 같은 패턴 진단 인프라 마련** — 향후 회귀 시 *어느 hop* 인지 즉시 attribute 가능.

자세히: `docs/plan/v1.0.4-messenger-config-auto-create.md` §7.2, `CHANGELOG.md` §[1.0.4]

#### 13.6.18 v1.1.0 — Multi-Agent Team Architecture (2026-05-27)

**핵심 변화** — 단일 PM session 패러다임을 **Team-Centric Multi-Agent** 로 격상. v1.0.x 의 *PM + Task 도구 + 25 specialist* 모델을 **Chief + 4 main + 20 specialist + 18 skill + 4 team** 의 5-layer (Hermes V2 차용) 계층으로 재편.

**아키텍처 5 결정 (2026-05-27 directive)**:
1. **Chief ≠ PM** — Chief 는 org-level user-facing supervisor (`<org>/agents/main/chief/SKILL.md`, 도메인 customized), PM 은 workspace-bundle 자율 product manager (`agents/main/pm/SKILL.md`, **사용자와 직접 대화 안 함**). PM 은 `open_questions[]` 프로토콜로 Chief 에게 batch escalate.
2. **모든 폴더 평탄(flat)** — `specialists/{team}/{name}/` 이중 중첩 폐기. 팀 멤버십은 `teams/{team}/composition.yaml` 데이터로.
3. **agentskills.io 표준** — skill 폴더 = `SKILL.md` + `assets/` + `scripts/` + `references/`. 루트 `templates/` 폐지 후 각 skill 의 `assets/` 로 분산.
4. **PM 고도화 최우선** — gstack(Garry Tan) Six Forcing Questions + Anti-Sycophancy + Hard Gate / RO-PNA pna-builders 6-Phase (SCQA→5-Whys→MECE→TDCC→XYZ) + phuryn pm-skills (OST / 8-section PRD / 9-framework prioritization) 통합.
5. **OKR=Chief 결정 / 마일스톤·WBS=PM 결정** — 의사결정 권한 분리.

**구현 산출물**:
- **신규 main bot 5**: chief / pm / engineer / designer / marketer. Chief 6+1 stage state machine (TRIAGE → DECOMPOSE → DISPATCH → AWAIT → SYNTHESIZE → DECIDE → RETROSPECT) 가 `<org>/memory/chief-stage-events.jsonl` 에 자동 emit.
- **20 specialist 평탄** (4 병합 + 1 rename): backend-developer+api-developer→backend-engineer, data-collector+data-engineer→data-engineer, idea-refiner+scope-estimator→idea-scoper, user-researcher+desk-researcher→researcher, paid-marketer→performance-marketer. content-marketer 병합은 취소 (brand-marketer 유지 + content-writing → skill).
- **4 팀**: product (구 strategy), engineering, design (구 experience), marketing (구 growth). 각각 `KNOWLEDGE.md` + `OKR.md` + `composition.yaml`.
- **18 skill** (problem-definition / discovery-synthesis / opportunity-tree / hypothesis-design / prd-writer / prioritization / wbs-decomposition / experiment-design / jobs-stories / lean-canvas / premortem / interview-script-author / retrospective / skill-refinement / workflow-refinement / okr-writer / triage / + 기존 7).
- **9-layer JIT context** — Layer 4a (team OKR) 신설. Chief 작성 OKR 이 매 spawn 시 자동 inject.
- **신규 util 모듈 5**: `composition` / `open-questions` / `leading-indicators` / `goal-queue` / `chief-stage-events`. 각각 unit test 포함 (60+ new tests).
- **path resolver 6**: `getBundleRoot` / `getMainAgentsDir` / `getSpecialistsDir` / `getSkillsDir` / `getTeamsDir` / `getUserDir` / `getSchedulesDir`.
- **agent-router + agents-builder** — v1.1 flat layout (`agents/{main,specialists}/<name>/`) 인식. v1.0.x nested layout 도 그대로 지원.
- **신규 CLI 3**: `solosquad goal queue <id>` / `goal active` / `goal next` (1-active-per-org semaphore).
- **신규 schedule 3**: leading-indicator (5 지표) / trace-rotate / bot-health-check.
- **4 workflow templates**: discovery-cycle / pmf-validation / autoplan-pm / weekly-retro.
- **Experiment 인프라**: `<org>/experiments/<id>/manifest.yaml` (variants + metrics + gates + Amplitude pattern).

**Fixed — 빈 agent list 버그**: `syncAgentsToOrg` 가 v0.2.4→v0.3.0 마이그레이션에서만 호출되어 그 후 org 가 비어있던 결함을 `solosquad init` / `add-org` / `sync` 세 진입점 모두에 호출 추가.

**Code rename**: `src/bot/pm-runner.ts` → `src/bot/chief-runner.ts` (class `PmRunner` → `ChiefRunner`). Event 이름 `pm.*` 은 archive consumer backward-compat 위해 유지.

**Out of scope (v1.2 위임)**: L1 Gateway — Discord/Slack 채널 토폴로지 재편 / 9-hop diagnostic / Forum Channel / Echo guard.

**QA**: 649 tests / 646 pass / 3 fail (3개 모두 pre-existing `test/git-snapshot.test.ts` — v1.1 무관). 신규 추가 60+ tests 전부 통과.

자세히: `docs/prd/v1.1-multi-agent-team-architecture.md`, `CHANGELOG.md` §[1.1.0]

#### 13.6.19 v1.2.6 — Messenger Connection (Chief on Discord, auto-connect first) (2026-05-28)

**핵심 변화** — v1.1.0 *내부 에이전트 격상* 위에 *외부 가시 UX 확장* 만 추가. 조직 1개당 1 Chief 봇 (multi-bot 분기 안 함) + Discord OAuth invite URL 1-click + handle 기반 채널이 멀티 메신저 / 멀티 서버 portable + owner-only 게이트로 채널 ACL 위에 author-id 권한 boundary 신설 + Chief 6+1 의 TRIAGE 가 `kind ∈ {chat, workflow, schedule, goal}` 분류해서 *chat 은 command 채널 평탄 응답 / 작업 단위는 works-handle 채널에 task card embed + thread 생성*. CLI freeze 침범 0, schema breaking 0.

**아키텍처 6 결정 (2026-05-28 directive)**:
1. **Chief 이름은 org 단위** — `OrgYaml.chief_name` (user.yaml 아님). init/add-org 가 prompt → `.org.yaml` 박제. Discord Developer Portal Bot 이름과 동일 사용 권장 (Discord 표면 정체성 일관).
2. **handle 기반 채널명 portability** — `command-<handle>` / `works-<handle>` 의 handle 은 user-level 식별자. 같은 사용자가 Discord 서버 N + 추후 Slack workspace 추가해도 모든 표면이 같은 이름의 채널 페어 (deriveChannelNames(handle) deterministic). v0.8.0 부터 동작, v1.2 가 명시 + 보증.
3. **owner-only 게이트 default ON** — `message.author.id === user.yaml.messenger_user_id`. 신규 설치 = true, 기존 v1.0.x/v1.1.0 업그레이드 = `owner_only: false` (migration 이 명시 박제, v1.0.2 channel-ACL-only 동작 보존). 미일치 → silently ignore + 첫 1회 ephemeral 안내 (per-(guild,sender) 1시간 dedupe, 30s auto-delete). v1.0.2 author-guard 제거의 *실제* 사유 (= 채널명이 user-id 라 봇 인식 실패) 가 handle 기반 채널명으로 해소된 이상 reversal 정당.
4. **TRIAGE kind 분기 — works-handle 과제 허브** — Chief 가 응답 첫 줄에 `[kind:<chat|workflow|schedule|goal>]` 마커 출력. chief-runner 가 strip 후 ChiefReply.kind 노출. `chat` 은 command 채널 평탄. `workflow/schedule/goal` 은 works-handle 에 task card embed (제목/kind/시작/요청 1줄, 색깔 차등) + `startThread({ autoArchiveDuration: 10080 })` → Chief reply + stage narration (DECOMPOSE/DISPATCH/AWAIT) 가 thread 내부, command 채널엔 *"📋 작업 등록됨 → <thread URL>"* 1줄. 마커 부재 시 user-text 휴리스틱 fallback (`/workflow`, `워크플로`, etc.).
5. **`solosquad add-org` 가 새 조직을 완전 동작 상태로 부트스트랩** — Chief 이름 prompt + `scaffoldOrg` 가 v1.1.0 전체 위계 시드 (agents/main/chief/SKILL.md, 4 teams × 3 files, memory/{open-questions,ledger}, knowledge/, workflows/problem-definition/) + Discord 봇이 이미 등록되어 있으면 invite URL 인라인 출력. 기존 v1.1.0 출시의 *migration 만 시드, add-org 는 누락* 결함 해소.
6. **problem-definition workflow 기본 시드** — `skills/workflow-maker/assets/workflows/problem-definition/workflow.yaml` 신규. 6 stages (SCQA → 5-Whys → MECE → TDCC → XYZ → 1-pager PRD), 각 phase 가 PM (pmf-planner) 가 problem-definition skill assets/01~06 로 실행. discovery-cycle 보다 가벼운 entry point. add-org 및 1.1.0→1.2.6 migration 모두 `<org>/workflows/` 에 자동 복사.

**구현 산출물** (commit chain `00a64d3` → `8108ca6`):
- **신규 모듈 6** (`src/messenger/`): discord-invite-url (bigint 권한 + 브라우저 open + clipboard fallback) / discord-onboarding (guildCreate embed + button interaction, 마커 dedupe) / discord-owner-gate (per-(guild,sender) LRU 1h, fail-open on missing messenger_user_id) / discord-task-card (works embed + startThread + `<org>/workflows/<wf-id>/discord-thread.txt` 박제) / discord-narration (chief-stage-events → thread 메시지 formatter, skip TRIAGE/SYNTHESIZE/DECIDE/RETROSPECT) / discord-chat-slash (`/chat` guild scope, intent fallback).
- **신규 CLI 1** + **doctor 확장 1**: `solosquad discord invite-url [--client-id|--print-only|--org]`, `solosquad doctor --discord` 5-hop (token shape → REST /users/@me → bot_user_id match → guild membership proxy → command channel ID).
- **scaffoldOrg 확장** — v1.1 + v1.2 전체 위계 시드, 기존 file 클로버 0 (idempotent).
- **`add-org` 보강** — `--chief-name`, `--skip-discord` 플래그 + 대화형 prompt + 인라인 Discord invite URL.
- **`init` Step 4/6 보강** — Discord token prompt 전 "Bot 이름 = Chief 이름 권장" guidance + Chief 이름 prompt + user.yaml 저장 후 invite URL 자동 출력 + 브라우저 open.
- **ChiefReply schema 확장** — `kind: ChiefKind` + `turnId: string` 필드 추가. `parseKindMarker` + 마커 부재 시 user-text 휴리스틱 fallback.
- **agents/main/chief/SKILL.md** — TRIAGE 단계에 *kind 마커 출력* 가이드 신설.
- **Migration 1.1.0 → 1.2.6** — version bump + workspace.yaml.messenger.discord 블록 (owner_only=false neutral upgrade) + problem-definition workflow 기본 시드. user.yaml/channel/token/config.yaml 무손상.

**Tests**: 675 → **728 / 728 pass**. 53 신규 (`discord-invite-url.test.ts` 10, `chief-kind-parser.test.ts` 8, `migration-1.1.0-to-1.2.6.test.ts` 10, `scaffold-org-v12.test.ts` 7, `discord-owner-gate.test.ts` 8, `discord-narration.test.ts` 8). Pre-flight 검증 7/7 통과 (CLI surface, invite-url 합성, doctor --discord 5-hop, add-org tmpdir end-to-end, migration apply+verify+idempotent).

**Out of scope (v1.2.1 위임)**: referencedMessage chain + LRU cache (PRD §7.3 / §12 #8) + thread token budget (PRD §9.2 / §12 #11) — 둘 다 thread 연속성 인프라 (messageCreate 가 thread 메시지 수신 + thread→workflow_id reverse lookup) 가 선행되어야 의미 있음. v1.2.6 = 작업 1개 = thread 1개 모델. Slack adapter 와 동일 슬롯에 합류.

자세히: `docs/prd/v1.2-messenger-connection-discord-first.md`, `CHANGELOG.md` §[1.2.6]

#### 13.6.20 v1.2.8 — Bot spawn `--add-dir` for registered repos (2026-05-29)

**핵심 변화** — v1.2.6 dogfood 직후 발견: 봇이 `cwd=<org>` 에서 `claude --print` spawn 하면 *org cwd 외부* 의 path-reference 등록 repo (예: `C:\Dev\bv-po-flow`) 에 접근 못 함. Chief 가 사용자에게 *"`/add-dir` 슬래시 명령을 직접 실행해주세요"* 안내하지만 그건 슬래시 명령이라 봇이 대신 호출 불가. → claude CLI 의 `--add-dir <abs-path1> <abs-path2> ...` flag 를 spawn 인자에 자동 추가하는 runtime 패치.

**구현**:
- `src/bot/claude-process.ts` — `ClaudeInvocation.addDirs?: string[]` 신규. `buildArgs()` 가 `args.push("--add-dir", ...inv.addDirs)` 처리. Node spawn 의 variadic 처리로 path 의 space 도 자동 escape.
- `src/bot/chief-runner.ts` — `collectRegisteredRepoPaths(orgCwd)` 신규. `<orgCwd>/repositories/*.yaml` 모두 읽어 `path:` 필드 + 디스크 존재 확인 후 절대경로 array 반환. `invokeWithSessionRecovery` 가 spawn 호출에 `addDirs` 전달.
- `src/migrations/scripts/1.2.6-to-1.2.7.ts` — pure version bump migration. workspace schema 변경 0.

**의도적 결정**:
- *manifest 박제 안 함* — 매 spawn 마다 `repositories/*.yaml` 실시간 스캔. add-repo / remove-repo 한 직후 봇 재시작 없이 즉시 반영.
- *path 존재 확인 (`fs.existsSync`)* — 등록만 됐고 실제 디렉토리는 사라진 (`git rm -rf` 등) 케이스에서 `--add-dir` 가 실패하지 않도록 silently skip.

**v1.2.x 흐름 정합** — v1.2.6 의 Claude trust 자동 grant 가 *디렉토리 자체에서 작업 가능한지* (trust dialog) 만 처리. v1.2.7 가 *cwd 외부 디렉토리 접근 허용* (--add-dir) 추가. 두 메커니즘 합쳐서 사용자가 봇 spawn 권한 다이얼로그를 한 번도 안 보고 모든 repo 작업 가능.

자세히: `CHANGELOG.md` §[1.2.7]

#### 13.6.21 v1.2.9 — Discord Application ID 자동 감지 + Invite URL 1-click 복구 (2026-06-01)

**핵심 변화** — v1.2.6 가 설계한 *OAuth Invite URL 1-click* 온보딩이 **존재하지 않는 API 필드 1개** 때문에 출시 이래 한 번도 작동한 적 없음을 dogfood 가 노출. `fetchBotIdentity` 가 `GET /users/@me` 의 봇 User 객체에서 `application_id` 를 읽었으나 **그 필드는 User 객체에 없다** (application id 는 별도 리소스). → `BotIdentity.appId` 영구 `undefined` → init Step 4 invite URL 블록의 `if (... && bot.appId)` 가드가 항상 skip → URL 미출력 / 브라우저 미오픈 / `user.yaml.bot_application_id` 미박제 / 후속 `discord invite-url` 실패. prompt fallback 도 없어 *"앱 ID 를 안 물어본다"* 로 직결.

**구현**:
- `src/cli/init.ts` — `fetchDiscordApplicationId(token)` 신규 (`GET /oauth2/applications/@me`). `fetchBotIdentity` 가 `appId = (await fetchDiscordApplicationId(token)) ?? body.id` 로 해석 (봇 user id 폴백). `promptHandleSelection` 에 Discord Application(Client) ID 확인 prompt 신설 — 감지값 default Enter 수락, 실패 시 Developer Portal 붙여넣기 안내, `/^\d{17,20}$/` 검증.
- `src/cli/doctor-discord.ts` — `fetchApplicationId` helper 신규. Hop 2 `liveAppId = (await fetchApplicationId(token)) ?? me.id`. 죽은 `UsersMeBody.application_id` 필드 제거. → Hop 3 `bot_application_id missing` 경고 + Hop 4 invite URL 힌트 실작동.

**의도적 결정**:
- *봇 user id 폴백* — Discord 봇은 봇 User id == Application id (동일 snowflake)라는 불변식 활용. `/oauth2/applications/@me` 호출이 네트워크/auth 로 실패해도 invite URL 합성이 죽지 않음.
- *자동 감지 + 명시적 prompt 병행* — PRD §3.1 이 원래 의도한 prompt 를 부활시키되, 감지값을 default 로 채워 Enter 1회로 끝나게. 자동 감지 실패 케이스(잘못된 토큰 / 오프라인)에서만 사용자가 직접 입력.

**v1.2.x 흐름 정합** — v1.2.6 의 invite URL 1-click 은 *설계로만* 존재했고 (`buildInviteUrl` 순수 함수는 정상), 입력값 source(`appId`)가 죽어 흐름 전체가 무력화돼 있었음. v1.2.9 가 source 를 고쳐 v1.2.6 의 약속(*init 완주 → click 1회 → 5분 내 채널 자동 생성*)을 비로소 실현.

자세히: `CHANGELOG.md` §[1.2.9], `docs/prd/v1.2.9-discord-app-id-and-invite-url-fix.md`

### 13.7 v1.1 — Multi-Agent Team Architecture (예고 — 구 plan, 이제 §13.6.18 에서 실현)

> **시너지/역할/구조/비전 박제.** 상세 작업은 `docs/prd/v1.1-multi-agent-team-architecture.md` (§21 amendment 2026-05-27 포함). v1.0.x patch 시리즈와 *narrative 단절* — *작업 흐름 + 디렉토리 + 명명 자체의 재설계*.

**시너지** — Hermes V2 5-layer 위계 + Harness Report §7.5 4 권고 + 7 framework supervisor 합의 + v1.x ideation Q1~Q7 *완전 흡수* (단일 plan 으로 정렬). v0.4 goal-runner / v0.5 workflow-maker / v0.6 8-layer JIT + KNOWLEDGE.md / v0.8 multi-user 모델 *위에* 쌓아 인프라 재사용.

**역할 위계 (L2~L5 — L1 은 v1.2):**
- **L2 Orchestrator** — **Chief session** (구 PM session 격상) + Scheduler + WorkflowReconciler. Chief 는 *organization 위계 거주* + *도메인 전문가 겸업*
- **L3 Team** — `team/{team}/KNOWLEDGE.md` + `team/{team}/OKR.md` (4 팀: chief/engineering/design/marketing)
- **L4 Agent** — 4 Main bots (`agents/main/{chief,designer,engineer,marketer}/SKILL.md`). Main Agent = Hermes V2 §4.3 "specialist 의 SKILL.md 를 *마치 도구처럼* 호출"
- **L5 Specialist** — 20 specialists (병합 후) + cross-agent `skills/` (workflow-maker · search · verify · code-review · citation · screenshot)

**디렉토리 구조 (workspace root — assets/ 폐지):**
```
agents/main/{chief,designer,engineer,marketer}/
agents/specialists/{chief,engineering,design,marketing}/...
skills/{workflow-maker,search,verify,code-review,...}/
user/{profile,voice,preferences}.md
team/{chief,engineering,design,marketing}/{KNOWLEDGE,OKR}.md
schedules/   (구 routines/)
templates/
```

**구조 — 4 인프라 신설 + 5 디렉토리 재편:**

| # | 신설 | 위치 |
|---|---|---|
| 4 Main + 20 Specialist 2-tier | 격상 | `agents/main/` + `agents/specialists/{team}/` |
| Chief = orchestrator + 도메인 전문가 겸업 | organization 위계 | `<org>/agents/main/chief/SKILL.md` (org-specific override) |
| Team Knowledge + **OKR.md 신설** | Layer 4a JIT inject | `team/{team}/OKR.md` |
| skills/ cross-agent 도구 | leader tier | `skills/{skill}/SKILL.md` |
| Educational Nudge (Triage stage 0) | chief 막연도 측정 → KNOWLEDGE.md slice 우선 제시 | `agents/main/chief/SKILL.md` + `<org>/.solosquad/nudge.yaml` |
| Dependency Injection (지표 layer 6.5) | stage 도메인 키워드 매칭 → signals.jsonl 자동 inject | `src/bot/spawn-assembler.ts` + `<org>/.solosquad/metric-injection.yaml` |

**5 specialist 병합:** backend-developer+api-developer → `backend-engineer`, data-collector+data-engineer → `data-engineer`, idea-refiner+scope-estimator → `idea-scoper`, user-researcher+desk-researcher → `researcher`, brand-marketer+content-writer → `content-marketer`. (25 → 20)

**SKILL frontmatter v1 → v2:** `bot_name` / `tier` / `domain_tags` / `routing_keywords` 4 신규 필드. migration `1.0.4-to-1.1.0.ts` 가 team 기반 80% 자동 채움 + 21a~21g 디렉토리 재편 일괄 적용.

**신규 CLI:** `solosquad goal queue <id>` · `solosquad experiment new/list/show/run/stop/conclude` · `solosquad run-schedule <id>` (구 `run-routine`, alias 6개월).

**비전** — *Chief 단일 voice* 가 *이사회 의장 (Board Chair)* 톤 (Harness §7.5 권고 4). 사용자 입력 = *founder 명령* / specialist 회신 = *이사회 합의*. Chief 가 org 도메인 전문가 겸업 = 일반 startup CEO 의 *founder + domain* 이중 정체성 정합. 1인 founder dogfood 단계 leading indicator 4지표 (대화→작업 변환률·자동 PR 성공률·자율 goal cycle 수·dev_capability 활용도) 가 본 plan 의 *성공 지표*.

### 13.8 v1.2 — 메신저 연결 (Discord 우선) (✓ 출시 — §13.6.19 에서 실현)

> **L1 Gateway 분리.** 상세 작업은 `docs/prd/v1.2-messenger-connection-discord-first.md`. 출시 사실은 §13.6.19 박제 — 본 절은 *시너지/역할/구조/비전* 박제 reference.

**시너지** — v1.1 의 5 코어 봇 (L4) 위에 *메신저 측 표면 (L1)* 만 분리. v1.0.4 의 G+H+P 흡수 + 미적용 L+M+N+O Best Practice 본 슬롯에서 적용. Slack 동등 fix 는 v1.2.x patch.

**구조 — 7 인프라:**
- Channel topology (5 코어 봇 × forum channel)
- Bot Identity Registry (`<org>/.solosquad/bots.json`)
- 9-hop diagnostic (v1.0.4 5-hop 의 확장)
- Forum Channel + Thread budget
- Mention routing (v1.0.1 `@<slug>` 위에 `@<bot>` 추가)
- Echo guard (봇 ↔ 봇 무한루프 차단)
- handoff-trace.jsonl 스키마

**비전** — *PM 단일 voice* 채널 모델 유지하되, 사용자가 특정 team 봇에게 직접 `@eng 이거 어떻게 짜` 같이 dispatch 가능. PM 은 항상 listener 로 남아 *이사회 의장* 역할 (v1.1 §14 톤 정합).

### 13.9 v1.x 시리즈 (예고 — cascade-shifted 슬롯)

**v1.x 슬롯 cascade (2026-05-24 결정 — product-roadmap §6 참조):**
- 구 v1.1 → v1.x **대시보드 상호작용** (별도 리포 `solopreneur-dashboard`+`solopreneur-api`) — `docs/prd/v1.x-dashboard-interaction.md`
- 구 v1.2 → v1.x **지식·암묵지 온톨로지 + MCP** (Notion·Obsidian·외부 API·타 에이전트) — `docs/prd/v1.x-knowledge-ontology.md`
- v1.x **LLM backend 추상화** — `docs/prd/v1.x-llm-backend-abstraction.md`
- **v1.3** 일정 관리 + 메모 (n잡 사용자) — 예정

**v1.x-workflow-goal-routine-evolution.md** — v1.1 plan §0 박제 표로 §1~§6 *완전 흡수* → *역사적 reference* 로 격하. 살아있는 영역 = 변경 이력 + 외부 reference 만.

자세히: `docs/prd/v1.1-multi-agent-team-architecture.md`, `docs/prd/v1.2-messenger-connection-discord-first.md`, `docs/prd/v1.x-*.md`

### 13.10 기획 문서 목록 (v0.x → v1.x)

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
- `docs/plan/v0.8.6-migrate-hotfix-pr-workflow.md`
- `docs/plan/v0.8.7-tiny-stabilization.md`
- `docs/plan/v0.9.1-workspace-repo-relationship.md` (plan + v0.9.1 Model B 구현)
- `docs/plan/v0.9.2-precheck-self-match-hotfix.md` (Windows uninstall precheck self-match hotfix)

**v1.x 포스트-런치 (계획):**
- `docs/prd/v1.1-multi-agent-team-architecture.md` — **신 v1.1.** Multi-Agent Team Architecture (Hermes V2 5-layer + Harness §7.5 4 권고 + Q1~Q7 흡수). L2~L5 만 — L1 은 v1.2
- `docs/prd/v1.2-messenger-connection-discord-first.md` — **신 v1.2.** 메신저 연결 (L1 Gateway, Discord 우선)
- `docs/prd/v1.x-dashboard-interaction.md` — *구 v1.1 cascade-shifted.* 대시보드 상호작용 (대시보드 자체는 별도 리포)
- `docs/prd/v1.x-knowledge-ontology.md` — *구 v1.2 cascade-shifted.* 지식 온톨로지 + MCP 외부 연결
- `docs/prd/v1.x-llm-backend-abstraction.md` — LLM backend 추상화
- `docs/prd/v1.x-workflow-goal-routine-evolution.md` — *archived.* Q1~Q7 ideation 7건 → v1.1 plan §0 박제로 *완전 흡수*. 살아있는 영역 = 변경 이력 + 외부 reference
- `docs/prd/v1.3-schedule-memo.md` (예정) — 일정 관리 + 메모 (지식 온톨로지와 같은 결)

롤링 상태는 `docs/prd/product-roadmap.md`.

---

## 14. 레퍼런스

- [OpenClaw](https://github.com/openclaw/openclaw) — npm 패키지 배포 + update/doctor CLI 패턴
- [Ralph Loop (Huntley)](https://ghuntley.com/ralph/) — 자율 코딩 루프 패턴
- [Hermes Agent](https://github.com/nousresearch/hermes-agent) — 에이전트 프레임워크 (설정 폴더 ~/.hermes/)
- [MiroFish](https://github.com/666ghj/MiroFish) — 멀티에이전트 시뮬레이션, 데이터 분석/예측 확장 방향
- [autoresearch (Karpathy)](https://github.com/karpathy/autoresearch) — 메트릭 게이팅 + git rollback 운영 패턴 원조 (v0.4 차용)
- [OpenAI Codex `/goal`](https://developers.openai.com/codex/use-cases/follow-goals) + [`AGENTS.md`](https://developers.openai.com/codex/agents-md/) — v0.4 자율 실행의 2계층 구조 (volatile goal + persistent AGENTS.md) 채택 근거
