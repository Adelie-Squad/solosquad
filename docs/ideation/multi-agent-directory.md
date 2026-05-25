팀 단위의 공통 지식 자산화, 서브 에이전트의 재사용성, 그리고 고도화된 오케스트레이션 개념을 반영하여 **Hermes Agent 시스템 설계안 V2**를 작성해 드립니다.

---

# 📝 Hermes Agent 시스템 설계안 V2 (Team-Centric Architecture)

## 1. 개요 (Overview)

본 시스템은 개별 에이전트의 활동을 넘어, **'팀(Team)'** 단위의 협업과 **'공통 지식(Shared Knowledge)'** 활용에 최적화된 자율형 멀티 에이전트 플랫폼입니다. 오케스트레이터는 팀의 목표를 달성하기 위해 최적의 에이전트와 공용 서브 에이전트를 조합하여 배치합니다.

---

## 2. 시스템 계층 구조 (The 5-Layer Hierarchy)

오케스트레이션은 상위 계층의 의사결정이 하위 계층의 실행으로 이어지는 단방향 흐름을 가집니다.

| 계층 | 구성 요소 | 역할 및 오케스트레이션 주체 |
| --- | --- | --- |
| **L1. Gateway** | Discord/Slack, Webhook | 사용자 접점 및 에이전트 가상 페르소나 출력 |
| **L2. Orchestrator** | Workflow, Scheduler | **[지휘 주체]** 전체 공정 관리 및 에이전트 호출 순서 결정 |
| **L3. Team** | Team Goal, Knowledge Base | **[지식 공유]** 팀 공동 목표 및 벡터 DB 기반 공통 지식 자산 |
| **L4. Agent** | Main Agents (Role-based) | **[판단 주체]** 팀의 목표를 인지하고 서브 에이전트/스킬 활용 결정 |
| **L5. Specialist** | **Shared Sub-Agents**, Skills | **[실행 주체]** 재사용 가능한 전문 지능 및 물리적 도구(함수) |

---

## 3. 고도화된 폴더 구조 (Directory Structure)

서브 에이전트를 특정 에이전트에 가두지 않고 `specialists/` 폴더로 공용화하여 재사용성을 극대화합니다.

```text
/hermes-project
├── teams/                         # 팀 단위 정의
│   └── {team_name}/               # 예: marketing_team
│       ├── TEAM_GOAL.md           # 팀의 공동 미션 및 협업 규칙
│       ├── KNOWLEDGE/             # 팀 공통 지식 (PDF, 문서, 가이드라인)
│       └── composition.yaml       # 팀원 구성 (Agent A, Agent B 등)
├── agents/                        # 지능체 정의
│   ├── main/                      # 메인 에이전트 (사용자 소통 가능)
│   │   └── researcher/
│   │       ├── INSTRUCTIONS.md    # 개인 업무 지침
│   │       └── config.yaml        # 사용 가능한 specialists 목록
│   └── specialists/               # [재사용] 공유 서브 에이전트
│       └── search_optimizer/      # 여러 에이전트가 호출 가능한 전문 지능
│           ├── INSTRUCTIONS.md
│           └── DESCRIPTION.md     # 메인 에이전트가 읽는 서브 에이전트 설명서
├── skills/                        # 공용 도구함 (Atomic Functions)
│   └── google_search/
│       ├── DESCRIPTION.md         # LLM이 읽는 도구 설명
│       └── logic.py               # 실제 실행 코드
├── context/                       # 세션 및 메모리 관리
└── workflows/                     # 오케스트레이션 시나리오 (YAML/JSON)

```

---

## 4. 핵심 설계 로직

### 4.1 지능형 오케스트레이션 (Orchestration Logic)

* **관리 주체:** 시스템 코어(Core Engine)가 `workflow` 설계도를 읽고 매니저 역할을 수행합니다.
* **프로세스:** 1. 유저 요청 수신 → 2. 해당 팀의 `TEAM_GOAL`과 `KNOWLEDGE` 추출 → 3. 적합한 `Main Agent` 배정 → 4. 에이전트가 필요시 `Specialist(Sub-agent)`에게 작업 위임 → 5. 최종 결과 취합 후 Gateway 전송.

### 4.2 팀 공통 지식 활용 (Context Injection)

에이전트가 실행될 때, 시스템은 아래 순서로 프롬프트를 조립(Assembly)하여 주입합니다.

1. **[팀 목표]** "우리는 OO 서비스를 홍보하는 팀이다."
2. **[팀 지식]** "우리 서비스의 주요 특징은 A, B, C이다." (RAG 기반 주입)
3. **[개인 역할]** "너는 이 팀의 리서처로서 시장 조사를 담당한다."
4. **[현재 상황]** "기획자가 보낸 초안을 검토하라."

### 4.3 서브 에이전트 재사용성 (Specialist Pool)

* **개념:** `specialists/` 폴더 내의 서브 에이전트는 독립된 인격체이자 '고성능 지능 도구'입니다.
* **공유:** '검색어 최적화 전문가' 서브 에이전트는 리서처가 심층 조사를 할 때도 사용하고, 작가가 자료를 찾을 때도 호출할 수 있습니다.
* **연결:** 메인 에이전트는 서브 에이전트의 `DESCRIPTION.md`를 읽고, 마치 스킬을 쓰듯이 서브 에이전트에게 사고(Reasoning) 업무를 요청합니다.

---

## 5. 구현 가이드 (Implementation Note)

1. **언어 및 프레임워크:** Python 기반으로 구축하며, `Pydantic`으로 데이터 규격을, `FastAPI`로 게이트웨이를 구성합니다.
2. **문서 로더 (Loader):** `teams/`, `agents/`, `skills/` 폴더 내의 대문자 `.md` 파일들을 읽어 실시간으로 프롬프트를 조합하는 클래스를 구현합니다.
3. **공유 메모리:** 팀원들이 실시간으로 정보를 교환할 수 있도록 `Redis` 기반의 '팀 화이트보드'를 세션별로 운영합니다.

---

이 설계안은 에이전트 개인이 아니라 '지식을 공유하는 팀'이 어떻게 유기적으로 움직이는지에 초점을 맞추고 있습니다.