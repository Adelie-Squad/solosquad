# prototype/

정식 개발에 들어가기 **전에** 손으로 만져보며 시험하는 프로토타입 모음.
SoloSquad 의 에이전트 팀으로 만들고, SoloSquad 자체가 그 과정에서 함께 검증된다.

## 두 가지 용도

| 종류 | 무엇을 시험하나 | 다음 단계 |
|---|---|---|
| **feature** | SoloSquad 기능 — 정식 개발(`src/`) 전에 흐름·화면·계약을 먼저 돌려본다 | 채택 시 PRD 를 `docs/prd/` 로 승격하고 본 코드베이스에서 다시 만든다 |
| **client** | 고객사 PoC 의 리허설 — 소규모 비즈니스 AX 솔루션을 일반화된 시나리오로 먼저 만들어 본다 | 실제 고객사용 PoC 는 **비공개 리포**에서 만들고 Cloudflare 로 배포한다 |

> ⚠️ **이 리포는 공개(PUBLIC)다.** 실제 고객사 이름 · 요구사항 · 데이터를 여기 두지 않는다.
> client 프로토타입은 가상의 사업장(예: '모모 베이커리')과 더미 데이터로만 만든다.

## 에이전트 팀 활용

프로토타입 하나는 SoloSquad 의 기획 → 설계 → 구현 → 검증 흐름을 그대로 탄다.

- **기획** — `product-manager` 가 `prd` · `hypothesis-design` · `opportunity-tree` 스킬로 PRD 와 검증 가설을 쓴다
- **설계** — `product-designer` · `system-architect` 가 화면 흐름과 구조를 잡는다
- **구현** — `engineer` 아래 `frontend` · `backend` 가 만든다
- **검증** — `qa` 가 데모 시나리오를 돌리고, `retrospective` 로 무엇을 배웠는지 남긴다

이때 에이전트가 막히거나 돌아가는 지점은 SoloSquad 기능의 개선 거리로 기록한다(feature 백로그).

## 규칙

- 프로젝트 하나 = 디렉토리 하나 (`prototype/<project>/`). 각자 독립된 `package.json` · 빌드를 갖는다.
- 루트 `tsconfig.json` · 테스트 · npm 배포(`package.json.files`) 대상이 **아니다.**
- 각 프로젝트는 루트에 `PRD.md` 를 둔다 — 무엇을 검증하려는지, 무엇이 더미인지.
- 디자인은 루트 [`DESIGN.md`](../DESIGN.md)(SoloSquad 전체 — 정식 웹과 같은 기준)를 따른다. 프로젝트 전용
  `DESIGN.md` 가 있으면 **같은 제목의 섹션만** 덮어쓴다 — 자세한 규칙은 루트 문서의 '적용 규칙'.
- 버려지면 디렉토리째 지운다.

## 프로젝트

| 프로젝트 | 종류 | 내용 | 스택 |
|---|---|---|---|
| [`ax-agent-web/`](./ax-agent-web/PRD.md) | client | 소규모 비즈니스용 AI 직원 '하루' 웹 인터페이스 (랜딩 + Arc 레이아웃 서비스 페이지) | TypeScript · React · Vite |
