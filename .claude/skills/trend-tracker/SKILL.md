---
name: trend-tracker
description: Track influential AI references and analyze trends across harness engineering, multi-agent, and 24/7 automation. Writes records to docs/trend-record/.
allowed-tools: WebSearch, WebFetch, Read, Write, Edit, Glob, Grep
---

# Trend Tracker

영향력 있는 AI 지식·프로젝트를 지속 추적하고, **하네스 엔지니어링 / 멀티 에이전트 / 24-7 자동화** 3축에서 통합 트렌드와 기술 구조를 분석한다. 산출물은 항상 `docs/trend-record/`에 누적된다.

## 1. Tier 1 추적 레퍼런스

웹 조사 시 항상 1차 출처(공식 GitHub, 공식 블로그, 논문)를 먼저 확인한다.

| # | 레퍼런스 | 카테고리 | 핵심 포커스 |
|---|---|---|---|
| 1 | Anthropic | 모델/하네스 | Claude, Claude Code, Agent SDK, prompt caching, harness engineering 공식 글 |
| 2 | OpenClaw | 하네스 | 자가 업데이트, 자연어 cron, 메신저 상주 |
| 3 | Hermes (Nous Research) | 멀티에이전트 | trajectory → skill 자동 요약, FTS5 메모리 |
| 4 | **garrytan/gstack** (사용자가 "harrytang"으로 칭한 것의 정정명) | 멀티에이전트 | Think→Plan→Build→Review→Test→Ship→Reflect 슬래시 체인 |
| 5 | phuryn/pm-skills | 멀티에이전트 | auto-load + slash 듀얼 트리거, PM 스킬 마켓플레이스 |
| 6 | karpathy/autoresearch | 24/7 자동화 | metric gate + git rollback 자율 루프 |
| 7 | MiroFish (CAMEL-AI OASIS) | 멀티에이전트 (관찰) | 1M 에이전트 swarm 시뮬레이션 |

Tier 2(월간 스캔): Anthropic/OpenAI/DeepMind 공식 블로그, GitHub trending(`agents` `claude-code` `multi-agent` 토픽), HN 1주 누적 상위(키워드: agent, harness, autonomous), X — karpathy / swyx / simonw / Anthropic researchers.

**승격 규칙**: Tier 2에서 2회 이상 의미 있는 신호 → Tier 1 승격 후보로 INDEX.md에 추기.

## 2. 분석 3축

- **하네스 엔지니어링**: 컨텍스트 윈도우 운영, 메모리 시스템, 도구 호출 패턴, 자가 진화, 슬래시/스킬 구조
- **멀티 에이전트**: 라우팅, 핸드오프 프로토콜, 공유 상태, 권한 경계, 협업 모델
- **24/7 자동화**: 크론/스케줄러, 신호 기반 트리거, 자율 의사결정 경계, human-in-the-loop 위치

각 신호를 **상/중/하/—** 로 평가. "—"는 해당 축과 무관하다는 명시 (공백 금지).

## 3. 실행 순서

1. **스캔**: 요청된 기간/대상에 대해 1차 출처 우선 WebSearch + WebFetch. 트위터 일회성 인용은 1차 출처로 다루지 말 것.
2. **신호 분류**: 릴리스 / 패턴 / 폐기·대체 / 컨센서스 변화 / 반례 중 어디에 해당하는지.
3. **3축 매핑**: 위 평가표 작성.
4. **SoloSquad 정합성**: 채택 가능성 `immediately / next-version / experimental / not-applicable` + 충돌 지점 + 통합 비용 + 제안 액션.
5. **레코드 작성**: `docs/trend-record/YYYY-MM-DD-{slug}.md` 신규 작성. 같은 날 여러 레코드면 `-2`, `-3` 접미사.
6. **INDEX.md 갱신**: 표 최상단(가장 위 = 가장 최근)에 한 줄 삽입. 하단으로 갈수록 과거.
7. **이전 가설 깨짐**: 과거 레코드를 덮어쓰지 말고 `## Update YYYY-MM-DD` 섹션으로 추기.

## 4. 레코드 스키마

```markdown
# YYYY-MM-DD — [주제]

## TL;DR
3줄 이내

## 신호
| 출처 | 신호 | 캡처 일시 |
|---|---|---|

## 3축 분석
### 하네스 엔지니어링
### 멀티 에이전트
### 24/7 자동화

## SoloSquad 정합성
| 채택 가능성 | 충돌 지점 | 통합 비용 | 제안 액션 |

## Open Questions
- [ ]

## 출처
```

## 5. Cadence

| 종류 | 주기 | 트리거 |
|---|---|---|
| Weekly Note | 일요일 20:00 직전 | 변화 있을 때만 — 없으면 스킵 |
| Monthly Digest | 매월 말일 | 1개월 누적 신호 통합 |
| Baseline Survey | 분기 말 | Tier 1 전체 스냅샷 |
| Event Record | 비정기 | 메이저 릴리스 / 패러다임 변화 즉시 |

## 6. Quality Checklist

- [ ] 모든 신호에 1차 출처 URL + 캡처 일시 기록
- [ ] 3축 모두 평가 (해당 없음도 — 명시)
- [ ] SoloSquad 정합성 4개 칸 모두 채움
- [ ] 추측을 사실로 표기하지 않음 (못 찾으면 "확인 안 됨")
- [ ] 이전 레코드 대비 차분(무엇이 바뀌었는가) 명시
- [ ] 새 레코드 작성 후 INDEX.md 갱신

## 7. Anti-patterns

- 트위터 인용을 1차 출처로 다루기
- 영향도 평가 없이 신호 나열만 하기
- Tier 2 1회 관측을 Tier 1로 즉시 승격
- "흥미롭다"로 끝나고 채택 결정 없음
- SoloSquad 정합성 누락 (관찰만 하고 우리에게 무슨 의미인지 안 쓰기)

## 8. 첫 베이스라인 참조

`docs/trend-record/2026-05-11-baseline-survey.md` — 7개 레퍼런스 × 3축 최초 스냅샷. 이후 모든 레코드는 이 베이스라인 대비 차분 형태.
