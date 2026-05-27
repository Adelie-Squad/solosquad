# P5. XYZ Hypothesis

> 검증 가능한 가설 형식. **`[X%] of [Y segment] will [Z behavior] within [T period], because [R rationale]`**

## 형식

```yaml
hypothesis:
  x_percent: "예: 80%"
  y_segment: "예: 신규 org 를 추가하는 founder"
  z_behavior: "예: 첫 messenger send 를 1회 시도 내 성공"
  t_period: "예: org 추가 후 5분 이내"
  r_rationale: "lazy-create 패턴 + post-add seed 가 wizard 와 동등한 보장 제공"

verification:
  method: "예: instrumentation 으로 add-repo → first-send 사이 retry 횟수 카운트"
  success_threshold: "first-try 성공률 ≥ 80%"
  measurement_window: "구현 후 30일"

confidence: 75   # 0-100, RO-PNA Confidence Score
```

## Anti-Sycophancy 강제

가설은 **입장 + 반증 조건**:

```yaml
position: "lazy-create 패턴 도입 시 80% 첫시도 성공"
falsification:
  # 무엇이 사실로 드러나면 입장 바뀜
  - "first-try 성공률 < 50% → 다른 root cause 존재 (예: discord API 권한)"
  - "성공률 100% 인데 사용자 보고 지속 → metric 정의 자체가 wrong proxy"
```

## ≥ 2 approaches 룰 (gstack 차용)

단일 가설 금지. 항상 최소 2개:

```yaml
hypotheses:
  - id: h1
    approach: "lazy-create on discord-adapter init"
    pros: ["기존 init flow 그대로 유지", "최소 변경"]
    cons: ["adapter 별로 중복 코드"]
  - id: h2
    approach: "add-repo CLI 에 config seed step 추가"
    pros: ["explicit", "단일 진입점"]
    cons: ["사용자가 add-repo 안 쓰는 path 존재"]
recommended: h1   # 또는 h2, 단 근거 명시
```

## V/U/V/F Assumption 분류 (phuryn 차용)

각 가설의 핵심 가정을 4 영역으로 분류:

- **V**alue — 사용자가 이 변화로 가치를 얻는가?
- **U**sability — 사용자가 이걸 발견/사용할 수 있나?
- **V**iability — 비즈니스 모델 / 운영 가능한가?
- **F**easibility — 기술적으로 구현 가능한가?

```yaml
assumptions:
  - "V: 사용자는 첫 시도 실패 시 시스템 abandon" (가장 위험)
  - "F: lazy-create 가 race condition 없이 가능"  (이미 검증됨)
  - "U: 에러 메시지 없이도 사용자가 시도 재개"  (검증 필요)
  - "V (모델): 추가 cost 없음"  (검증됨)
```

## 출력 예시

```markdown
## XYZ Hypothesis

**h1 (recommended)**: 80% of 신규 org founder 가 org 추가 후 5분 이내 첫 messenger send 1회 시도 내 성공, lazy-create 패턴이 wizard 와 동등한 보장 제공하기 때문.

**Falsification**:
- 1회 시도 성공률 < 50% → root cause 가 다른 곳 (e.g. discord API)
- 100% 성공인데 사용자 보고 계속 → metric 자체 wrong proxy

**Confidence**: 75

**V/U/V/F**:
- V (위험): 첫 실패 후 abandon 비율 미측정
- F (안전): lazy-create 단순
- U (검증 필요): silent success 시 사용자가 인지하나
- V 모델 (안전): cost neutral
```
