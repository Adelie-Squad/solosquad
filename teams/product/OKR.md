# Product Team — OKR

> **분기 OKR 작성·갱신·평가는 Chief 의 의사결정 영역.** PM 은 이 OKR 을 입력으로 받아 마일스톤·WBS 로 분해한다.
> 본 파일은 workspace bundle template. `<org>/teams/product/OKR.md` 에 org-specific override 가능.

## 작성 형식

```markdown
## YYYY Q[N] — [한 줄 분기 테마]

### Objective 1 (정성)
"우리는 [추구하는 변화]를 달성한다."

#### Key Results (정량, ≥3)
- KR1: [지표 X] 를 [기준선] → [목표값] (측정 방법: ...)
- KR2: ...
- KR3: ...

### Objective 2
...
```

## 분기 평가 (Chief 가 분기말 수행)

- 각 KR 의 달성률 % 기록
- 미달성 KR 의 원인 분석 (data-analyst 호출)
- 다음 분기 OKR 으로 carry-over / pivot / drop 결정

## Default 빈 template

```markdown
## 2026 Q[?] — [테마]

### Objective 1
"..."

#### Key Results
- KR1: ...
- KR2: ...
- KR3: ...
```

## 작성 가이드 (Chief 호출 시 `skills/okr-writer` 사용)

- KR 은 **outcome metric** (행동/지표) 으로, output (산출물 개수) 으로 정의하지 않는다
- KR 은 measurable + time-bound
- Objective 는 정성, KR 은 정량
- 분기당 Objective ≤3, 각 Objective 당 KR ≤5
