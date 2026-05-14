# Handoff (Dynamic): {{from_agent}} → {{to_agent}}

<!--
v0.6 §2.4 — 동적 라우팅 패턴 (메시지 내용에 따라 다음 agent 결정).
예: content-writer가 brand-marketer 또는 paid-marketer로 분기.
기존 4섹션 + `routing_signal` (어떤 단어/지표가 다음 agent 결정에 영향) 추가.
-->

## Meta
- pattern: dynamic
- from: {{from_agent}}
- to: {{to_agent}}
- team: {{team_name}}
- project: {{project_id}}
- stage: {{stage_name}}
- created: {{YYYY-MM-DDTHH:mm:ss+09:00}}
- version: v{{version}}

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

## Routing Signal

<!--
다음 agent를 *선택하게 만든* 키워드·지표·맥락을 명시한다.
PM이 라우팅 결정을 검토하거나 자동 라우터가 신호 → agent 매핑을 학습하는 입력원.
-->

| 신호 종류 | 값 | 근거 |
|-----------|----|------|
| keyword   |    | (예: "유료 광고" → paid-marketer) |
| metric    |    | (예: CAC 임계 초과 → ... ) |
| context   |    | (예: 사용자 명시 요청) |

## Open Questions

<!-- 미해결 질문. 라우팅 결정과 무관한 잔여 항목 -->

- [ ]
- [ ]
