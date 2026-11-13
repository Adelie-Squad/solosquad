"""Human-readable reports from a breakdown: report.md, and report.html rendered from the same Markdown.

Reading order is short-first, long-last: verdict and numbers → what the video says (structure, script) → who / where
(cast) → sound → look and camera → packaging → how to remake it → shot list → open questions → appendix (per-shot
forensics, metadata). Machine-oriented detail (per-shot evidence, measurement tables, 100-row text timelines) is folded
into <details> so it is there when needed and out of the way otherwise. Language: see i18n (breakdown["lang"]).
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from . import aspects, entities, narrative
from .classify import LABEL_ZH
from .i18n import LangDict, T, join, lang, semi, shot_ids
from .packaging import layer_name, anchor_text
from .production import report_md as production_md
from .sound_source import MUSIC_ZH, SFX_ZH, VOICE_ZH
from .util import fmt_time
from .visual import LABEL_COLOR

KIND_ZH = LangDict({"subtitle": "字幕", "title": "标题", "label": "文字", "static_graphic": "图形贴片", "layout_template": "版式模板",
                    "huazi": "花字", "animated_sticker": "动态贴纸/GIF", "static_sticker": "静态贴纸", "pip": "画中画"},
                   en={"subtitle": "subtitle", "title": "title", "label": "text", "static_graphic": "graphic", "layout_template": "layout template",
                       "huazi": "styled text", "animated_sticker": "animated sticker / GIF", "static_sticker": "static sticker", "pip": "picture-in-picture"})
CAMERA_ZH = LangDict({"static": "固定", "static_with_subject_motion": "固定（主体在动）", "planar_zoom_pan": "整图推拉/平移",
                      "handheld_like": "手持晃动", "smooth_move": "平滑运镜", "unknown": "—"},
                     en={"static": "static", "static_with_subject_motion": "static (subject moves)", "planar_zoom_pan": "whole-frame zoom / pan",
                         "handheld_like": "handheld shake", "smooth_move": "smooth move", "unknown": "—"})
ANIM_ZH = LangDict({"cut": "直接出现", "pop": "弹出", "fade": "淡入", "slide": "滑入", "reveal": "逐字", "cut_out": "直接消失",
                    "pop_out": "缩小消失", "fade_out": "淡出", "slide_out": "滑出"},
                   en={"cut": "hard in", "pop": "pop", "fade": "fade in", "slide": "slide in", "reveal": "type-on", "cut_out": "hard out",
                       "pop_out": "shrink out", "fade_out": "fade out", "slide_out": "slide out"})
GENDER_ZH = LangDict({"male": "偏男声", "female": "偏女声"}, en={"male": "male-leaning", "female": "female-leaning"})
CONF_ZH = LangDict({"medium": "中", "low": "低", "vlm": "VLM 看到"}, en={"medium": "medium", "low": "low", "vlm": "seen by VLM"})
MODE_ZH = LangDict({"music": "背景音乐", "voice": "人声", "sfx": "音效"}, en={"music": "Music", "voice": "Voice", "sfx": "Sound effects"})
# how a shot gets remade, in words (the rule ids stay in breakdown.json for agents)
ROUTE_ZH = LangDict({"ai_video": "AI 生成", "live_action": "实拍", "avatar": "TTS + 数字人", "cg_3d": "AI 生成 / 3D 渲染",
                     "code_render": "代码渲染", "screen_capture": "录屏重建", "still_motion": "本地 ffmpeg 推拉", "static_hold": "静帧",
                     "anim_2d": "AI 生成（2D 动画）", "stop_motion": "实拍定格", "film_footage": "找原片剪辑"},
                    en={"ai_video": "AI generation", "live_action": "reshoot", "avatar": "TTS + avatar", "cg_3d": "AI generation / 3D render",
                        "code_render": "code render", "screen_capture": "screen recording", "still_motion": "local ffmpeg move", "static_hold": "static frame",
                        "anim_2d": "AI generation (2D animation)", "stop_motion": "stop motion shoot", "film_footage": "cut from the source film"})
SFX_SRC_ZH = LangDict({"vlm": "听到", "effects_stem": "音效轨检出", "deterministic": "信号候选（低置信）", "deterministic_anchored": "信号候选，对上文字/贴纸出现（低置信）",
                       "review": "看图复核", "merged": "听到 + 信号"},
                      en={"vlm": "heard", "effects_stem": "on the effects track", "deterministic": "signal candidate (low confidence)", "deterministic_anchored": "signal candidate at a text / sticker pop (low confidence)",
                          "review": "agent review", "merged": "heard + signal"})
ENDING_ZH = LangDict({"natural_end": "自然结束", "fade_out": "淡出", "hard_cut": "硬切断"}, en={"natural_end": "ends naturally", "fade_out": "fades out", "hard_cut": "cut off hard"})
NARR_ZH = LangDict({"tts": "TTS 合成", "human": "真人", "none": "无", "mixed": "真人 + TTS"}, en={"tts": "TTS", "human": "human", "none": "none", "mixed": "human + TTS"})

_MIX_MARK = "<!--mix-->"
_STEMS_MARK = "<!--stems-->"
_FOLD_ROWS = 12  # tables longer than this are folded into <details>


def _colon() -> str:
    return T("：", ": ")


def _cell(x) -> str:
    return str(x if x not in (None, "") else "—").replace("|", "／").replace("\n", " ")


def _row(*cells) -> str:
    return "| " + " | ".join(_cell(c) for c in cells) + " |"


def _table(header: list[str], rows: list[list], fold_title: str | None = None) -> list[str]:
    """A Markdown table; long ones are folded behind a <details> with `fold_title`."""
    if not rows:
        return []
    L = [_row(*header), "|" + "---|" * len(header)] + [_row(*r) for r in rows]
    if fold_title and len(rows) > _FOLD_ROWS:
        return ["", f'<details class="ref"><summary>{html.escape(fold_title)}</summary>', ""] + L + ["", "</details>"]
    return [""] + L


def _points(points: list[str], cap: int = 5) -> str:
    """What a run of shots says, in order; a long run keeps its first few (every shot's point is in the shot list)."""
    pts = list(dict.fromkeys(p for p in points if p))
    more = T(" →（共 {n} 点，逐镜见「分镜表」）", " → (… {n} points, each shot in the shot list)", n=len(pts)) if len(pts) > cap else ""
    return " → ".join(pts[:cap]) + more if pts else "—"


def _shots_str(ids) -> str:
    return shot_ids(ids)


def _layers(rec: dict) -> str:
    ks = []
    for l in rec.get("layers", []):
        k = KIND_ZH.get(l["kind"], l["kind"])
        if k not in ks:
            ks.append(k)
    return join(ks) or "—"


def _origin(rec: dict, brief: bool = False) -> str:
    m = rec.get("material") or {}
    if not m:
        return "—"
    kinds = []
    for it in m.get("items", []):
        if it.get("real_material") and it["kind_zh"] not in kinds:
            kinds.append(it["kind_zh"])
    unsure = sorted({it["kind_zh"] for it in m.get("items", []) if it.get("real_material") is None})
    refs = list(dict.fromkeys(x["kind_zh"] for x in m.get("references", [])))
    # brief (shot list): the kinds of real material say it all ("实拍视频素材"); the origin ("用户真实素材") only when there are none
    return ((join(kinds) if brief and kinds else m.get("origin_zh", "—") + (f"{_colon()}{join(kinds)}" if kinds else ""))
            + (semi() + T("待确认是否真实：", "real or not, to confirm: ") + join(unsure) if unsure else "")
            + (semi() + T("复刻参考：", "references for the remake: ") + join(refs) if refs else ""))


def _unit_of(b: dict) -> dict[int, str]:
    """shot index -> generation unit / shooting scene / code project id from the production plan."""
    plan = b.get("production_plan") or {}
    out: dict[int, str] = {}
    for u in plan.get("units", []):
        for i in u["shots"]:
            out[i] = u["id"]
        for x in u.get("reused") or []:
            out[x["shot"]] = T("{u}（剪自 #{s}）", "{u} (cut from #{s})", u=u["id"], s=x["from"])
    for s in plan.get("shoot", []):
        for i in s["shots"]:
            out[i] = s["id"]
    for c in plan.get("code", []):
        for i in c["shots"]:
            out[i] = c["id"]
    return out


def _route(r: dict, units: dict[int, str]) -> str:
    base = ROUTE_ZH.get(r["base"]["label"], r["replication"].get("executor", ""))
    u = units.get(r["index"])
    return f"{base} · {u}" if u else base


def _t(x) -> str:
    try:
        return f"{float(x):.1f}s"
    except (TypeError, ValueError):
        return "—"


def _span(a, z) -> str:
    try:
        return f"{float(a):.1f}–{float(z):.1f}s"
    except (TypeError, ValueError):
        return "—"


# ------------------------------------------------------------------ sections --------------------------------------

TRANS_ZH = LangDict({"cut": "硬切", "jump": "跳剪", "flash": "闪亮切", "fade": "淡入淡出", "dissolve": "叠化", "wipe": "划像",
                     "slide": "推移", "whip": "甩镜", "zoom": "缩放转场", "spin": "旋转转场", "blur": "模糊转场", "glitch": "故障转场",
                     "shake": "抖动转场", "effect": "转场特效", "mg_transition": "版式切换"},
                    en={"cut": "cut", "jump": "jump cut", "flash": "flash cut", "fade": "fade", "dissolve": "dissolve", "wipe": "wipe",
                        "slide": "slide", "whip": "whip pan", "zoom": "zoom transition", "spin": "spin transition",
                        "blur": "blur transition", "glitch": "glitch transition", "shake": "shake transition",
                        "effect": "transition effect", "mg_transition": "layout change"})
# which way a transition moves: the direction the edge or the picture travels
TRANS_DIR_ZH = LangDict({"left": "向左", "right": "向右", "up": "向上", "down": "向下", "diagonal": "斜向", "center_out": "从中心展开",
                         "edges_in": "向中心收拢"},
                        en={"left": "leftwards", "right": "rightwards", "up": "upwards", "down": "downwards", "diagonal": "diagonal",
                            "center_out": "opening from the centre", "edges_in": "closing in to the centre"})
TRANS_MODE_ZH = LangDict({"push": "新旧画面一起移动", "cover": "新画面滑入盖住旧画面", "reveal": "旧画面滑走露出新画面"},
                         en={"push": "both pictures move", "cover": "the new picture slides in over the old one",
                             "reveal": "the old picture slides away"})
TRANS_VIA_ZH = LangDict({"black": "经黑场", "white": "经白场"}, en={"black": "through black", "white": "through white"})


def transition_text(tr: dict) -> str:
    """One transition in words: kind, direction / mode, length."""
    bits = [TRANS_ZH[tr["type"]] if tr["type"] in TRANS_ZH else tr["type"]]
    bits += [d[tr[k]] for k, d in (("via", TRANS_VIA_ZH), ("direction", TRANS_DIR_ZH), ("mode", TRANS_MODE_ZH)) if tr.get(k) in d]
    if tr.get("duration"):
        bits.append(T("{d:.1f} 秒", "{d:.1f}s", d=tr["duration"]) if tr["duration"] >= 0.1 else T("几帧", "a few frames"))
    return T("，", ", ").join(bits)


_AGENTS = ("agent", "claude", "claude code", "codex", "gpt", "chatgpt", "gemini", "cursor", "copilot", "dsh", "zcode", "deepseek", "kimi", "qwen")


def _readers(b: dict) -> str:
    """Who looked at it, in plain words (no model or service names: those are in breakdown.json)."""
    info, rv = b["analysis"]["vlm"], b["analysis"].get("review") or {}
    bits = [T("工具测量", "tool measurements")]
    status = info.get("status") or ("ok" if info.get("used") else "off")
    if status in ("ok", "partial"):
        n = sum(1 for r in b["shots"] if r.get("vlm"))
        bits.append(T("AI 看图 {n}/{m} 镜", "AI image reading {n}/{m} shots", n=n, m=len(b["shots"])))
    if rv.get("shots"):
        by = str(rv.get("by") or "agent")
        # say who looked: an AI assistant's review is not a person checking the shots
        if by.lower() in _AGENTS:
            bits.append(T("AI 助手看图复核 {n} 镜", "AI assistant reviewed {n} shots", n=rv["shots"]))
        else:
            bits.append(T("{by} 看图复核 {n} 镜", "{by} reviewed {n} shots", by=by, n=rv["shots"]))
    if any(r["base"]["decided_by"] == "user" for r in b["shots"]):
        bits.append(T("用户纠正", "user corrections"))
    out = " + ".join(bits)
    if status in ("failed", "not_configured"):
        out += T("（AI 看图没有生效，只靠工具）", " (AI image reading did not run; tools only)")
    return out


def _mmss(sec: float) -> str:
    sec = float(sec or 0)
    return f"{int(sec // 60)}:{int(sec % 60):02d}"


def _story(b: dict) -> dict:
    """What the video is and why it works: the reviewer's account first, then the whole-video VLM's."""
    rs, w = b.get("review_story") or {}, b.get("whole_video_vlm") or {}
    return {"summary": rs.get("summary") or w.get("summary") or "", "hook": rs.get("hook") or w.get("hook") or "",
            "highlights": [h for h in (rs.get("highlights") or w.get("highlights") or []) if h]}


def _head_md(b: dict) -> list[str]:
    """The card: what it is, how it was made, how sure. Every number here appears nowhere else in the summary part."""
    s, src = b["summary"], b["source"]
    orient = T("竖屏", "vertical") if src["height"] > src["width"] else T("横屏", "horizontal") if src["width"] > src["height"] else T("方屏", "square")
    L = [T("# 这条视频是怎么做的：{f}", "# How this video was made: {f}", f=src["filename"]), ""]
    said = _story(b)["summary"] or _said_from_story(b)
    if said:
        L.append(T("**一句话**：{x}", "**In one line**: {x}", x=said))
    L.append(T("**怎么做的**：{v}", "**How it was made**: {v}", v=s["verdict"].split(T("；", "; "))[0]))
    L += ["", T("- {d} · {o} {ar} · {n} 个镜头，平均 {avg} 秒一个", "- {d} · {o} {ar} · {n} shots, {avg}s each on average",
                d=_mmss(src["duration"]), o=orient, ar=src["aspect_ratio"], n=s["shots"], avg=f"{float(s['avg_shot_s']):.1f}"),
          T("- 判断可靠度 {c:.0%}，依据：{by}", "- Confidence {c:.0%}, based on: {by}", c=s["confidence"], by=_readers(b))]
    qs = entities.open_questions(b)
    if qs:
        L.append(T("- ⚠️ 有 {n} 处拿不准，见「不确定点」", "- ⚠️ {n} points are uncertain, see “Open questions”", n=len(qs)))
    L += ["", _MIX_MARK, "", "![storyboard](storyboard.jpg)"]
    return L


def _highlights_md(b: dict) -> list[str]:
    """Why it works: the hook and the few moves worth learning, each with where it happens."""
    st = _story(b)
    L = [T("- **开头怎么抓人**：{h}", "- **The hook**: {h}", h=st["hook"])] if st["hook"] else []
    L += [f"- {h}" for h in st["highlights"]]
    if not L:  # no reader wrote it: what the story line itself shows
        beats = [x for x in narrative.beats(b) if x.get("points")]
        if not beats:
            return []
        L.append(T("- **开头 {t}**：{p}", "- **Opening {t}**: {p}", t=_span(beats[0]["start"], beats[0]["end"]), p=beats[0]["points"][0]))
        pay = next((x for x in beats if x["role"] == "payoff"), None)
        if pay:
            L.append(T("- **{t} 给结论**：{p}", "- **Payoff at {t}**: {p}", t=_span(pay["start"], pay["end"]), p=pay["points"][0]))
    return ["", T("## 核心看点", "## What makes it work"), ""] + L


_USER_VOICE_HOW = LangDict({"human_recording": "自己录：手机或领夹麦贴近嘴，安静房间里录；台词照「内容与结构」的脚本表改写",
                            "tts": "TTS 配音：剪映「文本朗读」或其他配音工具，选相近的音色和语速",
                            "ai_video_native": "跟 AI 视频一起生成：用能出对白的视频模型，台词写进提示词"},
                           en={"human_recording": "record it yourself: phone or lavalier mic close to the mouth, in a quiet room; rewrite the lines from the script table",
                               "tts": "TTS voice-over: CapCut text-to-speech or another TTS tool, with a similar voice and pace",
                               "ai_video_native": "generated with the AI video: use a video model that speaks, with the lines in the prompt"})


def _sound_brief(b: dict) -> tuple[str, str]:
    """(what the sound is, how to make it) in one line each."""
    a, src = b.get("audio") or {}, b.get("sound_sources") or {}
    if not a.get("has_audio"):
        return T("没有声音", "silent"), "—"
    what, how = [], []
    vs = (src.get("voice") or {}).get("source")
    if (a.get("voice") or {}).get("present"):
        what.append(T("人声", "voice") + (f"（{(src.get('voice') or {}).get('source_zh')}）" if vs and vs != "unknown" else ""))
        if vs in _USER_VOICE_HOW:
            how.append(T("人声：", "voice: ") + _USER_VOICE_HOW[vs].split(T("：", ": "))[0])
    mu = a.get("music") or {}
    if mu.get("present"):
        bits = [x for x in ((f"{mu['tempo_bpm']:.0f} BPM" if mu.get("tempo_bpm") else ""), (src.get("music") or {}).get("source_zh", "")) if x]
        what.append(T("背景音乐", "music") + (f"（{join(bits)}）" if bits and lang() == "zh" else f" ({join(bits)})" if bits else ""))
        how.append(T("配乐：按节奏和情绪找同类曲", "music: find a track with the same tempo and mood"))
    sfx = [e for e in (b.get("audio_plan") or {}).get("sfx_merged", []) if not e.get("in_scene")]
    if sfx:
        kinds = len([g for g in (b.get("audio_plan") or {}).get("sfx_groups") or [] if not g.get("in_scene")])
        what.append(T("音效 {k} 种（共 {n} 处）", "{k} distinct effects ({n} hits)", k=kinds, n=len(sfx)) if 0 < kinds < len(sfx)
                    else T("音效 {n} 处", "{n} sound effects", n=len(sfx)))
        how.append(T("音效：按时间点从音效库加", "effects: add from a library at the listed times"))
    return join(what) or "—", semi().join(how) or "—"


def _overlay_kinds(b: dict) -> list[str]:
    ks: list[str] = []
    for r in b["shots"]:
        for l in r.get("layers", []):
            k = KIND_ZH.get(l["kind"], l["kind"])
            if k not in ks:
                ks.append(k)
    return ks


def _pct(r: float) -> str:
    return "<1%" if 0 < r < 0.01 else f"{r:.0%}"


def _said_from_story(b: dict) -> str:
    """No whole-video read: the format an image reader named, then where the story starts and where it lands."""
    fmt = str(((b.get("review_aspects") or {}).get("format") or {}).get("format") or "")
    beats = [x for x in narrative.beats(b) if x.get("points")]
    arc = ""
    if beats:
        first, last = beats[0]["points"][0], beats[-1]["points"][0]
        arc = first if first == last else f"{first} → … → {last}"
    return T("：", ": ").join(x for x in (fmt, arc) if x)


def _picture_how(b: dict) -> str:
    """How the picture layer gets made, in plain words; the shot counts are in the column beside it."""
    plan = b.get("production_plan") or {}
    bits = []
    if plan.get("shoot"):
        bits.append(T("分 {k} 个场景拍", "filmed in {k} scene{s}", k=len(plan["shoot"]), s="" if len(plan["shoot"]) == 1 else "s"))
    if plan.get("units"):
        again = any(u.get("reused") for u in plan["units"])
        bits.append(T("AI 分 {k} 次生成", "AI in {k} generation{s}", k=plan.get("calls") or len(plan["units"]), s="" if (plan.get("calls") or 1) == 1 else "s")
                    + (T("，重复出现的片段从成片里剪", ", repeated clips cut from the result") if again else ""))
    if plan.get("avatar"):
        bits.append(T("数字人口播", "avatar talking head"))
    if plan.get("code"):
        bits.append(T("录屏 / 代码做动效", "screen recording / motion graphics in code"))
    if plan.get("local"):
        bits.append(T("一张图做静帧或推拉", "a single image held or moved"))
    if plan.get("footage"):
        bits.append(T("找原片剪", "cut from the source film"))
    return semi().join(bits)


def _layers_md(b: dict) -> list[str]:
    """The mental model first: every short video is a picture, things laid on top of it, and sound."""
    s = b["summary"]
    n_by: dict[str, int] = {}
    for r in b["shots"]:
        n_by[r["base"]["label_zh"]] = n_by.get(r["base"]["label_zh"], 0) + 1
    pic = join(T("{l} {n} 镜", "{l} {n} shot{s}", l=m["label_zh"], n=n_by.get(m["label_zh"], 0), s="" if n_by.get(m["label_zh"]) == 1 else "s")
               for m in s["production_mix"] if n_by.get(m["label_zh"]))
    over = _overlay_kinds(b)
    snd, snd_how = _sound_brief(b)
    rows = [[T("**画面**（底层）", "**Picture** (base)"), pic, _picture_how(b) or s.get("production") or "—", T("「自己复刻」", "“Remake it yourself”")],
            [T("**包装**（叠在画面上）", "**Packaging** (on top)"), join(over) or T("没有", "none"),
             T("剪辑软件里加：字幕、花字、贴纸照时间轴摆", "add in the editor: subtitles, styled text and stickers by the timeline") if over else "—",
             T("「剪辑包装层」", "“Packaging layer”")],
            [T("**声音**", "**Sound**"), snd, snd_how, T("「声音」", "“Sound”")]]
    L = ["", T("## 一眼看懂：画面、包装、声音三层", "## At a glance: picture, packaging, sound"), "",
         T("短视频都可以拆成三层：底下是画面本身，上面叠字幕、花字、贴纸，再配上声音。复刻时一层一层做。",
           "Any short video splits into three layers: the picture, what is laid on top of it (subtitles, styled text, stickers), and the sound. Remake it one layer at a time.")]
    L += _table([T("层", "Layer"), T("这条视频里是什么", "In this video"), T("怎么做", "How to make it"), T("细节", "Detail")], rows)
    return L


def _materials_md(b: dict) -> list[str]:
    """What to have before starting: images the generations need, real files the picture shows, references."""
    plan = b.get("production_plan") or {}
    c = entities.cast(b)
    L: list[str] = []
    refs = list({r["what"]: r for u in plan.get("units") or [] for r in u.get("refs") or [] if r.get("user")}.values())
    gen = {i for u in plan.get("units") or [] for i in u["shots"]} | {x["shot"] for u in plan.get("units") or [] for x in u.get("reused") or []}
    ai_cast = [ch["name"] for ch in c["characters"] if set(ch.get("shots") or []) & gen]
    for r in refs:
        person = any(k in r["what"] for k in ("人物", "character"))
        L.append(f"- `{r['tag']}` {r['what']}" + (T("：{n}", ": {n}", n=join(ai_cast)) if ai_cast and person else ""))
    # footage you shoot is the shoot step; only real files shown in the picture are material to collect
    real = _grouped_assets(b, lambda r: [a for a in r.get("replication", {}).get("user_assets", []) if a.get("kind") != "real_footage"], with_where=True)
    if real:
        L += [T("- 画面里直接用的真实文件（截图、照片、录屏，要拿到原文件）：", "- Real files shown in the picture (screenshots, photos, recordings; get the originals):")]
        L += ["  " + x for x in real]
    refs2 = _grouped_assets(b, lambda r: (r.get("material") or {}).get("references", []), with_where=False)
    if refs2 and not refs:
        L += [T("- 拍摄或生成时照着做的参考：", "- References to shoot or generate from:")] + ["  " + x for x in refs2]
    return L


def _speakers_md(b: dict) -> list[str]:
    """Who speaks: one line per separated voice, with its share, pitch and track."""
    who = b.get("speakers") or {}
    people = who.get("speakers") or []
    if not who.get("ok") or len(people) < 2:
        return []
    from .entities import speaker_label

    main = [p for p in people if not p.get("minor")]
    tracks = who.get("tracks") or {}
    L = [T("- 说话人：按音色分出 {n} 个声音", "- Speakers: {n} voices told apart by timbre", n=len(main) or len(people))
         + (T("，另有 {m} 个只出现几秒", ", plus {m} heard for a few seconds only", m=len(people) - len(main)) if main and len(main) < len(people) else "")]
    for p in people:
        bits = [T("{s:.0f} 秒（{r:.0%}）", "{s:.0f}s ({r:.0%})", s=p["seconds"], r=p["share"]),
                T("{n} 段", "{n} turns", n=p["turns"]), T("第一次出现 {t:.1f}s", "first heard at {t:.1f}s", t=p["first"])]
        if p.get("f0_median_hz"):
            bits.append(T("基频约 {f:.0f}Hz（{g}）", "pitch about {f:.0f}Hz ({g})", f=p["f0_median_hz"],
                          g=GENDER_ZH.get(p.get("gender_hint"), T("性别不确定", "gender unclear"))))
        if tracks.get(p["id"]):
            bits.append(f"`stems/{tracks[p['id']]}`")
        L.append(f"  - {speaker_label(b, p['id'])}{_colon()}" + T("，", ", ").join(bits))
    ov = who.get("overlaps") or []
    if ov:
        L.append(T("  - 有 {n} 处两人同时说话（{t}），这几处在两人的音轨里都保留着",
                   "  - Two people talk at once in {n} places ({t}); those stay in both speakers' tracks",
                   n=len(ov), t=T("、", ", ").join(_span(a, z) for a, z in ov[:4]) + ("…" if len(ov) > 4 else "")))
    L.append(T("  - 音色相近的两个人可能被并成一个，同一个人换语气也可能被拆成两个；人数要紧时听各人的音轨确认",
               "  - Two people with similar voices may be merged, and one person changing tone may be split; listen to the tracks when the head count matters"))
    return L


def _edit_md(b: dict) -> list[str]:
    s = b["summary"]
    edit = next((x for x in s.get("aspects") or [] if x.startswith(T("剪辑", "Edit"))), "")
    trans = join(f"{TRANS_ZH[k] if k in TRANS_ZH else k}×{v}" for k, v in s["transitions"].items() if k != "start")
    how = str(((b.get("review_aspects") or {}).get("editing") or {}).get("editing") or "")
    L = [T("- 按「分镜表」的顺序和时长剪", "- Cut in the order and lengths of the shot list")]
    if how:
        L.append(T("- 手法：{h}", "- Approach: {h}", h=how))
    L.append(T("- 节奏：{e}", "- Rhythm: {e}", e=edit.split(T("：", ": "), 1)[-1] if edit else T("平均 {a} 秒一刀", "{a}s per shot", a=f"{float(s['avg_shot_s']):.1f}"))
             + (T("；转场 {t}", "; transitions {t}", t=trans) if trans else ""))
    # every transition that is more than a cut: where, what kind, which way, how long
    fx = [(r, r["transition"]) for r in b.get("shots", []) if (r.get("transition") or {}).get("type") not in (None, "cut", "jump")]
    if fx:
        L += ["", T("**转场**", "**Transitions**")]
        L += _table([T("时间", "Time"), T("进入镜头", "Into shot"), T("转场", "Transition")],
                    [[_span(tr.get("start"), tr.get("end")), f"#{r['index']}", transition_text(tr)] for r, tr in fx],
                    fold_title=T("全部 {n} 处", "all {n}", n=len(fx)))
    return L


def _plan_md(b: dict) -> list[str]:
    """The remake as one section: a short checklist, then the detail of each step in the same order."""
    from .production import report_parts

    plan = b.get("production_plan") or {}
    parts = report_parts(plan) if plan else {}
    steps: list[str] = []
    subs: list[str] = []

    def sub(title: str, body: list[str]) -> None:
        subs.extend(["", f"### {title}", ""] + body)

    steps.append(T("**定内容**：照「内容与结构」的叙事线写自己的脚本",
                   "**Plan the content**: write your script on the narrative line under “Content and structure”")
                 if narrative.beats(b) else
                 T("**定内容**：先看一遍分镜表，记下每段在讲什么，再写你自己的版本",
                   "**Plan the content**: go through the shot list, note what each part says, then write your own version"))
    mats = _materials_md(b)
    if mats:
        steps.append(T("**备素材**：见下方「要准备的素材」", "**Collect material**: see “What to prepare” below"))
        sub(T("要准备的素材", "What to prepare"), mats)
    shoot = plan.get("shoot") or []
    if parts.get("shoot"):
        steps.append(T("**拍摄**：{sc} 个场景、{st} 个机位，见下方「拍摄」", "**Shoot**: {sc} scenes, {st} camera setups, see “Shoot” below",
                       sc=len(shoot), st=sum(len(x.get("setups") or []) for x in shoot)))
        body = list(parts["shoot"])
        sp = b.get("shooting_plan") or {}
        if sp.get("gear") and not ((b.get("review_aspects") or {}).get("lighting") or {}).get("lighting_overall"):
            body += [T("器材（按测得的光线推的）：", "Gear (inferred from the measured light):")] + [f"- {g}" for g in sp["gear"]]
        sub(T("拍摄", "Shoot"), body)
    if parts.get("units"):
        steps.append(T("**AI 生成**：{c} 次生成，见下方「AI 生成」", "**Generate**: {c} generation{s}, see “AI generation” below",
                       c=plan.get("calls") or len(plan["units"]), s="" if (plan.get("calls") or 1) == 1 else "s"))
        sub(T("AI 生成", "AI generation"), [f"**{plan['summary'].split(T('；', '; '))[0]}**", ""] + parts.get("pre", []) + parts["units"])
    for key, title, step in (("code", T("代码合成", "Code build"), T("**录屏和动效**：见下方「代码合成」", "**Screen and motion graphics**: see “Code build” below")),
                             ("local", T("本地重建", "Local rebuild"), T("**静帧 / 推拉**：见下方「本地重建」", "**Stills / moves**: see “Local rebuild” below")),
                             ("footage", T("影视原片", "Film / TV source"), T("**影视片段**：见下方「影视原片」", "**Film / TV clips**: see “Film / TV source” below"))):
        if parts.get(key):
            steps.append(step)
            sub(title, parts[key])
    steps.append(T("**剪辑**：见下方「剪辑」", "**Edit**: see “Edit” below"))
    sub(T("剪辑", "Edit"), _edit_md(b))
    files = ((b.get("packaging") or {}).get("files") or {})
    if _overlay_kinds(b):
        steps.append(T("**包装**：", "**Packaging**: ")
                     + (T("字幕文件 `{f}` 可以直接导入剪辑软件；", "the subtitle file `{f}` imports straight into an editor; ", f=next(iter(files.values()))) if files else "")
                     + T("样式和时间轴见「剪辑包装层」", "styles and timeline under “Packaging layer”"))
    if (b.get("audio") or {}).get("has_audio"):
        steps.append(T("**声音**：见「声音」，每处音效都能先试听", "**Sound**: see “Sound”; every effect can be played first"))
    steps.append(T("**对照检查**：成片和原片并排看一遍：镜头长短、字幕位置、音乐起落对不对得上",
                   "**Compare**: watch yours next to the original: shot lengths, subtitle positions, where the music comes in and drops"))
    return (["", T("## 自己复刻：按这个顺序做", "## Remake it yourself: do it in this order"), "",
             T("复刻的是做法和节奏，不是照抄画面。", "Copy the method and the rhythm, not the pictures."), ""]
            + [f"{i}. {x}" for i, x in enumerate(steps, 1)] + subs)


def _content_md(b: dict, user: bool = False) -> list[str]:
    """user=True: the summary and hook are already at the top of the reader's report."""
    w = b.get("whole_video_vlm") or {}
    lines = entities.script(b)
    L = ["", T("## 内容与结构", "## Content and structure"), ""]
    if not w and not lines:
        if narrative.beats(b):
            L.append(T("- 下面的叙事线来自逐镜看图；台词没有单独整理，字幕原文见「剪辑包装层」",
                       "- The narrative line below comes from reading each shot; the lines were not transcribed separately, subtitle text is under “Packaging layer”"))
        else:
            L.append(T("- 这次没有分析整片内容（要开 AI 看图）；字幕原文见「剪辑包装层」",
                       "- The whole video's content was not analysed this time (needs AI image reading); subtitle text is under “Packaging layer”"))
        return L + _narrative_md(b)
    if w.get("summary") and not user:
        L.append(T("- 概括：{s}", "- Summary: {s}", s=w["summary"]))
    bits = []
    if w.get("format"):
        bits.append(T("形式：{f}", "format: {f}", f=w["format"]))
    if w.get("hook") and not user:
        bits.append(T("钩子：{h}", "hook: {h}", h=w["hook"]))
    if bits:
        L.append("- " + semi().join(bits))
    if w.get("overall_production") and not user:
        L.append(T("- 整体制作：{o}", "- Overall production: {o}", o=w["overall_production"]))
    segs = [sg for sg in (w.get("segments") or []) if isinstance(sg, dict)][:30]
    if segs:
        L += ["", T("**结构时间轴**", "**Structure**")]
        L += _table([T("时间", "Time"), T("这一段在做什么", "Beat"), T("文案", "Copy"), T("声音", "Audio")],
                    [[_span(sg.get("start"), sg.get("end")), sg.get("beat", ""), sg.get("copy", ""), sg.get("audio", "")] for sg in segs])
    L += _narrative_md(b)
    if lines:
        n = w.get("narration") or {}
        head = T("**脚本**", "**Script**")
        if n.get("type") and n.get("type") != "none":
            head += T("（{t}{v}）", " ({t}{v})", t=NARR_ZH.get(n["type"], n["type"]), v=(T("，", ", ") + n["voice"]) if n.get("voice") else "")
        if lines[0].get("source") == "asr":
            head += T("（本地语音识别，未校对；同音字和专有名词以画面字幕为准）", " (local speech recognition, unchecked; trust on-screen subtitles for names and homophones)")
        L += ["", head]
        L += _table([T("时间", "Time"), T("谁", "Who"), T("台词 / 旁白", "Line")],
                    [[_span(ln["start"], ln["end"]), ln["speaker"] or T("旁白", "narration"), ln["text"]] for ln in lines], fold_title=T("全部 {n} 句", "all {n} lines", n=len(lines)))
        if any(ln.get("voice") for ln in lines) and lines[0].get("source") == "asr":
            L.append(T("- 「谁」这一列按音色分出来的说话人填写，对应的单人音轨见「声音」",
                       "- The “Who” column is filled from the voices separated by timbre; each one's own track is under “Sound”"))
    return L


def _narrative_md(b: dict) -> list[str]:
    """The story as a sequence of jobs (hook, information, conclusion ...), each with the point it makes."""
    steps = narrative.beats(b)
    if not steps:
        return ["", T("- 这次没有整理出叙事线（每个镜头在讲什么，要开 AI 看图）；可以先看分镜表的「画面」列",
                      "- No narrative line this time (what each shot is doing in the story needs AI image reading); the “Picture” column of the shot list is a start")]
    L = ["", T("**叙事线**", "**Narrative line**"), "",
         T("复刻时保留这条线：每一步的顺序和作用照搬，讲的那一点换成自己的案例、数据和素材，就不只是换个主角。",
           "Keep this line in a remake: same order, same job at each step, with the point refilled from your own cases, numbers and material, so it is more than a change of subject.")]
    L += _table([T("时间", "Time"), T("镜头", "Shots"), T("作用", "Job"), T("在讲什么", "What it says")],
                [[_span(s["start"], s["end"]), _shots_str(s["shots"]), s["role_zh"] or "—", _points(s["points"])] for s in steps])
    return L


def _cast_md(b: dict) -> list[str]:
    c = entities.cast(b)
    L = ["", T("## 角色、场景与道具", "## Cast, scenes and props"), ""]
    if c["characters"]:
        L += _table([T("编号", "Id"), T("称呼", "Name"), T("类型", "Kind"), T("外观", "Look"), T("作用", "Role"), T("声音", "Voice"), T("出场", "Shots")],
                    [[ch["id"], ch["name"], entities.KIND_ZH.get(ch["kind"], ch["kind"]), ch["look"], ch["role"], ch["voice"], _shots_str(ch["shots"])] for ch in c["characters"]])
    else:
        L.append(T("- 这次没有整理出角色（要开 AI 看图）",
                   "- No cast extracted this time (needs AI image reading)")
                 + (T("；人脸检测器在这些镜头看到脸（真人或角色）：{s}", "; shots where the face detector saw a face (person or character): {s}", s=_shots_str(c["face_shots"])) if c["face_shots"] else ""))
    if c["scenes"]:
        L += ["", T("**场景**", "**Scenes**")]
        L += _table([T("场景", "Scene"), T("地点", "Where"), T("时间", "When"), T("布景 / 光线", "Set / light"), T("镜头", "Shots")],
                    [[sc["id"], sc["where"], sc["when"], sc["look"], _shots_str(sc["shots"])] for sc in c["scenes"]])
    if c["props"]:
        L += ["", T("**道具 / 商品 / Logo**", "**Props / products / logos**"), ""]
        for p in c["props"]:
            L.append(f"- {p['name']}" + (T("（镜头 {s}）", " (shots {s})", s=_shots_str(p["shots"])) if p["shots"] else "") + (f"{_colon()}{p['note']}" if p.get("note") else ""))
    return L


_RE_RULE_ID = re.compile(r"（[A-Z]\d\d[^）]*）|\([A-Z]\d\d[^)]*\)")


def _plain_how(h: str) -> str:
    """Remake hints come from the plan, which also feeds the capsule-cinema integration: drop rule ids from what users read."""
    return _RE_RULE_ID.sub("", h or "").strip()


def _audio_md(b: dict) -> list[str]:
    a = b.get("audio", {})
    L = ["", T("## 声音", "## Sound"), ""]
    if not a.get("has_audio"):
        L.append(T("- 没有音轨", "- No audio track"))
        return L
    w = b.get("whole_video_vlm") or {}
    src = b.get("sound_sources") or {}
    tracks = {t["track"]: t for t in (b.get("audio_plan") or {}).get("plan", [])}
    L.append("![audio](audio.png)")
    L.append("")
    over = [T("响度 {r} dBFS，峰值 {p} dBFS", "loudness {r} dBFS, peak {p} dBFS", r=a.get("rms_dbfs"), p=a.get("peak_dbfs"))]
    if w.get("mix"):
        over.append(T("混音：{m}", "mix: {m}", m=w["mix"]))
    pc = b.get("per_clip_audio") or {}
    if pc.get("ratio") is not None:
        over.append(T("每段画面自带声音（切点处背景声跳变 {a}dB，镜头内 {w}dB）", "each clip carries its own sound (background jumps {a}dB at cuts vs {w}dB within shots)", a=pc["at_cuts_db"], w=pc["within_shots_db"])
                    if pc.get("resets_at_cuts") else
                    T("声音跨切点连续，是后期整体铺的（切点处背景声变化 {a}dB，镜头内 {w}dB）", "sound runs across cuts, laid in post as one bed (background changes {a}dB at cuts vs {w}dB within shots)", a=pc["at_cuts_db"], w=pc["within_shots_db"]))
    L.append("- " + semi().join(over))
    if src.get("summary_zh"):
        L.append(T("- 来源判断：{s}", "- Sources: {s}", s=src["summary_zh"]))

    def _source_lines(k: str) -> list[str]:
        v = src.get(k) or {}
        if not v:
            return []
        names = {"voice": VOICE_ZH, "music": MUSIC_ZH, "sfx": SFX_ZH}[k]
        probs = T("，", ", ").join(f"{names.get(kk, kk)} {vv:.0%}" for kk, vv in sorted(v["probs"].items(), key=lambda kv: -kv[1])[:3])
        out = [T("- 来源：{s}（{p}）", "- Source: {s} ({p})", s=v["source_zh"], p=probs)]
        out += [f"  - {e}" for e in v.get("evidence", [])[:4]]
        out += [T("  - 确认方法：{h}", "  - How to confirm: {h}", h=h) for h in v.get("how_to_confirm", [])[:2]]
        return out

    # voice
    v = a.get("voice", {})
    n = w.get("narration") or {}
    L += ["", T("**人声**", "**Voice**"), ""]
    if v.get("present"):
        bits = [T("占 {r:.0%} 时长", "{r:.0%} of the duration", r=v.get("ratio", 0))]
        if n.get("type") and n["type"] != "none":
            bits.append(NARR_ZH.get(n["type"], n["type"]) + (T("，{v}", ", {v}", v=n["voice"]) if n.get("voice") else "") + (T("，{s}", ", {s}", s=n["style"]) if n.get("style") else ""))
        if v.get("f0_median_hz"):
            bits.append(T("基频约 {f}Hz（{g}）", "pitch about {f}Hz ({g})", f=v["f0_median_hz"], g=GENDER_ZH.get(v.get("gender_hint"), T("性别不确定", "gender unclear"))))
        if v.get("sung"):
            bits.append(T("是唱的", "sung"))
        L.append("- " + semi().join(bits))
        L += _speakers_md(b)
        L += _source_lines("voice")
        vs = (src.get("voice") or {}).get("source")
        if vs in _USER_VOICE_HOW:
            L.append(T("- 复刻：{h}", "- Remake: {h}", h=_USER_VOICE_HOW[vs]))
        elif tracks.get("voice"):
            L.append(T("- 复刻：{h}", "- Remake: {h}", h=_plain_how(tracks["voice"]["how"])))
        if entities.script(b):
            L.append(T("- 台词见「内容与结构」的脚本表", "- Lines are in the script table under “Content and structure”"))
    else:
        who = _speakers_md(b)
        if who or (b.get("speech") or {}).get("lines"):
            # the mix is mostly music, so the voice measure says "little"; the separated voice track still has lines on it
            L.append(T("- 占时长很少（混音里以配乐为主），在分离出的人声干声上能听到台词",
                       "- A small share of the duration (the mix is mostly music); lines can be heard on the separated voice track"))
            L += who
            if entities.script(b):
                L.append(T("- 台词见「内容与结构」的脚本表", "- Lines are in the script table under “Content and structure”"))
        else:
            L.append(T("- 无 / 很少", "- None / very little"))

    # music
    mu = a.get("music", {})
    vm = w.get("music") or {}
    L += ["", T("**背景音乐**", "**Music**"), ""]
    if mu.get("present") or vm.get("present"):
        if vm.get("song_guess"):
            L.append(T("- 歌曲：{s}", "- Song: {s}", s=vm["song_guess"]))
        desc = [x for x in (vm.get("style"), vm.get("genre"), vm.get("mood")) if x]
        if vm.get("instruments"):
            desc.append(join(vm["instruments"][:5]))
        if vm.get("has_vocals") is not None:
            desc.append(T("有人声演唱", "with vocals") if vm.get("has_vocals") else T("纯音乐", "instrumental"))
        if desc:
            L.append(T("- 风格：", "- Style: ") + semi().join(desc))
        if vm.get("lyrics_excerpt"):
            L.append(T("- 歌词：{l}", "- Lyrics: {l}", l=str(vm["lyrics_excerpt"])[:120])
                     + (T("（唱的就是画面内容）", " (the lyrics describe the video itself)") if vm.get("lyrics_match_content") else ""))
        tempo = []
        if mu.get("no_beat"):
            tempo.append(T("无明显节拍（持续音，没有打击成分）", "no clear beat (a held tone, nothing percussive)"))
        if mu.get("tempo_bpm"):
            tempo.append(T("{bpm} BPM（也可能是 {alt}）", "{bpm} BPM (or {alt})", bpm=mu["tempo_bpm"], alt="/".join(str(t) for t in mu.get("tempo_alternatives", []))) if mu.get("tempo_alternatives")
                         else f"{mu['tempo_bpm']} BPM")
        key = mu.get("key") or {}
        if key:
            tempo.append(T("调性 {t} {m}（置信 {c}）", "key {t} {m} (confidence {c})", t=key.get("tonic"), m=key.get("mode"), c=key.get("confidence")))
        if mu.get("present"):
            tempo.append(T("占 {r:.0%} 时长（{s}–{e}s）", "{r:.0%} of the duration ({s}–{e}s)", r=mu.get("ratio", 0), s=mu.get("start"), e=mu.get("end")))
        if mu.get("section_changes"):
            tempo.append(T("段落变化点 {p}", "section changes at {p}", p=", ".join(str(t) + "s" for t in mu["section_changes"][:8])))
        ending = vm.get("ending") or (src.get("music") or {}).get("ending")
        if ending:
            tempo.append(T("片尾{e}", "ending: {e}", e=ENDING_ZH.get(ending, ending)))
        if tempo:
            L.append(T("- 节奏：", "- Tempo: ") + semi().join(tempo))
        if "cuts_on_beat_ratio" in a:
            L.append(T("- 剪辑与节拍：{r:.0%} 的切点落在节拍上（随机约 {c:.0%}）", "- Cuts vs beat: {r:.0%} of cuts land on a beat (chance: about {c:.0%})",
                       r=a["cuts_on_beat_ratio"], c=a["cuts_on_beat_chance"]) + (T(" → **卡点剪辑**", " → **beat-synced edit**") if a.get("beat_synced_edit") else ""))
        L += _source_lines("music")
        if tracks.get("music"):
            L.append(T("- 复刻：{h}", "- Remake: {h}", h=_plain_how(tracks["music"]["how"])))
    elif mu.get("steady_tone"):
        L.append(T("- 不是音乐：整段是一个持续单音（约 {hz:.0f} Hz），没有旋律、和声和节拍，像测试音、提示音或电流声",
                   "- Not music: one held pitch (about {hz:.0f} Hz) with no melody, harmony or beat, like a test tone, a beep or mains hum",
                   hz=mu["steady_tone"]["hz"]))
    else:
        L.append(T("- 未检测到持续的音乐床", "- No sustained music bed detected"))

    # sfx
    sfx = (b.get("audio_plan") or {}).get("sfx_merged", [])
    n_maybe = sum(1 for e in sfx if e.get("confidence") == "low")
    count = (T("{n}，其中 {m} 处是待确认的信号候选", "{n}, of which {m} are unconfirmed signal candidates", n=len(sfx), m=n_maybe)
             if n_maybe and n_maybe < len(sfx) else T("{n}，都是待确认的信号候选", "{n}, all unconfirmed signal candidates", n=len(sfx)) if n_maybe else str(len(sfx)))
    all_groups = (b.get("audio_plan") or {}).get("sfx_groups") or []
    groups = [g for g in all_groups if not g.get("in_scene")]
    if all_groups:
        n_add = sum(g["count"] for g in groups)
        count = (T("{n} 处，{k} 种声音", "{n} hits, {k} distinct sounds", n=n_add, k=len(groups)) if len(groups) < n_add else str(n_add))
    L += ["", T("**音效**", "**Sound effects**") + (f"（{count}）" if sfx and lang() == "zh" else (f" ({count})" if sfx else "")), ""]

    def group_rows(gs: list[dict]) -> list[list]:
        rows = []
        for k, g in enumerate(gs, 1):
            mem = [e for e in sfx if e.get("group") == g["id"]]
            on = list(dict.fromkeys(x for x in (((e.get("on") or {}).get("what") or (T("切镜", "cut") if e.get("sync_with_visual") else "")) for e in mem) if x))
            clip = g.get("clip") or next((e.get("clip") for e in mem if e.get("clip")), None)
            rows.append([f"F{k}", f"[{T('试听', 'listen')}]({clip})" if clip else "—", g.get("type") or "—", g["count"],
                         join(f"{t:.1f}s" for t in g["times"]), semi().join(on[:3]) or "—"])
        return rows

    head = [T("声音", "Sound"), T("试听", "Listen"), T("类型", "Type"), T("次数", "Times used"), T("出现在", "At"), T("对应画面", "On screen")]
    if all_groups:
        # one row per distinct sound: listen once, then where it is used
        if groups:
            L += _table(head, group_rows(groups), fold_title=T("全部 {n} 种音效（可试听）", "all {n} distinct effects (with audio)", n=len(groups)))
            L.append("")
            L.append(T("- 复刻：每种声音先点「试听」听一下（已单独分离出来，听不到人声和配乐），到剪辑软件的音效库里找一个同类的，按「出现在」的时间点放到每一处",
                       "- Remake: play each sound first (separated out, without voice or music), find one similar effect in the editor's library, and place it at every time listed under “At”"))
        else:
            L.append(T("- 没有找到后期加的音效", "- No effects added in the edit were found"))
    elif sfx:
        rows = []
        has_clip = any(e.get("clip") for e in sfx)  # cut from the original sound: hear it, then find a similar one
        for e in sfx[:60]:
            on = (e.get("on") or {}).get("what") or e.get("sync_with", T("切点", "cut") if e.get("sync_with_visual") else "")
            clip = [f"[{T('试听', 'listen')}]({e['clip']})" if e.get("clip") else "—"] if has_clip else []
            rows.append([f"{float(e.get('t', 0)):.2f}s", *clip, e.get("type", ""), e.get("description", "") or e.get("anchor", ""), on, SFX_SRC_ZH.get(e.get("source"), e.get("source", ""))])
        L += _table([T("时间", "Time"), *([T("试听", "Listen")] if has_clip else []), T("类型", "Type"), T("描述", "Description"), T("对应画面", "On screen"), T("依据", "Basis")], rows,
                    fold_title=T("全部 {n} 处音效", "all {n} sound effects", n=len(rows)) + (T("（可试听）", " (with audio)") if has_clip else ""))
        L.append("")
        L += _source_lines("sfx")
        alone = any(e.get("source") == "effects_stem" for e in sfx)
        L.append(T("- 复刻：先点「试听」听这一下是什么声{a}，再到剪辑软件的音效库里找同类音效，按时间点放；对应画面一栏写了它卡在什么动作上",
                   "- Remake: press “listen” to hear what each one is{a}, then take a similar effect from the editor's sound library and place it at that time; “On screen” says what each one lands on",
                   a=T("（已单独分离出来，听不到人声和配乐）", " (separated out, without the voice and music)") if alone
                   else T("（片段从原声里剪的，会带着人声和配乐）", " (cut from the original sound, so voice and music are in it)")))
    else:
        L.append(T("- 没有找到明显的音效（人声和音乐下面很轻的音效可能漏掉）",
                   "- No clear sound effects found (very quiet ones under the voice and music may be missed)"))

    # ambience + files
    amb = w.get("ambience") or (tracks.get("ambience") or {}).get("what")
    if amb or tracks.get("ambience"):
        L += ["", T("**环境声**", "**Ambience**"), "", f"- {amb or '—'}" + (T("；复刻：{h}", "; remake: {h}", h=tracks["ambience"]["how"]) if tracks.get("ambience") else "")]
    st = b.get("stems") or {}
    if st.get("ok"):
        L += ["", T("- 分离出的音轨：`stems/original.wav`（原声）、`stems/vocals.wav`（人声干声）、`stems/music.wav`（配乐 + 环境声）",
                    "- Separated stems: `stems/original.wav` (original), `stems/vocals.wav` (dry voice), `stems/music.wav` (music + ambience)")
              + (T("、`stems/effects.wav`（音效轨）", ", `stems/effects.wav` (effects track)") if st.get("effects") else ""),
              _STEMS_MARK]
    if (b.get("audio_plan") or {}).get("mix"):
        L.append(T("- 混音复刻：{m}", "- Mix for the remake: {m}", m=b["audio_plan"]["mix"]))
    return L


def _visual_md(b: dict, user: bool = False) -> list[str]:
    style = entities.cast(b).get("style")
    L = aspects.report_md(b, user=user)
    if not L and not style:
        return []
    if not L:
        L = ["", T("## 拍法与打光", "## Camera and lighting") if user else T("## 拍法、打光与剪辑", "## Camera, lighting and editing"), ""]
    if style:
        L.insert(3, T("- 视觉风格：{s}", "- Visual style: {s}", s=style))
    return L


def packaging_md(b: dict) -> list[str]:
    """剪辑包装层: subtitles / 花字 / titles / labels / stickers and the sound effects that land on them."""
    pack = b.get("packaging")
    if not pack:
        return []
    cues = [c for c in pack.get("text_cues", []) if c["kind"] != "scene" and not c.get("part_of_picture")]
    stickers = [st for st in pack.get("stickers", []) if not st.get("in_picture")]
    L = ["", T("## 剪辑包装层（字幕 / 花字 / 贴纸 / 音效卡点）", "## Packaging layer (subtitles / styled text / stickers / sound-effect hits)"), ""]
    for line in pack.get("summary_zh") or []:
        L.append(f"- {line}")
    if not cues and not stickers:
        L.append(T("- 没有检出后期叠加的文字或贴纸", "- No overlaid text or stickers detected")
                 + (T("（未开 OCR，文字层没有分析）", " (OCR off, text layer not analysed)") if not (b.get("analysis") or {}).get("ocr", True) else ""))
    files = pack.get("files") or {}
    if files:
        L.append(T("- 导出：", "- Exports: ") + join(f"`{v}`" for v in files.values())
                 + T("（SRT 是字幕时间轴；ASS 带颜色、描边、位置和入场动画，字体需要换成原片字体；timeline.json 是完整时间轴）",
                     " (SRT is the subtitle timeline; ASS carries colour, outline, position and entrance animation, swap in the original font; timeline.json is the full timeline)"))
    if cues:
        sfx_by_ref: dict[str, list[str]] = {}
        for e in [x for x in (b.get("audio_plan") or {}).get("sfx_merged", []) if not x.get("in_scene")]:  # the picture's own sound is not a cue
            ref = (e.get("on") or {}).get("ref")
            if ref:
                sfx_by_ref.setdefault(ref, []).append(str(e.get("type", "")))
        rows = []
        for c in sorted(cues, key=lambda c: c["t0"])[:120]:
            anim = " / ".join(x for x in (ANIM_ZH.get((c.get("anim_in") or {}).get("kind"), ""), ANIM_ZH.get((c.get("anim_out") or {}).get("kind"), "")) if x)
            if c.get("mid_motion"):
                anim += T("（中途有弹跳/变色）", " (bounces / changes colour midway)")
            kind = c["kind_zh"] + (T("·跟随物体", " · follows an object") if c.get("follows") else "")
            rows.append([f"{c['t0']:.2f}–{c['t1']:.2f}s", kind, c["text"].replace("/", " ⏎ ")[:40], c.get("style_zh", ""), anim or "—", join(sfx_by_ref.get(c["id"], [])) or "—"])
        L += _table([T("时间", "Time"), T("类型", "Kind"), T("文字", "Text"), T("样式", "Style"), T("入场 / 出场", "In / out"), T("音效", "SFX")], rows,
                    fold_title=T("文字时间轴（{n} 条）", "text timeline ({n} rows)", n=len(rows)))
    if stickers:
        rows = []
        for st in stickers:
            where = (T("x{0:.0%} y{1:.0%} 宽{2:.0%} 高{3:.0%}", "x{0:.0%} y{1:.0%} w{2:.0%} h{3:.0%}").format(*st["bbox"]) if st.get("bbox") else (st.get("where") or "—"))
            dyn = (T("循环，周期 {p:.2f}s", "loops every {p:.2f}s", p=st["loop_period_s"]) if st.get("looping")
                   else (T("在动", "animated") if st.get("animated") else T("静止", "static")))
            why = []
            if st.get("crosses_cut"):
                why.append(T("跨切镜不变", "unchanged across a cut"))
            if st.get("disappears_mid_shot"):
                why.append(T("镜头中途出现又消失", "appears and disappears mid-shot"))
            conf = CONF_ZH.get(st.get("confidence"), st.get("confidence", "")) + (T("（{w}）", " ({w})", w=join(why)) if why else "")
            rows.append([f"{st['t0']:.2f}–{st['t1']:.2f}s", st["kind_zh"], where, dyn, conf, f"![{st['id']}]({st['image']})" if st.get("image") else "—"])
        L += ["", T("**贴纸 / 动图 / 画中画**", "**Stickers / GIFs / picture-in-picture**")]
        L += _table([T("时间", "Time"), T("类型", "Kind"), T("位置", "Position"), T("动态", "Motion"), T("置信", "Confidence"), T("截图", "Crop")], rows)
        dropped = [st for st in pack.get("stickers", []) if st.get("in_picture")]
        if dropped:
            L.append(T("- 另有 {n} 处画面里突然出现的东西没算作贴纸（3D/动画/版式画面里元素本来就会出现）",
                       "- {n} more things that pop up in the picture were not counted as stickers (elements appear on their own in 3D / animation / layout shots)", n=len(dropped)))
    anchored = sorted((e for e in cues + stickers if e.get("anchor")), key=lambda e: e["t0"])
    if anchored:
        rows = [[f"{e['t0']:.2f}s", layer_name(e), anchor_text(e["anchor"])] for e in anchored[:80]]
        L += _table([T("时间", "Time"), T("元素", "Layer"), T("跟哪句台词", "Spoken line")], rows,
                    fold_title=T("按台词定位（{n} 处，复刻换文案时按这句话放，不按原秒数）", "placed by spoken line ({n}; with new wording place each on its line, not the old second)", n=len(anchored)))
    if pack.get("vlm_text_effects"):
        fx = pack["vlm_text_effects"][:20]
        L += ["", f"<details class=\"ref\"><summary>{html.escape(T('VLM 看到的文字特效（{n}）', 'Text effects seen by the VLM ({n})', n=len(fx)))}</summary>", ""]
        for e in fx:
            L.append(f"- {e.get('t', '')}s {e.get('kind', '')}「{e.get('text', '')}」{e.get('style', '')} {e.get('animation', '')}")
        L += ["", "</details>"]
    L += ["", T("复刻：字幕和花字用 `packaging/overlays.ass` 直接压制（ffmpeg -vf ass=overlays.ass），或按 timeline.json 在剪映 / Remotion 里重建；"
                "贴纸和动图要找同款素材（表情包库 / GIF 库），截图在 packaging/ 下。",
                "Remake: burn subtitles and styled text in with `packaging/overlays.ass` (ffmpeg -vf ass=overlays.ass), or rebuild them from timeline.json in CapCut / Remotion; "
                "stickers and GIFs need matching assets (meme / GIF libraries), crops are under packaging/.")]
    return L


def _remake_md(b: dict) -> list[str]:
    s = b["summary"]
    L = production_md(b.get("production_plan") or {})
    if not L:
        L = ["", T("## 复刻方案", "## Remake plan"), ""]
    rm = s.get("real_material") or {}
    if rm.get("shots"):
        L += ["", T("### 画面里的真实素材（必须拿到原文件）", "### Real material in the picture (the original files are needed)"), "",
              T("共 {n} 个镜头、{s}s（{r:.0%}）的画面里有真实素材（录屏、截图、照片、嵌入视频），模型生成替代不了：",
                "{n} shots, {s}s ({r:.0%}) contain real material (screen recordings, screenshots, photos, embedded video); a model cannot stand in for them:",
                n=len(rm["shots"]), s=rm["seconds"], r=rm["ratio"]), ""]
        L += _grouped_assets(b, lambda r: r.get("replication", {}).get("user_assets", []), with_where=True)
    if s.get("references"):
        L += ["", T("### 复刻要准备的参考素材", "### Reference material to prepare for the remake"), "",
              T("这些镜头的画面是生成或拍摄出来的，下面是画面里出现、复刻时应作为参考图 / 道具准备的东西（不是嵌入的真实像素）：",
                "These shots were generated or filmed; the items below appear in them and should be prepared as reference images / props for the remake (they are not embedded real pixels):"), ""]
        L += _grouped_assets(b, lambda r: (r.get("material") or {}).get("references", []), with_where=False)
    return L


def _grouped_assets(b: dict, items, with_where: bool) -> list[str]:
    """One line per kind of material, with the shots and seconds it covers, instead of one line per shot."""
    groups: dict[tuple, dict] = {}
    for r in b["shots"]:
        for a in items(r):
            key = (a.get("kind_zh") or a.get("kind"), a.get("where", "") if with_where else "", a.get("description") or "")
            g = groups.setdefault(key, {"shots": [], "s": 0.0})
            if r["index"] not in g["shots"]:
                g["shots"].append(r["index"]); g["s"] += r["duration"]
    return [T("- **{k}**{w}{d}：镜头 {sh}，共 {s:.1f}s", "- **{k}**{w}{d}: shots {sh}, {s:.1f}s in all",
              k=k, w=(T("（{w}）", " ({w})", w=w) if w else ""), d=(T("，", ", ") + d if d else ""), sh=shot_ids(g["shots"]), s=g["s"])
            for (k, w, d), g in groups.items()]


def _clock(t: float) -> str:
    """0:07.9 — a shot list needs tenths, not milliseconds."""
    return f"{int(t // 60)}:{t % 60:04.1f}"


def _shotlist_md(b: dict) -> list[str]:
    units = _unit_of(b)
    told = narrative.shot_roles(b)
    rows = []
    for r in b["shots"]:
        base = r["base"]
        desc = ((r.get("vlm") or r.get("review") or {}).get("description") or "").replace("\n", " ")
        n = told.get(r["index"]) or {}
        says = (n.get("role_zh") or "") + (_colon() if n.get("role_zh") and n.get("point") else "") + (n.get("point") or "")
        a = r.get("assets") or {}
        pic = a.get("first_frame") or a.get("sheet")  # one frame reads at thumbnail size; the contact sheet is in the appendix
        rows.append([r["index"], f"![#{r['index']}]({pic})" if pic else "—", _clock(r["start"]), f"{r['duration']:.1f}s", *([says[:48] + ("…" if len(says) > 48 else "") or "—"] if told else []),
                     desc[:40] + ("…" if len(desc) > 40 else "") or "—", CAMERA_ZH.get(r["features"].get("camera", "unknown"), "—"), _layers(r),
                     f"{base['label_zh']} {base['confidence']:.0%}", _origin(r, brief=True), _route(r, units)])
    return ["", T("## 分镜表", "## Shot list"), "",
            T("「画面」「运镜」「叠加层」是画面里看得到的；「制作方式」「素材来源」是工具推断的，依据见附录逐镜取证。",
              "Picture, Camera and Overlays are what is visible on screen; Made with and Material are the tools' inference, with the basis in the shot-by-shot appendix.")] + _table(
        ["#", T("截图", "Frames"), T("时间", "Time"), T("时长", "Length"), *([T("在讲什么", "What it says")] if told else []),
         T("画面", "Picture"), T("运镜", "Camera"), T("叠加层", "Overlays"),
         T("制作方式（推断）", "Made with (inferred)"), T("素材来源（推断）", "Material (inferred)"), T("复刻", "Remake")], rows)


def _questions_md(b: dict) -> list[str]:
    qs = entities.open_questions(b)
    L = ["", T("## 不确定点", "## Open questions"), ""]
    L += [f"- {q}" for q in qs] or [T("- 没有需要特别复核的地方", "- Nothing needs a second look")]
    return L


def _split_evidence(base: dict) -> tuple[list[str], list[str]]:
    """(visible on screen, tool basis). Older breakdowns only carry the merged list: split it by its reader tags."""
    if "seen" in base or "measured" in base:
        return list(base.get("seen") or []), list(base.get("measured") or [])
    seen = [e for e in base.get("evidence", []) if e.startswith("[VLM]") or re.match(r"\[[^\]]+ (看图|review)\]", e)]
    return seen, [e for e in base.get("evidence", []) if e not in seen]


def _shot_detail_md(r: dict) -> list[str]:
    base = r["base"]
    seen, measured = _split_evidence(base)
    L = [f"![{r['id']}]({r['assets']['sheet']})", ""]
    # what you can check against the frames
    L.append(T("**画面里看得到的**（可以对照截图核实）", "**Visible on screen** (check against the frames)"))
    v = r.get("vlm") or r.get("review") or {}
    if v.get("description"):
        L.append(T("- 画面：{d}", "- Picture: {d}", d=v["description"]))
    cl = aspects.shot_text(r) if base["label"] in aspects.PHOTOGRAPHIC else ""
    if cl:
        L.append(T("- 拍法/打光：{c}", "- Camera / lighting: {c}", c=cl))
    if base.get("scene_text"):
        L.append(T("- 画面里物体上的字（不是后期字幕）：", "- Text on objects in the scene (not subtitles): ") + join(base["scene_text"][:6]))
    intrinsic = base["label"] in ("code_render", "screen_capture")
    said = (r.get("vlm") or {}).get("overlay_text")
    said = said if isinstance(said, list) else (r.get("review") or {}).get("overlay_text")
    from .classify import _same_words

    for tr in r.get("text", {}).get("tracks", [])[:4]:
        texts = tr["texts"]
        if isinstance(said, list) and not intrinsic:  # a reader listed the post words: the rest is in the scene line above
            texts = [t for t in texts if any(_same_words(t, str(o)) for o in said)]
            if not texts:
                continue
        kind = T("画面内容文字", "text in the picture") if intrinsic else KIND_ZH.get(tr["kind"], tr["kind"])
        L.append(T("- 文字轨（{k}/{b}）：", "- Text track ({k}/{b}): ", k=kind, b=tr["band"]) + " / ".join(t[:40] for t in texts[:4]))
    if r.get("beats"):
        L.append(T("- 镜头内动效节拍：", "- Motion beats within the shot: ") + join(f"{t:.2f}s" for t in r["beats"]))
    L += [f"- {e}" for e in seen[:8]]
    if len(L) == 3:
        L.append(T("- 没有看图描述（这次没开 VLM，也没有 agent 看图）", "- No image description (no VLM or agent image review in this run)"))
    # what the tools concluded about how it was made, and on what basis
    L += ["", T("**工具推断的制作方式**（是推断，不是看到的）", "**How it was made, as inferred by the tools** (inferred, not seen)")]
    probs = sorted(base["probs"].items(), key=lambda kv: -kv[1])[:3]
    L.append(T("- 推断：", "- Inference: ") + T("，", ", ").join(f"{LABEL_ZH[k]} {v:.0%}" for k, v in probs) + T("（{d}）", " ({d})", d=base["decided_by"]))
    for key, name in (("uncertain", T("待确认", "To confirm")), ("disputed", T("有分歧", "Disputed"))):
        if base.get(key):
            L.append(f"- ⚠️ {name}{_colon()}{base[key]}")
    if base.get("image_source"):
        L.append(T("- 静帧来源：{s}", "- Still source: {s}", s=base["image_source"]))
    L.append(T("- 素材来源：{o}", "- Material: {o}", o=_origin(r)))
    for it in (r.get("material") or {}).get("items", []):
        if it.get("real_material") and it.get("evidence"):
            L.append(f"  - {it['kind_zh']}{_colon()}{it['evidence']}")
    if base.get("generator_guess") and base["generator_guess"] != "unknown":
        L.append(T("- 可能的工具：{g}", "- Likely tool: {g}", g=base["generator_guess"]))
    if measured:
        L.append(T("- 判断依据（工具测量，肉眼不一定看得出）：", "- Basis (tool measurements, not necessarily visible to the eye):"))
        L += [f"  - {e}" for e in measured[:8]]
    rep = r["replication"]
    L += ["", T("- 复刻：{n}", "- Remake: {n}", n=rep["note"])]
    if rep.get("capsule", {}).get("image_prompt"):
        L.append(T("  - 首帧图像提示词：{p}", "  - First-frame image prompt: {p}", p=rep["capsule"]["image_prompt"]))
    if rep.get("capsule", {}).get("prompt"):
        L.append(T("  - 视频提示词：{p}", "  - Video prompt: {p}", p=rep["capsule"]["prompt"]))
    return L


def _appendix_md(b: dict) -> list[str]:
    L = ["", T("## 附录", "## Appendix"), "", T("### 逐镜取证", "### Shot by shot"), "",
         T("每个镜头分两块：画面里看得到的，和工具推断的制作方式（附判断依据）；最后是复刻提示词。默认折叠，点开看。", "Each shot has two parts: what is visible on screen, and how the tools infer it was made (with the basis); remake prompts last. Folded by default."), ""]
    for r in b["shots"]:
        title = f"#{r['index']} {fmt_time(r['start'])}–{fmt_time(r['end'])} · {r['verdict']}"
        L += [f'<details class="ref"><summary>{html.escape(title)}</summary>', ""] + _shot_detail_md(r) + ["", "</details>", ""]
    prov = b.get("provenance", {})
    if prov.get("hints") or prov.get("encoder"):
        L += [T("### 元数据线索", "### Metadata clues"), ""]
        if prov.get("encoder"):
            L.append(T("- 编码器：`{e}`", "- Encoder: `{e}`", e=prov["encoder"]))
        for k, v in (prov.get("hints") or {}).items():
            L.append(f"- {k}{_colon()}{', '.join(v)}")
        L.append("")
    L += [T("### 说明", "### Notes"), "",
          T("- 确定性取证对「是否在动、是否整图推拉、是否渲染纹理、是否 24→30 帧率转换」很可靠；对实拍 / AI / 3D 的区分要靠看图（看图模型或 AI 助手复核），最好再自己对照截图看一眼。",
            "- Deterministic forensics is reliable on motion, whole-frame pan/zoom, rendered texture and 24→30 fps conversion; telling live action from AI from 3D needs image reading (a VLM or an AI assistant's review), and a look at the frames yourself."),
          T("- 元数据经平台转码常被清除，缺失不代表没有。", "- Platform transcoding usually strips metadata; missing metadata proves nothing."),
          T("- 完整数据在 `breakdown.json`；给模型读的拆片包从 `VIDEO.md` 开始。", "- The full data is in `breakdown.json`; the package for models starts at `VIDEO.md`."), ""]
    return L


def markdown(b: dict) -> str:
    # what it is and why it works, how it is told and cut, how to remake it, then the reference detail
    L = (_head_md(b) + _highlights_md(b) + _layers_md(b) + _content_md(b, user=True) + _shotlist_md(b) + _plan_md(b)
         + _cast_md(b) + _visual_md(b, user=True) + packaging_md(b) + _audio_md(b) + _questions_md(b) + _appendix_md(b))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(L)).strip() + "\n"


