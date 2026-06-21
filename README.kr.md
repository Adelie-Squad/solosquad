# SoloSquad

> 솔로 파운더 · 1인 창업자 · n잡 사용자를 위한 24/7 AI 어시스턴트 시스템 — Discord 봇 + 자동 루틴 + 팀 단위 에이전트, npm 패키지 하나로 배포.

> 영문 버전: [README.md](README.md)

혼자 회사를 운영한다는 게 혼자 일한다는 뜻은 아닙니다. SoloSquad는 **Chief 1명** (조직별 supervisor, 유일한 사용자 대면 에이전트) + **4 main bot** (pm / engineer / designer / marketer) + 4개 팀(product · engineering · design · marketing)에 걸친 **20명의 specialist**를 가상의 팀으로 제공합니다. 사용자는 메신저 안에서 Chief와 대화하면 됩니다. 자동화된 일일 루틴, 조직별 메모리 격리, 6+1 단계 의사결정 루프(TRIAGE → DECOMPOSE → DISPATCH → AWAIT → SYNTHESIZE → DECIDE → RETROSPECT)가 기본 탑재돼 있습니다.

```
산출물 ≠ 목표.  산출물 = 목표를 달성하기 위한 수단.
```

**플랫폼:** Windows · macOS · Linux (크로스 플랫폼 CLI, CI 검증 완료)
**메신저:** Discord — 워크스페이스당 하나. Slack 어댑터 코드는 동봉되지만 **v1.0 SemVer 약속 대상이 아닙니다** (post-v1.0 슬롯). Telegram은 v0.2.4부터 미지원.
**스택:** TypeScript + Node.js 18+ · AI 엔진은 Claude Code · 파일 기반 메모리(JSONL + FTS5)

---

## 이 README는 누구를 위한 것인가

- **솔로 파운더 · 1인 창업자** — 혼자 프로덕트 하나를 굴리는 사용자
- **소규모 팀 창업자 (1~5명)** — 같은 메신저 서버에서 봇 여러 개를 띄우는 팀
- **n잡 사용자** — 직장 + 사이드 프로젝트 + 부업 + 멀티 직장을 한 머신에서 분리 운영

SoloSquad의 핵심 약속은 **"사용자가 코드를 직접 보지 않고도, 메신저 대화만으로 자동화된 멀티 에이전트 팀을 운영할 수 있다"** 입니다. 메신저 셋업이 사용자 진입의 거의 전부이기 때문에, 본 README는 셋업·운영·작업 분류를 한국어 화자 입장에서 우선 설명합니다.

---

## 공식 문서

가장 정합한 사용자 가이드는 메뉴 분할 HTML 매뉴얼입니다.

> **[`manual/master-guide_ko.html`](manual/master-guide_ko.html)** (한국어) · **[`manual/master-guide_en.html`](manual/master-guide_en.html)** (English) — 브라우저에서 열어주세요.

10개 메뉴 섹션 구성:

| # | 섹션 | 내용 |
|---|---|---|
| 1 | Getting Started | 프로젝트 의도 · 핵심 개념 · 기대 가치 |
| 2 | How It Works | 시스템 아키텍처 · 폴더 위계 · 메모리 모델 · 워크플로우 정의 |
| 3 | Concept Glossary | `SKILL.md` · `KNOWLEDGE.md` · `CLAUDE.md` · `AGENTS.md` 비교 · 레이어별 파일 인벤토리 · 4채널 라우팅 |
| 4 | Onboarding | 신규 사용자 / 기존 리포 마이그레이션 / 버전 업그레이드 3 갈래 |
| 5 | Messenger Setup | Discord 8단계 토큰 워크스루 (Slack 절은 post-v1.0 참고용으로 유지) |
| 6 | Usage | CLI 레퍼런스 · 일일 운영 · 첫 실행 체크리스트 · 자동 루틴 |
| 7 | Glossary | 60+ 핵심 용어 사전 · 파일명 사전 · 약어 사전 (초심자 친화) |
| 8 | Version Differences | v1.2.6 (npm 배포) vs 다음 릴리스 |
| 9 | Operations | 24/7 호스팅 옵션(터미널 · Docker · launchd/NSSM · VPS) · 멀티 워크스페이스 · 멀티 조직 · 보안 체크리스트 |
| 10 | Troubleshooting & FAQ | 설치/런타임 이슈 · 마이그레이션 실패 · FAQ |

모든 기능에는 버전 배지가 붙어 있습니다.

내부 아키텍처 · 릴리스 계획 · 결정 이력은 [`docs/prd/product-roadmap.md`](docs/prd/product-roadmap.md) + [`docs/prd/architecture.md`](docs/prd/architecture.md) 참조.

---

## v1.2.6 신규 (2026-05-28)

**메신저 연결 — Chief on Discord, auto-connect first.** v1.1.0 의 내부 에이전트 아키텍처 위에 *외부 사용자 가시 UX* 만 얹은 minor 릴리스:

- **조직 1개당 1 Chief 봇** — `solosquad add org --chief-name Hermes` 로 이름 부여. Discord Developer Portal 에서 Bot 생성 시 같은 이름을 쓰면 메신저 표면 정체성이 일관됩니다.
- **OAuth Invite URL 1-click** — `solosquad discord invite-url` 가 application client_id + 권장 10-perm bitfield (verification trigger 6건은 의도적 배제) 합성 → 브라우저 자동 open → clipboard fallback.
- **handle 기반 채널 portability** — 한 사용자가 Discord 서버 N개 + 추후 Slack workspace 추가해도 모든 표면이 동일한 `command-<handle>` / `works-<handle>` 페어 자동 재사용.
- **owner-only 게이트** (신규 설치 default ON, 업그레이드는 OFF — neutral) — Chief 가 워크스페이스 owner 의 메시지만 처리. 미일치 사용자는 silently ignore + 첫 1회 ephemeral 안내.
- **TRIAGE kind 분기** — 짧은 대화는 command 채널 평탄 응답. `workflow` / `cron` / `goal` 은 `works-<handle>` 채널에 task card embed + thread 자동 생성, sub-agent 활동(DECOMPOSE / DISPATCH / AWAIT)이 thread 내부에 narration. command 채널엔 `📋 작업 등록됨 → <thread URL>` 1줄.
- **`solosquad add org`** 가 새 조직을 *완전 동작 상태* 로 부트스트랩 — Chief 이름 + v1.1.0 위계 (agents/main/chief, 4 teams, memory/open-questions·ledger, knowledge/) + `problem-definition` workflow 기본 시드 + Discord inline 연결.
- **`solosquad doctor --discord` 5-hop diagnostic** — token shape → REST `/users/@me` → bot_user_id match → guild membership → command 채널 ID. 매 hop attributable + actionable.
- **guildCreate onboarding embed + 2 button** (Auto-create / Manual choose) + `/chat` slash command (MESSAGE_CONTENT intent 거부 fallback).

