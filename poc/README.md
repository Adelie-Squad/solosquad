# poc/

정식 기능이 되기 **전에** 아이디어를 손으로 만져보기 위한 데모 프로젝트 모음.

- 프로젝트 하나 = 디렉토리 하나 (`poc/<project>/`). 각자 독립된 `package.json`·빌드를 갖는다.
- 루트 `tsconfig.json`·테스트·npm 배포(`package.json.files`) 대상이 **아니다.**
- 각 프로젝트는 루트에 `PRD.md` 를 둔다 — 무엇을 검증하려는 데모인지, 무엇이 더미인지.
- 채택되면 PRD 를 `docs/prd/` 로 승격하고 본 코드베이스로 옮긴다. 버려지면 디렉토리째 지운다.

| 프로젝트 | 내용 | 스택 |
|---|---|---|
| [`ax-agent-web/`](./ax-agent-web/PRD.md) | 소규모 비즈니스용 AI 직원 '하루' 웹 인터페이스 (랜딩 + Arc 레이아웃 서비스 페이지) | TypeScript · React · Vite |
