---
name: wbs-decomposition
description: 마일스톤 → WBS (Work Breakdown Structure) 분해. PM 핵심 산출물. team OKR 의 KR 을 분기→주→일 단위 작업으로 변환. dependency graph + critical path 식별.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["pm"]
dev_capability: false
triggers:
  keyword:
    - "wbs"
    - "마일스톤"
    - "일정"
    - "schedule"
    - "decomposition"
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: false
  minimum_approaches: 1
---

# WBS Decomposition Skill

> PM 의 마일스톤/WBS 의사결정 영역 (Chief OKR 결정과 분리).

## 입력

- team OKR (특히 KR)
- `prd-writer` §6 Solution (recommended approach)
- `hypothesis-design` recommended hypothesis

## 분해 3단계

```
Level 1: Milestone (분기 ~ 월)
  Level 2: Workstream (주)
    Level 3: Task (일)
```

## 형식

```yaml
milestones:
  - id: m1
    title: "lazy-create 패턴 도입"
    target_date: "2026-06-14"   # YYYY-MM-DD
    okr_kr_ref: "Q2-KR2"
    exit_criteria:
      - "discord-adapter 가 config 없을 때 자동 생성"
      - "qa-engineer test 통과"
    workstreams:
      - id: m1.w1
        title: "discord-adapter lazy-create"
        owner_specialist: "backend-engineer"
        target_date: "2026-06-07"
        tasks:
          - { id: "m1.w1.t1", title: "loadOrEmpty + mkdir 헬퍼", estimate: "2h", depends_on: [] }
          - { id: "m1.w1.t2", title: "config.yaml schema validation", estimate: "1h", depends_on: ["m1.w1.t1"] }
          - { id: "m1.w1.t3", title: "test 작성", estimate: "1h", depends_on: ["m1.w1.t1"] }
      - id: m1.w2
        title: "add-repo CLI seed"
        owner_specialist: "fde"
        ...

dependency_graph:
  # 의존성 시각화 (graphviz dot 또는 mermaid)
  - "m1.w1 → m1.w2"
  - "m1.w2 → m2"

critical_path:
  - "m1.w1.t1 → m1.w1.t2 → m1.w1.t3 → m1.w2 → m2"
  total_estimate: "4 weeks"
```

## HARD GATE: WBS 완료 조건

- [ ] 모든 milestone 에 target_date + exit_criteria 명시
- [ ] 모든 task 에 estimate + owner_specialist 명시
- [ ] dependency_graph cycle 없음
- [ ] critical_path 식별
- [ ] team OKR 의 KR 과 milestone 의 1:N 매핑 확인

## 입력 → 출력 흐름

```
PM 호출 wbs-decomposition({
  okr: <team OKR>,
  solution: <prd §6.recommended>,
  hypothesis: <hypothesis-design.recommended>
})

→ {
  milestones: [...],
  dependency_graph: [...],
  critical_path: [...],
  total_estimate: "...",
  open_questions: [
    // capacity 미확인 (e.g. backend-engineer 가용 시간)
    // priority tie-break 필요
  ]
}
```

## Anti-Sycophancy

- ❌ "약 4주 정도 걸릴 것 같습니다"
- ✅ "Critical path 추정 4주. backend-engineer task throughput 가정 5h/day. 가정 깨지면 6주."

## Reference

- IEEE 1490 (PMBOK) WBS 원칙
- phuryn/pm-skills/pm-execution/outcome-roadmap
- v1.1 PRD §6.4 (PM 마일스톤/WBS 권한)
