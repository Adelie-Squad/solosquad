"""Board for round 3 (ㅈ + ㅅ as one rounded line): board-3.html (+ board-3.png, board-3.pdf).

    python3 identity/_drafts/jesl-logo/scripts/build_board3.py [png-height]
"""

from __future__ import annotations

import sys

import build_board as B

WM = "r3-wordmark-ko"
OPTIONS = [
    {
        "key": "r3-a",
        "fam": "A + B",
        "name": "돌아 오르는 ㅈ",
        "type": "한 줄 · 둥근 끝 · 교차 없음 (단독 심볼 · 록업)",
        "symbol": "r3-a-symbol",
        "horizontal": "r3-a-horizontal-ko",
        "horizontal_en": "r3-a-horizontal-en",
        "stacked": "r3-a-stacked",
        "wordmark": WM,
        "small": "r3-a-symbol-small",
        "idea": "둥근 ㅅ 을 그린 선이 오른쪽 발끝에서 멈추지 않고 돌아 올라가, 그 위를 덮는 ㅈ 의 가로획이 된다. 선 하나에 ㅅ(슬)과 ㅈ(제)이 다 있다.",
        "values": [
            "자신의 슬기를 다하라 → 슬(ㅅ)이 끝까지 가서 제(ㅈ)를 완성한다 — 한 번도 끊기지 않는 선",
            "옳은 방향으로의 뒷길 → 바닥에서 돌아 올라가 위로 덮는 길",
            "메타 느낌: 고른 굵기, 둥근 끝, 부드러운 꺾임 — 심볼로 먼저 읽히고 글자는 두 번째",
        ],
        "risk": "가장 단정하지만 가장 조용하다. 네모 틀처럼 보이면 'ㄱ + ㅅ' 으로 읽힐 수 있다. 작은 크기에는 굵은 컷(16 · 32px 줄에 사용) 필요.",
    },
    {
        "key": "r3-b",
        "fam": "A + B",
        "name": "꼬아 오르는 ㅈ",
        "type": "한 줄 · 둥근 끝 · 교차 1회 (단독 심볼 · 록업)",
        "symbol": "r3-b-symbol",
        "horizontal": "r3-b-horizontal-ko",
        "horizontal_en": "r3-b-horizontal-en",
        "stacked": "r3-b-stacked",
        "wordmark": WM,
        "small": "r3-b-symbol-small",
        "idea": "ㅅ 의 발끝에서 선이 자기 아래로 한 바퀴 감기며 제 다리를 가로질러 올라가 ㅈ 의 가로획이 된다. 한 번 꼬인 선 — 메타처럼 겹침이 있는 안.",
        "values": [
            "구조적 장벽에 홀로 도전 → 길이 막힌 곳에서 혼자 몸을 틀어 넘어감(교차)",
            "나만의 무기 → 꼬임 하나가 이 마크만의 디테일",
            "뒷길 → 아래로 돌아 뒤로 감아 올라가는 고리",
        ],
        "risk": "흑백에서는 교차가 한 덩어리로 보여 꼬임이 약하다 — 투톤(K2)에서 살아남. 필기체 ㅈ · 'λ' 로 읽힐 수 있다. 세 안 중 가장 개성 있음.",
    },
    {
        "key": "r3-c",
        "fam": "B 중심",
        "name": "ㅈㅅ 한 줄",
        "type": "가로형 한 줄 (록업 · 배너용, 작은 크기 약함)",
        "symbol": "r3-c-symbol",
        "horizontal": "r3-c-horizontal-ko",
        "horizontal_en": "r3-c-horizontal-en",
        "stacked": "r3-c-stacked",
        "wordmark": WM,
        "small": "r3-c-symbol",
        "idea": "ㅈ 의 가로획이 먼저 뒤로(왼쪽) 가다 둥글게 내려와, 봉우리 둘(ㅈ 의 人, ㅅ)을 넘는다. 이름의 두 초성을 한 줄로 이어 쓴 것 — 2차 능선과도 이어짐.",
        "values": [
            "ㅈ · ㅅ 두 초성이 모두 보이는 유일한 안",
            "뒷길 → 출발이 뒤쪽(왼쪽)으로 가는 가로획",
            "구조적 장벽 → 넘어야 할 두 봉우리, 끊기지 않고 넘음",
        ],
        "risk": "가로로 넓어 16px · 앱 아이콘에서 뭉친다(이 안은 단독 심볼보다 록업 · 배너용). 둥근 지그재그는 'm' · 물결로도 읽힌다.",
    },
]


def colour_section() -> str:
    folder = B.SVG / "colour"
    rows = []
    for o in OPTIONS:
        k = o["key"]
        cells = "".join(
            f'<div class="box" style="background:{bg}"><div class="k">{name}</div>'
            f'<div class="row" style="margin-top:10px">{B.art(f"{k}-{ck}", 110, 260, folder=folder)}</div></div>'
            for ck, name, bg in (("k1", "K1 주홍 단색 #E2492F", "#F6F3EE"), ("k2", "K2 먹 + 주홍 나눔 (돌아 오르는 길만 주홍)", "#F6F3EE"))
        )
        rows.append(f'<div><b>{k.upper()}</b><div class="colours" style="margin-top:6px">{cells}</div></div>')
    return '<div style="display:grid;gap:16px">' + "".join(rows) + "</div>"