# ------------------------------------------------------------------ HTML ------------------------------------------

_RE_IMG = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
_RE_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
# 只有报告自己生成的这几种行可以原样进 HTML；VLM / OCR 文字里换行带出来的标签一律转义
# class="ref": reference data (timelines, per-shot evidence) that stays folded when the report is printed
_RE_RAW_OK = re.compile(r'<details(?: class="ref")?><summary>[^<>]*</summary>|</details>|<!--[^<>]*-->')


def _remote(url: str) -> bool:
    return url.startswith("//") or ":" in url.split("/", 1)[0]


def _safe_url(m: re.Match, tpl: str) -> str:
    """Links / images only to http(s) or relative paths (no javascript:, data: ...)."""
    url = m.group(2)
    if ":" in url.split("/", 1)[0] and not url.lower().startswith(("http://", "https://")):
        return m.group(0)
    return tpl.format(text=m.group(1), url=url)
_RE_BOLD = re.compile(r"\*\*(.+?)\*\*")
_RE_CODE = re.compile(r"`([^`]+)`")
_RE_SEP = re.compile(r"^\|(\s*:?-+:?\s*\|)+\s*$")


def _inline(s: str) -> str:
    s = html.escape(s, quote=True)
    s = _RE_CODE.sub(r"<code>\1</code>", s)
    s = _RE_BOLD.sub(r"<b>\1</b>", s)
    # SoloSquad vendored copy: images are local files only. Text from OCR / a VLM can carry a
    # remote URL, and an <img> would fetch it the moment the report is opened or printed.
    s = _RE_IMG.sub(lambda m: m.group(0) if _remote(m.group(2)) else _safe_url(m, '<img src="{url}" alt="{text}" loading="lazy">'), s)
    # a link to a local sound clip plays in place
    s = _RE_LINK.sub(lambda m: _safe_url(m, '<audio controls preload="none" src="{url}" title="{text}"></audio>'
                                         if re.fullmatch(r"[\w./-]+\.(wav|mp3|m4a)", m.group(2)) else '<a href="{url}">{text}</a>'), s)
    return s


