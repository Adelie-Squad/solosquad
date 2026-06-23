# 위임 그래프 무결성 (G1) — `agent validate --graph` 의 작성 가이드면

> actor frontmatter 는 **그래프**다. `collaborators`/`used_by`/`skills_used` 가 엣지, depth/budget 이
> 제약이다. 정적 검증으로 무한 위임·고아 참조·역할 사다리 붕괴를 막는다. 공통 frontmatter 원칙은
> `skill-core/core.md` §7, 여기는 **agent 고유 그래프 규칙**. 근거: 260618 Part G(G1)·E.2, CMA depth-1(B.6).

## 1. 참조 무결성
- `collaborators` · `used_by` 가 **실존 actor** 를 가리키나 — `<team>/<agent>` 로 해소(고아 참조 = FAIL).
- `skills_used` 가 **실존 skill** 을 가리키나 — skill 레지스트리 교차. (advisory **prefetch floor** — 선언분은
  항상 주입하되 화이트리스트 ceiling 으로는 안 씀: 선언 밖 skill 도 description 매칭으로 자유 사용.)

## 2. 순환 + depth (무한 위임 차단)
- **순환:** collaborator/위임 그래프에 사이클 없음 — workflow `depends_on` 과 **동일 Kahn O(V+E)**(공유 코어).
- **depth cap:** 위임 깊이 상한 강제. **1차 선례 — CMA coordinator depth 1(중첩 coordinator 금지)** 이 가장
  강함. 그 외 Claude Code subagent 5 · OpenAI 10 · LangGraph 25. SoloSquad 는 supervisor(Chief) 유지 +
  얕은 depth 지향 — coordinator-of-coordinators 금지.

## 3. 역할 사다리 정합
- `tier`(leader/member) ↔ `team` 정합 — leader 는 팀 supervisor, member 는 worker. 엇갈리면 FAIL.
- `name` — kebab-case · **부모 디렉터리명 일치** · 예약어(`claude`/`anthropic`) 금지(core.md §3 동형).

## 4. budget — narrower-only invariant (사전 표면화)
- `agent-profile.yaml` 의 turn/depth budget 은 **부모보다 넓어질 수 없다**(narrower-only). 현재 로드 시
  warning 만 → 작성 단계에서 **사전 표면화**(spawn 자식 상속은 guardrails.md §1).

## 5. 1차 정합 체크 (CMA agent config)
frontmatter 가 CMA agent config(`name`·`model`·`tools`·`mcp_servers`·`skills`·`multiagent`)로 **손실 없이
사상**되는가 — 1차 표준과의 호환을 작성 시 확인(마켓·hosted 이식 대비). roster ≤20 · 동시 thread ≤25 가 1차 한도.

## 6. 작성 체크
- [ ] 모든 `collaborators`/`used_by`/`skills_used` 가 실존 대상을 가리킨다.
- [ ] 위임 그래프에 순환이 없고 depth 가 얕다(coordinator 중첩 없음).
- [ ] `tier`↔`team` 가 맞고, budget 이 부모보다 넓지 않다.
- [ ] `solosquad agent validate --graph` green.
