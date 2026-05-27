---
name: premortem
description: 출시 전 pre-mortem 분석. "이미 실패했다고 가정하고 원인 역추적." launch checklist + release notes draft 자동 생성.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["pm", "chief"]
dev_capability: false
triggers:
  keyword: ["premortem", "pre-mortem", "런치 전 점검", "launch checklist", "post-mortem"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 1
---

# Pre-Mortem Skill

> Tier-2 (v1.1.x slot). Gary Klein 의 pre-mortem 기법. 출시 전 마지막 sanity check.

## 진행 흐름

### 1. Time Travel
"6개월 후. 이 프로젝트는 *실패* 했다. 사용자는 떠났고, OKR 미달."

### 2. 실패 원인 brainstorm (≥10)
가능한 모든 실패 시나리오를 나열. positive thinking 자제, 비관적으로.

```yaml
failure_modes:
  - id: f1
    scenario: "사용자가 첫 사용 후 다시 안 옴"
    likelihood: high | medium | low
    impact: critical | major | minor
    detection_lag: "..."  # 얼마나 늦게 알게 되나
    early_signal: "..."   # 어떤 지표가 미리 알려주나
    mitigation:
      - "..."
```

### 3. 우선순위 매트릭스
- (likelihood × impact) 곱으로 정렬
- top 5 risk → 사전 mitigation 필수

### 4. Launch Checklist 도출

```markdown
## Launch Checklist — {{project}}

### Pre-launch (T-3d)
- [ ] qa-engineer regression test 통과
- [ ] security-engineer audit (auth/data 변경 시)
- [ ] policy-architect 검토 (정책 영향 시)
- [ ] data-analyst instrumentation 검증
- [ ] (premortem risks → 대응 완료 확인) × 5

### Launch (T-0)
- [ ] rollback plan 명시
- [ ] monitoring dashboard 준비
- [ ] support 응답 ready
- [ ] release notes 작성 완료

### Post-launch (T+24h)
- [ ] leading indicator 5 지표 확인
- [ ] guardrail metric 회귀 없는지
- [ ] 사용자 피드백 1-pass
- [ ] (premortem early signal 모니터링)
```

### 5. Release Notes Draft

```markdown
# {{Project}} — Release Notes

## TL;DR
{{1 line summary}}

## What's New
- ...

## Why
- {{problem this solves}}

## How to Use
- ...

## Known Limitations
- {{premortem 의 mitigated risks 일부 명시}}

## Feedback
- ...
```

## HARD GATE

```markdown
- [ ] failure modes ≥ 10 brainstorm
- [ ] top 5 risk 모두 mitigation 완료
- [ ] launch checklist 모든 항목 ✅
- [ ] release notes 작성 완료
- [ ] rollback plan 명시 + 실험
```

## Anti-Sycophancy

비관적 사고 강제:
- ❌ "출시 준비가 잘 되었습니다"
- ✅ "5 risk 중 3건 mitigated. risk #2 (적용 시 latency +200ms) 는 monitoring 만 완료. monitoring 발동 임계값 명시 필요."

## Reference

- Gary Klein "Performing a Project Premortem" (HBR)
- phuryn/pm-skills/pm-execution/{pre-mortem, release-notes}
