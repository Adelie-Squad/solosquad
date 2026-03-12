# Solo Founder Agents 개선 진행 상황

> 최종 업데이트: 2026-03-12

---

## 개요

기존 SKILL.md 기반 23개 에이전트 시스템에 24/7 자동화 인프라를 추가하여
**Discord 봇 + 에이전트 라우팅 + 스케줄러 + 메모리 자동 저장 + CLI + Docker 배포**가 가능한 솔로프리너 비서 시스템으로 진화.

---

## 완료된 작업

### 1. Discord Bot + 에이전트 라우팅 (`src/bot.py`)
- [x] `#owner-command` 채널에서 명령 수신
- [x] Claude Code `--print` 모드로 실행 후 응답 반환
- [x] guild_id 기반 서버-제품 자동 매핑
- [x] 봇 초대 시 필수 채널 6개 자동 생성
- [x] 2000자 초과 메시지 자동 분할
- [x] 키워드 기반 에이전트 자동 라우팅 (60+ 키워드 → 23개 에이전트)
- [x] 매칭된 에이전트의 SKILL.md를 프롬프트에 자동 주입
- [x] 라우팅 결과를 Discord 응답 헤더에 표시
- [x] 매칭 없으면 일반 모드로 폴백

### 2. Scheduler + 메모리 자동 저장 (`src/scheduler.py`)
- [x] APScheduler 기반 cron 스케줄 등록
- [x] 5개 루틴 정의 (Morning Brief, Signal Scan, Experiment Check, Daily Log, Weekly Review)
- [x] 모든 등록 제품에 대해 병렬 실행
- [x] Discord 채널 직접 전송 → 웹훅 폴백 → 파일 저장 3단계 보고
- [x] 시작 시 daily-brief 채널에 스케줄 알림
- [x] 루틴 결과에서 ```json 블록 자동 추출 → JSONL 메모리 append
- [x] 루틴별 memory_targets 매핑 (signal-scan → signals.jsonl 등)
- [x] 중복 방지 + 날짜 자동 추가
- [x] 모든 루틴 로그 항상 파일 저장 (memory/routine-logs/)

### 3. CLI Tools
- [x] `cli/new_project.py` — 인터랙티브 프로젝트 생성
  - 제품 선택 → 프로젝트 타입 → 에이전트 선택 → 디렉토리/CLAUDE.md/program.md 자동 생성
  - GitHub 레포 자동 생성 (선택)
- [x] `cli/status.py` — 전체 현황 대시보드
  - 제품별 프로젝트 목록, 활동 상태, 최근 결정 표시
  - 검증 중인 가설 수 표시
- [x] `cli/run_routine.py` — 수동 루틴 실행
  - 인터랙티브 모드 / 직접 실행 모드 / 제품 필터 / 전체 실행

### 4. Setup Wizard (`setup.py`)
- [x] 6단계 설치 마법사
  - 1단계: 환경 확인 (Docker, Python, git)
  - 2단계: .env 설정 (오너 정보, Discord 토큰, GitHub 토큰, repos 경로)
  - 3단계: 제품/조직 등록 → 디렉토리 구조 + CLAUDE.md 자동 생성
  - 4단계: Docker 빌드
  - 5단계: Discord Bot 초대 링크 생성
  - 6단계: 시스템 시작
- [x] OWNER.md에 실제 오너 정보 자동 반영
- [x] 제품 CLAUDE.md의 core/ 경로 동적 생성

### 5. Core Templates (`core/`)
- [x] `OWNER.md` — 오너 프로필 (setup.py가 실제 값 자동 설정)
- [x] `PRINCIPLES.md` — 의사결정 원칙 5가지
- [x] `VOICE.md` — 글쓰기 스타일

### 6. Routine Prompts (`routines/`)
- [x] `morning-brief.md` — 오늘의 포커스 + 진행 중 실험 + 할 일
- [x] `signal-scan.md` — 경쟁/고객/기술/정책 시그널 탐지
- [x] `experiment-check.md` — 실험 상태 점검 + signal_strength 판단
- [x] `daily-log.md` — 오늘 한 일 + 결정 + 내일 이어갈 것
- [x] `weekly-review.md` — 주간 회고 + 다음 주 포커스 제안

### 7. Docker 배포
- [x] `Dockerfile` — Python 3.12-slim + Node.js + Claude Code CLI
- [x] `docker-compose.yml` — bot + scheduler 2개 서비스
- [x] TZ 환경변수로 타임존 설정
- [x] volumes: repos, core, routines, .env 마운트

### 8. 프로젝트 설정 파일
- [x] `.env.example` — 환경변수 템플릿 (4개 필수값)
- [x] `requirements.txt` — Python 의존성 7개
- [x] `.gitignore` — .env, __pycache__, products.json 등

### 9. 서비스명 일반화
- [x] 하드코딩된 특정 이름 제거 (제품명, 오너명)
- [x] Docker 컨테이너명 일반화 (agent-bot, agent-scheduler)
- [x] 배포 가능한 범용 시스템으로 전환

---

## 아키텍처

### 3-Layer 컨텍스트 격리

```
Layer 0: Universal (core/)
  OWNER.md, PRINCIPLES.md, VOICE.md
  → 모든 제품/프로젝트 세션에 공유

