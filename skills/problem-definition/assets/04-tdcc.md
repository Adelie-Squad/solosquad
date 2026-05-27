# P4. TDCC — 5필드 매핑

> **T**railing indicator (후행지표), **D**ownstream problem (선행문제, 3개), **C**ustomer opportunity (기회), **C**ausal link (인과), **Unknown** (미지)

원본 명명: 토스 TDCC 프레임워크 (RO-PNA 변형).

## 5 필드

```yaml
trailing_indicator:
  # 후행지표 — 결과로 나타나는 측정값
  metric: "예: 신규 org config 오류율"
  baseline: "현재 값"
  target: "목표 값"

downstream_problems:
  # P3 의 선행 문제 (Leading) 3개
  - "(2.1) lazy-create 부재"
  - "(2.2) add-repo CLI seed 미실행"
  - "(2.3) migration 자동 생성 미흡"

customer_opportunity:
  # 사용자 측에서 어떤 가치를 얻을 수 있나
  description: "neue org 추가 시 config 자동 생성 → 즉시 messaging 가능"
  size: "small | medium | large"

causal_link:
  # 선행 → 후행 인과 사슬
  chain: "(2.x) → wizard 가 mkdir 누락 → discord init throw → 사용자 보고"

unknown:
  # 답할 수 없는 항목 — open_question 으로 escalate
  - "이전 release 에 같은 case 가 있었는데 왜 보고가 안 됐나?"
  - "사용자가 config 수동 작성 시도 했나?"
```

## 미지 필드 처리

각 unknown 항목을 `open_questions[]` 에 append:

```json
{
  "id": "q-tdcc-unknown-1",
  "stage": "problem-definition.P4",
  "type": "data_request",
  "question": "이전 release 에 동일 case 가 있었는지 archive 에서 확인 필요",
  "context": "P4 TDCC unknown 항목",
  "blocking": false
}
```

## HARD GATE

- [ ] 5 필드 모두 채움 (또는 unknown 으로 escalate)
- [ ] causal_link 가 P3 선행 문제와 1:1 정합
- [ ] trailing_indicator 가 측정 가능 (baseline + target 명시)

미달성 시 → 다음 phase (P5 XYZ) 진입 차단.
