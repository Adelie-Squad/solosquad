---
name: jobs-stories
description: Job Story + User Story (3C/INVEST) + Gherkin Acceptance Criteria 일괄 생성. product-designer 가 PRD 작성 시 호출.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["product-manager"]
dev_capability: false
triggers:
  keyword: ["job story", "user story", "유저스토리", "스토리", "acceptance criteria", "gherkin"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 1
---

# Jobs & Stories Skill

> Tier-2 (v1.1.x slot). PRD §6 Solution section 의 핵심 산출물.

## Job Story (Klement) — 상황 + 동기 + 결과

```
When [situation],
I want to [motivation],
So I can [expected outcome].
```

User Story 와 달리 *user role* 을 명시하지 않음 — 상황이 사용자를 정의.

## User Story (3C) — Card / Conversation / Confirmation

```
[Card]
As a [role],
I want to [action],
So that [benefit].

[Conversation]
- ...

[Confirmation = Acceptance Criteria]
- ...
```

### INVEST 체크 (필수)

- **I**ndependent — 다른 story 와 deploy 분리 가능
- **N**egotiable — 세부 협상 가능
- **V**aluable — 사용자 가치 명확
- **E**stimable — 효과 추정 가능
- **S**mall — 1 sprint 이내
- **T**estable — AC 측정 가능

## Gherkin Acceptance Criteria

```gherkin
Feature: [name]

  Scenario: [happy path]
    Given [precondition]
    When [action]
    Then [observable outcome]

  Scenario: [edge case]
    Given ...
    When ...
    Then ...
```

각 story 당 ≥2 scenario (happy + edge).

## HARD GATE

```markdown
- [ ] Job Story / User Story 양쪽 다 작성
- [ ] INVEST 6 check 모두 통과
- [ ] Gherkin scenario ≥ 2
- [ ] researcher 정합 확인 (flow 일치)
```

## Reference

- phuryn/pm-skills/pm-execution/{user-stories, job-stories}
- Mike Cohn (3C) / Bill Wake (INVEST) / Alan Klement (Job Stories)