Layer 1: Product (~/repos/{slug}/)
  CLAUDE.md, product/brief.md, product/weekly-state.md
  memory/hypotheses.jsonl, experiments.jsonl, decisions.jsonl, signals.jsonl
  → 제품 단위 격리. 다른 제품 컨텍스트 차단.

Layer 2: Project (~/repos/{slug}/projects/{id}/)
  CLAUDE.md, brief.md, team.yaml, program.md
  memory/decisions.jsonl, experiments.jsonl, handoffs.jsonl
  → 프로젝트 단위 격리. 에이전트 활성 목록 제한.
```

### 시스템 구성도

```
[Discord 서버]
  #owner-command ←→ bot.py (에이전트 라우팅) ←→ Claude Code --print
  #daily-brief   ←── scheduler.py (06:00, 22:00)
  #signals       ←── scheduler.py (12:00)
  #experiments   ←── scheduler.py (16:00)
  #weekly-review ←── scheduler.py (일 20:00)

[메모리 자동 저장]
  scheduler.py → ```json 블록 추출 → signals.jsonl / experiments.jsonl / decisions.jsonl
  scheduler.py → memory/routine-logs/ (항상)

[CLI]
  setup.py         → .env + core/products.json + 제품 디렉토리 + OWNER.md 설정
  new_project.py   → 프로젝트 디렉토리 + CLAUDE.md + program.md
  status.py        → 현황 대시보드 출력
  run_routine.py   → 수동 루틴 실행

[Docker]
  agent-bot        → src/bot.py
  agent-scheduler  → src/scheduler.py
```

### JSONL 메모리 스키마

| 파일 | 필드 | 용도 |
|------|------|------|
| `hypotheses.jsonl` | id, statement, risk, method, status, date | 가설 관리 |
| `experiments.jsonl` | id, hypothesis_id, method, result, signal_strength, date, next_action | 실험 기록 |
| `decisions.jsonl` | date, decision, alternatives, reasoning, emotion_weight | 의사결정 기록 |
| `signals.jsonl` | date, source, type, content, relevance, action | 외부 시그널 |
| `handoffs.jsonl` | date, from_stage, to_stage, summary, context | 에이전트 간 인계 |

---

## 기존 유지 항목

| 항목 | 파일 수 | 상태 |
|------|---------|------|
| 에이전트 SKILL.md | 23개 | 변경 없음 |
| 팀 TEAM_KNOWLEDGE.md | 4개 | 변경 없음 |
| templates/ | 11개 | 변경 없음 |
| orchestrator/SKILL.md | 1개 | 변경 없음 |

---

## 미완료 / 향후 과제

- [ ] core/skills/ 디렉토리에 에이전트별 스킬 요약 파일 생성
- [ ] Discord 서버 자동 생성 기능
- [ ] 웹 대시보드 (status.py의 웹 버전)
- [ ] 에이전트 실행 로그 수집 및 분석
- [ ] CI/CD 파이프라인 (테스트 + 린트)
- [ ] 멀티 오너 지원 (팀 사용)
- [ ] Claude Code --print 실행당 토큰/비용 로깅
- [ ] 일일 실행 한도 설정

---

## 파일 변경 요약

### 신규 생성 (20개)
```
setup.py
docker-compose.yml
Dockerfile
.env.example
requirements.txt
src/bot.py
src/scheduler.py
cli/new_project.py
cli/status.py
cli/run_routine.py
core/OWNER.md
core/PRINCIPLES.md
core/VOICE.md
routines/morning-brief.md
routines/signal-scan.md
routines/experiment-check.md
routines/daily-log.md
routines/weekly-review.md
docs/solopreneur-agents-improvement-plan.md
docs/progress.md
```

### 수정 (4개)
```
README.md          ← 전면 개편
CLAUDE.md          ← 새 구조 반영
CONTRIBUTING.md    ← CLI/루틴/라우팅 기여 가이드 추가
.gitignore         ← .env, __pycache__ 등 추가
```
