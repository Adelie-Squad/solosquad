# 주식회사 제슬 (JESL) — 로고 시안 1차 (초안, 2026-11-25)

> SoloSquad 브랜드가 아니다. 사용자 회사 로고의 **탐색 시안**이며, `skills/logo-design` 절차로 만들었다.
> 지금은 **체크포인트**: 방향을 고르기 전에는 키트(색 확정 · 파비콘 · PNG/PDF 세트 · 가이드)를 만들지 않는다.

**보기: [`board.html`](board.html)** (오프라인 단일 파일) · `board.png` · `board.pdf`

## 브리프
- 뜻: 제 + 슬기(순우리말) — "자신의 슬기를 다하라".
- 가치: 구조적 장벽에 홀로 도전하는 기백 · 한계를 재정의하는 나만의 무기 · 옳은 방향으로의 뒷길을 열어 줌.
- 대상: 작은 AI 전환(AX) 회사의 고객 — AI 도입이 막막한 기업의 대표 · 실무자. 어조: 단단함 · 결기 · 영리함 · 조용한 자신감.
- 제외: 펭귄. 유료 AI 이미지 생성(Figma generate · Recraft 등) — 형태는 모두 코드로 그린 기하.

## 시안
| 안 | 패밀리 | 파일 |
|---|---|---|
| A1 뒷길 J (추천) | A 단독 심볼 + B 록업 | `svg/a1-symbol.svg` · `a1-horizontal-ko.svg` · `a1-horizontal-en.svg` · `a1-stacked.svg` |
| A2 쐐기 ㅈ | A + B | `svg/a2-symbol.svg` · `a2-horizontal-ko.svg` · `a2-horizontal-en.svg` · `a2-stacked.svg` |
| C1 제슬 — 선을 지나 길이 되는 획 | C 한글 워드마크 | `svg/c1-wordmark.svg` · `c1-stacked.svg` · `c1-symbol.svg`(작은 크기용 '슬') |
| C2 JESL — 뒤로 꺾고 앞으로 뻗기 | C 라틴 워드마크 | `svg/c2-wordmark.svg` · `c2-stacked.svg` · `c2-symbol.svg`(S 컷) |
| 공통 워드마크 | B 록업용 | `svg/wordmark-ko.svg` · `wordmark-en.svg`(JESL) · `wordmark-en-jeseul.svg` |
| 색 방향 2개 | 따로 제안 | `svg/colour/{a1,a2,c1}-{d1,d2}.svg` (D1 먹 · 주홍, D2 심록) |

스케치(`sketch/`): 1라운드 9개. a3(사각 ㄹ) · a4(엇갈린 두 벽)는 흔해서 탈락, a1 · a2 는 다듬어 위 시안으로.

## 다시 만들기
도구: Python 3 표준 라이브러리 + Chrome(PNG · PDF). 저장소 루트에서:
```sh
D=identity/_drafts/jesl-logo; S=skills/logo-design/scripts
python3 $D/scripts/sketch_symbols.py $D/sketch          # 1라운드 스케치
python3 $D/scripts/draw.py                              # 시안 SVG 전부 -> $D/svg/
python3 $D/scripts/colour.py                            # 색 방향 -> $D/svg/colour/
python3 $S/svg_audit.py $D/svg/*.svg > $D/tests/svg-audit.txt
python3 $S/preview_sheet.py $D/svg/a1-symbol.svg $D/svg/a2-symbol.svg $D/svg/c1-symbol.svg $D/svg/c2-symbol.svg \
  --names "A1 뒷길 J" "A2 쐐기 ㅈ" "C1 슬 (small cut)" "C2 S (small cut)" --name 제슬 --brand-color "#111111" \
  --refs-generic 8 -o $D/tests/symbols-test.html
python3 $S/preview_sheet.py $D/svg/c1-wordmark.svg $D/svg/c2-wordmark.svg $D/svg/a1-horizontal-ko.svg $D/svg/a2-horizontal-ko.svg \
  --names "C1 제슬 길" "C2 JESL" "B1 lockup" "B2 lockup" --name 제슬 --brand-color "#111111" --refs-generic 6 -o $D/tests/wordmarks-test.html
python3 $S/render_png.py $D/tests/symbols-test.html -o $D/tests/symbols-test.png --width 1400 --height 5200
python3 $S/render_png.py $D/tests/wordmarks-test.html -o $D/tests/wordmarks-test.png --width 1400 --height 5200
python3 $D/scripts/build_board.py 3960                  # board.html + board.png(높이 px) + board.pdf
```
- `scripts/geom.py` 기하 도구(사각 · 사선 획 · 1/4 고리 · 좌표 이동), `scripts/glyphs.py` 직접 그린 글자(제 · 슬 · J · E · S · L · U — 폰트 안 씀),
  `scripts/draw.py` 심볼과 록업, `scripts/build_board.py` 보드.
- 획이 맞닿는 곳은 한 외곽선(`path_stroke`)이거나 2 단위 겹치게 그려 이음새가 없다. 키트 단계에서 Inkscape/SVGO 로 합친다(`skills/logo-design/references/production.md`).

## 테스트 결과
- svg_audit: SVG 17개 모두 FAIL · WARN 0.
- 테스트 시트(`tests/`): A1 은 16px 에서도 J 음각이 남는다. A2 는 16px 에서 별표처럼 뭉칠 수 있다. C1 '슬' 컷은 24px 아래에서 뭉친다.
  거울 · 180° 회전에서 나쁜 독해는 찾지 못했다. 선반 테스트는 코드로 그린 일반 도형하고만 비교했다(실제 로고 파일 미사용).

## 남은 일 · 주의
- 상표 조사 안 함 — KIPRIS · USPTO 에서 '제슬' · 'JESL' · 'Jeseul' 문자와 도형을 9 · 35 · 42류 중심으로 확인(변리사).
- AI 보조 탐색본. 최종본은 사람이 다듬은 벡터로 확정한다(`skills/logo-design/references/rights.md`).
- 글꼴: 로고 글자는 모두 직접 그림. 브랜드 본문 서체 후보(OFL): Pretendard · Wanted Sans · SUIT.
