# 위임 가드레일 (G4) — budget 상속·circuit breaker·HITL·출력 검증

> spawn 은 비용·side-effect·연쇄오류의 원천이다. 작성 단계에서 **자식이 한도를 물려받고, 비가역 액션엔
> 사람이 끼고, downstream 전에 출력을 검증**하도록 설계한다. 근거: 260618 Part G(G4)·E.3·E.4, CMA
> permission policy(B.6), LangGraph SubAgentMiddleware 반면교사.

## 1. budget 자식 상속 (대표 함정)
- Chief→specialist spawn 시 **turn/depth budget 을 자식에 명시적 상속.** LangGraph SubAgentMiddleware 버그
  (한도가 자식에 미전파)가 자체 harness 의 직접 리스크 — *상속을 빠뜨리면 자식이 무한 루프*.
- budget 은 **narrower-only**(자식이 부모보다 넓어질 수 없음, delegation-graph.md §4와 합류).

## 2. circuit breaker
- **연속 실패 trip** — 같은 자식이 반복 실패하면 차단(escalation). 무한 재시도 금지(orchestrator "max N attempts").

## 3. 비가역 액션 HITL (permission policy)
- push·배포·외부 전송 등 **비가역 액션엔 사람 승인 게이트.** side-effect 는 **승인 *이후***(idempotent).
- **MCP deny-by-default** — 신규 MCP 툴은 `always_ask`(CMA 1차 기본: agent toolset=always_allow,
  MCP toolset=always_ask). agent 자체 툴만 자동 허용, 외부 연동은 확인 강제.

## 4. cascading error 방어
- **downstream 전달 전 출력 schema 검증** — 깨진 출력이 다음 actor 로 전파되면 연쇄 실패(arXiv "Spark to Fire").
- 자식 출력이 계약(기대 형식)을 벗어나면 통과시키지 말고 재시도/escalation.

## 5. 작성 체크
- [ ] spawn 설계에 turn/depth budget 자식 상속이 명시됐다(narrower-only).
- [ ] 비가역 액션에 HITL 게이트가 있고 side-effect 가 승인 이후다.
- [ ] 신규 MCP 툴이 deny-by-default(always_ask)다.
- [ ] downstream 전달 전 출력 검증 + circuit breaker 가 있다.
