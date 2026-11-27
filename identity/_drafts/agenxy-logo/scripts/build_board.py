"""agenxy logo board, round 1: board.html (+ board.png, board.pdf via the skill's offline Chrome).

    python3 identity/_drafts/agenxy-logo/scripts/build_board.py [png-height]

Every mark is inlined as SVG; no reference logo is embedded (they are other companies' trademarks —
the analysis is written in words, the screenshot stays local in identity/_preview/, which is ignored).
"""

from __future__ import annotations

import html
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "svg"
sys.path.insert(0, str(ROOT.parents[2] / "skills" / "logo-design" / "scripts"))
import render_png  # noqa: E402

INK = "#1E1C17"

OPTIONS = [
    {
        "key": "a", "name": "열린 x", "weight": "얇게 (획 8 / x-높이 100)", "fam": "워드마크 + 심볼",
        "idea": "x 를 네 모서리에서 가운데로 모이는 네 획으로 그리고, 가운데는 비워 둔다 — 대표가 맡긴 일이 놓이는 자리, 에이전트들이 그리로 모인다.",
        "why": ["agency + x: x 가 '여럿이 한 일에 모인다' 는 뜻을 지는 글자", "심볼(열린 x)만 떼어 파비콘 · 앱 아이콘으로 씀", "얇은 원형 기하 소문자 — 요청한 'e2b 얇게' 의 가벼운 무게"],
        "diff": "ChatCut(굵은 그로테스크) · E2B(굵은 블록 + 가로 홈)와 무게 · 꼴이 반대. Upstage 의 줄무늬 심볼과 달리 심볼이 글자 x 그 자체. Anything 처럼 두 서체를 섞지 않는다.",
        "risk": "가운데가 빈 x 는 작은 크기에서 '+'/'※' 로 보일 수 있다 — 심볼 작은 컷은 획을 굵게. 얇은 워드마크는 24px 아래에서 굵은 컷 필요.",
    },
    {
        "key": "b", "name": "맞닿은 x · 사각", "weight": "얇게, 넓은 사각 바탕 (획 8)", "fam": "워드마크 + 심볼",
        "idea": "넓은 둥근 사각형으로 지은 소문자. x 는 등을 맞댄 두 호 ')(' — 두 에이전트가 한 점에서 일을 넘겨받는 순간.",
        "why": ["'e2b 를 얇게' 에 가장 가까운 방향: 넓고 기하적인 사각 글자, 무게만 가볍게", "x 의 두 호가 맞닿는 한 점 = 핸드오프", "심볼 ')(' 은 x 로도, 마주 선 둘로도 읽힘"],
        "diff": "E2B 는 굵은 대문자 블록에 가로 홈 — 이쪽은 얇은 소문자, 홈 없음, 둥근 사각 그릇. ChatCut 의 특수 a, Upstage 의 줄무늬, Anything 의 세리프 이탤릭 어느 것도 쓰지 않는다.",
        "risk": "사각 기하 소문자는 테크 업계에 흔하다 — 소유감은 x 의 두 호가 짐. g · y 꼬리가 길어 줄 간격을 잡아먹는다.",
    },
    {
        "key": "c", "name": "건네는 xy", "weight": "얇게 (획 8)", "fam": "워드마크만",
        "idea": "x 의 오르는 획이 x-높이에서 짧은 다리를 건너 y 로 내려간다 — 한 글자(에이전트)가 다음 글자에게 일을 건네는 한 줄.",
        "why": ["'agency' 에서 'xy' 로 이어지는 소리와 모양을 한 획으로", "여러 에이전트가 손을 넘기는 팀 — 서비스 설명 그대로", "심볼 없이 글자만으로 아이디어가 있는 워드마크"],
        "diff": "레퍼런스 넷 모두 글자를 잇지 않는다(ChatCut · E2B 는 따로 선 글자, Anything 은 두 단어 스타일 대비). 합자 하나가 유일한 장치.",
        "risk": "다리가 작아 16–24px 에서는 그냥 'xy' 로 보인다(굵은 컷에서도 약함). 파비콘용 심볼이 없다 — 필요하면 A/B 심볼을 빌려야 함.",
    },
    {
        "key": "d", "name": "엇갈린 x · 보통 굵기", "weight": "보통 (획 15)", "fam": "워드마크만",
        "idea": "x 의 한 획이 다른 획 아래로 지나간다(교차에 틈) — 서로 다른 일이 부딪히지 않고 엇갈려 지나가는 팀.",
        "why": ["얇은 안들의 짝: 같은 원형 글자의 보통 굵기 — 헤더 · 작은 화면에서 가장 안정적", "틈 하나로 x 를 구별, 나머지는 조용히", "강조색은 아래로 지나가는 획 하나에만"],
        "diff": "ChatCut 만큼 무겁지 않고, E2B 처럼 홈을 반복하지 않는다(틈은 x 의 교차 한 곳뿐).",
        "risk": "가장 무난한 만큼 개성이 약하다. 틈이 작은 크기에서 닫힐 수 있다.",
    },
]

