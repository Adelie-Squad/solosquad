**Hermes Agent** 스타일의 자율형 멀티 에이전트 시스템 설계안을 마크다운 문서 형식으로 정리해 드립니다. 이 설계안은 시스템의 확장성과 에이전트의 지능적 도구 사용에 최적화되어 있습니다.

---

# 📝 Hermes Agent 시스템 설계안 (System Design Specification)

## 1. 개요 (Overview)

본 시스템은 디스코드/슬랙과 연동되어 자율적으로 업무를 수행하는 **멀티 에이전트 팀**을 구축하는 것을 목표로 합니다. 에이전트는 고유한 페르소나를 가지며, 중앙 워크플로우 엔진에 의해 통제되고, 웹훅(Webhook)을 통해 사용자에게 개별적인 인격을 가진 것처럼 노출됩니다.

---

## 2. 시스템 위계 구조 (Hierarchy)

시스템은 [입력/트리거] - [제어] - [실행] - [자원]의 4단계 위계를 가집니다.

| 계층 | 구성 요소 | 역할 설명 |
| --- | --- | --- |
| **L1. Interface** | 봇(Discord/Slack), 스케줄러 | 외부 사용자의 명령 접수 및 시간 기반 자동 실행 트리거 |
| **L2. Orchestrator** | 워크플로우 (Workflow) | 에이전트 간 업무 배분, 실행 순서 및 상태(State) 제어 |
| **L3. Execution** | 에이전트 (Agent) | 페르소나에 기반한 의사결정 및 도구 사용 판단 |
| **L4. Resources** | 컨텍스트 & 스킬 | 에이전트의 기억(Memory) 및 실제 기능을 수행하는 함수(Tools) |

---

## 3. 디렉토리 구조 (Directory Structure)

에이전트의 지능(Prompt)과 로직(Code)을 분리하여 관리하는 **Folder-as-Object** 구조를 채택합니다.

```text
/project-root
├── main.py                 # 시스템 진입점 (FastAPI/Bot Loop)
├── agents/                 # 에이전트(직원) 정의 폴더
│   └── {agent_name}/       # 예: researcher, designer
│       ├── INSTRUCTIONS.md # 에이전트 행동 지침 및 페르소나
│       └── config.yaml     # 모델 설정 및 권한 있는 스킬 목록
├── skills/                 # 전문 기술(도구) 모음
│   └── {skill_name}/       # 예: web_search, file_writer
│       ├── DESCRIPTION.md  # LLM이 읽는 도구의 용도 및 사용법
│       ├── logic.py        # 실제 API 호출 및 실행 로직
│       └── schema.json     # 입력/출력 데이터 규격 (JSON Schema)
├── context/                # 데이터 및 상태 관리
│   ├── sessions/           # 채널/유저별 현재 대화 이력
│   ├── memories/           # Vector DB 기반 장기 기억
│   └── globals/            # 전역 변수 (프로젝트 목표, 공통 규칙)
├── workflows/              # 에이전트 간 협업 로직 (Graph/State Machine)
└── interfaces/             # 플랫폼 연동 (Discord/Slack Webhook)

```

---

## 4. 핵심 구성 요소 상세 설계

### 4.1 에이전트(Agent)와 스킬(Skill)의 분리

* **에이전트(직원):** 고유한 `INSTRUCTIONS.md`를 가지며, 문제를 해결하기 위해 어떤 스킬을 쓸지 '판단'합니다.
* **스킬(도구):** `DESCRIPTION.md`를 통해 LLM에게 자신의 기능을 설명하며, 실제 동작은 `logic.py`에서 수행합니다.
* **특징:** 동일한 '검색 스킬'을 리서처 에이전트와 기획자 에이전트가 공유하여 사용할 수 있습니다.

### 4.2 대문자 `.md` 파일의 용도

시스템 엔진은 다음 파일들을 자동으로 읽어 LLM의 시스템 프롬프트에 주입합니다.

* **`DESCRIPTION.md`**: 스킬 폴더 내 위치. LLM이 도구를 선택할 때 읽는 '도구 설명서'.
* **`INSTRUCTIONS.md`**: 에이전트 폴더 내 위치. 에이전트의 자아와 업무 스타일을 규정하는 '업무 지침서'.

### 4.3 플랫폼 연동 전략 (Identity Management)

* **중앙 봇 방식:** 디스코드/슬랙에는 하나의 메인 관리 봇만 존재합니다.
* **가면 페르소나 (Webhook):** 에이전트가 답변을 출력할 때, **Webhook**을 사용하여 메시지마다 에이전트의 이름과 프로필 사진을 동적으로 교체합니다.
* *장점:* 봇 계정 생성 제한을 우회하며, 수십 명의 에이전트를 한 채널에서 운영 가능.



---

## 5. 데이터 흐름 (Data Flow)

1. **Trigger:** 사용자 메시지가 디스코드 봇을 통해 서버로 전달됩니다.
2. **Context Loading:** 해당 채널의 과거 대화(Session)와 에이전트의 지침(Instructions)을 로드합니다.
3. **Reasoning:** LLM이 상황을 분석하고, 필요한 스킬(Description 참고)을 호출합니다.
4. **Action:** `logic.py`가 실행되어 외부 API 결과를 가져옵니다.
5. **Response:** 최종 답변을 Webhook을 통해 에이전트의 '이름'과 '사진'을 입혀 채널에 전송합니다.

---

## 6. 향후 확장 계획

* **Auto-Scheduling:** `scheduler/` 모듈을 추가하여 특정 시간대에 에이전트가 자율적으로 리포트를 생성하도록 구현.
* **Human-in-the-loop:** 민감한 스킬 실행 전 사용자의 승인을 대기하는 워크플로우 노드 추가.

---

이 설계안이 프로젝트의 든든한 이정표가 되길 바랍니다. 이제 이 구조를 바탕으로 **`DESCRIPTION.md`를 읽어오는 로더(Loader) 코드**부터 작성을 시작해 볼까요? 아니면 에이전트 간 협업 규칙(Workflow)을 더 구체화해 볼까요?