def dropped() -> str:
    sk = B.ROOT / "sketch-3"
    items = [
        ("s1-loop-bar", "고리 ㅈ (다리 교차 + 위 고리)", "인식 리본(🎗)과 거의 같은 꼴 — 강한 기존 의미. s6 · s7 · s8 · s3 도 같은 이유로 탈락."),
        ("s5-ridge-back", "ㅅ + 아래로 돌아오는 ㅡ", "삼각형(△) · 재활용 표시처럼 읽힘."),
        ("s4-seven-wave", "7 + ㅅ 지그재그", "번개 · 'ㄹ' 로 읽히고 둥근 느낌이 약함."),
        ("i3c-turn-back-steep", "가파른 돌아 오르는 ㅈ", "가로획이 기울어 실수처럼 보임 — R3-A 로 정리."),
    ]
    return '<div class="colours">' + "".join(
        f'<div class="drop box">{B.art(n, 64, 120, folder=sk)}<div><b>{t}</b><p>{w}</p></div></div>' for n, t, w in items
    ) + "</div>"


def page() -> str:
    opts = "".join(B.option(o, o["key"] == "r3-b") for o in OPTIONS)
    wms = "".join(B.art(n, 56, 360) for n in ("r3-wordmark-ko", "r3-wordmark-en", "r3-wordmark-jeseul"))
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>제슬 로고 시안 3차</title>
<style>{B.CSS}</style></head><body><main>
<div class="k">주식회사 제슬 (JESL) · 로고 시안 3차 · ㅈ + ㅅ 한 줄 · 2026-11-26 · 체크포인트 — 키트는 방향을 고른 뒤</div>
<h1>제슬 — ㅈ 과 ㅅ, 끊기지 않는 둥근 선 하나</h1>
<div class="brief">
<div class="box"><div class="k">요청 (그대로)</div><p>"로고는 ㅈ이랑 ㅅ 초성을 활용하되, 메타 로고 같은 느낌으로 디자인해줘. 선인데 둥근 형태"</p>
<p><b>메타에서 가져온 성질만</b> 끊기지 않는 한 줄, 고른 굵기, 둥근 끝 · 이음, 부드러운 곡선, (선택) 한 번의 겹침. <b>가져오지 않은 것</b> 무한대 · 뫼비우스 모양과 그 고유한 부분.</p></div>
<div class="box"><div class="k">만든 방식</div><ul>
<li>중심선 = 직선 + 원호, 접선이 이어짐(꺾임 없음). 외곽선은 한 덩어리 경로, 끝은 반원.</li>
<li>획 굵기 ≈ 마크 높이의 15–18 %. 16 · 32px 용 굵은 컷(×1.3) 따로.</li>
<li>한계: 곡률이 직선 · 원호 이음에서 한 번 바뀜(G1). 키트 단계에서 베지어로 G2 정리.</li></ul></div>
<div class="box"><div class="k">스케치 17 → 3</div><ul style="font-size:12px">
<li><b>R3-A</b> 돌아 오르는 ㅈ ✓ · <b>R3-B</b> 꼬아 오르는 ㅈ ✓ · <b>R3-C</b> ㅈㅅ 한 줄 ✓</li>
<li>리본 꼴 5개 · 삼각형 · 지그재그 · 기운 가로획 — 탈락(아래)</li></ul></div>
</div>
<h2>둥근 워드마크 (같은 펜 · 같은 획 논리)</h2>
<div class="box"><div class="row" style="gap:40px">{wms}</div>
<p class="k" style="text-transform:none;letter-spacing:0;margin-top:10px">제슬: ㅈ 의 人 과 슬의 ㅅ 은 한 획(둥근 꼭짓점), ㄹ 은 머리핀처럼 꺾이는 한 줄. 라틴: J · L 은 둥근 모서리 한 획, S 는 반원 둘. Jeseul 은 표준 로마자(소문자).</p></div>
<h2>시안 — 흑백</h2>
{opts}
<h2>색 (최대 2개)</h2>
{colour_section()}
<h2>스케치에서 뺀 것</h2>
{dropped()}
<h2>테스트 결과 요약</h2>
<div class="box"><ul>
<li>svg_audit: 3차 SVG · 색 파일 FAIL · WARN 0 (워드마크 ㅈ 다리 62° → 60° 로 고침) — <code>tests/svg-audit.txt</code></li>
<li>테스트 시트: <code>tests/round3-symbols-test.png</code> · <code>tests/round3-wordmarks-test.png</code></li>
<li>R3-A · R3-B 는 굵은 컷으로 16px 에서 형태 유지. R3-C 는 16px 에서 뭉침. 거울 · 180°: R3-A 는 W · ㄷ 비슷, R3-B 는 ㄹ 비슷한 고리 — 나쁜 독해 없음.</li>
<li>상표 조사 안 함 · AI 보조 탐색본 — 1 · 2차와 같은 주의. 메타 상표와의 유사성도 상표 조사에서 함께 확인.</li></ul></div>
<p class="foot">스크립트: identity/_drafts/jesl-logo/scripts/pen.py (둥근 선 → 외곽선) · draw_round3.py · build_board3.py · 1 · 2차: board.html · board-2.html</p>
</main></body></html>"""


def main() -> None:
    out = B.ROOT / "board-3.html"
    out.write_text(page(), encoding="utf-8")
    png = B.ROOT / "board-3.png"
    B.render_png.screenshot_html(str(out), str(png), 1500, int(sys.argv[1]) if len(sys.argv) > 1 else 5000)
    B.pdf(out, B.ROOT / "board-3.pdf")
    print("wrote", out, png, B.ROOT / "board-3.pdf")


if __name__ == "__main__":
    main()
