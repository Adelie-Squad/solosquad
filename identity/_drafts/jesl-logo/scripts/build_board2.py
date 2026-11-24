"""Board for round 2 ("but why" mood): board-2.html (+ board-2.png, board-2.pdf).

    python3 identity/_drafts/jesl-logo/scripts/build_board2.py [png-height]

Same cells as round 1 (build_board.option); keeps A1 from round 1 for comparison. Reads svg/ from
draw.py + draw_round2.py and svg/colour/ from colour.py + draw_round2.py.
"""

from __future__ import annotations

import html
import sys

import build_board as B

OPTIONS = [
    {
        **next(o for o in B.OPTIONS if o["key"] == "a1"),
        "name": "뒷길 J (1차 추천 — 비교용)",
    },
    {
        "key": "n1",
        "fam": "A + B",
        "name": "다섯 번째 획",
        "type": "추상 심볼 (단독 심볼 · 록업)",
        "symbol": "r2-n1-symbol",
        "horizontal": "r2-n1-horizontal-ko",
        "horizontal_en": "r2-n1-horizontal-en",
        "stacked": "r2-n1-stacked",
        "wordmark": "wordmark-ko",
        "small": "r2-n1-symbol",
        "idea": "넷까지는 똑같이 선 획. 다섯 번째는 묶음을 가로질러 긋는 대신, 한 걸음 앞에서 기울어 혼자 걸어 나간다.",
        "values": [
            "홀로 도전하는 기백 → 무리와 똑같은 획인데 방향만 다르다",
            "구조적 장벽 → '다섯 번째는 넷을 긋는다'는 세는 규칙(卌)을 그냥 따르지 않음",
            "뒷길 → 묶음 밖으로 한 걸음 — 이유는 말하지 않고 걸어감('but why' 의 무표정)",
        ],
        "risk": "16px 에서 네 획이 회색 덩어리로 뭉친다. 가로로 넓어 앱 아이콘 안에서 작아진다. 바코드 · 줄무늬로 읽힐 위험.",
    },
    {
        "key": "n2",
        "fam": "A + B",
        "name": "왜 — 능선 물음표",
        "type": "추상 심볼 (단독 심볼 · 록업)",
        "symbol": "r2-n2-symbol",
        "horizontal": "r2-n2-horizontal-ko",
        "horizontal_en": "r2-n2-horizontal-en",
        "stacked": "r2-n2-stacked",
        "wordmark": "wordmark-ko",
        "small": "r2-n2-symbol",
        "idea": "길게 오르는 능선, 짧게 꺾여 내려와 멈춘 획, 그 아래 점 하나. 멀리서 보면 산, 가까이 보면 물음표 — 점은 그 산으로 걸어가는 한 사람.",
        "values": [
            "구조적 장벽 → 능선(산), 홀로 → 점 하나",
            "'but why?' 에 대한 답 → 질문의 점이 곧 걷고 있는 사람",
            "슬기 → 능선이 슬의 ㅅ 과 같은 꼴(60° 오르막)",
        ],
        "risk": "물음표가 먼저 읽히면 '모르겠다 · 불확실' 로 받아들일 수 있다(컨설팅 회사엔 양날). 산 + 점은 아웃도어 브랜드처럼 보일 수 있다.",
    },
    {
        "key": "n3",
        "fam": "C",
        "name": "제슬 ———— 지평선",
        "type": "한글 워드마크 중심 (작은 크기용 '슬 + 능선' 컷)",
        "symbol": "r2-n3-symbol",
        "horizontal": "r2-n3-wordmark",
        "horizontal_en": None,
        "stacked": "r2-n3-stacked",
        "wordmark": "r2-n3-wordmark",
        "small": "r2-n3-symbol",
        "idea": "슬의 ㅡ 가 멈추지 않고 텅 빈 설원처럼 길게 이어지다 먼 능선에 닿는다. 말없이 오래 걷는 한 획.",
        "values": [
            "'but why' 의 건조한 유머 → 터무니없이 긴 ㅡ, 그래도 끝까지 간다",
            "구조적 장벽 → 끝의 능선, 나만의 무기 → 그 거리를 혼자 가는 획",
            "뒷길 → 글자(무리) 밖으로 이어지는 길이 이름 안에서 시작됨",
        ],
        "risk": "가로로 아주 길어 좁은 자리(모바일 헤더)에서 작아진다 — 짧은 컷 필수. 작은 크기에서 끝의 산이 화살촉처럼 보일 수 있다.",
    },
]

COLOUR_ROWS = [("a1", "a1"), ("n1", "r2-n1"), ("n2", "r2-n2"), ("n3", "r2-n3")]


def colour_section() -> str:
    folder = B.SVG / "colour"
    rows = []
    for label, stem in COLOUR_ROWS:
        cells = []
        for dk, name, paper in (("d1", "D1 먹 · 주홍", "#F6F3EE"), ("d2", "D2 심록", "#EEF1EC")):
            h = 64 if stem == "r2-n3" else 96
            cells.append(
                f'<div class="box" style="background:{paper}"><div class="k">{name}</div>'
                f'<div class="row" style="margin-top:10px">{B.art(f"{stem}-{dk}", h, 420, folder=folder)}</div></div>'
            )
        rows.append(f'<div><b>{label.upper()}</b><div class="colours" style="margin-top:6px">{"".join(cells)}</div></div>')
    return '<div style="display:grid;gap:16px">' + "".join(rows) + "</div>"


