# Production — 최적화 · 외곽선 · 내보내기 (SoloSquad 작성)

키트 단계(Phase 7)에서만 쓴다. 콘셉트 단계에서는 `render_png.py` 로 보는 것으로 충분하다.

## 1. 마스터 규칙
- 마스터 SVG = 경로만: `<text>` 없음(글자는 외곽선), 래스터·필터·마스크 없음, 획은 면으로 확장, `viewBox` 필수.
- 같은 그림을 SVGO 전·후로 `svg_audit.py` 에 넣어 경고 차이가 없는지 확인한다(최적화가 모양을 바꾸면 안 된다).

## 2. SVGO (viewBox 유지)
```bash
npx --yes svgo@4.0.0 --config <skill>/scripts/svgo.config.mjs master.svg -o master.min.svg
npx --yes svgo@4.0.0 --config <skill>/scripts/svgo.config.mjs -f masters/ -o dist/svg/   # 폴더 전체
```
- 버전을 고정한다(`svgo@4.0.0`). 4.x 의 preset-default 는 `removeViewBox`·`removeTitle` 을 켜지 않는다. 3.x 를 써야 한다면
  config 의 overrides 에 `removeViewBox: false` 를 직접 넣는다 — 빠뜨리면 viewBox 가 지워져 크기 조절이 깨진다.
- `removeDimensions` 는 width/height 를 지우고 viewBox 만 남긴다(웹에서 CSS 로 크기 지정).
- 결과에 `viewBox=` 가 있는지 `grep -L viewBox dist/svg/*.svg` 로 확인(출력이 없어야 한다).

## 3. Inkscape CLI (1.x) — 글자→경로, PNG/PDF
Inkscape 는 사용자가 설치했을 때만(제품 의존성 아님). 1.0 이후 명령 형식:
```bash
# 글자를 외곽선으로 (폰트가 설치된 기계에서 한 번) — 결과에는 <text> 가 없어야 한다
inkscape lockup-text.svg --export-text-to-path --export-plain-svg --export-filename=lockup.svg
# 필요하면 획도 면으로: 모든 객체 선택 → stroke-to-path
inkscape lockup.svg --actions="select-all:all;object-stroke-to-path;export-plain-svg;export-filename:lockup-filled.svg;export-do"

# PNG: 폭 기준(높이는 비율), 투명 배경
for w in 256 512 1024 2048; do
  inkscape symbol.svg --export-type=png --export-width=$w --export-filename=png/symbol-$w.png
done
inkscape lockup.svg --export-type=png --export-height=200 --export-filename=png/lockup-h200.png
inkscape symbol.svg --export-type=png --export-width=1024 --export-background="#FFFFFF" --export-background-opacity=1 --export-filename=png/symbol-1024-white.png

# PDF (인쇄 · 벡터 유지, 글자는 이미 경로)
inkscape lockup.svg --export-type=pdf --export-text-to-path --export-filename=pdf/lockup.pdf
# 여러 파일 한 번에
inkscape --export-type=png,pdf --export-width=1024 *.svg
```
- 권장 크기: 심볼 PNG 256/512/1024/2048, 가로 록업 높이 100/200/400, 파비콘·앱 아이콘은 `export_variants.py --web-icons`.
- CMYK 인쇄용 PDF 는 Inkscape 가 만들지 못한다(RGB PDF). 인쇄소가 CMYK/별색을 요구하면 사람이 Illustrator 등에서 변환 — 그 사실을 인수인계에 적는다.
- Inkscape 가 없으면 `render_png.py`(Chrome) 로 PNG, PDF 는 사용자의 도구로. 외곽선 변환이 안 되면 글자를 코드로 그린 경로를 쓴다.

## 4. 웹 아이콘
```bash
python3 <skill>/scripts/export_variants.py symbol.svg --title "Brand logo" --mono "#HEX" --icon-bg "#HEX" \
    --web-icons --favicon-source symbol-small.svg --out-dir dist/web
```
`favicon.ico`(16/32/48) · `favicon.svg` · `apple-touch-icon.png`(180) · `icon-192/512.png` · `maskable-512.png` ·
`site.webmanifest` · `head-snippet.html` 이 나온다. 16px 에서 무너지는 심볼은 단순화한 별도 그림(`--favicon-source`)을 그린다.

## 5. 넘기는 파일 묶음(키트)
`svg/`(색·검정·흰색·단색 × 심볼·가로·세로·워드마크) · `png/` · `pdf/` · `web/` · `guidelines.md`(여백·최소 크기·색 코드·금지 사례) ·
`HANDOVER.md`(콘셉트 근거·테스트 결과·사용 글꼴과 라이선스·상표 조사 권고·남은 일).
