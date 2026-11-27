"""agenxy board, round 2: D (point inside the wordmark) · A (agents-gathering symbol) · 추가 — 펭귄.

    python3 identity/_drafts/agenxy-logo/scripts/build_board2.py [png-height]
"""

from __future__ import annotations

import html
import sys

import build_board as B

MEANING = "agenxy = 에이전트(agent)들이 모여 에이전시(agency)가 되고, 거기에 AX(AI 전환)가 합쳐진 이름 — x 가 곧 AX."

D_OPTS = [
    {"key": "d1", "name": "엇갈린 x", "wm": "r2-d1-wordmark", "small": "r2-d1-wordmark-small", "point": "r2-d1-point",
     "idea": "x 의 한 획이 다른 획 아래로 지나간다. 따로 쓸 때는 그 x 하나만.",
     "meaning": "에이전트들의 일이 부딪히지 않고 엇갈려 지나가는 자리 = AX. 워드마크 안의 x 가 그대로 심볼.",
     "risk": "엇갈린 x 만 떼면 흔한 '닫기 ×' 와 가깝다 — 틈이 유일한 구별점."},
    {"key": "d2", "name": "걷는 x", "wm": "r2-d2-wordmark", "small": "r2-d2-wordmark-small", "point": "r2-d2-point",
     "idea": "x 의 오르는 획이 짧게 멈추고 그 위에 머리 하나 — x 가 걸어가는 사람(에이전트)이 된다.",
     "meaning": "agenxy 에서 한 글자만 사람: 일하는 에이전트가 AX(x) 그 자체. 따로 쓰면 '머리 달린 x'.",
     "risk": "작은 크기에서 점이 'x 옆 마침표'로 보일 수 있다. 사람 픽토그램(걷는 사람 표지)과 닮지 않게 각도 유지."},
    {"key": "d3", "name": "핵이 있는 x", "wm": "r2-d3-wordmark", "small": "r2-d3-wordmark-small", "point": "r2-d3-point",
     "idea": "x 의 네 획이 가운데 둥근 핵 앞에서 멈춘다 — 네 방향에서 모여든 에이전트와 그 가운데의 AX.",
     "meaning": "모인 에이전트(네 획) → 하나의 에이전시(핵). 1차 A 의 '열린 x' 에 중심을 채워 의미를 붙였다.",
     "risk": "따로 쓰면 꽃 · 눈송이 · 분자 아이콘과 가깝다. 워드마크 안에서 가장 잘 읽힌다."},
]
A_OPTS = [
    {"key": "a1", "name": "모이는 넷", "sym": "r2-a1-symbol", "small": "r2-a1-symbol-small", "lock": "r2-a1-horizontal",
     "idea": "머리 + 몸 하나씩인 에이전트 넷이 대각선에서 한 가운데를 향한다. 넷이 이루는 꼴이 x(AX).",
     "meaning": "agent 넷 → 하나의 agency, 그 모양이 AX 의 x. 사람(에이전트)이 먼저 읽히고 x 가 두 번째.",
     "risk": "작은 크기에서 '뼈다귀 X' 로 읽힐 수 있다 — 몸과 머리 사이 틈을 키운 작은 컷으로 대응."},
    {"key": "a2", "name": "머리를 맞댄 넷", "sym": "r2-a2-symbol", "small": "r2-a2-symbol-small", "lock": "r2-a2-horizontal",
     "idea": "넷의 머리가 가운데에 모이고 몸은 바깥으로 — 머리를 맞대고 일하는 팀. 몸의 방향이 x.",
     "meaning": "에이전트가 '모여 있다' 를 가장 직접 보여 주는 안. 가운데 네 점 = 한 팀, 바깥 네 획 = AX.",
     "risk": "가운데 네 점이 주사위 · 버튼처럼 보일 수 있다. 16px 에서 네 점이 한 덩어리."},
    {"key": "a3", "name": "한 점을 둘러싼 넷", "sym": "r2-a3-symbol", "small": "r2-a3-symbol-small", "lock": "r2-a3-horizontal",
     "idea": "위에서 본 넷(머리 + 어깨)이 한 점(맡긴 일)을 둘러싼다. 넷 사이 빈 대각선이 x.",
     "meaning": "agency = 한 일 둘레에 모인 에이전트들, 그 일이 AX. 사람 넷이 가장 분명.",
     "risk": "과녁 · 조준선 · '팀' 아이콘과 닮는다 — 세 안 중 가장 흔한 꼴."},
]
P_OPTS = [
    {"key": "p1", "name": "펭귄 a", "wm": "r2-p1-wordmark", "small": "r2-p1-wordmark-small", "point": "r2-p1-point",
     "idea": "agenxy 의 첫 글자 a 의 둥근 그릇에 눈 둘과 마름모 부리 — a 가 우리 펭귄 얼굴. 따로 쓸 때는 그 a 만.",
     "meaning": "에이전트(펭귄)가 이름의 첫 자리에 — agent 의 a. 워드마크에 녹아 있는 심볼(D 방식).",
     "diff": "Tux(리눅스)는 전신 · 노란 부리 · 발, Penguin Books 는 타원 안의 걷는 실루엣, Pudgy Penguins 는 통통한 만화 얼굴 — 이쪽은 글자 a 안의 기하 얼굴(점 둘 + 마름모)뿐.",
     "risk": "얼굴만 보면 올빼미로도 읽힌다(점 둘 + 마름모). 펭귄임은 브랜드 캐릭터와 함께 쓸 때 분명해진다."},
    {"key": "p2", "name": "펭귄 마크", "sym": "r2-p2-symbol", "small": "r2-p2-symbol-small", "lock": "r2-p2-horizontal",
     "idea": "둥근 머리의 검은 몸, 흰 앞판은 진짜 구멍(음각), 정원 눈 둘, 마름모 부리 — 캐릭터를 로고 기호로 줄인 것.",
     "meaning": "모든 에이전트가 펭귄 — 이 하나가 에이전트들의 대표 얼굴. 워드마크와 나란히(A 방식).",
     "diff": "Tux 처럼 몸 · 발 · 노란색이 없고, Penguin Books 의 옆모습 걷는 실루엣과 반대로 정면 얼굴 한 장. Pudgy Penguins 의 만화체와 달리 기하 도형만.",
     "risk": "앞판이 커서 유령 · 올빼미와 닮을 수 있다 — 앞판 크기를 줄여 검은 머리를 늘렸다. 볼 색(마젠타)은 캐릭터 전용 색이라 로고에 쓰려면 DESIGN.md 예외가 필요(아래 따로)."},
    {"key": "p3", "name": "부리 x", "wm": "r2-p3-wordmark", "small": "r2-p3-wordmark-small", "point": "r2-p3-point",
     "idea": "x 의 네 획이 가운데의 마름모 부리에서 만난다 — AX 의 한가운데가 펭귄의 부리.",
     "meaning": "에이전트(펭귄)가 AX 의 중심에. 펭귄은 아는 사람만 알아보는 정도로 조용히.",
     "diff": "펭귄 형상 없이 부리 마름모 하나 — 다른 펭귄 로고들과 형태가 겹치지 않는다.",
     "risk": "부리를 모르면 그냥 '마름모 x' — 펭귄 연결이 약하다. D3(핵 x)와 같은 구조."},
]


