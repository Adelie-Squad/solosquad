# Trend Record Index

> Trend Tracker 에이전트가 생성/갱신하는 트렌드 레코드의 메타 인덱스. 신규 레코드 추가 시 한 줄을 위로 삽입한다. **하단으로 갈수록 과거.**

| 일자 | 종류 | 주제 | 파일 |
|---|---|---|---|
| 2026-05-13 | Event Record | Tier 1 확장: paperclip / claw3d / Ralphathon (#8–#10) | [2026-05-13-tier1-expansion.md](./2026-05-13-tier1-expansion.md) |
| 2026-05-11 | Baseline Survey | 7개 레퍼런스 × 3축 진단 (최초 베이스라인) | [2026-05-11-baseline-survey.md](./2026-05-11-baseline-survey.md) |

---

## 레코드 종류 범례

| 종류 | 주기 | 트리거 |
|---|---|---|
| **Baseline Survey** | 분기 | Tier 1 전체 스냅샷, 다음 분기 기준선 |
| **Monthly Digest** | 월간 (말일) | 1개월 누적 신호 통합 |
| **Weekly Note** | 주간 (일 20:00 직전) | 변화 있을 때만 — 없으면 스킵 |
| **Event Record** | 비정기 | 메이저 릴리스 / 패러다임 변화 즉시 |

## Tier 1 추적 레퍼런스 (현행)

| # | 레퍼런스 | 카테고리 | 마지막 스캔 |
|---|---|---|---|
| 1 | Anthropic | 모델/하네스 | 2026-05-11 |
| 2 | OpenClaw | 하네스 | 2026-05-11 |
| 3 | Hermes (Nous Research) | 멀티에이전트 | 2026-05-11 |
| 4 | gstack (Garry Tan) | 멀티에이전트 | 2026-05-11 |
| 5 | phuryn/pm-skills | 멀티에이전트 | 2026-05-11 |
| 6 | karpathy/autoresearch | 24/7 자동화 | 2026-05-11 |
| 7 | MiroFish | 멀티에이전트 (관찰) | 2026-05-11 |
| 8 | paperclipai/paperclip | 멀티에이전트 / 24-7 | 2026-05-13 |
| 9 | iamlukethedev/claw3d | 멀티에이전트 (시각화) | 2026-05-13 |
| 10 | Ralphathon (해커톤 문화) | 24-7 자동화 | 2026-05-13 |

승격 규칙: Tier 2에서 2회 이상 의미있는 신호 관측 → Tier 1 승격 후보. **사용자 지정 즉시 승격 트랙도 허용** (2026-05-13 #8–#10 사례 — SKILL.md §1 보완 필요, 본 레코드 Open Questions 참조).
