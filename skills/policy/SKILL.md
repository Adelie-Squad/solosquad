---
name: policy
description: 서비스 정책·약관·규제 설계 — ToS·개인정보·환불·AI 사용·콘텐츠 정책. 초안은 design doc 만(코드 변경 금지, Hard Gate). MECE 누락 검증. product-designer·product-manager 가 활용.
schema_version: 2
tier: member
team: _skill
category: governance
used_by: ["product-designer", "product-manager"]
dev_capability: false
triggers:
  keyword: ["정책", "약관", "tos", "privacy", "gdpr", "regulation", "compliance", "policy", "환불"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# Policy Skill

> 서비스 정책·약관·규제 설계. 구 `policy-architect` 의 정책 역량을 skill 로 추출(v2.0).
> **초안은 design doc 만, 코드 변경 금지.**

## 담당 범위
서비스 약관(ToS)/개인정보처리방침 · 환불·취소 · 데이터 처리(GDPR/CCPA/PIPA) · AI 사용 정책 · 콘텐츠/moderation.

## Hard Gate (핵심)
```markdown
- [ ] 정책 초안 = design doc(markdown), 코드 X
- [ ] 적용 시나리오 ≥3 mental sim (edge case 포함)
- [ ] 보안/데이터 영향 시 security 검토
- [ ] 수익 모델 영향 시 business-strategy 정합
- [ ] 사용자 명시적 ack 1회 ("이대로 게시하시겠어요?")
```

## MECE 분해 (누락 검증)
user_data: collection/usage/sharing/retention/deletion · ai_processing · cross_border · children · cookies/tracking.

## ≥2 approaches
엄격(opt-in 강제) vs 유연(opt-out+명시 link) 비교 + falsification.

## Anti-Sycophancy
- ❌ "정책이 잘 정리됨"
- ✅ "현재 초안은 X 영역 누락 위험. Y 흐름 추가 시 재검토."

## Reference
- 구 policy-architect 역량 추출 (v2.0 squad restructure)
- gstack Hard Gate · RO-PNA MECE