def cells_wordmark_led(o: dict) -> str:
    sizes = "".join(f"<span>{B.art(o['point'], s)}{s}px</span>" for s in (16, 32, 64))
    sizes += "".join(f"<span>{B.art(o['small'], s)}{s}px 높이</span>" for s in (16, 24))
    return "".join([
        B.cell(B.art(o["wm"], 64, maxw=420), "워드마크 (심볼이 안에 있음)"),
        B.cell(B.art(o["point"], 96), "따로 쓸 때: 그 포인트만"),
        B.cell(B.art(o["wm"], 56, maxw=420), "가로 = 워드마크"),
        B.cell(sizes, "실제 크기", "sizes"),
        '<div style="display:grid;grid-template-rows:1fr 1fr;gap:12px">'
        + B.cell(B.art(o["wm"], 30, colour="#000000", maxw=220), "단색 검정")
        + B.cell(B.art(o["wm"], 30, colour="#ECE8DF", maxw=220), "반전", "dark") + "</div>",
    ])


def cells_with_symbol(o: dict) -> str:
    sizes = "".join(f"<span>{B.art(o['small'], s)}{s}px</span>" for s in (16, 32, 64))
    sizes += "".join(f"<span>{B.art('r2-a-wordmark-small', s)}{s}px 높이</span>" for s in (16, 24))
    return "".join([
        B.cell(B.art("r2-a-wordmark", 64, maxw=420), "워드마크 (얇게)"),
        B.cell(B.art(o["sym"], 96), "심볼 단독"),
        B.cell(B.art(o["lock"], 64, maxw=420), "가로 록업"),
        B.cell(sizes, "실제 크기 (작은 컷)", "sizes"),
        '<div style="display:grid;grid-template-rows:1fr 1fr;gap:12px">'
        + B.cell(B.art(o["sym"], 52, colour="#000000"), "단색 검정")
        + B.cell(B.art(o["sym"], 52, colour="#ECE8DF"), "반전", "dark") + "</div>",
    ])


