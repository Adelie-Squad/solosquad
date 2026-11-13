"""Production aspects: how a video was shot, lit and cut, as pluggable analyses (see base.py for the contract).

Registered in dependency order: framing and camera feed format; editing feeds format. To add an aspect, write a
module with an Aspect subclass, call register() at import, and import it below. The pipeline, VLM prompt, review
template, report and eval pick it up from REGISTRY."""
from __future__ import annotations

import html
import json

from ..i18n import T, semi

from . import framing, camera, lighting, grade, editing, fmt  # noqa: F401  (registration order matters)
from .base import FILMED, PHOTOGRAPHIC, REGISTRY, ShotCtx, get
from .subject import subject

__all__ = ["REGISTRY", "measure_shot", "finalize", "prompt_block", "review_template", "review_guide", "clean_answers",
           "summary_lines", "check", "shot_text", "report_md", "report_html", "shooting_plan"]


# ---------------------------------------------------------------- per shot ---------------------------------------

def measure_shot(frames: list, faces: dict, features: dict, duration: float) -> dict:
    """faces: faces.shot_faces() output (picked frame indexes with their main face)."""
    picked = [p for p in faces.get("frames", []) if p["i"] < len(frames)] or [{"i": i, "face": None} for i in range(0, len(frames), max(1, len(frames) // 6))]
    fr = [frames[p["i"]] for p in picked]
    subs = [subject(frames[p["i"]], p.get("face")) for p in picked]
    ctx = ShotCtx(frames=fr, subjects=subs, features=features, duration=duration)
    out = {}
    for a in REGISTRY:
        m = a.measure(ctx)
        if m:
            out[a.key] = {"measured": m}
    return out


# ---------------------------------------------------------------- questions for image readers --------------------

def _fields(video: bool) -> dict[str, dict[str, str]]:
    out = {}
    for a in REGISTRY:
        fs = a.video_fields if video else a.shot_fields
        if fs:
            out[a.key] = {f.key: f.question for f in fs}
    return out


def prompt_block(video: bool = False, indent: int = 2) -> str:
    """JSON skeleton for the VLM prompt, braces doubled for str.format()."""
    txt = json.dumps(_fields(video), ensure_ascii=False, indent=indent)
    txt = txt.replace("{", "{{").replace("}", "}}")
    return "\n".join((" " * indent + l if i else l) for i, l in enumerate(txt.splitlines()))


def review_template(video: bool = False) -> dict:
    return {k: {f: "" for f in v} for k, v in _fields(video).items()}


def review_guide() -> str:
    lines = []
    for a in REGISTRY:
        for f in a.shot_fields:
            lines.append(T("  {a}.{f}（{l}）：{q}", "  {a}.{f} ({l}): {q}", a=a.key, f=f.key, l=f.zh, q=f.question))
    return "\n".join(lines)


def clean_answers(d, video: bool = False) -> dict:
    """Keep only known aspect fields with non-empty string answers."""
    if not isinstance(d, dict):
        return {}
    out = {}
    for k, fields in _fields(video).items():
        sub = d.get(k) if isinstance(d.get(k), dict) else {}
        vals = {f: str(sub[f]).strip() for f in fields if str(sub.get(f, "") or "").strip()}
        if vals:
            out[k] = vals
    return out


# ---------------------------------------------------------------- per video ---------------------------------------

def finalize(b: dict) -> dict:
    """Interpret every shot, then summarise per aspect. Needs base labels (call after fusion)."""
    for r in b["shots"]:
        asp = r.setdefault("aspects", {})
        if r["base"]["label"] not in PHOTOGRAPHIC:
            for v in asp.values():
                v.pop("result", None)
            continue
        for a in REGISTRY:
            res = a.interpret(r)
            if res:
                asp.setdefault(a.key, {})["result"] = res
    b["aspects"] = {}
    for a in REGISTRY:
        s = a.summarize(b["shots"], b)
        if s:
            b["aspects"][a.key] = s
    b["shooting_plan"] = shooting_plan(b)
    return b["aspects"]


def shooting_plan(b: dict) -> dict:
    """How to film it again: format, framing, camera, lighting set-up with gear, editing rules."""
    A = b.get("aspects") or {}
    if not (A.get("lighting") or {}).get("filmed"):
        return {}
    fr, cam, li, ed, fo = (A.get(k) or {} for k in ("framing", "camera", "lighting", "editing", "format"))
    steps = []
    if fo:
        steps.append(T("形式：{f}", "Format: {f}", f=fmt.FORMAT_ZH[fo["result"]["format"]].split("（")[0].split(" (")[0]))
    if fr.get("result", {}).get("shot_size"):
        steps.append(T("取景：以{s}为主", "Framing: mostly {s}", s=fr["result"]["shot_size"])
                     + (T("，{a}", ", {a}", a=fr["result"]["camera_angle"]) if fr["result"].get("camera_angle") else ""))
    if cam.get("lines"):
        steps.append(cam["lines"][0])
    st = li.get("setup") or {}
    if st:
        steps.append(T("布光：{n}——{d}", "Lighting: {n} — {d}", n=st["name"], d=st["detail"]))
    if ed.get("lines"):
        steps.append(ed["lines"][0])
    return {"steps": steps, "gear": st.get("gear", [])}


def summary_lines(b: dict) -> list[str]:
    out = []
    for a in REGISTRY:
        out += (b.get("aspects") or {}).get(a.key, {}).get("lines", [])
    return out


def check(gt: dict, b: dict) -> dict[str, bool]:
    """gt: {aspect: {field: accepted value(s)}}."""
    out = {}
    for k, want in (gt or {}).items():
        a = get(k)
        if a:
            for f, ok in a.check(want, (b.get("aspects") or {}).get(k) or {}).items():
                out[f"{k}.{f}"] = ok
    return out


def shot_text(r: dict, brief: bool = False) -> str:
    """brief=True: shot size, camera, lighting setup only (the per-shot line of `rea-video summary`;
    key direction / ratio / softness are in the whole-video lines and in report.md)."""
    asp = r.get("aspects") or {}
    fr, cam, li = ((asp.get(k) or {}).get("result") or {} for k in ("framing", "camera", "lighting"))
    if brief:
        support = cam.get("support_zh") or ""
        return semi().join(p for p in (fr.get("shot_size"), fr.get("camera_angle"), support.split("（")[0].split(" (")[0],
                                         li.get("setup_name")) if p)
    parts = [fr.get("shot_size"), fr.get("camera_angle"), cam.get("support_zh"),
             li.get("setup_name"), li.get("key_direction") and T("主光{k}", "key light {k}", k=li["key_direction"]),
             li.get("ratio") and T("光比{r}", "lighting ratio {r}", r=li["ratio"]), li.get("quality")]
    return semi().join(p for p in parts if p)


# ---------------------------------------------------------------- report -----------------------------------------

def _src(row: dict) -> str:
    """Who said what. A source that agrees with the verdict is named only; one that differs shows its own value."""
    final = str(row.get("final", "")).strip()
    bits = []
    for key, name in (("measured", T("测量", "measured")), ("vlm", "VLM"), ("agent", T("看图", "agent review"))):
        v = row.get(key)
        if v in (None, ""):
            continue
        bits.append(name if str(v).strip() == final else f"{name}{T('：', ': ')}{v}")
    return semi().join(bits)


def report_md(b: dict, user: bool = False) -> list[str]:
    """user=True (the reader's report): what was seen and measured only. The editing numbers and the shooting plan
    live in the remake section there, and an image reader's account of the lighting replaces the pixel guess
    (measured values stay in the fold)."""
    A = b.get("aspects") or {}
    if not any(A.get(a.key) for a in REGISTRY):
        return []
    li = A.get("lighting") or {}
    L = ["", T("## 拍法与打光", "## Camera and lighting") if user else T("## 拍法、打光与剪辑", "## Camera, lighting and editing"), ""]
    seen_light = str(((b.get("review_aspects") or {}).get("lighting") or {}).get("lighting_overall") or "")
    for a in REGISTRY:
        lines = (A.get(a.key) or {}).get("lines", [])
        if user and a.key == "editing":
            continue
        if user and a.key == "lighting" and seen_light:
            lines = [T("打光：{l}（看图判断；像素测量见下方折叠）", "Lighting: {l} (image reading; pixel measurements in the fold below)", l=seen_light)]
        L += [f"- {x}" for x in lines]
    plan = b.get("shooting_plan") or {}
    if plan and not user:
        L += ["", T("**复刻拍摄方案**", "**Shooting plan for the remake**"), ""] + [f"{i}. {s}" for i, s in enumerate(plan["steps"], 1)]
        if plan.get("gear"):
            L += ["", T("器材：", "Gear:")] + [f"- {g}" for g in plan["gear"]]
        if (li.get("setup") or {}).get("notes"):
            L += [T("- 注意：{n}", "- Note: {n}", n=n) for n in li["setup"]["notes"]]
    rows = [(a, r) for a in REGISTRY for r in (A.get(a.key) or {}).get("fields", [])]
    if rows:
        L += ["", f"<details class=\"ref\"><summary>{html.escape(T('逐项测量与看图结果（{n} 项）', 'Per-item measurements and image readings ({n})', n=len(rows)))}</summary>", "",
              T("| 维度 | 项目 | 结论 | 来源 |", "| Aspect | Item | Verdict | Sources |"), "|---|---|---|---|"]
        for a, r in rows:
            L.append(f"| {a.title} | {r['zh']} | {str(r['final']).replace('|', '/')} | {_src(r).replace('|', '/')} |")
        L += ["", "</details>"]
    L += ["", T("- 说明：光比、软硬、色温、景别由主体像素测得（有人脸用人脸，没有用画面清晰区域，后者是估算）；平台转码会压暗部，软硬和补光偏保守；"
                "机位角度、光源种类、眼神光、轮廓光以看图结果为准。测量和看图不一致时两者都列出。",
                "- Note: lighting ratio, soft / hard, colour temperature and shot size are measured on the subject's pixels (the face when there is one, "
                "otherwise the in-focus region, which is an estimate); platform transcodes crush the shadows, so hardness and fill read conservative; "
                "camera angle, light source, catchlight and rim light follow the image readers. Where measurement and readers disagree, both are listed.")]
    return L


def report_html(b: dict) -> str:
    A = b.get("aspects") or {}
    if not any(A.get(a.key) for a in REGISTRY):
        return ""
    esc = html.escape
    items = "".join(f"<li>{esc(x)}</li>" for x in summary_lines(b))
    plan = b.get("shooting_plan") or {}
    plan_html = ""
    if plan:
        plan_html = (f"<h4>{T('复刻拍摄方案', 'Shooting plan for the remake')}</h4><ol>" + "".join(f"<li>{esc(s)}</li>" for s in plan["steps"]) + "</ol>"
                     + (f"<h4>{T('器材', 'Gear')}</h4><ul>" + "".join(f"<li>{esc(g)}</li>" for g in plan.get("gear", [])) + "</ul>" if plan.get("gear") else ""))
    rows = "".join(f"<tr><td>{esc(a.title)}</td><td>{esc(r['zh'])}</td><td>{esc(str(r['final']))}</td><td class='muted'>{esc(_src(r))}</td></tr>"
                   for a in REGISTRY for r in (A.get(a.key) or {}).get("fields", []))
    table = f"<table style='width:100%;font-size:13px;border-collapse:collapse'>{rows}</table>" if rows else ""
    return f"<section class='shot'><h3 style='margin:4px 0'>{T('拍法、打光与剪辑', 'Camera, lighting and editing')}</h3><ul>{items}</ul>{plan_html}{table}</section>"
