---
name: logo-design
description: 로고·브랜드 마크 디자인 — 브리프 → 카테고리 관습 → 한 줄 콘셉트 8–12개 → 3개(또는 패밀리별) SVG 로 그리기 → 감사·테스트 시트(16px·단색·반전·눈 가늘게·거울·일반 도형 사이 비교) → 사용자 체크포인트에서 멈춤 → 승인 후에만 키트(록업·파비콘·앱 아이콘·매니페스트·PNG/PDF·가이드). 오픈소스 logo-design-skill(MIT, 고정 커밋 사본)의 무의존 Python 도구와 참고 노트(광학 보정·타이포·록업) 기반, 실제 로고 라이브러리는 제외. 사용 시점 — "로고 만들어줘", 워드마크·심볼·모노그램·CI/BI, 로고 시안·배리에이션, 로고 평가·리디자인, 파비콘·앱 아이콘을 로고에서 뽑을 때, 한글 워드마크. (제외 — 배너·광고 비주얼 등 캠페인 그래픽, 제품 UI 아이콘 세트)
schema_version: 2
tier: member
team: _skill
category: design
used_by: ["creative", "marketer"]
dev_capability: false
triggers:
  keyword: ["logo", "로고", "워드마크", "wordmark", "심볼 마크", "brand mark", "모노그램", "monogram", "CI", "BI", "favicon", "파비콘", "앱 아이콘", "logotype", "标志", "商标设计", "字标"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 3
---

# logo-design — 로고를 브리프에서 파일까지

> 업스트림 [kaankiziltug/logo-design-skill](https://github.com/kaankiziltug/logo-design-skill) 커밋 `e9eaddc` 를 고정해
> 흐름 · 스크립트 · 참고 노트를 옮기고 고쳤다(MIT, `LICENSE` · `NOTICE`). 무엇을 가져오고 뺐는지는 `UPSTREAM.md`.
> 업스트림의 실제 로고 1,400여 개 라이브러리는 상표라서 **넣지 않았다**.

로고는 **설명이 아니라 식별자**다: 16px 에서도, 간판에서도, 한 가지 색으로도 통하는 단순하고 구별되는 표시. 아이디어 하나를 찾고,
정확하게 그리고, 테스트로 증명하고, 맞는 기준으로 판단받게 보여 준다.

## 언제 쓰나
| 요청 | 모드 | 시작 |
|---|---|---|
| 새 로고 · 시안 · 배리에이션 | 디자인(아래 절차) | 1단계 |
| 로고 평가 | 비평 | `references/critique.md` |
| 기존 로고 다듬기 | 리디자인 | 자산(형태·색) 목록 → 1단계 |
| 심볼에서 파비콘·앱 아이콘·변형 | 내보내기 | `scripts/export_variants.py`, `references/production.md` |

배너·광고 비주얼은 이 skill 이 아니다(creative 기본 업무). 제품 안의 UI 아이콘 세트는 `product-designer`.

## 입력
- 이름(정확한 철자 · 한글/로마자), 하는 일, 대상, 브랜드 형용사 3–5개, 경쟁·비교 대상, 제약(색·기존 자산·쓰일 곳), 결정권자.
- 사용자가 준 뜻·가치(예: 이름의 어원)는 그대로 브리프에 옮긴다. 모르는 것은 질문 ≤5개 한 번에, 아니면 가정을 적고 진행.
- 금지 요소(예: "펭귄 빼고")는 브리프의 **제외** 줄에 적고 마지막 자체 검토에서 다시 확인한다.

## 절차
도구는 모두 의존성 없는 Python 3(`scripts/`): `python3 <skill>/scripts/<도구>.py`. Windows 는 `python`.

| 도구 | 용도 |
|---|---|
| `svg_audit.py` | 구조(viewBox·title·live text·래스터·필터) · 색 수 · 거의 맞는 각도 · 작은 디테일 · 중심 · 복잡도 검사 |
| `preview_sheet.py` | HTML 테스트 시트: 크기 사다리, 16/32/48px 픽셀, 배경, 단색·반전, 눈 가늘게(blur), 거울·180°, 파비콘·앱 아이콘·헤더·명함, 나란히 비교, `--refs-generic N` 일반 도형 사이 선반 테스트 |
| `concept_sheet.py` | 체크포인트용 한 장 개요(큰 마크 · 록업 · 실제 64/32/16px · 이름 · 한 줄 아이디어 · 추천) |
| `render_png.py` | SVG → PNG(투명), HTML 스크린샷, favicon.ico. 외부 참조가 있는 SVG 는 거부, Chrome 은 네트워크 차단 상태로 실행 |
| `presentation_board.py` | 발표 보드(브리프 · 콘셉트별 근거 · 업종 목업 · 비교 · 추천), `--png-dir` 슬라이드 PNG |
| `export_variants.py` | 검정·흰색·단색·정사각·파비콘·앱 아이콘 SVG, `--png`, `--web-icons`(ico·PNG 세트·webmanifest·head 스니펫) |
| `svgo.config.mjs` | 키트 단계 SVG 최적화(viewBox 유지) — `references/production.md` |

**그린 것은 반드시 본다.** SVG 코드는 눈 감고 그리는 것이다: `render_png.py a.svg b.svg --out-dir renders --size 512` 후 PNG 를 열어 확인.
렌더러가 없으면 그렇다고 말하고 기하를 더 단순하게 둔다.

1. **브리프**(`references/discovery-brief.md` §5): 뜻 · 가치 · 대상 · 형용사 · 제외 · 성공 기준 · 가정. 형용사가 가장 값진 입력이다.
2. **카테고리 관습**: 같은 업종 마크의 흔한 형태·색·기법을 **말로** 적고(다른 회사 로고 파일을 받거나 저장하지 않는다), 클리셰 목록을 만든다
   — 새 형태를 주지 못하면 금지. 단어 지도(이름·뜻·약속 → 명사·은유·반대말)로 교차점을 찾는다. 마크 유형 후보 ≥2(`references/mark-types.md`).
3. **콘셉트 8–12개, 한 문장씩**: 각자 소유할 만한 비틀기가 있어야 한다(경쟁사 로고도 설명할 수 있는 문장은 콘셉트가 아니다). 명확성·구별·단순·관련·작은 크기로
   빠르게 점수 → 가장 강하고 서로 다른 3개(요청이 패밀리별 배리에이션이면 패밀리마다 1–2개)만 그린다.
4. **SVG 로 그리기, 검정 먼저**(`references/svg-construction.md`): 구성을 말로 먼저(프리미티브·반경·각도·그리드 단위), 심볼은 `viewBox="0 0 256 256"`,
   록업은 높이 256. 고정 각도(0/15/30/45/60/90°), 일정한 획 두께·반경, 음각은 `fill-rule="evenodd"`. 완성본에 `<text>` 금지 — 글자는 경로로
   (직접 그리거나 OFL 글꼴 외곽선, `references/fonts-korean.md`). 반복마다 `-v1`, `-v2` 로 저장하고 덮어쓰지 않는다. 그리는 스크립트를 남긴다.
5. **테스트·수정(최소 두 바퀴)**:
   ```bash
   python3 scripts/svg_audit.py a.svg b.svg c.svg
   python3 scripts/preview_sheet.py a.svg b.svg c.svg --refs-generic 8 -o preview.html
   python3 scripts/render_png.py preview.html -o preview.png --width 1400 --height 4000
   ```
   광학 보정(오버슈트 1–3 %, 가로획 얇게, 광학 중심은 기하 중심보다 약간 위, 반전판은 얇게 — `references/visual-techniques.md`), 균형,
   거울·180° 의도치 않은 독해, 글자 테스트(고친 글자가 그 글자로 읽히나), 접합부(노치·틈·뭉침), 문자 그대로의 그림(제품을 그린 것)인지.
   전체 목록 `references/testing-checklist.md`.
6. **체크포인트 — 보여 주고 멈춘다.** 회색조 개요(`concept_sheet.py … --greyscale -o concepts.png`)를 직접 보고, 콘셉트당 한 줄 + 추천 + 정직한 위험
   1개씩, 그리고 키트 제안으로 끝낸다. **사용자 답 전에는 키트를 만들지 않는다.** 색은 이때 많아야 1–2 방향을 따로 제안.
7. **키트(승인 후에만)**: 고른 방향 다듬기(작은 크기 컷, 반전판), 색(`references/color.md`), 타이포·록업(가로·세로·심볼 단독·워드마크 단독, 상대 크기·간격 고정 —
   `references/typography.md` §5), 발표 보드(`presentation_board.py`, 예시 `templates/presentation-spec.example.json`), 내보내기·SVGO·Inkscape
   (`references/production.md`), 가이드(`templates/brand-guidelines-template.md`), 인수인계(근거·테스트 결과·글꼴 라이선스·상표 조사 권고).

체크포인트 메시지 형식:
```markdown
<개요 이미지>
### A — <이름> · <마크 유형>   ← 추천
**아이디어:** <한 문장>  **왜 맞나:** <브리프의 뜻·가치·형용사에 연결한 2–3줄>
### B — … / ### C — …
**추천:** <한두 문장 + 콘셉트별 위험 하나>
**다음:** 방향을 고르시면(또는 각각 좋은 점을 말씀하시면) 키트를 만들까요? <키트 내용 한 줄>
```

## 체크 (HARD GATE)
```markdown
- [ ] 브리프에 뜻·가치·제외 항목이 사용자 말 그대로 있고, 콘셉트마다 어느 가치를 형태로 옮겼는지 한 줄
- [ ] 마크 유형 ≥2 탐색, 그린 시안 ≥3, 서로 다른 아이디어
- [ ] 완성본 SVG: `<text>`·래스터·필터 없음, viewBox 있음 — svg_audit FAIL 0
- [ ] 16px · 단색 · 반전 · blur · 거울 테스트를 실제로 렌더해 보고 결과를 적음(못 했으면 못 했다고)
- [ ] 선반 테스트는 일반 도형(`--refs-generic`) 또는 사용자가 준 파일로만 — 실제 로고 파일을 받거나 저장하지 않음
- [ ] 글꼴은 OFL(또는 사용자가 라이선스를 확인한 것)만, 사용 글꼴·버전 기록
- [ ] 체크포인트에서 멈춤 — 키트는 사용자 승인 후
- [ ] 상표 조사(KIPRIS/USPTO, 9·35·42류 등)는 권고로만, "등록 가능" 단정 금지 — `references/rights.md`
- [ ] 유료 이미지 생성 AI 안 씀. 최종본은 사람이 다듬은 벡터라는 점을 인수인계에 적음
```

## 함정
- 클리셰 그대로(AI 회사 = 뇌·회로·반짝이, 컨설팅 = 위로 가는 화살표), 문자 그대로의 그림.
- 기본 굵기 기하 산세리프에 이니셜만 — 소유할 디테일이 없다.
- 캔버스의 1/48 보다 작은 디테일, 작은 크기에서 막히는 틈, 0.3–3° 어긋난 각도(실수로 읽힌다).
- 흰 도형을 덮어 만든 가짜 구멍 — 단색·사진 배경에서 얼룩이 된다(`fill-rule="evenodd"` 로 진짜 구멍).
- 기존 로고와 닮음: 익숙하게 느껴지는데 내 것이 아니면 남의 것이다. 업스트림 갤러리·라이브러리도 참고 대상이 아니다.
- 한글: 받침 있는 글자와 없는 글자의 초성 높이를 같게 두기, 가로획을 세로획과 같은 두께로 두기(`references/fonts-korean.md` §3).
- 체크포인트를 건너뛰고 키트까지 만들기 — 고르지 않은 방향에 일이 다 들어간다.

## 참고 지도
| 파일 | 언제 |
|---|---|
| `references/principles.md` | 판단 근거, 의견 충돌 |
| `references/discovery-brief.md` | 질문, 브리프 틀, 단어 지도 |
| `references/mark-types.md` | 마크 유형 고르기 |
| `references/visual-techniques.md` | 기하·그리드·균형·**광학 보정**·음각 |
| `references/typography.md` | 글자 고르기·커스텀 글자·간격·**록업** |
| `references/fonts-korean.md` | OFL 글꼴, 한글 워드마크, 로마자 표기 |
| `references/color.md` | 팔레트·재현·접근성 |
| `references/svg-construction.md` | 깨끗한 SVG 쓰는 법 |
| `references/testing-checklist.md` | 보여 주기 전 테스트 전부 |
| `references/critique.md` | 로고 비평 점수표 |
| `references/production.md` | SVGO · Inkscape CLI · 웹 아이콘 · 키트 묶음 |
| `references/rights.md` | 상표 조사, AI 출력 권리 |

## 출처
- kaankiziltug/logo-design-skill (MIT, © 2026 kaankiziltug), 커밋 e9eaddc07895575253d6663320354a708f53e955 — `scripts/*.py` 와
  `references/` 의 영어 노트 9개, `templates/` 는 업스트림을 고친 사본(변경 내역 `UPSTREAM.md`). 이 SKILL.md, `references/production.md` ·
  `fonts-korean.md` · `rights.md`, `scripts/svgo.config.mjs` 는 SoloSquad 작성.
- 업스트림 `assets/library/`(실제 로고 1,432개)는 `TRADEMARKS.md` 에 따라 MIT 대상이 아니므로 제외. `svg_audit.py` 에는 그 라이브러리에서 잰 앵커 수 백분위 숫자만 남겼다.