def dropped() -> str:
    sk = B.ROOT / "sketch-2"
    items = [
        ("n1-3", "무리도 기운 다섯 획", "무리까지 기울이니 바코드 · 줄무늬로 읽힘. 무리는 똑바로, 하나만 기울어야 이탈이 보임."),
        ("n2-3", "지평선 · 점 · 먼 산", "그림(일러스트)이 됨 — 다리미 · 배처럼도 읽힘. 기호로 줄여 N2 로."),
        ("n4-1", "JES L — 한 글자 이탈", "L 만 띄우니 정렬 실수처럼 보임. 걸어 나가는 느낌은 N3 의 긴 ㅡ 가 더 잘 냄."),
    ]
    return '<div class="colours">' + "".join(
        f'<div class="drop box">{B.art(n, 64, 160, folder=sk)}<div><b>{t}</b><p>{w}</p></div></div>'
        for n, t, w in items
    ) + "</div>"


def page() -> str:
    opts = "".join(B.option(o, False) for o in OPTIONS)
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>제슬 로고 시안 2차</title>
<style>{B.CSS}</style></head><body><main>
<div class="k">주식회사 제슬 (JESL) · 로고 시안 2차 · 'but why' 감성 · 2026-11-25 · 체크포인트 — 키트는 방향을 고른 뒤</div>
<h1>제슬 — 무리와 반대로, 먼 능선까지</h1>
<div class="brief">
<div class="box"><div class="k">감성 참고 (분위기만)</div>
<p>남극 다큐멘터리 속, 무리를 떠나 바다 반대편 먼 산맥으로 혼자 꾸준히 걸어가는 한 마리 — 'but why' 라는 밈으로 알려진 장면.</p>
<p><b>옮긴 것</b> 텅 빈 흰 들판, 먼 능선, 무리와 반대로 가는 하나, 서두르지 않음, 무표정한 건조한 유머, 질문에 말 대신 걸음으로 답하기.</p>
<p><b>옮기지 않은 것</b> 펭귄 그림, 영상 스틸, 밈 이미지와 글자.</p></div>
<div class="box"><div class="k">제슬의 뜻 · 가치에 잇기</div><ul>
<li>자신의 슬기를 다하라 — 남들이 묻는 '왜?' 에 걸음으로 답함</li>
<li>구조적 장벽에 홀로 도전 — 무리 · 규칙 · 먼 산</li>
<li>한계를 재정의하는 나만의 무기 — 같은 획인데 다른 방향</li>
<li>옳은 방향으로의 뒷길 — 묶음 밖 · 글자 밖으로 이어지는 길</li></ul></div>
<div class="box"><div class="k">한 줄 콘셉트 → 그린 것</div><ul style="font-size:12px">
<li><b>N1 다섯 번째 획</b> — 넷은 서고 하나는 기울어 걸어감 ✓</li>
<li><b>N2 능선 물음표</b> — 산이 곧 '?', 점이 걷는 사람 ✓</li>
<li><b>N3 지평선 ㅡ</b> — 슬의 ㅡ 가 먼 능선까지 ✓</li>
<li>무리도 기운 획 · 지평선과 점과 산 · JES L 이탈 — 스케치 후 탈락</li>
<li>같은 화살표 줄 속 반대 화살표 · J 를 뒤집은 물음표 · 발자국 점선 · 흰 여백 속 점 하나 — 한 줄에서 탈락(흔함 / 너무 문자 그대로)</li></ul></div>
</div>
<h2>시안 — 흑백 (1차 A1 을 비교로 함께)</h2>
{opts}
<h2>색 방향 적용 (D1 은 '혼자 가는 요소' 만 주홍: 기운 획 · 점 · 능선 · A1 의 J 길)</h2>
{colour_section()}
<h2>스케치에서 뺀 것</h2>
{dropped()}
<h2>테스트 결과 요약</h2>
<div class="box"><ul>
<li>svg_audit: 2차 SVG 와 색 파일까지 FAIL · WARN 0 — 처음엔 기운 각도(102.2° → 105°), 능선 각도(47.5° → 45°), 캔버스 넘침이 걸려 고침. <code>tests/svg-audit.txt</code></li>
<li>테스트 시트: <code>tests/round2-symbols-test.png</code> · <code>tests/round2-wordmarks-test.png</code> (16 · 32 · 48px, 단색, 반전, blur, 거울 · 180°, 컨텍스트, 일반 도형 선반)</li>
<li>N2 는 16px 에서도 '?' 꼴이 남음. N1 은 16px 에서 네 획이 뭉침. N3 컷은 32px 아래에서 산이 작아짐. 거울상: N1 은 반대로 걷는 획(의미 유지), N2 는 거꾸로 된 물음표(어색하지 않음).</li>
<li>상표 조사 안 함 · AI 보조 탐색본 — 1차 보드와 같은 주의.</li></ul></div>
<p class="foot">글자는 모두 코드로 그린 경로(폰트 미사용). 스크립트: identity/_drafts/jesl-logo/scripts/draw_round2.py · build_board2.py · 1차 보드: board.html</p>
</main></body></html>"""


def main() -> None:
    out = B.ROOT / "board-2.html"
    out.write_text(page(), encoding="utf-8")
    print("wrote", out)
    png = B.ROOT / "board-2.png"
    B.render_png.screenshot_html(str(out), str(png), 1500, int(sys.argv[1]) if len(sys.argv) > 1 else 5000)
    print("wrote", png)
    B.pdf(out, B.ROOT / "board-2.pdf")
    print("wrote", B.ROOT / "board-2.pdf")
    _ = html


if __name__ == "__main__":
    main()