DROPPED = [
    ("s01-round-thin-plain", "얇은 원형, 특수 글자 없음", "기준용 — 아무나 칠 수 있는 기하 산세리프."),
    ("s08-round-hairline", "더 얇은 헤어라인", "16–24px 에서 사라짐."),
    ("s09-round-bold-open-x", "굵은 열린 x", "ChatCut 처럼 무거워짐 — 요청한 '얇게' 와 반대."),
    ("s07-square-regular-arcs-x", "보통 굵기 사각", "E2B 블록 느낌에 너무 가까워짐."),
]

CONCEPTS = [
    "A 열린 x — 네 획이 빈 가운데로 모임 ✓", "B ')(' 맞닿은 x + 얇은 사각 글자 ✓", "C xy 합자 — 일을 건네는 한 줄 ✓",
    "D 엇갈린 x — 아래로 지나가는 획 ✓", "가운데 점이 있는 x(✕·) — 흔한 '닫기' 아이콘과 겹쳐 탈락",
    "y 가 둘로 갈라지는 분기 심볼 — git 분기 아이콘 클리셰라 탈락", "g 의 꼬리가 화살표 — 화살표 클리셰라 탈락",
    "agen 가벼움 + xy 굵음 대비 — Anything 의 '두 스타일 섞기' 와 너무 가까워 탈락",
    "이중선(인라인) 글자 — E2B 의 홈을 얇게 흉내 내는 꼴이라 탈락", "얇은 글자 전체를 가로지르는 한 줄 — 흰 띠로 덮는 가짜 구멍이 필요해 탈락",
    "e 의 가로획이 n 까지 이어짐 — 읽힘이 'eh' 로 흔들려 탈락", "a 를 둥근 사각 안에 — 흔한 앱 아이콘 틀이라 탈락",
]

CSS = """
:root{--ink:#1E1C17;--ink2:#575143;--ink3:#8A8371;--line:#DED6C6;--bg:#EEE9DF;--surface:#FBF9F4;--accent:#2867D0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
 font:14px/1.55 Pretendard,"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif}
main{max-width:1500px;margin:0 auto;padding:40px 40px 60px}
h1{font-size:30px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 10px}
.k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.box{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.box ul{margin:4px 0;padding-left:18px}.grid3{display:grid;grid-template-columns:1.1fr 1.3fr 1fr;gap:16px}
.opt{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin-top:22px;padding:20px 22px}
.head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.head b{font-size:22px}
.tag{font-size:12px;border:1px solid var(--ink);border-radius:20px;padding:1px 9px}
.idea{font-size:16px;margin:6px 0 14px}
.cells{display:grid;grid-template-columns:1.4fr 150px 1.4fr 1fr 1fr;gap:12px}
.cell{border:1px solid var(--line);border-radius:10px;background:#fff;min-height:150px;display:flex;flex-direction:column}
.cell .art{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:14px;flex-wrap:wrap}
.cell .cap{font-size:11px;color:var(--ink3);padding:6px 10px;border-top:1px solid var(--line)}
.dark{background:#15161B}.dark .cap{border-color:#353745;color:#B7B2A6}
.sizes .art{align-items:flex-end}.sizes span{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;color:var(--ink3)}
.gnb{height:64px;background:var(--bg);border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;margin-top:12px}
.gnb .act{display:flex;gap:10px;align-items:center;font-size:13px}
.gnb .btn{padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-weight:600}
.gnb .btn.p{background:var(--accent);border-color:var(--accent);color:#fff}
.gnb .cur{font-size:15px;font-weight:800;letter-spacing:-.01em}
.why{display:grid;grid-template-columns:1.3fr 1.3fr 1fr;gap:18px;margin-top:14px}.why ul{margin:0;padding-left:18px}
.risk{color:#A85A12}.drop{display:flex;gap:14px;align-items:center}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.foot{margin-top:40px;color:var(--ink3);font-size:12px}
"""


def raw(name: str, folder: Path = SVG) -> str:
    t = (folder / f"{name}.svg").read_text(encoding="utf-8")
    return re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", t).strip()


def art(name: str, h: int, colour: str | None = None, folder: Path = SVG, maxw: int | None = None) -> str:
    s = raw(name, folder)
    if colour:
        s = s.replace(INK, colour)
    mw = f";max-width:{maxw}px" if maxw else ""
    return s.replace("<svg ", f'<svg style="height:{h}px;width:auto;display:block{mw}" ', 1)


