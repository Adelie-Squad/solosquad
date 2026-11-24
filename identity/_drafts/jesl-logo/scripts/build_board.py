"""Build the one presentation board for round 1: board.html (+ board.png, board.pdf via offline Chrome).

    python3 identity/_drafts/jesl-logo/scripts/build_board.py

Reads svg/ (draw.py) and svg/colour/ (colour.py). Every mark is inlined as SVG, so the HTML is one
self-contained file with no network requests. PNG/PDF use the skill's render_png (Chrome, networking off).
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
SKILL = ROOT.parents[2] / "skills" / "logo-design" / "scripts"
sys.path.insert(0, str(SKILL))
import render_png  # noqa: E402  (skill tool: offline Chrome screenshots)

INK = "#111111"

OPTIONS = [
    {
        "key": "a1",
        "fam": "A + B",
        "name": "뒷길 J",
        "type": "추상 심볼 + 글자 음각 (단독 심볼 · 록업)",
        "symbol": "a1-symbol",
        "horizontal": "a1-horizontal-ko",
        "horizontal_en": "a1-horizontal-en",
        "stacked": "a1-stacked",
        "wordmark": "wordmark-ko",
        "small": "a1-symbol",
        "idea": "정사각형 벽 하나를 J 모양 길이 가르고 지나간다. 막힌 덩어리 뒤로 돌아 나가는 길이 곧 JESL 의 J.",
        "values": [
            "구조적 장벽 → 꽉 찬 정사각형(벽), 홀로 도전 → 길은 하나뿐",
            "뒷길을 열어 줌 → 정면이 아니라 벽 뒤로 꺾어 나가는 J 채널",
            "나만의 무기 → 음각 J 가 곧 이름의 머리글자, 따로 그린 기호가 아니라 자기 글자",
        ],
        "risk": "J 는 라틴 독자에게만 읽힌다(한국어 화자에겐 '길 난 사각형'). 사각형 음각은 흔한 형식이라 채널의 곡률·비례로 소유해야 한다.",
    },
    {
        "key": "a2",
        "fam": "A + B",
        "name": "쐐기 ㅈ",
        "type": "자모 심볼 (단독 심볼 · 록업)",
        "symbol": "a2-symbol",
        "horizontal": "a2-horizontal-ko",
        "horizontal_en": "a2-horizontal-en",
        "stacked": "a2-stacked",
        "wordmark": "wordmark-ko",
        "small": "a2-symbol",
        "idea": "제의 첫 자모 ㅈ. 그런데 ㅈ 의 ㅅ(人 · 한 사람)이 칼날이 되어 자기 머리 위 가로획(한계선)을 뚫고 올라간다.",
        "values": [
            "홀로 도전하는 기백 → 人(한 사람)이자 날 선 쐐기 하나가 선을 뚫음",
            "한계를 재정의하는 무기 → 한계선이 끊긴 자리가 정확히 칼날이 지나간 자리",
            "옳은 방향 → 가지(오른 획)는 선을 넘은 뒤에야 갈라진다 — 넘은 다음에 길을 고름",
        ],
        "risk": "16px 에서 별표·大·ㅊ 처럼 보일 수 있다. 사선이 많아 A1 보다 시끄럽다.",
    },
    {
        "key": "c1",
        "fam": "C",
        "name": "제슬 — 선을 지나 길이 되는 획",
        "type": "한글 워드마크 중심 (작은 크기용 '슬' 컷)",
        "symbol": "c1-symbol",
        "horizontal": "c1-wordmark",
        "horizontal_en": None,
        "stacked": "c1-stacked",
        "wordmark": "c1-wordmark",
        "small": "c1-symbol",
        "idea": "슬의 ㅅ 오른 획이 멈추지 않고 ㅡ(경계)를 끊고 내려가 ㄹ(길)이 된다. 슬기가 장벽을 지나 길로 이어진다.",
        "values": [
            "자신의 슬기를 다하라 → '슬' 한 글자 안에서 ㅅ → ㅡ → ㄹ 이 한 동작",
            "구조적 장벽 → 끊긴 ㅡ, 뒷길 → 굽이진 ㄹ 이 길로 그려짐",
            "아마존 · 넷플릭스처럼 글자 자체가 아이디어 — 심볼 없이도 성립",
        ],
        "risk": "가장 고유하지만 가독성 위험: 처음 보는 사람이 '슬' 을 한 번 더 읽는다. 작은 크기(슬 컷)는 24px 아래에서 뭉친다.",
    },
    {
        "key": "c2",
        "fam": "C",
        "name": "JESL — 뒤로 꺾고 앞으로 뻗기",
        "type": "라틴 워드마크 중심 (작은 크기용 S 컷)",
        "symbol": "c2-symbol",
        "horizontal": "c2-wordmark",
        "horizontal_en": None,
        "stacked": "c2-stacked",
        "wordmark": "c2-wordmark",
        "small": "c2-symbol",
        "idea": "J 와 L 은 서로의 거울: J 는 뒤로 꺾이고 L 은 앞으로 뻗는다. 그 사이 S 는 슬의 ㄹ 을 뒤에서 본 모양 — 같은 길.",
        "values": [
            "옳은 방향으로의 뒷길 → 처음엔 뒤로 꺾고(J) 끝에선 앞으로 나감(L)",
            "제슬 ↔ JESL 이 같은 길(ㄹ ↔ S)을 공유 — 두 문자 체계가 한 브랜드",
            "글자만으로 쓰는 라틴 표기 — 해외 · 개발자 접점용",
        ],
        "risk": "아이디어가 조용해서 설명이 필요하다. 모노라인 기하 산세리프는 흔하다 — 단독 로고보다는 다른 안의 라틴 짝으로 더 맞다.",
    },
]

DROPPED = [
    ("a3-1", "ㄹ 길(사각 ㄹ)", "누구나 칠 수 있는 자모 그대로 — 소유할 디테일이 없음. ㄹ 아이디어는 C1 · C2 의 글자 안으로 옮김."),
    ("a4-1", "엇갈린 두 벽(문)", "사선으로 잘린 두 덩어리는 흔한 형식이고 '열림' 이 바로 읽히지 않음."),
]

CSS = """
:root{--ink:#111;--muted:#6b6b6b;--line:#e3e1dc;--paper:#f6f5f1}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
 font:14px/1.55 Pretendard,"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif}
main{max-width:1500px;margin:0 auto;padding:40px 40px 60px}
h1{font-size:30px;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:20px;margin:40px 0 10px}
.k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.brief{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px;margin-top:18px}
.box{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.box p{margin:4px 0}.box ul{margin:4px 0;padding-left:18px}
.opt{background:#fff;border:1px solid var(--line);border-radius:14px;margin-top:22px;padding:20px 22px}
.opt.rec{border:2px solid var(--ink)}
.head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.head b{font-size:22px}.tag{font-size:12px;border:1px solid var(--ink);border-radius:20px;padding:1px 9px}
.tag.r{background:var(--ink);color:#fff}
.idea{font-size:16px;margin:6px 0 14px}
.grid{display:grid;grid-template-columns:170px 1.6fr 1.1fr 1.2fr 1fr 1fr;gap:12px}
.cell{border:1px solid var(--line);border-radius:10px;min-height:180px;display:flex;flex-direction:column}
.cell .art{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:14px;flex-wrap:wrap}
.cell .cap{font-size:11px;color:var(--muted);padding:6px 10px;border-top:1px solid var(--line)}
.dark{background:#111}.dark .cap{color:#aaa;border-color:#333}
.sizes{align-items:flex-end!important}
.sizes span{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;color:var(--muted)}
.why{display:grid;grid-template-columns:2fr 1fr;gap:18px;margin-top:14px}
.why ul{margin:0;padding-left:18px}.risk{color:#7a3b1d}
table{border-collapse:collapse;width:100%;background:#fff}
td,th{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#faf9f6;font-weight:600}
.colours{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.sw{display:inline-block;width:18px;height:18px;border-radius:4px;vertical-align:-4px;margin-right:6px;border:1px solid rgba(0,0,0,.1)}
.row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.drop{display:flex;gap:14px;align-items:center}
.foot{margin-top:40px;color:var(--muted);font-size:12px}
"""


def raw(name: str, folder: Path = SVG) -> str:
    text = (folder / f"{name}.svg").read_text(encoding="utf-8")
    return re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", text).strip()


def art(name: str, h: int | None = None, w: int | None = None, colour: str | None = None,
        folder: Path = SVG) -> str:
    s = raw(name, folder)
    if colour:
        s = s.replace(INK, colour)
    style = []
    if h:
        style.append(f"height:{h}px")
    if w:
        style.append(f"max-width:{w}px")
    style.append("width:auto;display:block")
    return s.replace("<svg ", f'<svg style="{";".join(style)}" ', 1)


def cell(inner: str, cap: str, cls: str = "") -> str:
    return f'<div class="cell {cls}"><div class="art {cls}">{inner}</div><div class="cap">{cap}</div></div>'


def option(o: dict, rec: bool) -> str:
    sizes = "".join(f"<span>{art(o['small'], s)}{s}px</span>" for s in (16, 32, 64))
    wm_small = f"<span>{art(o['wordmark'], 16)}16px</span><span>{art(o['wordmark'], 24)}24px</span>"
    horiz = art(o["horizontal"], 70, 330)
    if o["horizontal_en"]:
        horiz += art(o["horizontal_en"], 52, 300)
    sym_cap = "심볼 단독" if o["fam"].startswith("A") else "작은 크기용 컷 (단독 심볼 아님)"
    cells = [
        cell(art(o["symbol"], 128), sym_cap),
        cell(horiz, "가로 록업 (B)" if o["fam"].startswith("A") else "가로 = 워드마크 그 자체"),
        cell(art(o["stacked"], 150, 230), "세로 록업" + (" (B)" if o["fam"].startswith("A") else " · 이중 표기")),
        cell(art(o["wordmark"], 60, 260), "워드마크 단독"),
        cell(sizes + wm_small, "실제 크기 16 · 32 · 64px", "sizes"),
        cell(
            art(o["symbol"], 64, colour="#000000") + art(o["symbol"], 64, colour="#ffffff"),
            "단색 검정 · 반전(흰색)",
        ),
    ]
    # the inverse needs a dark ground: split the last cell in two
    mono = cell(art(o["symbol"], 64, colour="#000000"), "단색(검정)")
    inv = cell(art(o["symbol"], 64, colour="#ffffff"), "반전(흰색)", "dark")
    cells[-1] = f'<div style="display:grid;grid-template-rows:1fr 1fr;gap:12px">{mono}{inv}</div>'
    vals = "".join(f"<li>{html.escape(v)}</li>" for v in o["values"])
    tags = f'<span class="tag">{o["fam"]}</span>' + ('<span class="tag r">추천</span>' if rec else "")
    return f"""<section class="opt{' rec' if rec else ''}">
<div class="head"><span class="k">{o['key'].upper()}</span><b>{html.escape(o['name'])}</b>{tags}
<span class="k">{html.escape(o['type'])}</span></div>
<p class="idea">{html.escape(o['idea'])}</p>
<div class="grid">{''.join(cells)}</div>
<div class="why"><div><div class="k">뜻 · 가치와 연결</div><ul>{vals}</ul></div>
<div><div class="k">정직한 위험</div><p class="risk">{html.escape(o['risk'])}</p></div></div>
</section>"""


def colours() -> str:
    folder = SVG / "colour"
    blocks = []
    for key, name, ink, acc, paper in (
        ("d1", "D1 먹 · 주홍", "#16181B", "#E2492F", "#F6F3EE"),
        ("d2", "D2 심록", "#123F3A", "#123F3A", "#EEF1EC"),
    ):
        sw = "".join(f'<span class="sw" style="background:{c}"></span>{c} ' for c in dict.fromkeys((ink, acc, paper)))
        row = "".join(art(f"{k}-{key}", 96 if k != "c1" else 70, folder=folder) for k in ("a1", "a2", "c1"))
        note = (
            "생각을 싣는 한 요소(A1 의 J 길, A2 의 칼날, C1 의 ㅅ→ㄹ 획)만 주홍. 나머지는 먹. 단색판은 그대로 유지."
            if key == "d1"
            else "한 가지 색. AI 업계의 기본값(파랑 · 보라 그라데이션)을 피하고 차분 · 단단한 인상. 한지색 바탕과 반전 모두 대비 충분."
        )
        blocks.append(
            f'<div class="box" style="background:{paper}"><b>{name}</b><p>{sw}</p>'
            f'<div class="row" style="margin:12px 0">{row}</div><p class="k" style="text-transform:none;letter-spacing:0">{note}</p></div>'
        )
    return f'<div class="colours">{"".join(blocks)}</div>'


def dropped() -> str:
    sk = ROOT / "sketch"
    out = []
    for name, title, why in DROPPED:
        out.append(f'<div class="drop box">{art(name, 64, folder=sk)}<div><b>{title}</b><p>{why}</p></div></div>')
    return '<div class="colours">' + "".join(out) + "</div>"


def page() -> str:
    opts = "".join(option(o, o["key"] == "a1") for o in OPTIONS)
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>제슬 로고 시안 1차</title>
<style>{CSS}</style></head><body><main>
<div class="k">주식회사 제슬 (JESL) · 로고 시안 1차 · 2026-11-25 · 체크포인트 — 방향을 고르기 전에는 키트를 만들지 않음</div>
<h1>제슬 — 자신의 슬기를 다하라</h1>
<div class="brief">
<div class="box"><div class="k">브리프</div>
<p><b>뜻</b> 제 + 슬기(순우리말): "자신의 슬기를 다하라".</p>
<p><b>가치</b> 구조적 장벽에 홀로 도전하는 기백 · 한계를 재정의하는 나만의 무기 · 옳은 방향으로의 뒷길을 열어 줌.</p>
<p><b>누구</b> 작은 AI 전환(AX) 회사 — 고객은 AI 도입이 막막한 기업의 대표 · 실무자.</p>
<p><b>어조</b> 단단함 · 결기 · 영리함 · 조용한 자신감. 반짝이지 않음.</p>
<p><b>제외</b> 펭귄(사용자 지시). 유료 AI 생성 이미지.</p></div>
<div class="box"><div class="k">카테고리 관습 (설명만, 다른 로고 파일은 쓰지 않음)</div><ul>
<li>국내 AI · IT 컨설팅: 파랑 · 보라 그라데이션, 뇌 · 회로 · 노드 · 반짝이(✦), 위로 향한 화살표, 육각형 · 무한대</li>
<li>기본 굵기 기하 산세리프 워드마크 + 'AI' · 'Lab' 꼬리표</li>
<li>대기업형: 타원 · 원 안의 영문 워드마크</li>
<li>→ 이번 시안: 클리셰 금지, 한글 자모와 이름의 글자에서 형태를 찾음, 1차는 흑백</li></ul></div>
<div class="box"><div class="k">한 줄 콘셉트 12개 → 그린 것</div><ul style="font-size:12px">
<li><b>A1 뒷길 J</b> — 벽을 가르는 J 길 ✓</li><li><b>A2 쐐기 ㅈ</b> — ㅈ 의 칼날이 자기 획을 뚫음 ✓</li>
<li><b>C1 슬의 길</b> — ㅅ → ㅡ 를 끊고 → ㄹ ✓</li><li><b>C2 JESL 거울</b> — J 뒤로, L 앞으로, S = 뒤에서 본 ㄹ ✓</li>
<li>사각 ㄹ 길 · 엇갈린 두 벽(문) — 스케치 후 탈락</li>
<li>ㅔ 의 두 기둥 = 문 · 천장에 난 틈 · 격자를 가로지르는 사선 하나 · 모서리가 열린 사각형 · JS 모노그램 · 홀로 선 점과 벽 — 한 줄에서 탈락(흔함 / 문자 그대로)</li></ul></div>
</div>
<h2>시안 — 흑백 (A 심볼 단독 · B 심볼+워드마크 · C 워드마크 중심)</h2>
{opts}
<h2>로마자 표기 제안</h2>
<table><tr><th>표기</th><th>장점</th><th>단점</th></tr>
<tr><td><b>JESL</b> (워드마크 · 도메인 · 앱)</td><td>4자로 짧고 J ↔ L 이 거울 — 로고(A1 J, C2)와 바로 연결. 상표 · 핸들 조합이 쉬움</td><td>국어 로마자 표기법이 아님. 발음이 '제슬' 로 고정되지 않음(제즐 · 제셀)</td></tr>
<tr><td><b>Jeseul</b> (법인 영문명 · 공문서)</td><td>국립국어원 표기법(2000) 그대로 — 표준, 한국인에게 정확</td><td>6자, 외국인은 '제쇨 · 제시울' 로 읽기 쉬움. 'eu' 가 낯섦</td></tr>
<tr><td>Jesul</td><td>발음에 가깝고 5자</td><td>비표준. 'Jesus' 와 모양이 가까워 피하는 게 좋음</td></tr></table>
<p><b>제안</b> 로고 · 도메인 · 앱은 <b>JESL</b>, 법인 영문 표기는 <b>Jeseul Inc.</b> 처럼 표준 표기를 같이 둔다(둘 다 상표 · 도메인 따로 확인). 워드마크 시안: <span style="display:inline-block;vertical-align:middle">{art("wordmark-en", 26)}</span> · <span style="display:inline-block;vertical-align:middle">{art("wordmark-en-jeseul", 26)}</span></p>
<h2>색 방향 (따로 제안, 최대 2개 — 고른 시안에만 적용)</h2>
{colours()}
<h2>스케치에서 뺀 것</h2>
{dropped()}
<h2>테스트 결과 요약</h2>
<div class="box"><ul>
<li>svg_audit: 17개 SVG 모두 FAIL · WARN 0 (글자 없음, 래스터 · 필터 없음, viewBox 있음) — <code>tests/svg-audit.txt</code></li>
<li>테스트 시트(16 · 32 · 48px 픽셀, 단색, 반전, blur, 거울 · 180°, 파비콘 · 앱 아이콘 · 헤더 · 명함, 일반 도형 사이 선반): <code>tests/symbols-test.png</code> · <code>tests/wordmarks-test.png</code></li>
<li>A1 은 16px 에서도 J 음각이 남음. A2 는 16px 에서 사선이 뭉쳐 별표처럼 보일 수 있음. C1 '슬' 컷은 24px 아래에서 뭉침. 거울 · 180° 에서 나쁜 독해는 발견 못 함(A1 거울 = ㄴ 모양 채널, A2 180° = Y 비슷).</li>
<li>한계: 상표 조사는 하지 않았음 — KIPRIS · USPTO(9 · 35 · 42류)에서 '제슬' · 'JESL' · 'Jeseul' 과 도형을 확인해야 함. 이 시안은 AI 보조 탐색본이며 최종본은 사람이 다듬은 벡터로 확정.</li></ul></div>
<p class="foot">글자는 모두 코드로 그린 경로(폰트 미사용). 그린 스크립트: identity/_drafts/jesl-logo/scripts/ · 도구: skills/logo-design (kaankiziltug/logo-design-skill @ e9eaddc, MIT 기반).</p>
</main></body></html>"""


def pdf(html_path: Path, out: Path) -> None:
    chrome = render_png.find_chrome()
    if not chrome:
        print("PDF skipped: no Chrome")
        return
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-first-run", *render_png.CHROME_OFFLINE,
             f"--user-data-dir={tmp}", "--no-pdf-header-footer", f"--print-to-pdf={out}",
             html_path.resolve().as_uri()],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90,
        )


def main() -> None:
    out = ROOT / "board.html"
    out.write_text(page(), encoding="utf-8")
    print("wrote", out)
    png = ROOT / "board.png"
    render_png.screenshot_html(str(out), str(png), 1500, int(sys.argv[1]) if len(sys.argv) > 1 else 5200)
    print("wrote", png)
    pdf(out, ROOT / "board.pdf")
    print("wrote", ROOT / "board.pdf")


if __name__ == "__main__":
    main()