def _md_to_html(lines: list[str], b: dict) -> str:
    """Just enough Markdown for our own reports: headings, lists (2 levels), tables, fences, images, bold, code, raw <details>."""
    out: list[str] = []
    lists: list[tuple[str, int]] = []  # (tag, indent)
    table: list[str] = []
    para: list[str] = []
    in_code = False
    in_section = False
    skip_table = False

    def close_lists(to_indent: int = -1):
        while lists and lists[-1][1] > to_indent:
            out.append(f"</{lists.pop()[0]}>")

    def flush():
        nonlocal table, para, skip_table
        close_lists()
        if para:
            out.append("<p>" + "<br>".join(para) + "</p>")
            para = []
        if table:
            if not skip_table:
                head, *body = table
                out.append("<table><thead><tr>" + "".join(f"<th>{_inline(c.strip())}</th>" for c in head.strip().strip("|").split("|")) + "</tr></thead><tbody>"
                           + "".join("<tr>" + "".join(f"<td>{_inline(c.strip())}</td>" for c in row.strip().strip("|").split("|")) + "</tr>" for row in body) + "</tbody></table>")
            table = []
            skip_table = False

    for raw in lines:
        line = raw.rstrip()
        if in_code:
            if line.startswith("```"):
                in_code = False
                out.append("</pre>")
            else:
                out.append(html.escape(line))
            continue
        if line.startswith("```"):
            flush()
            in_code = True
            out.append("<pre class='prompt'>")
            continue
        if line == _MIX_MARK:
            flush()
            out.append(_mix_bar(b))
            continue
        if line == _STEMS_MARK:
            flush()
            out.append(_stems_html(b))
            continue
        if _RE_RAW_OK.fullmatch(line):  # our own details / summary / comments pass through
            flush()
            out.append(line)
            continue
        if not line.strip():
            flush()
            continue
        if line.startswith("#"):
            flush()
            level = len(line) - len(line.lstrip("#"))
            text = _inline(line[level:].strip())
            if level == 2:
                if in_section:
                    out.append("</section>")
                out.append(f"<section class='card'><h2>{text}</h2>")
                in_section = True
            else:
                out.append(f"<h{level}>{text}</h{level}>")
            continue
        if line.lstrip().startswith("|"):
            if _RE_SEP.match(line.strip()):
                continue
            if para:
                flush()
            table.append(line)
            continue
        m = re.match(r"^(\s*)(?:[-*]|\d+\.)\s+(.*)$", line)
        if m:
            if table or para:
                flush()
            indent = len(m.group(1))
            tag = "ol" if re.match(r"^\s*\d+\.", line) else "ul"
            if lists and lists[-1][1] == indent:
                pass
            elif not lists or indent > lists[-1][1]:
                lists.append((tag, indent))
                out.append(f"<{tag}>")
            else:
                close_lists(indent)
                if not lists or lists[-1][1] != indent:
                    lists.append((tag, indent))
                    out.append(f"<{tag}>")
            out.append(f"<li>{_inline(m.group(2))}</li>")
            continue
        if table:
            flush()
        if _RE_IMG.fullmatch(line.strip()):
            flush()
            out.append(_inline(line.strip()).replace("<img ", "<img class='sb' "))
            continue
        close_lists()
        para.append(_inline(line.strip()))
    flush()
    if in_section:
        out.append("</section>")
    return "\n".join(out)


