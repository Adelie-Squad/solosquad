# Handoff (Graph): {{from_agent}} → {{to_agent}}

<!--
v0.6 §2.4 — 그래프 협업 패턴 (조건부 분기 + 공유 상태).
research ↔ planner ↔ data-analyst 처럼 양방향 루프가 gate 통과까지 반복되는 경우.
기존 4섹션 + `state_object_diff` (이전 핸드오프 대비 변경된 필드만) + `loop_count` 추가.
-->

## Meta
- pattern: graph
- from: {{from_agent}}
- to: {{to_agent}}
- team: {{team_name}}
- project: {{project_id}}
- stage: {{stage_name}}
- created: {{YYYY-MM-DDTHH:mm:ss+09:00}}
- version: v{{version}}
- loop_count: {{loop_count}}        <!-- 현재까지 누적된 루프 회수 (gate 통과 시 종료) -->

---

## Summary

<!-- 핵심 발견/결정 3줄 이내 요약 -->

1.
2.
3.

## Artifacts

<!-- 이 단계에서 생성한 산출물 파일 목록 -->

| 파일 | 설명 |
|------|------|
| `{{stage_name}}/` | |

## Key Decisions

<!-- 주요 결정 사항과 근거. 대안도 기록하여 맥락 전달 -->

| 결정 사항 | 근거 | 검토한 대안 |
|----------|------|-----------|
| | | |

## State Object Diff

<!--
공유 상태 객체에서 이전 핸드오프 대비 *바뀐 필드만* 적는다.
loop_count가 0(첫 핸드오프)이 아닐 때만 의미가 있다.
새로 채워진 필드는 `+`, 갱신된 값은 `~`, 삭제된 필드는 `-` 로 표시.
-->

```yaml
# state_object_diff
+ new_field_name: value           # added this round
~ existing_field: new_value       # updated (was: prior_value)
- removed_field: ~                # cleared this round
```

## Open Questions

<!-- 미해결 질문. 그래프 루프 다음 노드에서 해소되어야 할 항목 -->

- [ ]
- [ ]
