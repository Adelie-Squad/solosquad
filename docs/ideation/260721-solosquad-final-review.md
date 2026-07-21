# solosquad 언어 & 아키텍처 최종 검토 보고서

> **최종 결론: Python 오케스트레이션 중심 + TypeScript 프론트엔드.**
> 언어 경계는 React ↔ FastAPI 한 곳으로 축소. 배포는 pip/pipx + curl/irm 원클릭, npm은 웹 자산 전용으로 역할 축소.
> 단일 트레이드오프: Claude Agent SDK 세션 훅을 shell로 우회해야 함.

---

## 0. 이 보고서의 목적

앞선 논의에서 "웹이 TS이므로 오케스트레이션도 TS"라는 결론을 냈으나, 이는 약한 논거였다. 본 보고서는 그 결론을 정정하고, solosquad의 실제 무게중심에 기반한 최종 아키텍처를 확정한다.

---

## 1. 핵심 정정: 웹은 오케스트레이션 언어를 강제하지 않는다

### 잘못된 논거의 해부

앞서 TS 오케스트레이션의 근거로 든 세 가지를 재평가하면:

| 근거 | 실제 무게 | 판정 |
|------|----------|------|
| "웹 대시보드와 같은 언어여야" | 웹과 오케스트레이션은 HTTP/JSON으로 통신하면 그만 | ❌ 약함 |
| "CLI가 npm 배포라 TS" | CLI는 얇은 런처면 됨. Python도 CLI 배포 가능 | 🔺 부분적 |
| "Claude Agent SDK 세션 훅이 TS 우선" | 진짜 근거. 단 Python도 shell 훅으로 우회 가능 | ✅ 유일하게 유효 |

**결론**: 대시보드는 오케스트레이터가 뱉는 상태(JSONL/DB/REST)를 읽어 그리기만 한다. 오케스트레이터가 Python이든 TS든 대시보드는 무관하다. 웹의 존재는 오케스트레이션 언어 결정에서 사실상 중립이다.

---

## 2. 진짜 결정 기준

오케스트레이션 언어를 가르는 단 하나의 질문:

> **오케스트레이션이 (A) 시뮬레이션·분석과 얼마나 밀착해야 하는가 vs (B) 세션 생명주기 훅에 얼마나 의존하는가**

| 조건 | 유리한 언어 |
|------|:----------:|
| 시뮬레이션·분석과 밀착이 핵심 | **Python** |
| 세션 훅(SessionStart/End/TaskCompleted 등)이 핵심 | **TypeScript** |

### solosquad의 실제 무게중심

- 핵심 루프 = **"가설 → 시뮬레이션 검증 → 분석 → 재귀 개선"**
- 스케줄 기반 운영 (APScheduler)
- 세션 훅은 부수적, 시뮬레이션·분석 밀착은 본질적

→ solosquad는 (A)에 압도적으로 치우쳐 있다. **Python 오케스트레이션이 정답.**

---

## 3. 최종 아키텍처

```
solosquad/                     ← 모노레포
│
├── core/                      ← Python 세계 (무게중심)
│   ├── orchestrator/          ← 멀티 에이전트 오케스트레이션
│   ├── simulation/            ← VMS 가설 검증 시뮬레이션
│   ├── analytics/             ← 사용자 로그 분석
│   ├── ontology/              ← 세컨드 브레인 / LLM Wiki
│   ├── workflows/             ← MECE, 5-Whys, JTBD 등
│   ├── llm_router/            ← 다중 LLM 라우팅
│   ├── connectors/            ← 메신저 연결 (OpenTag 등)
│   └── pyproject.toml
│
├── apps/                      ← TypeScript 세계
│   ├── dashboard/             ← 웹 대시보드 (React)
│   └── docs/                  ← 개발자 문서 사이트 (Docusaurus)
│
├── schema/                    ← ★ 단일 진실 (언어 간 계약)
│   ├── *.schema.json
│   └── gen/
│       ├── types.ts           ← 자동 생성 (대시보드용)
│       └── models.py          ← 자동 생성 (코어용)
│
├── cli/                       ← 얇은 런처 (Python)
├── Makefile                   ← 공통어 (make dev/build/test)
└── deploy/
    ├── Dockerfile
    └── docker-compose.yml
```

### 이 구조의 결정적 이점

1. **언어 경계가 1곳으로 축소**: 오케스트레이션과 분석·시뮬레이션이 같은 Python 안에서 함수 호출로 연결된다. 이전 설계에서 TS 오케스트레이터가 Python 시뮬레이션을 REST로 호출하던 경계가 통째로 사라진다.

2. **핵심 루프에 직렬화 비용 없음**: "가설 → 시뮬레이션 → 분석 → 개선"이 전부 Python 프로세스 내부에서 돈다. 데이터 직렬화/역직렬화 오버헤드 제거.

3. **경계가 가장 검증된 형태**: 남는 언어 경계는 TS 웹 ↔ Python 백엔드 딱 하나. React + FastAPI는 세상에서 가장 흔하고 안정적인 조합이다.