def option(o: dict, fam: str) -> str:
    led = "wm" in o
    cells = cells_wordmark_led(o) if led else cells_with_symbol(o)
    logo = B.art(o["small"], 24) if led else B.art(o["lock"], 28)
    diff = (f'<div><div class="k">다른 펭귄 마크와 다른 점</div><p>{html.escape(o["diff"])}</p></div>'
            if "diff" in o else f'<div><div class="k">이름의 뜻</div><p>{html.escape(o["meaning"])}</p></div>')
    meaning = (f'<div><div class="k">이름의 뜻</div><p>{html.escape(o["meaning"])}</p></div>' if "diff" in o
               else '<div><div class="k">레퍼런스와 다른 점</div><p>e2b.dev 레퍼런스의 공통점(단색 · 산세리프 · 장치 하나)만 따르고, 어느 것의 글자 · 심볼도 쓰지 않음.</p></div>')
    return f"""<section class="opt"><div class="head"><span class="k">{o['key'].upper()}</span><b>agenxy · {html.escape(o['name'])}</b>
<span class="tag">{fam}</span></div><p class="idea">{html.escape(o['idea'])}</p><div class="cells">{cells}</div>
{B.gnb(logo, '랜딩 헤더 실제 크기 — 작은 자리는 굵은 컷')}
<div class="why">{meaning}{diff}<div><div class="k">정직한 위험</div><p class="risk">{html.escape(o['risk'])}</p></div></div></section>"""


def accents() -> str:
    col = B.SVG / "colour"
    rows = []
    for k in ("d1", "d2", "d3", "p1", "p3"):
        rows.append(f'<div class="box drop">{B.art(f"r2-{k}-point-accent", 48, folder=col) if (col / f"r2-{k}-point-accent.svg").exists() else ""}'
                    f'{B.art(f"r2-{k}-wordmark-accent", 44, folder=col, maxw=320)}<b>{k.upper()}</b></div>')
    for k in ("a1", "a2", "a3"):
        rows.append(f'<div class="box drop">{B.art(f"r2-{k}-symbol-accent", 56, folder=col)}<b>{k.upper()}</b> 머리만 강조색</div>')
    rows.append(f'<div class="box drop">{B.art("r2-p2-symbol-cheek", 56, folder=col)}<div><b>P2 + 볼(마젠타 #E01FAE)</b>'
                '<p>DESIGN.md 에서 --cheek 는 캐릭터 전용 색 — 로고에 쓰려면 규칙 예외 결정이 필요.</p></div></div>')
    return '<div class="two">' + "".join(rows) + "</div>"


def dropped() -> str:
    sk = B.ROOT / "sketch-2"
    return ('<div class="two"><div class="box drop">' + B.art("a4-symbol", 56, folder=sk)
            + '<div><b>돌아 모이는 넷(바람개비)</b><p>네 팔이 한 방향으로 꺾인 회전형 — 卍 꼴로 읽힐 위험이 있어 바로 탈락.</p></div></div></div>')


