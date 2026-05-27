# P2. 5-Whys — Root Cause Chain

> P1.Q 에 대해 5단계 "왜?" 체인. 근본 원인 1문장으로 수렴.

## 형식

```markdown
**Why 1**: [P1.Q] → 왜냐하면 [원인 1]
**Why 2**: [원인 1] → 왜냐하면 [원인 2]
**Why 3**: [원인 2] → 왜냐하면 [원인 3]
**Why 4**: [원인 3] → 왜냐하면 [원인 4]
**Why 5**: [원인 4] → 왜냐하면 [근본 원인]

→ **근본 원인 (1문장)**: ...
```

## 5단계 못 채우는 경우

- 3단계 미만에서 막힘 → **데이터 부족**. open_question.append:
  ```json
  {
    "stage": "problem-definition.P2",
    "question": "Why-N 단계에서 X 가 사실인지 알아야 합니다",
    "blocking": true
  }
  ```
- 5단계가 너무 다양한 분기 → **MECE (P3) 로 분해 필요**. 가장 큰 분기 1개 선택 후 P3.

## Anti-Sycophancy

근본 원인 진술도 입장 + 반증:
- "근본 원인은 X 입니다. Y 가 사실로 확인되면 다른 원인 (Z) 으로 입장 바뀝니다."

## 출력 예시

```markdown
## 5-Whys

**Why 1**: 메신저 설정 오류 → wizard 가 config.yaml 을 자동 생성 안 함
**Why 2**: config.yaml 자동 생성 안 됨 → mkdir 누락 시 throw
**Why 3**: mkdir 누락 → discord 진입 시 lazy create 패턴 부재
**Why 4**: lazy create 패턴 부재 → 초기 init 만이 책임이라 가정
**Why 5**: init 만이 책임 가정 → 멀티 org 사례 미고려 (org N+1 추가 시 init 미실행)

**근본 원인**: 멀티-org 추가 시나리오에서 config 생성 책임이 init 에만 묶여 있음.
```