def cell(inner: str, cap: str, cls: str = "") -> str:
    return f'<div class="cell {cls}"><div class="art">{inner}</div><div class="cap">{cap}</div></div>'


def gnb(logo: str, label: str) -> str:
    return (f'<div class="gnb">{logo}<div class="act"><span>한국어 ▾</span>'
            f'<span class="btn p">데모 체험</span><span class="btn">로그인</span></div></div>'
            f'<div class="k" style="margin-top:4px;text-transform:none;letter-spacing:0">{label}</div>')


def option(o: dict) -> str:
    k = o["key"]
    has_sym = (SVG / f"{k}-symbol.svg").exists()
    small_wm = f"{k}-wordmark-small" if (SVG / f"{k}-wordmark-small.svg").exists() else f"{k}-wordmark"
    if has_sym:
        sizes = "".join(f"<span>{art(f'{k}-symbol-small', s)}{s}px</span>" for s in (16, 32, 64))
    else:
        sizes = ""
    sizes += "".join(f"<span>{art(small_wm, s)}{s}px 높이</span>" for s in (16, 24))
    head_logo = art(f"{k}-horizontal", 28) if has_sym else art(small_wm, 24)
    cells = [
        cell(art(f"{k}-wordmark", 64, maxw=420), "워드마크 (마스터, 얇은 원본)"),
        cell(art(f"{k}-symbol", 96) if has_sym else "<span class='k'>없음</span>", "심볼 단독 (파비콘 · 앱 아이콘)" if has_sym else "심볼 — 이 안은 워드마크만"),
        cell(art(f"{k}-horizontal", 64, maxw=420) if has_sym else art(f"{k}-wordmark", 56, maxw=420), "가로 록업" if has_sym else "가로 = 워드마크"),
        cell(sizes, "실제 크기 (작은 크기는 굵은 컷)", "sizes"),
        f'<div style="display:grid;grid-template-rows:1fr 1fr;gap:12px">'
        + cell(art(f"{k}-wordmark", 30, colour="#000000", maxw=220), "단색 검정")
        + cell(art(f"{k}-wordmark", 30, colour="#ECE8DF", maxw=220), "반전 (다크 --ink)", "dark") + "</div>",
    ]
    why = "".join(f"<li>{html.escape(w)}</li>" for w in o["why"])
    return f"""<section class="opt"><div class="head"><span class="k">{k.upper()}</span><b>agenxy · {html.escape(o['name'])}</b>
<span class="tag">{o['fam']}</span><span class="k">{html.escape(o['weight'])}</span></div>
<p class="idea">{html.escape(o['idea'])}</p><div class="cells">{''.join(cells)}</div>
{gnb(head_logo, '랜딩 헤더 실제 크기 (64px 높이, 바탕 --bg, 오른쪽 버튼은 지금 랜딩 그대로)')}
<div class="why"><div><div class="k">근거</div><ul>{why}</ul></div>
<div><div class="k">레퍼런스와 다른 점</div><p>{html.escape(o['diff'])}</p></div>
<div><div class="k">정직한 위험</div><p class="risk">{html.escape(o['risk'])}</p></div></div></section>"""


def accents() -> str:
    col = SVG / "colour"
    cells = []
    for o in OPTIONS:
        k = o["key"]
        sym = art(f"{k}-symbol-accent", 56, folder=col) if (col / f"{k}-symbol-accent.svg").exists() else ""
        cells.append(f'<div class="box"><b>{k.upper()}</b><div class="drop" style="margin-top:8px">{sym}{art(f"{k}-wordmark-accent", 48, folder=col, maxw=360)}</div></div>')
    return f'<div class="two">{"".join(cells)}</div>'


def dropped() -> str:
    sk = ROOT / "sketch"
    return '<div class="two">' + "".join(
        f'<div class="box drop">{art(n, 34, folder=sk, maxw=240)}<div><b>{t}</b><p>{w}</p></div></div>' for n, t, w in DROPPED
    ) + "</div>"