def _mix_bar(b: dict) -> str:
    esc = html.escape
    return "<div class='mix'>" + "".join(
        f"<div class='bar' style='flex:{m['ratio']};background:rgb({','.join(str(c) for c in LABEL_COLOR.get(m['label'], (80, 80, 80)))})' title='{esc(m['label_zh'])}'>{esc(m['label_zh'])} {m['ratio']:.0%}</div>"
        for m in b["summary"]["production_mix"]) + "</div>"


def _stems_html(b: dict) -> str:
    if not (b.get("stems") or {}).get("ok"):
        return ""
    return "<div class='stems'>" + "".join(
        f"<div>{name}{_colon()}<audio controls preload='none' src='stems/{f}'></audio></div>"
        for f, name in (("original.wav", T("原声", "original")), ("vocals.wav", T("人声干声", "dry voice")), ("music.wav", T("配乐 + 环境声", "music + ambience")),
                        *((("effects.wav", T("音效", "effects")),) if (b.get("stems") or {}).get("effects") else ()),
                        *_speaker_tracks(b))) + "</div>"


def _speaker_tracks(b: dict) -> list[tuple[str, str]]:
    from .entities import speaker_label

    return [(f, speaker_label(b, sid)) for sid, f in ((b.get("speakers") or {}).get("tracks") or {}).items()]


