# Solo Founder Agents

> 1인 창업자를 위한 24/7 AI 비서 시스템. Claude Code + Discord 봇 + 자동 루틴 + 팀 기반 에이전트로 동작한다.

## 핵심 철학

```
결과물 ≠ 목표. 결과물 = 목표 달성을 위한 수단.
```

## 프로젝트 구조

```
setup.py                          → 설치 마법사 (최초 1회)
docker-compose.yml                → 크로스플랫폼 실행
core/                             → 오너 프로필, 원칙, 글쓰기 스타일
  OWNER.md, PRINCIPLES.md, VOICE.md, products.json
src/
  bot.py                          → Discord 봇 (에이전트 라우팅 + Claude Code 실행)
  scheduler.py                    → 24시간 루틴 자동 실행 + 메모리 자동 저장
cli/
  new_project.py                  → 프로젝트 생성 CLI
  status.py                       → 현황 대시보드
  run_routine.py                  → 수동 루틴 실행 CLI
routines/                         → 루틴 프롬프트 (수정 가능)
orchestrator/SKILL.md             → 프로젝트 워크플로우 조율
agents/{team}/{agent}/SKILL.md    → 개별 에이전트 정의 (23개)
agents/_teams/{team}/TEAM_KNOWLEDGE.md → 팀 공유 지식
templates/                        → PRD, 핸드오프, 상태 파일 템플릿
```

## 3-Layer 컨텍스트

```
Layer 0: Universal (core/)       → 모든 세션에 공유
Layer 1: Product (~/repos/{slug}/) → 제품별 격리
Layer 2: Project (projects/{id}/)  → 프로젝트별 격리
```

## 팀 구성

| 팀 | 에이전트 | 역할 |
|----|---------|------|
| **Strategy** | PMF Planner, Feature Planner, Policy Architect, Data Analyst, Business Strategist, Idea Refiner, Scope Estimator | 전략, 기획, 분석 |
| **Growth** | GTM Strategist, Content Writer, Brand Marketer, Paid Marketer | 마케팅, 브랜딩 |
| **Experience** | User Researcher, Desk Researcher, UX Designer, UI Designer | 리서치, 디자인 |
| **Engineering** | Creative Frontend, FDE, Architect, Backend Developer, API Developer, Data Collector, Data Engineer, Cloud Admin | 개발, 인프라 |

## 에이전트 라우팅

Discord `#owner-command`에서 메시지를 보내면 `src/bot.py`가 키워드를 분석해 적절한 에이전트의 SKILL.md를 자동 주입한다.
- 60+ 키워드 → 23개 에이전트 매핑 (`AGENT_ROUTES` 딕셔너리)
- 매칭 없으면 일반 모드로 폴백

## 자동 루틴 + 메모리 저장

| 시간 | 루틴 | 채널 | 메모리 저장 |
|------|------|------|-------------|
| 06:00 매일 | Morning Brief | #daily-brief | - |
| 12:00 매일 | Signal Scan | #signals | signals.jsonl |
| 16:00 매일 | Experiment Check | #experiments | experiments.jsonl |
| 22:00 매일 | Daily Log | #daily-brief | decisions.jsonl |
| 일 20:00 | Weekly Review | #weekly-review | decisions.jsonl |

루틴 결과에서 ```json 블록을 자동 추출 → JSONL 메모리에 append. 모든 로그는 `memory/routine-logs/`에 파일 저장.

## 사용법

### 설치
```bash
cp .env.example .env && python setup.py
```

### Discord 명령
`#owner-command` 채널에 메시지 → 에이전트 자동 라우팅 → Claude Code가 응답

### CLI
```bash
python cli/new_project.py           # 새 프로젝트
python cli/status.py                # 현황 대시보드
python cli/run_routine.py           # 수동 루틴 실행
```

### 프로젝트에서 직접 작업
```bash
cd ~/repos/my-product/projects/pmf-validation && claude
```

## 멀티 세션 실행 규칙

### Orchestrator 세션 (이 세션)
1. `orchestrator/SKILL.md` 로드
2. 사용자 아이디어 → 구체화 질문 → PRD 생성
3. `projects/{id}/_status.yaml` 생성
4. 팀별 세션 컨텍스트(`sessions/`) 생성
5. 각 Phase별 실행할 팀 세션 안내
6. 세션 완료 후 `_status.yaml` + `_handoff.md` 확인

### 팀 세션 (개별 터미널)
1. `projects/{id}/sessions/{team}/CLAUDE.md` 읽기
2. 이전 단계 `_handoff.md` 확인
3. 해당 에이전트 `SKILL.md` 로드하여 작업 수행
4. 산출물을 `projects/{id}/stage-N-{name}/`에 저장
5. `_handoff.md` 작성 (다음 에이전트에게 맥락 전달)
6. `_status.yaml`의 해당 stage를 `completed`로 업데이트

## 핸드오프 프로토콜

모든 에이전트는 작업 완료 시 `_handoff.md`를 작성합니다:
- **Summary**: 핵심 발견/결정 3줄 요약
- **Artifacts**: 생성된 산출물 목록
- **Key Decisions**: 결정 사항과 근거
- **Context for Next Agent**: 다음 에이전트가 알아야 할 맥락
- **Open Questions**: 미해결 질문

템플릿: `templates/handoff.md`

## 상태 추적

`projects/{id}/_status.yaml`로 전체 워크플로우를 추적합니다:
- `pending` → `in_progress` → `completed`
- `needs_revision`: 이전 stage 수정으로 재생성 필요

템플릿: `templates/status.yaml`

## 워크플로우 타입

| 타입 | 용도 | 핵심 Phase |
|------|------|-----------|
| PMF 탐색 | 새 제품 시장 적합성 | Research → Planning → Design → Build → Launch |
| 기능 확장 | 기존 제품 기능 추가 | Analysis → Planning → Design → Build |
| 리브랜딩 | 브랜드 재정립 | Research → Branding → Design → Marketing |
| 빠른 프로토타입 | 최소 기능 검증 | Refine → Build → Launch |