def page() -> str:
    concepts = "".join(f"<li>{html.escape(c)}</li>" for c in CONCEPTS)
    opts = "".join(option(o) for o in OPTIONS)
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>agenxy 로고 시안 1차</title>
<style>{CSS}</style></head><body><main>
<div class="k">agenxy · 로고 시안 1차 · 2026-11-27 · 체크포인트 — 방향을 고르기 전에는 키트를 만들지 않음</div>
<h1>agenxy — 에이전시, 그리고 x</h1>
<div class="grid3" style="margin-top:18px">
<div class="box"><div class="k">브리프</div>
<p><b>이름</b> agenxy (소문자, '에이전시' 로 읽음 — agency + x).</p>
<p><b>무엇</b> 소상공인을 위한 AI 에이전트 팀 서비스의 공개 브랜드(마케팅 사이트). 랜딩 헤더의 'SoloSquad' 글자를 대신한다.</p>
<p><b>요청</b> "chatcut, upstage, anything, e2b(얇게) 참고". 펭귄 없음.</p>
<p><b>어조</b> 가볍고 정확함 · 테크 · 사람에게 친절. 단색 우선, 강조색은 랜딩의 --accent #2867D0 하나.</p></div>
<div class="box"><div class="k">레퍼런스 분석 (e2b.dev 고객 로고 — 말로만, 로고 파일은 싣지 않음)</div><ul>
<li><b>ChatCut</b> — 굵고 좁은 그로테스크 대문자 섞어 쓰기, 자간 촘촘, 'a' 하나를 바꾼 디테일, 단색 회색.</li>
<li><b>Upstage</b> — 소문자 산세리프, 첫 글자에 표시, 오른쪽에 평행 줄무늬 사선 심볼, 단색.</li>
<li><b>Anything</b> — 얇은 무게, 'Any' 세리프 이탤릭 + 'thing' 그로테스크, 두 스타일의 대비가 아이디어.</li>
<li><b>E2B</b> — 넓고 무거운 기하 블록 글자에 가로 홈. 사용자는 이걸 '얇게' 원함.</li>
<li><b>공통</b> 단색 · 산세리프 · 자간이 고르고 촘촘 · 장치는 하나(바꾼 글자 하나, 작은 심볼 하나, 스타일 대비 하나). → 우리도 장치 하나, 그 장치는 x(에이전시의 x).</li></ul></div>
<div class="box"><div class="k">한 줄 콘셉트 12 → 4</div><ul style="font-size:12px">{concepts}</ul></div>
</div>
<div class="k" style="margin-top:28px">지금 헤더 (비교)</div>{gnb('<span class="cur">SoloSquad</span>', '현재: 15px · 800 텍스트')}
<h2>시안 — 단색 (글자는 모두 코드로 그린 경로, 폰트 없음)</h2>
{opts}
<h2>강조색 (선택, 하나): --accent #2867D0 를 x(또는 건네는 획)에만</h2>
{accents()}
<h2>스케치에서 뺀 것</h2>
{dropped()}
<h2>테스트 결과 요약</h2>
<div class="box"><ul>
<li>svg_audit: 모든 SVG FAIL · WARN 0 (x 획 46–47° → 45° 로 맞춤) — <code>tests/svg-audit.txt</code></li>
<li>테스트 시트(크기 사다리 · 16/32/48px 픽셀 · 단색 · 반전 · blur · 거울 · 컨텍스트 · 일반 도형 선반): <code>tests/symbols-test.png</code> · <code>tests/wordmarks-test.png</code></li>
<li>얇은 워드마크(A · B · C)는 24px 이상에서 깨끗, 16–20px 에서 흐려짐 → 굵은 컷(×1.5)을 헤더 · 작은 자리용으로 따로 둠. 심볼 A · B 는 16px 에서 형태 유지.</li>
<li>거울 · 180°: 소문자라 거울에선 다른 글자열로 읽히지만 나쁜 단어는 없음.</li>
<li>상표 조사 안 함 — 'agenxy' 문자 · 도형을 KIPRIS · USPTO(9 · 35 · 42류)에서 확인 필요. AI 보조 탐색본, 최종본은 사람이 다듬은 벡터.</li></ul></div>
<p class="foot">스크립트: identity/_drafts/agenxy-logo/scripts/ (letters.py · draw.py · build_board.py) · 도구: skills/logo-design</p>
</main></body></html>"""


def pdf(html_path: Path, out: Path) -> None:
    chrome = render_png.find_chrome()
    if not chrome:
        return
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-first-run", *render_png.CHROME_OFFLINE,
                        f"--user-data-dir={tmp}", "--no-pdf-header-footer", f"--print-to-pdf={out}",
                        html_path.resolve().as_uri()], check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=90)


def main() -> None:
    out = ROOT / "board.html"
    out.write_text(page(), encoding="utf-8")
    render_png.screenshot_html(str(out), str(ROOT / "board.png"), 1500, int(sys.argv[1]) if len(sys.argv) > 1 else 5000)
    pdf(out, ROOT / "board.pdf")
    print("wrote", out, ROOT / "board.png", ROOT / "board.pdf")


if __name__ == "__main__":
    main()