def page() -> str:
    d = "".join(option(o, "D · 워드마크에 녹아든 심볼") for o in D_OPTS)
    a = "".join(option(o, "A · 워드마크 + 에이전트 심볼") for o in A_OPTS)
    p = "".join(option(o, "추가 — 펭귄") for o in P_OPTS)
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>agenxy 로고 시안 2차</title>
<style>{B.CSS}</style></head><body><main>
<div class="k">agenxy · 로고 시안 2차 · A · D 디벨롭 + 추가 펭귄 · 2026-11-27 · 체크포인트</div>
<h1>agenxy — 모인 에이전트, 그리고 AX</h1>
<div class="grid3" style="margin-top:18px">
<div class="box"><div class="k">요청 (그대로)</div><p>"a, d 중심으로 좀 더 디벨롭해보자. d의 경우처럼 심볼과 워드마크가 같이 있을 필요 없고 워드마크에 심볼이 녹아있어서 심볼만 쓸때는 그 포인트만 쓰고 그래도 됨. a의 경우에는 심볼을 x 말고 에이전트가 좀 더 느껴지게 해봐. agenxy의 뜻은 agent가 모여있어서 agency에 ax가 합쳐진거야" · "캐릭터는 펭귄이니까 펭귄 관련되어서는 추가 시안으로 해봐"</p></div>
<div class="box"><div class="k">이름의 뜻</div><p>{MEANING}</p><ul>
<li><b>D</b> — 심볼이 워드마크 안 한 점(x)에. 따로 쓸 땐 그 점만.</li>
<li><b>A</b> — 얇은 워드마크 + 에이전트가 모이는 심볼(x 보다 사람이 먼저).</li>
<li><b>추가 — 펭귄</b> — 브랜드 캐릭터(정원 눈 · 마름모 부리 · 흰 앞판)를 로고 기호로.</li></ul></div>
<div class="box"><div class="k">스케치 → 남긴 것</div><ul style="font-size:12px">
<li>D: 엇갈린 x · 걷는 x · 핵 x (3)</li><li>A: 모이는 넷 · 머리 맞댄 넷 · 둘러싼 넷 (3) — 바람개비 탈락</li>
<li>펭귄: 펭귄 a · 펭귄 마크(+볼 색 변형) · 부리 x (3)</li><li>심볼 작은 컷은 획을 키우되 틈은 유지(A1 은 몸이 가운데서 붙어 고침)</li></ul></div>
</div>
<div class="k" style="margin-top:28px">지금 헤더 (비교)</div>{B.gnb('<span class="cur">agenxy</span>', '현재: 15px · 800 텍스트')}
<h2>D — 워드마크에 녹아든 심볼 (보통 굵기)</h2>{d}
<h2>A — 워드마크 + 에이전트가 모이는 심볼 (얇게)</h2>{a}
<h2>추가 — 펭귄</h2>{p}
<h2>강조색 (선택): --accent #2867D0 을 포인트에만</h2>{accents()}
<h2>스케치에서 뺀 것</h2>{dropped()}
<h2>테스트 결과 요약</h2>
<div class="box"><ul>
<li>svg_audit: 2차 SVG · 색 파일 FAIL · WARN 0 (부리 47.5° → 45° 마름모로 단순화) — <code>tests/svg-audit.txt</code></li>
<li>비교 시트: <code>tests/round2-symbols-compare.png</code> · <code>tests/round2-wordmarks-compare.png</code>, 전체 시트(D2 · A2 · P2): <code>tests/round2-symbols-test.png</code></li>
<li>16px: D1 · D2 · P2 · P3 형태 유지, A2 가운데 네 점은 뭉침, P1 은 얼굴이 점 하나로 줄어듦.</li>
<li>상표 조사 안 함 — 특히 펭귄 마크는 기존 펭귄 상표(Linux Tux, Penguin Books, Pudgy Penguins 등)와 유사성 확인 필요.</li></ul></div>
<p class="foot">스크립트: identity/_drafts/agenxy-logo/scripts/draw_round2.py · build_board2.py · 1차 보드: board.html</p>
</main></body></html>"""


def main() -> None:
    out = B.ROOT / "board-2.html"
    out.write_text(page(), encoding="utf-8")
    B.render_png.screenshot_html(str(out), str(B.ROOT / "board-2.png"), 1500, int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
    B.pdf(out, B.ROOT / "board-2.pdf")
    print("wrote", out)


if __name__ == "__main__":
    main()
