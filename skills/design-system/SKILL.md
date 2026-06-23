---
name: design-system
description: 디자인 시스템 — 토큰(color/type/spacing)·컴포넌트·일관성 규칙 정의·적용. one-off 지양, 토큰 기반. product-designer·creative-designer·frontend 가 활용.
schema_version: 2
tier: member
team: _skill
category: governance
used_by: ["product-designer", "creative-designer", "frontend"]
dev_capability: false
triggers:
  keyword: ["design system", "디자인 시스템", "토큰", "token", "컴포넌트", "design token", "스타일 가이드", "style guide"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Design System Skill

> 디자인 일관성의 단일 진실원. 토큰·컴포넌트·규칙. `product-designer`(제품 UI)·`creative-designer`(브랜드
> 비주얼)·`frontend`(구현)가 공유. (구 ui-designer 의 design-token 역량을 skill 로 추출, v2.0)

## 무엇을 산출하나
- **토큰:** color(semantic + scale)·typography(scale·weight·line-height)·spacing(base unit)·radius·elevation·motion.
- **컴포넌트 스펙:** 상태(default/hover/active/disabled)·variant·a11y(contrast/focus).
- **일관성 규칙:** one-off 금지(토큰 참조), naming convention, dark/light·responsive.

## 절차
1. 기존 토큰/컴포넌트 인벤토리 확인(중복·드리프트 탐지).
2. 신규/변경은 **토큰 우선** — 하드코딩 색·크기 금지.
3. 접근성 게이트: WCAG AA 대비, focus-visible, 키보드 내비.
4. frontend handoff: 토큰 → CSS 변수/테마 매핑 명시.

## Red Flags
- one-off hex/px 산재 · 토큰 없는 컴포넌트 · dark mode 누락 · contrast 미달.

## Reference
- v2.0 squad restructure (신규 governance skill, 구 ui-designer design-token 역량)
