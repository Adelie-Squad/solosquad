# 역할 경계 (G2) — SRP·중첩 게이트·single-agent-first

> actor 의 가장 흔한 실패는 *역할 흐림*이다(MAST FM-1.2 role-spec 위반). 새 actor 가 기존과 겹치거나
> (re-skin), 한 actor 가 너무 많이 하거나(generalist 함정), description 이 위임 트리거로 약하면 — 자동
> 라우팅이 무너진다. 근거: 260618 Part G(G2)·C·D, Vercel Eve(B.5), CMA "single most valuable subagent first"(B.6).

## 1. SRP — 역할은 하나로 명확
- 한 actor = **하나의 명확한 책임.** "이 actor 가 무슨 일을 하나"에 한 문장으로 답 안 되면 분할 신호.
- **generalist 함정 회피** — "이것저것 다 하는" actor 는 라우팅도 품질도 약하다. specialist > generalist.

## 2. right altitude
- 너무 **brittle**(하드코딩된 단계 나열)도, 너무 **vague**(모호한 "잘 해줘")도 아닌 중간.
- 열린 작업 → "왜"+자유. 깨지기 쉽거나 파괴적 → 정확한 순서·낮은 자유도(primitive-core.md §3.4 처방강도 보정 동형).

## 3. 중첩 게이트 (anti-reskin, 정적)
- **8-word shingle 중복도** — 엔티티 중립화 후 신규 actor 의 description/본문이 기존 번들과 얼마나 겹치나.
  **FAIL ≥40% / WARN ≥20%**(agency-agents `check-agent-originality.sh` 이식). 행동 eval 없이 re-skin·역할중첩 탐지.
- 두 specialist 가 같은 일을 하면 = 통합 또는 한쪽 위임으로 해소.

## 4. single agent first; multiagent only when earned
- **항상 single agent 에서 출발**(one job, one context). 멀티에이전트는 *벌어졌을 때만*.
- **가장 값진 subagent 를 먼저** 만들고 **coordinator 는 나중**(launch-your-agent). coordinator-first 금지.
- 새 역할이 정말 필요한지 — `solosquad agent list` 로 기존 위임으로 풀 수 있으면 만들지 않는다.

## 5. description = 위임 트리거 (강제 계약)
- 부모(Chief/PM)는 description 으로 라우팅한다 — **위임 트리거로 충분히 구체적**이어야 한다.
  Vercel Eve 의 "subagent description = 컴파일러 강제 위임계약"을 차용 — 불충분하면 review FAIL(warning 아님).
- 공식·3인칭·non-goal·약간 pushy = primitive-core.md §3.2. 여기선 *"이 description 으로 자동 위임이 켜지나"* 가 합격선.

## 6. 작성 체크
- [ ] 역할이 한 문장 SRP 로 떨어진다(generalist 아님).
- [ ] 8-word shingle 중복 <20%(기존 번들과 re-skin 아님).
- [ ] description 이 위임 트리거로 충분(부모가 이걸로 라우팅 가능).
- [ ] 새로 만들기 전 `agent list` 로 기존 위임 가능성 확인했다.
