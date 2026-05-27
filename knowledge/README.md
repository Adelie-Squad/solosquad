# Workspace Knowledge (v1.1)

> Workspace-level knowledge — cross-agent, cross-team 가 공유하는 craft / 도메인 frameworks / 결정 기록. Layer 1 JIT context 의 입력.

본 디렉토리는 사용자가 자유롭게 markdown 파일을 추가하는 영역. agent / specialist / skill 어느 누구든 spawn 시 키워드 매칭으로 가장 관련성 높은 파일들이 컨텍스트에 inject 됨 (`src/util/paths.ts:getKnowledgeDir` 참조).

## 적합한 컨텐츠

- **Decision frameworks** — "우리는 X 결정할 때 Y 매트릭스 쓴다"
- **Glossary** — 도메인 용어 / 약어 / convention
- **Architecture patterns** — repeat-friendly 시스템 디자인 원칙
- **Brand voice principles** — content-writing skill 이 참조
- **Customer segments** — 누적된 customer 가설 (`<org>/domain/customers.md` 보다 일반적인 case)
- **Past decision logs** — 큰 결정의 근거 (post-mortem 결합)

## 부적합한 컨텐츠

- 한 agent 만 쓰는 craft → 해당 agent 의 SKILL.md
- 팀 단위 지식 → `teams/<team>/KNOWLEDGE.md`
- 분기 OKR → `teams/<team>/OKR.md`
- Org-specific 도메인 정보 → `<org>/domain/`
- 사용자 개인 정보 → `user/`

## 파일 컨벤션

- 파일명: kebab-case (예: `pricing-framework.md`, `customer-archetypes.md`)
- 길이: 각 ≤200줄 권장 (JIT 토큰 절약)
- 첫 줄: H1 제목, 다음에 1-2 문단 요약 (keyword matching 정확도 향상)

## v1.0.x → v1.1

본 디렉토리는 v1.0.x 의 `assets/knowledge/` 위치를 워크스페이스 루트로 승격. fresh install 시 init 이 `<bundle>/knowledge/` 의 starter 파일들을 `<workspace>/.solosquad/knowledge/` 로 복사.

## 작성 시작

자유롭게 markdown 파일을 추가하세요. Chief 가 새 파일을 발견하면 다음 spawn 부터 자동 사용합니다.