_CSS = """
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#0d9488}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif}
main{max-width:1100px;margin:auto} h1{font-size:22px} h2{font-size:18px;margin:4px 0 10px} h3{font-size:15px;margin:16px 0 6px} h4{font-size:13px;color:var(--muted);margin:10px 0 2px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0}
.mix{display:flex;height:30px;border-radius:6px;overflow:hidden;margin:12px 0} .bar{color:#fff;font-size:12px;padding:6px;white-space:nowrap;overflow:hidden}
img{max-width:100%;border-radius:6px} img.sb{display:block;margin:8px 0}
table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;display:block;overflow-x:auto} th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top;min-width:3.2em} th{color:var(--muted);font-weight:600}
td img{max-height:96px} td audio{width:150px;height:30px}
ul,ol{margin:4px 0;padding-left:20px} li{margin:2px 0} p{margin:6px 0}
pre.prompt{background:var(--bg);padding:10px;border-radius:6px;font-size:13px;white-space:pre-wrap;word-break:break-word}
code{background:var(--bg);padding:1px 4px;border-radius:4px;font-size:13px}
details{margin:8px 0;border:1px solid var(--line);border-radius:8px;padding:6px 12px} summary{cursor:pointer;color:var(--accent);font-weight:600}
.stems div{margin:4px 0} audio{vertical-align:middle;max-width:100%}
@media print{:root{--bg:#fff;--fg:#1c1917;--muted:#57534e;--card:#fff;--line:#d6d3d1}
body{padding:0;font-size:12px} .card{border:none;padding:0;margin:10px 0}
img.sb{max-height:160mm;width:auto;margin:8px auto} h2,h3{break-after:avoid} tr,img{break-inside:avoid}
table{display:table;font-size:11px} details{border:none;padding:0} summary{color:var(--fg)} audio,.stems{display:none}
.mix{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
"""


def html_report(b: dict) -> str:
    body = _md_to_html(markdown(b).split("\n"), b)
    return (f"<!doctype html><html lang=\"{lang()}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            f"<title>{T('拆解：', 'Breakdown: ')}{html.escape(b['source']['filename'])}</title><style>{_CSS}</style></head><body><main>\n{body}\n</main></body></html>")


def write_reports(b: dict, out: Path) -> None:
    from .i18n import set_lang

    set_lang(b.get("lang", "zh"))
    (out / "report.md").write_text(markdown(b), encoding="utf-8")
    (out / "report.html").write_text(html_report(b), encoding="utf-8")
    from .videomd import write as write_videomd

    write_videomd(b, out)  # the same breakdown laid out for models: VIDEO.md + video/