---

## 4. 유일한 트레이드오프

**Claude Agent SDK 세션 훅을 Python에서 shell로 우회해야 함.**

- TS SDK: `SessionStart`, `SessionEnd`, `TaskCompleted` 등을 콜백으로 네이티브 지원
- Python SDK: `.claude/settings.json`의 shell 훅 + `setting_sources=["project"]`로 우회
- (단 `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop` 등은 Python도 콜백 지원)

**영향 평가**: solosquad는 스케줄 기반이고 세션 훅이 부수적이므로, 이 우회 비용은 시뮬레이션·분석 밀착의 이점에 비하면 작다. 감내 가능한 트레이드오프.

---

## 5. 배포 전략 (재확정)

오케스트레이션이 Python이 되면 배포 결론도 따라 바뀐다.

| 채널 | 역할 | 대상 |
|------|------|------|
| **pip / pipx** | Python 코어 + CLI 배포 (주 채널) | 개발자 |
| **curl / irm** | 원클릭 설치 (Python + Docker 자동 세팅) | 비개발자 |
| **npm** | TS 대시보드/문서 사이트 자산 배포 (역할 축소) | 내부/웹 |

### 정정 포인트
- 이전 "npm 유지"는 TS 오케스트레이션 가정에 기반한 것. **오케스트레이션이 Python이면 `npm install -g solosquad`는 부자연스럽다.**
- 주 설치 채널은 `pipx install solosquad`(개발자) + `curl/irm 원클릭`(비개발자).
- npm은 오케스트레이션 배포에서 빠지고, 웹 자산 배포로 역할이 축소된다.

### 비개발자 원클릭 스크립트 내부 동작
```
curl -fsSL https://get.solosquad.dev | sh
  → Python 3.10+ 확인/설치
  → pipx로 solosquad 설치
  → Docker 확인/설치
  → 초기 설정 마법사 실행
```

---

## 6. 레퍼런스 교훈 반영 현황

| 레퍼런스 | 교훈 | solosquad 반영 |
|----------|------|---------------|
| n8n | 모노레포의 힘 (타입 공유, 단일 빌드) | 모노레포 채택 |
| LangChain | 완전 분리 레포 → 드리프트가 기본 상태 | 단일 레포로 회피 |
| DeepEval/Stripe | 저장소는 나눠도 진실의 원천은 하나 | `schema/` 단일 진실 |
| Supabase | 도구별 최적 언어 (단 대규모 조직) | 언어 2개로 제한 (1인 제약) |
| 폴리글랏 모노레포 | 언어 간 계약이 성패 좌우 | JSON 스키마 계약 + Makefile |

---

## 7. 확장 가능성

- **새 LLM**: `core/llm_router/`에 어댑터 추가
- **새 메신저**: `core/connectors/`에 커넥터 추가
- **시뮬레이션 고도화(ICML)**: `core/simulation/`이 오케스트레이터와 한 언어라 연구 반영이 즉시
- **성능 경로에 Rust 필요 시**: `core/` 옆에 추가하고 `schema/` 계약 준수 (단 1인 단계에선 2개 언어 상한 권장)
- **기여자 온보딩**: Python 기여자 → `core/`, 프론트 기여자 → `apps/`. 관심사별 자연 분리

---

## 8. 리스크와 완화

| 리스크 | 완화책 |
|--------|--------|
| 세션 훅 우회의 번거로움 | shell 훅 표준화, 필요 최소한만 사용 |
| TS↔Python 드리프트 | `schema/` 단일 진실 + 자동 코드 생성 |
| 비개발자 설치 실패 | curl/irm 스크립트가 Python+Docker 자동 처리 |
| Python 오케스트레이션 성능 | I/O 바운드 작업이라 asyncio로 충분, 병목 시 특정 경로만 최적화 |

---

## 9. 최종 요약

| 항목 | 결정 |
|------|------|
| 오케스트레이션 | **Python** (시뮬레이션·분석과 밀착) |
| 시뮬레이션·분석·온톨로지 | **Python** (같은 언어, 경계 없음) |
| 웹 대시보드·문서 | **TypeScript** (React 생태계) |
| 구조 | 모노레포 (`core/` Python + `apps/` TS) |
| 언어 경계 | 1곳: React ↔ FastAPI (검증된 조합) |
| 드리프트 방지 | `schema/` 단일 진실 → 타입 자동 생성 |
| 배포 주 채널 | pipx(개발자) + curl/irm(비개발자) |
| npm 역할 | 웹 자산 배포로 축소 |
| 유일한 대가 | Claude Agent SDK 세션 훅 shell 우회 |

### 이전 결론 대비 변경 사항
1. 오케스트레이션 언어: TS → **Python** (정정)
2. 언어 경계: 2곳 → **1곳** (React↔FastAPI)
3. 배포 주 채널: npm → **pipx + curl/irm** (npm은 웹 자산 전용으로 축소)

---

*작성일: 2026년 기준 / solosquad 아키텍처 확정본*
