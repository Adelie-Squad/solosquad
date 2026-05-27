# Amplitude Pattern — Natural Language → Query 변환

> Harness Report §7.5 권고 1 (Experiment Proposal) 의 실행 메커니즘. data-analyst 가 자연어 질문을 받아 Amplitude (또는 동등 product analytics) query 로 변환 → anomaly detection → significance check → 권고 자동 생성.

## 4-Step 자동화

### Step 1. 자연어 → Query

사용자/Chief 의 자연어 질문을 구조화된 query 로 변환:

```
입력: "지난 주에 retention 떨어졌는데 왜인지 알려줘"

→ Query intent:
  metric: D7_retention
  segment_by: [acquisition_channel, signup_date, plan_tier]
  time_window: last_7d vs prior_7d
  comparison: percentage_change
  threshold: |Δ| > 5%
```

### Step 2. Anomaly Detection

각 segment 의 metric 변화를 baseline 대비 비교:

```yaml
anomalies:
  - segment: { channel: "google_ads" }
    metric: D7_retention
    baseline_7d: 0.42
    current_7d: 0.28
    delta: -0.14
    delta_pct: -33%
    z_score: -2.8
    significance: yes
```

### Step 3. Significance Check

statistical significance (z-score, p-value) 검증:

- p < 0.01 → 강한 신호
- 0.01 ≤ p < 0.05 → 약한 신호
- p ≥ 0.05 → noise

표본 크기 부족시 (n < 100) → confidence 등급 hold:

```yaml
significance:
  z_score: -2.8
  p_value: 0.005
  sample_size: 247
  power: 0.81
  verdict: strong_signal
```

### Step 4. Recommend (Action Item)

자동 권고 생성:

```yaml
recommendation:
  action: investigate
  priority: high
  next_steps:
    - "google_ads channel 의 D7 retention -33% 확인 (n=247, p=0.005)"
    - "지난 7d google_ads 의 cohort quality 변화 확인 (UTM source / campaign)"
    - "performance-marketer 와 협업으로 traffic source 점검"
  estimated_effort: "1h investigation"
  related_artifacts:
    - "<org>/experiments/{exp-id}/" (해당 시)
```

## Chief 통합 흐름

```
[User → Chief] "retention 왜 떨어졌어?"
[Chief TRIAGE] discussion (60%) vs goal (40%)
[Chief DISPATCH] data-analyst, brief="retention drop investigation"
[data-analyst]
  → amplitude-pattern.md 의 4-step 실행
  → recommendation 산출
  → confidence_score 추가
[data-analyst → Chief]
[Chief SYNTHESIZE]
[Chief → User] "지난 7일 D7 retention -33% in google_ads. p=0.005. 점검 권고."
```

## Anti-Sycophancy 강제

- ❌ "retention 이 안 좋아요"
- ✅ "google_ads segment 의 D7 retention -33% (baseline 0.42 → 0.28, p=0.005, n=247). 단, organic search +5% 로 상쇄. 전체 retention 은 -8% (p=0.07, noise 가능)."

## 의존성

- Amplitude / Mixpanel / PostHog 중 하나 이상 setup
- 또는 자체 archive.sqlite + custom metric pipeline (default fallback)

## Reference

- Harness Report §7.5 권고 1 (Experiment Proposal)
- v1.1 PRD §14 (Leading Indicator)
- gstack `/retro` per-contributor breakdown
