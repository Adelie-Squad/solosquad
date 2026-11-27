# agenxy — 로고 시안 1차 (초안, 2026-11-27)

> 마케팅 사이트의 공개 브랜드 'agenxy'(에이전시 — agency + x) 로고 **탐색 시안**. `skills/logo-design` 절차로 만들었다.
> 지금은 **체크포인트**: 방향을 고르기 전에는 키트를 만들지 않는다. 랜딩 헤더의 이름 교체(SoloSquad → agenxy)는 이 폴더 밖의 일이다.

**보기: [`board.html`](board.html)** (오프라인 단일 파일) · `board.png` · `board.pdf`

## 브리프 · 레퍼런스
- 요청: "chatcut, upstage, anything, e2b(얇게) 참고". 펭귄 없음. 단색 우선, 강조색은 DESIGN.md `--accent` #2867D0 하나.
- 레퍼런스는 e2b.dev 고객 로고 띠에서 **스타일만** 분석했다(보드에 말로 정리). 다른 회사의 로고 파일은 저장소에 넣지 않았다 —
  분석에 쓴 스크린샷은 로컬 `identity/_preview/agenxy-refs/reference-strip.png`(무시되는 폴더)에만 있다.

## 시안
| 안 | 무엇 | 파일 |
|---|---|---|
| A 열린 x (얇게) | 가운데를 비운 네 획의 x + 심볼 | `svg/a-wordmark.svg` · `a-wordmark-small.svg` · `a-symbol.svg` · `a-symbol-small.svg` · `a-horizontal.svg` |
| B 맞닿은 x · 사각 (얇게) | 넓은 둥근 사각 소문자, x = ')(' + 심볼 | `svg/b-*` (같은 구성) |
| C 건네는 xy (얇게) | x 가 다리를 건너 y 로 이어지는 합자 | `svg/c-wordmark.svg` · `c-wordmark-small.svg` |
| D 엇갈린 x (보통) | x 의 한 획이 아래로 지나감 | `svg/d-wordmark.svg` |
| 강조색 | x(또는 건네는 획)만 #2867D0 | `svg/colour/*-accent.svg` |

`-small` = 24px 아래(헤더 · 파비콘 옆 글자)에 쓰는 굵은 컷(획 ×1.5). 스케치 13개는 `sketch/`.

## 다시 만들기 (저장소 루트에서)
```sh
D=identity/_drafts/agenxy-logo; S=skills/logo-design/scripts
python3 $D/scripts/draw.py sketch        # sketch/
python3 $D/scripts/draw.py               # svg/ + svg/colour/
python3 $S/svg_audit.py $D/svg/*.svg $D/svg/colour/*.svg > $D/tests/svg-audit.txt
python3 $S/preview_sheet.py $D/svg/a-symbol.svg $D/svg/b-symbol.svg $D/svg/a-symbol-small.svg $D/svg/b-symbol-small.svg \
  --name agenxy --brand-color "#2867D0" --refs-generic 8 -o /tmp/agx-sym.html
python3 $S/preview_sheet.py $D/svg/a-wordmark.svg $D/svg/b-wordmark.svg $D/svg/c-wordmark.svg $D/svg/d-wordmark.svg \
  --name agenxy --brand-color "#2867D0" --refs-generic 6 -o /tmp/agx-wm.html
python3 $S/render_png.py /tmp/agx-sym.html -o $D/tests/symbols-test.png --width 1400 --height 5000
python3 $S/render_png.py /tmp/agx-wm.html -o $D/tests/wordmarks-test.png --width 1400 --height 5600
python3 $D/scripts/build_board.py 4260   # board.html/png/pdf
```
`scripts/pen.py` · `geom.py` 는 `identity/_drafts/jesl-logo/scripts/` 에서 복사(둥근 선 → 외곽선). `letters.py` 가 직접 그린 소문자.

## 2차 — A · D 디벨롭 + 추가 펭귄 (board-2)
**보기: [`board-2.html`](board-2.html)** · `board-2.png` · `board-2.pdf`

이름의 뜻: 에이전트(agent)들이 모여 에이전시(agency) + AX(AI 전환) → agen·x·y, x 가 AX.

| 안 | 무엇 | 파일 |
|---|---|---|
| D1 엇갈린 x | 워드마크 안의 x 가 심볼, 따로 쓰면 그 x | `svg/r2-d1-wordmark.svg` · `-wordmark-small.svg` · `-point.svg` |
| D2 걷는 x | x 의 한 획 + 머리 = 걷는 에이전트 | `svg/r2-d2-*` |
| D3 핵이 있는 x | 네 획이 가운데 핵(AX)에서 멈춤 | `svg/r2-d3-*` |
| A1 모이는 넷 | 머리 + 몸 넷이 가운데로 — 꼴이 x | `svg/r2-a1-symbol.svg` · `-symbol-small.svg` · `-horizontal.svg` (+ `svg/r2-a-wordmark*.svg`) |
| A2 머리를 맞댄 넷 | 머리 넷이 가운데, 몸이 x | `svg/r2-a2-*` |
| A3 한 점을 둘러싼 넷 | 위에서 본 넷이 한 점을 둘러쌈 | `svg/r2-a3-*` |
| P1 펭귄 a (추가) | a 의 그릇에 눈 둘 + 마름모 부리 | `svg/r2-p1-*` |
| P2 펭귄 마크 (추가) | 검은 몸 + 흰 앞판 음각 + 눈 + 부리 | `svg/r2-p2-*` · 볼 색 변형 `svg/colour/r2-p2-symbol-cheek.svg`(DESIGN.md 예외 필요) |
| P3 부리 x (추가) | x 의 네 획이 마름모 부리에서 만남 | `svg/r2-p3-*` |

스케치 `sketch-2/`: 바람개비(a4)는 卍 꼴 위험으로 탈락. 부리는 로고용으로 45° 마름모로 단순화(캐릭터는 아랫부리가 조금 더 김).
```sh
python3 $D/scripts/draw_round2.py sketch && python3 $D/scripts/draw_round2.py
python3 $D/scripts/build_board2.py 7880
```

## 테스트 · 남은 일
- svg_audit FAIL · WARN 0. 얇은 워드마크는 24px 이상에서 깨끗, 그 아래는 `-small` 컷. 심볼 A · B 는 16px 유지.
- 상표 조사 안 함 — 'agenxy' 문자 · 도형을 KIPRIS · USPTO(9 · 35 · 42류)에서 확인. AI 보조 탐색본, 최종본은 사람이 다듬은 벡터.
