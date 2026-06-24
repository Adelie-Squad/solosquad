# Leading Indicator (v1.1 schedule)

> 매일 1회 실행 (cron 기본: 사용자 timezone 09:30, 다른 schedule 과 충돌 방지). 5 지표를 계산해 `<org>/memory/leading-indicators.jsonl` 에 한 줄 append.

본 schedule 은 PM 의 가설 진척과 Chief 의 자가학습 루프에 입력 데이터를 공급. 결과는 Chief 의 RETROSPECT(작업 완료 회고 → 루프 엔지니어링)가 7일 평균으로 사용자에게 보고.

## 측정 5 지표

| # | 지표 | 정의 | 데이터 소스 |
|---|---|---|---|
| 1 | **conversion_to_task_rate** | 사용자 메시지 N건 중 workflow/goal 으로 발전된 비율 | `<org>/memory/chief-stage-events.jsonl` |
| 2 | **auto_pr_success_rate** | engineer/architect 가 만든 PR 중 mergeable 비율 | `<org>/memory/ledger/` + git log |
| 3 | **autonomous_goal_cycles** | 사용자 개입 없이 완료된 goal 수 (지난 7d) | `<org>/goals/<id>/` |
| 4 | **shipping_streak_days** | 연속 release 일수 | git tag (release 패턴) |
| 5 | **avg_confidence_score** | PM 가설 confidence 평균 (지난 7d) | `<org>/memory/open-questions/<id>.json` |

## 실행 절차

1. 지난 24시간 + 지난 7일 두 window 모두 계산
2. 각 지표를 `data-analyst` specialist 호출로 산출 (Confidence Score 모델 적용)
3. 결과를 다음 형식으로 jsonl 한 줄 append:

```json
{
  "ts": "ISO 8601",
  "window_1d": {
    "conversion_to_task_rate": 0.0,
    "auto_pr_success_rate": 0.0,
    "autonomous_goal_cycles": 0,
    "shipping_streak_days": 0,
    "avg_confidence_score": 0
  },
  "window_7d": { "...": "..." },
  "evidence_refs": ["..."]
}
```

4. Threshold 위반 시 Chief 에게 alert (예: shipping_streak < 7일 → yellow, conversion < 30% → red)

## Anti-Sycophancy

수치는 항상 baseline + delta + 신뢰구간:
- ❌ "지표가 좋아 보입니다"
- ✅ "conversion 42% (+3pp WoW). 표본 N=18. p=0.21 으로 noise 가능."

## Reference

- v1.1 PRD §14 (Leading Indicator)
- gstack shipping streak
- RO-PNA Confidence Score