신규 test 53건; 728/728 pass. Migration `1.1.0 → 1.2.6` 멱등; 기존 사용자는 `owner_only: false` neutral upgrade.

전체 릴리스 노트: [CHANGELOG.md §1.2.6](CHANGELOG.md#122--2026-05-28).

---

## 빠른 시작 (약 5분)

```bash
# 1. 사전 준비 (최초 1회)
brew install node git                             # macOS — Windows/Linux는 master-guide §4.2
npm install -g @anthropic-ai/claude-code

# 2. SoloSquad 설치
npm install -g solosquad
mkdir ~/solosquad-workspace && cd ~/solosquad-workspace
solosquad init                                    # wizard가 Claude OAuth(Step 1.5) + Chief 이름 + Discord 토큰 + invite URL 자동 open 처리
solosquad doctor                                  # 환경 점검
solosquad doctor --discord                        # v1.2 — Discord 5-hop diagnostic (token / REST / bot_user_id / guild / channel)

# 3. 봇 기동
solosquad bot                                     # 포그라운드
# 또는
docker compose up -d --build                      # 백그라운드 + 자동 재시작 (워크스페이스 루트에서 — init이 compose 파일을 여기 복사)
```

봇을 길드에 초대하면 **guildCreate onboarding embed** 가 system 채널에 표시됩니다. **Auto-create channels** 버튼을 누르면 `#command-<handle>` / `#works-<handle>` 자동 생성 + command 채널에서 Chief 첫 인사 → 메시지 한 번 보내면 Chief 가 답합니다.

**메신저 토큰 셋업**은 Discord 기준 3~5분 정도 걸립니다. [`master-guide_ko.html` §5](manual/master-guide_ko.html)의 단계 절차를 따라가세요.

### 메신저 셋업이 핵심인 이유

SoloSquad는 사용자가 IDE 대신 메신저로 시스템과 대화합니다. 메신저 봇 토큰이 없으면 첫 메시지부터 막힙니다. v0.8.x 시리즈는 이 진입 경험을 집중적으로 다듬었습니다:

- 봇 토큰 입력 직후 messenger API를 호출해 **handle을 자동 추출** (수기 입력 X)
- `command-<handle>` + `works-<handle>` **채널 페어 자동 생성** (private, 초대만)
- `solosquad init --verify` 로 토큰 ping → 채널 생성 → echo 테스트까지 **e2e 검증**
- 채널 첫 생성 시 **sticky welcome 메시지**가 자동 게시 (사용 안내)
- 채널을 실수로 지웠다면 `solosquad messenger ensure-channels` 로 즉시 복구

### 기존 v0.5.x 사용자의 업그레이드

```bash
npm install -g solosquad@latest             # 0.5.x → 0.8.x
solosquad migrate --dry-run                 # Pass 1 시뮬레이션 보고
# 보고를 확인한 뒤:
solosquad migrate --apply --confirm         # 2-pass 휴먼 리뷰 게이트 포함
```

Pass 2 단계에서 `solosquad agent validate --all` 이 자동 실행됩니다. `human_review_required: true` 로 마킹된 항목은 *자동 적용되지 않으며* 사용자가 직접 재분류해야 합니다. 마이그레이션 중 LLM fallback 비용은 `<org>/memory/migration-costs.jsonl` 에 per-run 캡과 함께 누적됩니다.

기존 리포를 워크스페이스로 가져오는 경우 v0.8.3에서 추가된 안전 옵션을 권장:

```bash
solosquad add repo /path/to/repo --dry-run        # 디스크 변경 0건 + 활성 프로세스·심링크·slug 충돌 등 위험 시나리오 5종 사전 진단
solosquad add repo /path/to/repo --keep-original  # 이동(rename) 대신 복사로 처리
# v0.8.4: --inspect alias는 deprecated (v1.0 제거 예정) — --dry-run 사용
```

---

## 기본 탑재 — 무엇을 받게 되는가

### 4개 팀 25명의 전문 에이전트, frontmatter 기반 자동 라우팅

| 팀 | 에이전트 | 역할 |
|---|---|---|
| **Strategy** (7) | PMF Planner · Feature Planner · Data Analyst · Business Strategist · Idea Refiner · Scope Estimator · Policy Architect | 시장 분석, 가설 설계, 기획 |
| **Growth** (4) | GTM Strategist · Content Writer · Brand Marketer · Paid Marketer | 마케팅, 브랜딩, 카피, 유료 광고 |
| **Experience** (4) | User Researcher · Desk Researcher · UX Designer · UI Designer | 리서치, 디자인 |
| **Engineering** (10) | Creative Frontend · FDE · Architect · Backend · API · Data Collector · Data Engineer · Cloud Admin · QA · Security | 개발, 인프라, 품질, 보안 |

```
사용자: "랜딩 페이지 카피 써줘"        → Content Writer (Growth)
사용자: "가입 funnel 분석해줘"          → Data Analyst (Strategy)
사용자: "로그인 UI 디자인해줘"          → UI Designer (Experience)
사용자: "회원가입 API 설계해줘"         → API Developer (Engineering)
```

**v0.5 4채널 라우팅** (우선순위: `slash > explicit > keyword > freq`)이 매 턴마다 어느 전문가의 `SKILL.md` 를 주입할지 결정합니다. 트리거는 각 에이전트의 frontmatter (`triggers.slash` / `.keyword` / `.freq`) 에 정의되어 있고, 봇 부팅 시 3-tier 스캔 (`<org>/.agents/` > `~/.solosquad/agents/` > 번들) 으로 수집됩니다.

**v0.6 chokidar hot-reload** 가 동일한 3 tier 를 감시 (Windows + WSL 강제 폴링, 300ms 디바운스) 하며 라우터 인덱스를 원자적으로 swap — SKILL을 편집해도 봇 재시작 불필요. 리로드 모드는 `auto`(기본) / `prompt` / `manual` + 안전모드 `git_only`(`HEAD ≡ upstream + clean tree` 만) 로 설정 가능. `solosquad agent reload` 로 수동 트리거 가능.

### 작업 3분류 — 대화 vs 워크플로우 vs goal vs 루틴

사용자가 메신저에서 보내는 메시지는 PM 오케스트레이션이 다음 4가지로 분기합니다:

| 분류 | 정의 | PM 처리 |
|---|---|---|
| **대화** | 아이디어 구체화 · 진행 상황 확인 · 자유 응답 | `command-<handle>` 안에서 즉시 응답. 메모리 jsonl 에는 기록되지만 작업 스레드는 만들지 않음 |
| **워크플로우** | task 단위 지시 — "~ 화면 디자인 개선해줘", "QA 해줘", "~ 시장 조사해줘" | PM이 작업으로 인지 → `works-<handle>` 채널에 *스레드 생성* + specialist 위임 + 진행/완료 보고 |
| **goal** | 하루 이상의 장기 목표 — PMF 검증 · GTM · A/B 테스트 · 포지셔닝 · 배포 | PM이 goal로 인지 → `solosquad goal run` 백그라운드 사이클 시작 → `works-<handle>` 스레드에 사이클별 진행 보고 |
| **루틴** | 반복 작업 — cron 스케줄 + LLM 또는 결정적 실행 | 명시적 명령으로 추가/제거. 실행 시점에 works 스레드 또는 broadcast 채널에 결과 보고 |

**구분 룰** (메신저 안에서 사용자가 인지할 수 있는 신호):
- PM이 *작업으로 인지*하면 `works-<handle>` 에 스레드가 생성됨이 사용자에게 보이는 시그널
- 의도적으로 *대화만* 하고 싶다면 `/think` 슬래시 사용
- 3분류는 상호 배타적이지 않습니다 — goal 이 워크플로우·루틴을 *조합*해 자율 진행. 사용자가 진행 중 goal에 워크플로우/루틴을 추가/변경/생략 지시 가능

### 기본 탑재 워크플로 5종 (task 단위)

| 워크플로 | 주력 specialist |
|---|---|
| **시장 조사** | Desk Researcher · Business Strategist · Brand Marketer |
| **디자인** | UI Designer · UX Designer · Creative Frontend |
| **화면 개발** | FDE · Creative Frontend · API Developer |
| **QA** | QA Engineer |
| **배포** | Cloud Admin · Backend Developer |

### 기본 탑재 goal 5종 (장기 목표)

| goal | 주력 specialist |
|---|---|
| **PMF 검증** | pmf-planner · user-researcher · data-analyst |
| **GTM** | gtm-strategist · paid-marketer · content-writer · brand-marketer |
| **A/B 테스트** | data-analyst · feature-planner |
| **포지셔닝** | brand-marketer · pmf-planner · business-strategist |
| **배포** | cloud-admin · backend-developer · qa-engineer |

org 당 *여러 goal* 가능하지만 **한 조직에서 동시 active goal은 1개**입니다 — 다른 goal은 paused/queued.

### 디폴트 자동 루틴 3종

| 시간 | 루틴 | 발송 채널 | 메모리 |
|---|---|---|---|
| 08:00 (사용자 timezone) | Morning Brief | `works-<handle>` | — |
| 18:00 | Evening Brief | `works-<handle>` | `decisions.jsonl` |
| 23:00 | PM Compaction | `works-<handle>` | `memory/pm-skills/` |

> v0.5 까지의 디폴트 6종(Signal Scan·Experiment Check·Weekly Review 포함)은 v0.8 정책 박제로 *비-디폴트*로 이동했습니다. 분석 routine은 디폴트로 강제하기엔 노이즈가 크다는 회고 결과. trajectory miner / freq miner / `archive-rotate` / `log-rotate` 같은 housekeeping 인프라는 *디폴트 아님*이지만 시스템 무결성에 필요하므로 항상 활성.

모든 시간은 `.solosquad/workspace.yaml` 에서 변경 가능 (timezone 기본값 `Asia/Seoul`).

### 3-Layer 컨텍스트 격리

```
Layer 0 · Workspace (universal)      → Owner 프로필, principles, 25 에이전트 정의
   ↓
Layer 1 · Organization (per-product) → 메모리, 워크플로우, 메신저 채널, org 도메인 지식
   ↓
Layer 2 · Repository (per-codebase)  → 코드 + repo 전용 SKILL
```

프로덕트 A의 에이전트는 프로덕트 B의 데이터를 절대 보지 않습니다. 여러 프로덕트가 한 워크스페이스에 깔끔히 공존합니다.

### 셀프 호스팅

Mac Mini · PC · VPS 어디서든 동작. 데이터는 사용자 머신에. 외부 통신은 Claude API + 메신저 서버 2종 뿐.

### 멀티 유저 메신저 (v0.8.0)

같은 Discord 서버에 N명이 각자 SoloSquad를 설치할 수 있습니다. 각 사용자는 자기 `command-<handle>` + `works-<handle>` 페어를 가지며, 다른 사용자 채널은 봇이 *listen 안 함*. 채널은 메신저 ACL로 private (초대만) + 코드 레벨 `author-guard` 가 defense in depth. *(Slack 어댑터도 동일 채널 페어 컨벤션을 따르지만 v1.0 SemVer 약속 외 — post-v1.0 슬롯.)*

옵션 broadcast 채널 (`#solosquad-broadcast`) 은 opt-in — `workspace.yaml.messenger.broadcast_enabled: true` 일 때만 designated 봇 1개가 morning/evening brief 를 push. 같은 토큰을 두 머신이 동시 사용하면 Discord가 disconnect 시키므로 *1 토큰 = 1 머신* 원칙 준수.

### Dev Capability (v0.8.2)

엔지니어링 5 SKILL(`backend-developer` / `fde` / `api-developer` / `creative-frontend` / `qa-engineer`)에 `dev_capability: true` 가 박제됐습니다. 메신저 대화만으로 코드 수정 → commit → push → PR 생성까지 end-to-end. 단:

- **`git push` / `gh pr merge` 는 사용자 confirmation gate 통과 필수** (30분 timeout)
- **자동 머지는 영구 거부** (`dev_permissions.merge.auto: false` 박제)
- Bash allowlist/denylist 가 spawn-time에 적용. 위험 명령은 거부
- 모든 dev confirmation 은 `<org>/memory/dev-confirmations.jsonl` 에 audit 기록

`workspace.yaml.dev_capability.enabled: false` 로 마스터 토글 가능.

---

## CLI 레퍼런스 (v0.8.3)

```bash
# 워크스페이스 운영 (v0.1+)
solosquad init                                    # 워크스페이스 셋업 wizard (v0.8 polish: 6→4단계)
solosquad init --verify                           # e2e 셋업 검증 (토큰 ping → 채널 생성 → echo)
solosquad bot                                     # 메신저 봇 기동
solosquad cron start                              # 자동 cron 스케줄러 기동
solosquad status                                  # 대시보드 (org / 워크플로우 / 최근 활동)
solosquad doctor                                  # 환경 진단
solosquad doctor --messenger-check                # 라이브 API 로 토큰 검증
solosquad doctor --messenger-verify               # v0.8 멀티 유저 메신저 점검
solosquad update                                  # npm latest 확인 + 설치
solosquad cron run [name]                         # cron 수동 실행

# Chief 세션 운영 (v0.3, v1.1 에서 PM→Chief 리네임)
solosquad chief status                            # 활성 Chief 세션 / 누적 비용
solosquad chief reset                             # 사용자 세션 archive + 새로 발급
solosquad chief compact                           # 완료 워크플로 외부화
solosquad workflow list                           # 워크플로 목록
solosquad workflow show <wf-id>                   # 단계 + 최근 이벤트
solosquad workflow focus <wf-id> [--clear]        # 세션별 active 워크플로 지정/해제
solosquad rollback [--workflow <id>] [--to <sha>] [--list]   # git snapshot revert

# 자율 엔진 (v0.4)
solosquad goal new [goal-id]                      # 템플릿에서 goal.md 스캐폴드
solosquad goal list                               # goal 목록
solosquad goal show <goal-id>                     # 스펙 + 최근 cycle
solosquad goal run <goal-id> [--hours N | --cycles N]   # 백그라운드 자율 루프
solosquad goal status [goal-id]                   # cycle 횟수, 비용, ship 후보
solosquad goal stop <goal-id>                     # 진행 중 run 중단 (현재 cycle 종료 후)
solosquad goal verify <goal-id> --cycle N         # evaluator 재실행, 결정성 검증

# 에이전트 저작 (v0.5 + v0.6)
solosquad agent validate <path>                   # 단일 SKILL.md v0.5 스키마 검증
solosquad agent validate --all [--corpus]         # 번들 + 워크스페이스 SKILL 전수 검증
solosquad agent add --name <slug> --team <team>   # 새 SKILL.md 스캐폴드 (LLM 비호출)
solosquad agent reload [--org <slug>]             # 라우터 수동 rebuild (manual fs.watch 모드)
npm run validate-skills                           # CI 게이트 (= agent validate --all --corpus)

# 메모리 아카이브 (v0.6)
solosquad readiness check [--target v0.6]         # v0.5 데이터 + 4 디폴트 워크플로 + 저작 SKILL 카운트 → pass/short
solosquad memory search <query> [--limit N]       # 아카이브된 이벤트 FTS5 풀텍스트 검색
                       [--event-type X]           #   routine_log | route_hit | route_miss | author_turn | spawn_decision
solosquad memory stats [--disk]                   # 인덱스 row 카운트 + event_type 분포 (+ sqlite 파일 크기)

# 리포 분석 (v0.5)
solosquad analyze repo <path> [--force] [--prune-orphans]    # .claude/skills/ 스캔 + 분류 + 보고서
solosquad add repo --from-report <report> --merge-policy <append|override|replace>
solosquad add repo <path> --dry-run               # v0.8.3 — 디스크 변경 0건 시뮬레이션 + 위험 시나리오 5종 진단
solosquad add repo <path> --keep-original         # v0.8.3 — 이동 대신 복사
                                                  # (v0.8.4: --inspect 별칭 deprecated, v1.0 제거)

# 마이그레이션
solosquad migrate                                 # 워크스페이스 레이아웃 업그레이드 (기본 dry-run)
solosquad migrate --apply                         # 실제 적용
solosquad migrate --rollback                      # 백업으로 복원

# 라이프사이클 (v0.7 + v0.8.1, v0.8.4에서 surface freeze)
solosquad uninstall [--mode full|keep|archive-only] [--dry-run] [--force]
                                                  # farewell archive + cleanup. 기본 full
                                                  # keep = workflows/memory/knowledge 보존 (재설치용)
                                                  # archive-only = zip만 생성, cleanup 스킵
solosquad import <archive.zip> [--dry-run] [--mode merge|replace]                 # v0.8.1 archive 페어 완결
solosquad archive verify <archive.zip>            # manifest SHA256 대조
solosquad archive info <archive.zip>              # 메타 + 분류 요약
solosquad archive list <archive.zip>              # 항목 트리

# 백업 관리 (v0.8.4 — migrate/uninstall 백업 플래그 흡수)
solosquad backup list                             # ~/.solosquad-backups/ 목록
solosquad backup delete <id>                      # 단일 백업 삭제
solosquad backup purge [--keep-recent N] [--dry-run] [-y]
                                                  # 일괄 삭제(전체 또는 최근 N개 유지)

# 관측성 (v0.8.3)
solosquad logs [--level X] [--tail N] [--follow] [--since T] [--type X]   # logger 로그 조회

# 메신저 운영 (v0.8 polish)
solosquad messenger ensure-channels [--org <slug>] [--dry-run]   # 채널 페어 부재 시 복구
solosquad messenger broadcast-handover --to <handle>             # broadcast designation 이양

# Org / repo
solosquad add org <name>                          # 조직 추가
solosquad add repo <url|path>                     # 리포 clone 또는 등록
solosquad sync                                    # repositories/ ↔ .org.yaml 동기화
```

각 명령의 자세한 워크스루는 master-guide §6 참조.

---

## 아키텍처 개요

긴-수명 프로세스 2개 + 파일 기반 메모리 레이어:

| 프로세스 | 역할 |
|---|---|
| `solosquad bot` | 메신저 메시지 수신 → 사용자의 long-lived Chief 세션 (`orchestrator/SKILL.md`, v0.3) 재개 → 4채널 라우터가 어떤 specialist를 로드할지 결정 (`slash > explicit > keyword > freq`, v0.5) → Claude Code 의 native `Task` tool 로 fresh subagent에 위임 → tool 결과를 종합해 응답 |
| `solosquad cron start` | cron (디폴트 3종 — 위 표) 실행, 결과를 JSONL 메모리 파일에 append |

봇 위에 얹히는 추가 모드 2종:

- **v0.5 author loop** — 메신저-네이티브 SKILL 작성. `_meta/workflow-maker` 메타 SKILL 이 사용자를 `CLARIFY → DRAFT → SANDBOX_PROMPT → AWAIT_CONFIRM → APPLIED` 로 안내. paperclip 스타일 budget cap 이 `<org>/memory/author-costs.jsonl` 에 기록. spec-gate draft 는 `<org>/goals/<goal-id>/goal.md` 자동 생성.
- **v0.4 goal-runner** — 백그라운드 자율 cycle. `solosquad goal run <id>` 가 `bg-<goal-id>-<runId>` PM 세션을 부트해 pipeline → evaluator (metric gate) → git-snapshot keep/discard 를 시간/cycle/비용 예산 소진 또는 모든 metric `CONFIRMING` 도달까지 반복. `solosquad goal verify` 가 과거 cycle 의 evaluator 결정성 재검증.

v0.6 가 v0.3~v0.5 위에 얹은 5가지:

- **Spawn assembly** — `src/bot/spawn-assembler.ts` 가 매 Task prompt 를 8-layer JIT 주입(knowledge → team KNOWLEDGE → SKILL → `<org>/core/` → `agent-profile.yaml` → `<org>/domain/` → handoff + memory recall → target repo)으로 빌드. `workspace.yaml.spawn.max_context_tokens` (기본 80,000) 캡을 초과하면 우선순위 낮은 layer가 정해진 순서로 drop 되고 모든 결정은 `<org>/memory/spawn-decisions.jsonl` 에 기록 (FTS5 인덱싱).
- **Budget envelope** — 네임스페이스 2종 분리: author-loop 턴은 `author-costs.jsonl`, spawn 호출은 `agent-costs.jsonl`. `<org>/agent-profile.yaml` 의 per-agent cap 은 워크스페이스 기본값을 *좁힐 수만* 있고 넓힐 수 없음. 마이그레이션 LLM fallback 비용은 `migration-costs.jsonl` 에 격리.
- **FTS5 cold archive** — `src/memory/` 가 `routine-logs/*.jsonl` 중 8일 이상 된 것을 매일 `<org>/memory/archive.sqlite` 로 회전 (`assets/routines/archive-rotate.md`, 00:00). 기본 retention 365일, 옵션으로 `.zst` 압축-후-삭제. 4 event_type 인덱싱 (`route_hit / route_miss / author_turn / spawn_decision`); 라우터 miss 시 사용자에게 회상 hint 1회 노출.
- **Hot-reload** — `chokidar` 3-tier `fs.watch` (Windows + WSL 강제 폴링, 300ms 디바운스) → `src/bot/reload-policy.ts` → 라우터 인덱스 원자적 swap. `auto` / `prompt` / `manual` 모드. `git_only` 안전모드는 `HEAD ≡ upstream + clean tree` 일 때만 리로드.
- **Stop-hook** — v0.5 의 `loop_mode.spec-gate` SKILL 필드가 `src/engine/stop-hook-adapter.ts` 로 실행 가능. DSL은 3 형식 (`command` / `metric` / `natural`) 수용, 5초 timeout, 모호 시 *continue* 기본 (보수적). 매 평가는 `<org>/memory/stop-hook-events.jsonl` append 후 v0.4 goal-runner 로 thread back.

v0.7 + v0.8 패치 시리즈가 위에 얹은 라이프사이클 + 멀티 유저 + dev capability + observability:

- **v0.7 Uninstall & Lifecycle** — install ↔ uninstall 2단으로 라이프사이클 완결. 데이터 5분류 (A/A\*/B/C/D/E) — 클래스 A *사용자 코드는 walker 가 enumerate 자체를 안 함*. WAL-safe SQLite backup + streaming SHA256 manifest + concurrent lockfile + idempotent journal. `REVOKE-CHECKLIST.md` 자동 생성, PII-NOTICE.md 자동 동봉. `solosquad reset`/`clean` 같은 "초기화" 명령은 영구 거부.
- **v0.8.0 Multi-User Messenger** — "1 워크스페이스 = 1 owner = 1 봇 = 2 채널" 가정 폐기. `command-<handle>` / `works-<handle>` 채널 페어 + 봇 multiplicity (1 user = 1 bot) + author-guard. broadcast 채널은 opt-in.
- **v0.8.1 Security & Lifecycle Pair** — npm audit 7건 → 0. archive 페어 완결 (`solosquad import` + `archive verify/info/list`). `docs/api-stability.md` 신설 — 6개 schema_version 의 bump 룰 + deprecation 기간 박제. v1.0 정식 출시의 *전제 항목*.
- **v0.8.2 Dev Capability** — 엔지니어링 5 SKILL `dev_capability: true` + `dev_permissions` (Bash allow/deny, push confirmation gate). 자동 머지 영구 거부. workspace 마스터 토글.
- **v0.8.3 Onboarding UX + Observability** — `add repo --dry-run`/`--inspect`/`--keep-original` 으로 기존 리포 마이그레이션 UX 강화. logger 확장 + `solosquad logs` CLI + `log-rotate` routine (14일 retention). doctor CLI↔workspace version mismatch 감지. trajectory 자동 등록 ROI 측정 스크립트 박제.

24/7 항상-가동 운영은 다음 중 택1:
- Docker Compose (권장, 백그라운드 + 자동 재시작) — `solosquad init` 이 `docker-compose.yml` + `Dockerfile` 을 워크스페이스 루트에 복사하니, 거기서 `docker compose up -d --build` 실행. [master-guide §Docker](manual/master-guide_ko.html) 참고.
- macOS `launchd` plist / Windows NSSM 서비스
- VPS + systemd (자세히는 [`docs/cloud-deployment.md`](docs/cloud-deployment.md))

자세히는 master-guide §7.1.

---

## 버전

현재 npm 릴리스: **v1.2.6** (npm registry: `1.2.6`).

v1.0 이 정식 출시 마일스톤으로 안정 API 보장이 시작되었습니다. 출시된 + 예정된 마일스톤 (전체 이력은 [`CHANGELOG.md`](CHANGELOG.md), 결정 로그는 [`docs/prd/product-roadmap.md`](docs/prd/product-roadmap.md) §6):

| 버전 | 테마 | 핵심 |
|---|---|---|
| v0.3 (출시) | PM 모드 + 멀티 에이전트 오케스트레이션 | (user, org) 단위 long-lived PM 세션; Claude Code native `Task` tool 로 specialist 위임; 슬래시 체인 `/think /plan /build /review /ship`; 봇 부팅 시 workflow reconciler; `solosquad pm` / `workflow` / `rollback` CLI; per-org `snapshot.git` |
| v0.4 (출시) | 자율 overnight 엔진 | `goal.md` intent 파일 + `solosquad goal run` 백그라운드 루프; metric 기반 keep/discard + git-snapshot revert; `AGENTS.md` 를 cross-tool immutable 워크스페이스 가이드로; 3-tier 가드레일 (Input / Runtime / Output); `solosquad goal verify` 결정성 검증 |
| v0.5 (출시) | 워크플로우 메이커 + frontmatter 라우팅 | 메신저-네이티브 author loop (`_meta/workflow-maker`); 4채널 라우터 + paperclip budget envelope; 리포 분석기 (4-라벨 분류 + incremental ledger); 25 SKILL.md Anthropic-호환 frontmatter; spec-gate ↔ `goal.md` 통합 |
| v0.6 (출시) | 디폴트 워크플로 튜닝 + 메모리 archive + 패턴 miner + Org Layer | Org Layer (`<org>/{core,domain,agent-profile.yaml}` + spawn-assembler 8-layer + budget 일반화); FTS5 archive 4-event 인덱싱; trajectory + freq miner 가 반복 패턴을 SKILL draft 로 추출 (v0.5 `applyDraft` 재사용); stop-hook DSL; chokidar hot-reload + CI PR review 봇 |
| v0.7 (출시) | Uninstall & Lifecycle (Farewell Archive) | `solosquad uninstall` + `solosquad logout`; 데이터 5분류 (A/A\*/B/C/D/E) **사용자 코드 불가침**; WAL-safe SQLite backup + streaming SHA256 manifest; lockfile + journal idempotent resume; REVOKE-CHECKLIST.md + PII-NOTICE.md 자동 생성 |
| **v0.8.0 (출시)** | **Multi-User Messenger** | `command-<handle>` / `works-<handle>` 채널 페어 + 봇 multiplicity (1 user = 1 bot) + author-guard + broadcast opt-in. n잡 사용자 시나리오 1급 지원 |
| **v0.8.1 (출시)** | **Security & Lifecycle Pair** | npm audit 7건 → 0; archive 페어 완결 (`solosquad import` + `archive verify/info/list`); `docs/api-stability.md` (6 schema_version 의 bump 룰); 25 SKILL.md `schema_version: 1` 백필 |
| **v0.8.2 (출시)** | **Dev Capability** | SKILL frontmatter `dev_capability` + `dev_permissions`; engineering 5 SKILL 박제; push/merge confirmation gate; **자동 머지 영구 거부**; workspace 마스터 토글 |
| **v0.8.3 (출시)** | **Onboarding UX + Observability** | `add repo --dry-run`/`--inspect`/`--keep-original`; logger 확장 + `solosquad logs` CLI; `log-rotate` (14일); doctor CLI↔workspace mismatch 감지; trajectory ROI 측정 스크립트 |
| **v1.0.0 (출시)** | **정식 출시** | 안정 API 보장 · 42 CLI surface freeze · `docs/api-stability.md` 공개 약속 발효 · Discord 단일 메신저 (Slack post-v1.0 슬롯) |
| v1.0.1 – v1.0.4 (출시) | **Discord robustness patch chain** | discord.js v15 deprecation · `@<slug>` mention · author-guard 정합 · guild-org binding · category rename · config.yaml load-or-empty + 5-hop diagnostic + Slack author-guard cleanup |
| **v1.1.0 (출시)** | **Multi-Agent Team Architecture** | Single PM session → Team-Centric. Chief (org-level supervisor, 사용자 대면) + PM (workspace-bundle, 자율 product manager) 분리. 4 main bot + 20 specialist + 18 skill + 4 team. 9-layer JIT (team OKR Layer 4a). Chief 6+1 stage state machine. open_questions[] async-batch protocol. Goal queue (1-active-per-org). 4 workflow templates. 외부 reference: Hermes V2 + gstack (Garry Tan) + RO-PNA pna-builders + phuryn pm-skills |
| **v1.2.6 (출시)** | **Messenger Connection (Chief on Discord, auto-connect first)** | 조직 1개당 1 Chief 봇 (`OrgYaml.chief_name`) · OAuth Invite URL 1-click (`solosquad discord invite-url`) · handle 기반 채널 멀티-메신저 portable · owner-only 게이트 (v1.0.2 reversal, 신규 ON / 업그레이드 OFF) · TRIAGE kind 분기 → `works-<handle>` task card + thread + stage narration · `solosquad add-org` 가 v1.1.0 위계 + problem-definition workflow 시드까지 완전 부트스트랩 · `solosquad doctor --discord` 5-hop diagnostic · guildCreate onboarding embed + 2 button · `/chat` slash fallback. 53 신규 test (728/728 pass) |
| v1.2.1 (예정) | 메신저 thread 연속성 | referencedMessage chain + LRU cache + thread token budget. messageCreate 가 thread 메시지 수신 + thread→workflow_id reverse lookup. Slack adapter 동일 슬롯 |
| v1.3 (예정) | 일정 관리 + 메모 | n잡 사용자의 시간·기억 통합 — Calendar/Apple Notes/Obsidian/Notion MCP 연결 |
| v1.x (예정) | 대시보드 인터랙션 | 컴패니언 웹 대시보드 (별도 리포 `solopreneur-dashboard` + `solopreneur-api`) |
| v1.x (예정) | 지식 온톨로지 + MCP | 그래프 백엔드 + MCP 외부 커넥터 (Notion · Obsidian 등) |
| v1.x (예정) | LLM backend abstraction | Multi-backend (single Claude → pluggable) |

결정 로그: [`docs/prd/product-roadmap.md`](docs/prd/product-roadmap.md) §6.

---

## 멀티 워크스페이스

Discord 페르소나(예: 비즈니스 / 개인)를 분리하고 싶다면 워크스페이스를 여러 개 만들면 됩니다:

```
~/solopreneur/      # Discord 봇, 비즈니스 페르소나
~/personal-lab/     # Discord 봇, 취미 페르소나
```

각각 독립된 `.env`, 토큰, 메모리, 메신저 계정. 서로 간섭 없이 병렬 실행. (단, 1 워크스페이스 = 1 메신저 — v0.1.x 의 `MESSENGER=discord,slack` multi-target 문법은 더 이상 지원 안 함. v1.0은 Discord 어댑터만 SemVer 약속에 포함; Slack 어댑터는 코드는 남지만 post-v1.0 슬롯.)

n잡 사용자라면 이 패턴이 핵심입니다:

```
~/work-startup/     # 본업 스타트업
~/side-project-a/   # 사이드 프로젝트 A
~/side-project-b/   # 사이드 프로젝트 B
~/personal-blog/    # 개인 블로그
```

각 워크스페이스가 독립 봇 토큰·메모리·org·메신저 채널을 가지므로 도메인 누수 0. 같은 머신에서 동시 운영 가능.

---

## 리포지토리 레이아웃

본 리포 소스 트리 (요약):

```
package.json                      → npm 패키지 설정 (v0.8.3)
tsconfig.json                     → TypeScript 설정
bin/solosquad.ts                  → CLI 진입점
AGENTS.md                         → 워크스페이스 정합 가이드 (v0.4 — immutable, cross-tool)
CLAUDE.md                         → AGENTS.md 로의 3줄 redirect (백워드 호환)
src/
  cli/                            → CLI 명령 (init, bot, cron, doctor, chief, workflow,
                                     goal, agent, analyze, add, sync, migrate, rollback,
                                     memory, readiness, uninstall, import, archive,
                                     add-repo, logs, messenger)
  bot/                            → chief-runner, claude-process, session-store, events,
                                     agents-builder, workflow-reconciler, slash-commands,
                                     git-snapshot, skill-parser, agent-router,
                                     spawn-assembler (v0.6 8-layer JIT),
                                     agent-budget (v0.6), fs-watcher + reload-policy
                                     (v0.6 hot-reload), user-registry + author-guard +
                                     channel-bootstrap (v0.8.0), dev-confirm (v0.8.2)
  engine/                         → v0.4 자율 엔진 — goal-parser, agents-md-loader,
                                     guards, evaluator, tracker, reconciliation,
                                     goal-runner; stop-hook-adapter (v0.6 spec-gate DSL)
  memory/                         → v0.6 FTS5 archive — archive-db, archive-rotate,
                                     archive-search, route-event-sink
  lifecycle/                      → v0.7 uninstall — classify, manifest, sqlite-backup,
                                     lockfile, journal, precheck, archive, cleanup,
                                     revoke-checklist; v0.8.1 import + archive-reader
  analyze/                        → v0.5 리포 분석기 — scanner, classifier, ledger,
                                     workflow-matcher, report-writer, applier
  messenger/                      → Discord 어댑터 (v1.0). Slack 어댑터 동봉되나 post-v1.0 슬롯. broadcast (v0.8.0)
  scheduler/                      → cron 루틴 + 메모리 append;
                                     trajectory-extractor + freq-keyword-miner (v0.6)
  util/                           → config, paths, logger (v0.8.3 확장), platform, cost,
                                     agent-profile (v0.6), repo-inspect (v0.8.3)
  migrations/                     → 버전별 마이그레이션 스크립트 (0.1.x → 0.8.3)
assets/                           → 번들 디폴트 (init 시 사용자 워크스페이스로 복사)
  agents/{team}/{agent}/SKILL.md  → 25 specialist 정의 (v0.5 frontmatter + v0.6
                                     collab_pattern + v0.8.1 schema_version + v0.8.2
                                     dev_capability)
  agents/{team}/KNOWLEDGE.md      → v0.6 — 팀(=도메인) 공유 craft
  agents/_meta/workflow-maker/    → v0.5 author loop 메타 SKILL
  knowledge/                      → v0.6 — 번들 워크스페이스 지식 시작 가이드
  core/                           → owner 프로필 + principles + voice (universal layer)
  routines/                       → 루틴 prompt (디폴트 3종 + archive-rotate + log-rotate)
  orchestrator/SKILL.md           → PM 역할 정의 (v0.3 + v0.4 goal-md-spec + v0.8.2
                                     Engineering Spawn Template)
  templates/                      → PRD / handoff (×3) / status / goal.md / AGENTS.md /
                                     workflow.yaml / agent-profile.yaml / hooks.json
  messenger-manual/               → v0.8 polish — @bot help 응답 source-of-truth
                                     (quick-reference / full-manual / agents-listing /
                                     troubleshooting)
deploy/
  docker/                         → 컨테이너 배포 (Dockerfile + compose + README)
docs/
  manual/master-guide.html        → 공식 사용자 매뉴얼 (10 섹션)
  plan/                           → 릴리스 계획 + 결정 로그 (v0.1 → v1.3)
  plan/product-roadmap.md         → 마스터 로드맵 + 결정 로그
  plan/architecture.md            → 내부 시스템 설계
  plan/cloud-deployment.md        → VPS + systemd 셋업
  api-stability.md                → v0.8.1 — schema_version bump 룰 + deprecation 기간
.github/workflows/                → CI + v0.6 skill-review.yml + v0.8.1 npm audit 게이트
scripts/                          → backfill-bundled-frontmatter,
                                     inject-collab-pattern (v0.6),
                                     skill-pr-review (v0.6 CI PR 봇),
                                     inject-skill-schema-version (v0.8.1),
                                     regen-agents-listing (v0.8 polish),
                                     measure-trajectory-roi (v0.8.3)
```

엔드유저 워크스페이스 (`solosquad init` 으로 생성, 마이그레이션으로 진화):

```
~/solosquad-workspace/
├── AGENTS.md                            (v0.4 — 단일 영속 가이드)
├── .solosquad/
│   ├── workspace.yaml                   (timezone, briefings, pm, skill_loader, author,
│   │                                       spawn, fs_watch, archive, messenger,
│   │                                       dev_capability, uninstall)
│   ├── .env                             (메신저 토큰, MESSENGER, …)
│   ├── agents/{team}/{agent}/SKILL.md   (번들 25 + v0.5 frontmatter + v0.6 collab_pattern
│   │                                       + v0.8.2 dev_capability)
│   ├── agents/{team}/KNOWLEDGE.md       (v0.6 — 팀 공유 craft)
│   ├── agents/_meta/workflow-maker/     (v0.5 — author loop 메타 SKILL)
│   ├── knowledge/                       (v0.6 — 사용자 누적 지식)
│   └── routines/, core/                 (선택적 사용자 override)
├── .agents/                             (v0.5 — 선택적 워크스페이스 SKILL override)
└── <org-slug>/
    ├── .org.yaml                        (schema_version: 1)
    ├── core/                            (v0.6 — org 철학 override)
    ├── agent-profile.yaml               (v0.6 — 25 에이전트 modifier + budget cap)
    ├── domain/                          (v0.6 — org 도메인 지식)
    ├── .agents/                         (v0.5 — 선택적 per-org SKILL override, 최고 우선순위)
    ├── .solosquad/
    │   ├── users/<handle>.yaml          (v0.8.0 — 멀티 유저 identity layer)
    │   ├── sessions/<user>.json         (v0.3 PM 세션 id + 비용; v0.5 freqCooldowns)
    │   ├── snapshot.git                 (v0.3 — memory/ + workflows/ 용 bare repo)
    │   └── analysis/                    (v0.5 — analyze-repo Markdown 보고서)
    ├── memory/
    │   ├── signals.jsonl · experiments.jsonl · decisions.jsonl
    │   ├── author-costs.jsonl           (v0.5 — author loop 비용 로그)
    │   ├── agent-costs.jsonl            (v0.6 — spawn 비용 로그)
    │   ├── migration-costs.jsonl        (v0.6 — 마이그레이션 LLM fallback)
    │   ├── spawn-decisions.jsonl        (v0.6 — 8-layer drop 로그, FTS5)
    │   ├── stop-hook-events.jsonl       (v0.6 — spec-gate 평가 로그)
    │   ├── dev-confirmations.jsonl      (v0.8.2 — push/merge 승인 audit)
    │   ├── archive.sqlite               (v0.6 — FTS5 cold archive, 365일 retention)
    │   ├── pm-skills/                   (v0.3 — PM compaction 외부화)
    │   └── routine-logs/                (hot tier — 8일 후 archive.sqlite 로 회전)
    ├── workflows/<wf-id>/               (v0.3 — _status.yaml, _events.jsonl, stages)
    ├── goals/<goal-id>/                 (v0.4 — goal.md, results.tsv, _best.json)
    ├── repositories/<repo>/             (Layer 2 — 사용자 프로덕트 코드, 클래스 A 불가침)
    ├── discord/                          (채널 설정 — v1.0 기본). slack/ 동봉되나 post-v1.0 슬롯
    └── product/                         (org별 산출물)

~/.solosquad/
├── agents/                              (v0.5 — 사용자-global SKILL override)
├── agent-profile-defaults.yaml          (v0.6 — 사용자-global agent-profile 기본값)
└── logs/                                (v0.8.3 — 14일 rolling 로그)
```

---

## 참고 자료 (peer-project 차용)

| 프로젝트 | 차용 패턴 |
|---|---|
| [Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | initializer + coding agent 분리; 컨텍스트 compaction; subagent spawning |
| [gstack](https://github.com/garrytan/gstack) | 슬래시 체인 프로토콜 — v0.3 `/think /plan /build /review /ship` 의 직접 차용 |
| [Hermes Agent](https://github.com/nousresearch/hermes-agent) | hot+cold FTS5 메모리 archive, trajectory → SKILL 자동 요약 (v0.6 채택); WAL-safe SQLite backup (v0.7 차용) |
| [autoresearch](https://github.com/karpathy/autoresearch) | metric gate + git keep/rollback 루프 (v0.4 채택) |
| [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | auto-load + slash dual-trigger SKILL 라우팅 (v0.5 4채널 라우터에 채택) |
| [OpenClaw](https://github.com/openclaw/openclaw) | npm publishing + `update` / `doctor` CLI 패턴. *반면교사* — 전체 삭제 디폴트 (Issue #6289) 안티패턴은 v0.7 에서 명시적 거부 |
| [gh CLI](https://github.com/cli/cli) | logout / data-removal 분리, server-side revoke 한계 명시 (v0.7 차용) |
| Amplitude AI agents | 자연어 → metric/segment 자동 query, statistical significance 자동 check (v1.x 실험 인프라 슬롯) |

솔로 파운더에 *과한 엔지니어링*으로 명시적 거부된 항목: 3-repo 물리 분리, LangGraph v3 그래프 오케스트레이션, MCP 기반 내부 SKILL 레지스트리, Vector + Graph DB 하이브리드, 자동 머지. 사유는 [`docs/prd/product-roadmap.md`](docs/prd/product-roadmap.md) §6 참조.

---

## 기여

활성 1인 개발 중. 이슈 / PR 환영하지만 v1.0 까진 API 가 불안정합니다. [`CONTRIBUTING.md`](CONTRIBUTING.md) 참조.

## 라이선스

MIT — [`LICENSE`](LICENSE) 참조.
