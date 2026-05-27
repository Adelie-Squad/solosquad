# SJT (Situational Judgment Test) 7-Q — 사용자 사고 성향 진단

> RO-PNA/pna-builders 차용. idea-scoper 가 첫 인터랙션 시 옵션으로 호출 가능. founder 의 thinking style 을 4 유형으로 분류 (Primary + Complementary).

**사용 원칙**: opt-in 만. 강제하지 않음. Chief 가 사용자에게 "사고 성향 진단을 해보시겠어요? 약 2분 소요됩니다" 동의받은 후 진행.

## 4 사고 유형

| 유형 | 핵심 질문 | 정합 specialist |
|---|---|---|
| **A. 고객 발견형** | "고객은 지금 무엇을 경험하는가?" | researcher, pmf-planner (JTBD) |
| **B. 구조 분해형** | "빠짐없이 쪼개면 핵심은?" | policy-architect (MECE), feature-planner (Logic Tree) |
| **C. 원인 추적형** | "왜? 근본 원인은?" | pmf-planner (5-Whys), data-analyst (TDCC) |
| **D. 가설 실험형** | "검증 가능한 가설은?" | hypothesis-design, experiment-design |

## 7 질문

각 질문은 4 보기, 각 보기가 A/B/C/D 1개에 1점. 가장 끌리는 보기 1개 선택.

### Q1. 새 제품을 만들 때 가장 먼저 하는 일은?

- (A) 잠재 고객 5명과 점심 먹으며 그들의 일상 듣기
- (B) 시장 / 기술 / 경쟁사 영역을 mind map 으로 분해
- (C) 비슷한 제품이 왜 실패했는지 사례 분석
- (D) 작은 prototype 만들어 빠르게 테스트

### Q2. 사용자 N=10 인터뷰 결과를 받았다. 다음 단계는?

- (A) 추가로 다른 segment 의 N=10 인터뷰
- (B) JTBD / 페르소나 / journey map 으로 정리
- (C) "왜 이 패턴이 나타났을까" 가설 list 작성
- (D) 인터뷰 결과로 즉시 검증 가능한 실험 design

### Q3. 동료가 "X 기능 만들자" 라고 제안. 가장 자연스러운 반응?

- (A) "사용자가 X 를 왜 원할까? 누구한테 들었어?"
- (B) "X 가 어디에 속하는 기능이야? 우리 사이트맵에 박스 어디?"
- (C) "X 안 만들면 무슨 문제가 생기는데?"
- (D) "X 의 가치를 어떻게 측정할 수 있어?"

### Q4. 지표가 갑자기 떨어졌다. 가장 먼저?

- (A) 사용자 1명 전화해서 무슨 일이냐고 묻기
- (B) 어떤 cohort / segment / channel 에서 떨어졌는지 break down
- (C) "왜?" 를 5번 반복하며 root cause chain 그리기
- (D) 가설 list + 각 가설 검증 실험 design

### Q5. 가장 자주 쓰는 도구 / 프레임워크?

- (A) JTBD, Mom Test, persona
- (B) Logic Tree, MECE, MoSCoW
- (C) 5-Whys, fishbone, TDCC
- (D) Lean Canvas, A/B test, fake door

### Q6. 회의에서 가장 자주 하는 발언?

- (A) "사용자한테 직접 물어봤어?"
- (B) "이거 더 잘게 쪼개보자"
- (C) "근본 원인이 뭘까?"
- (D) "이걸 어떻게 검증하지?"

### Q7. 일이 안 풀릴 때 위안이 되는 정보는?

- (A) 비슷한 고민하는 사용자가 있다는 evidence
- (B) 문제 영역의 완전한 지도
- (C) "그래서 왜 안 풀리는지" 를 알게 되는 것
- (D) 작은 win 1개라도 측정으로 확인

## 채점

```python
score = {"A": 0, "B": 0, "C": 0, "D": 0}
# 7개 응답을 각 유형에 +1
primary = top1
complementary = top2 (점수 차이 ≥1)
```

## 결과 활용

| Primary | idea-scoper 가 사용자 응답 처리 시 우선 호출 |
|---|---|
| A | researcher → pmf-planner → discovery-synthesis |
| B | policy-architect (MECE) → feature-planner |
| C | pmf-planner (5-Whys) → data-analyst (TDCC) |
| D | hypothesis-design → experiment-design |

`<org>/memory/founder-thinking-style.json` 에 저장:

```json
{
  "primary": "A",
  "complementary": "C",
  "scores": { "A": 4, "B": 1, "C": 2, "D": 0 },
  "completed_at": "ISO 8601"
}
```

→ 이후 모든 dispatch 에서 Chief 가 이 정보를 routing hint 로 사용. PM/specialist 의 출력 톤도 사용자 사고 성향에 맞춤.

## Reference

- RO-PNA/pna-builders systemPrompt.ts (원본 7문항 변형)
- v1.1 PRD §6.4 (idea-scoper 보강)
