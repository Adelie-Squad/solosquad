"""Turn a classified shot into a replication plan: which capability rule applies, which
models are candidates, and how capsule-cinema (or local ffmpeg) would execute it."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from .i18n import LangDict, T, join, model_name, semi

CAP = Path(__file__).resolve().parent / "capabilities"

# base label -> (routing rule, executor, capsule generation type)
LABEL_ROUTE = {
    "ai_video": ("R07-product-hero", "capsule_cinema", "first_last_frame"),
    "live_action": ("R07-product-hero", "capsule_cinema", "image_to_video"),
    "avatar": ("R03-talking-head", "capsule_cinema", "image_to_video"),
    "cg_3d": ("R08-product-multiview", "capsule_cinema", "first_last_frame"),
    "code_render": ("R01-code-graphics", "code_render_spec", None),
    "screen_capture": ("R02-screen-demo", "code_render_spec", None),
    "still_motion": ("R17-still-motion", "local_ffmpeg", None),
    "static_hold": ("R18-static-hold", "local_ffmpeg", None),
    "anim_2d": ("R19-2d-animation", "capsule_cinema", "first_last_frame"),
    "stop_motion": ("R20-stop-motion", "capsule_cinema", "image_to_video"),
    "film_footage": ("R21-film-footage", "source_footage", None),
}
NOTE = LangDict({
    "ai_video": "原片为 AI 生成：取原镜头首尾帧做首尾帧生成，可高度还原构图与动作；换主体时先用图像模型改首帧",
    "live_action": "原片为实拍：按拍摄方案（景别/机位/打光）重新拍摄；没有拍摄条件时才用 AI 图生视频近似（以首帧为参考）",
    "avatar": "数字人口播：先克隆/合成配音，再用数字人模型由人像 + 音频驱动",
    "cg_3d": "3D 渲染：可用首尾帧 AI 生成近似；需要精确多角度时走 3D 建模 + Blender 渲染",
    "code_render": "代码渲染：用 Remotion/HTML 按文字轨与版式重建，100% 可控，不需要生成模型",
    "screen_capture": "录屏/截图：用真实界面录屏或网页截图重建",
    "still_motion": "静态图推拉：用一张图 + 测得的缩放/平移参数在本地 ffmpeg 精确复刻",
    "static_hold": "静帧：一张图定格即可",
    "anim_2d": "2D 动画：先出角色设定图定画风，再首尾帧生成；要精确口型和动作时做 AE / Live2D / Spine 工程",
    "stop_motion": "定格动画：首选真的拍（手机固定 + 定格 App，每秒约 12 张）；AI 生成只能近似顿挫感",
    "film_footage": "影视片段：画面剪自已有的电影/电视剧/短剧，复刻要找到原片对应片段再剪（版权属于片方，商用要授权）；不用原片时，按同样景别、机位和打光自己拍，或用 AI 做近似画面",
}, en={
    "ai_video": "Source is AI-generated: use the shot's first and last frames for first/last-frame generation to closely match composition and motion; to change the subject, edit the first frame with an image model first",
    "live_action": "Source is live action: reshoot per the shooting plan (shot size / camera setup / lighting); only fall back to AI image-to-video (first frame as reference) when a shoot is not possible",
    "avatar": "Digital-avatar talking head: clone or synthesize the voice first, then drive an avatar model from a portrait + the audio",
    "cg_3d": "3D render: AI first/last-frame generation gives an approximation; for precise multiple angles, model in 3D and render in Blender",
    "code_render": "Code render: rebuild in Remotion / HTML from the text tracks and layout, 100% controllable, no generative model needed",
    "screen_capture": "Screen recording / screenshot: rebuild from a real screen recording or web screenshot",
    "still_motion": "Still-image move: one image + the measured zoom / pan parameters, reproduced exactly with local ffmpeg",
    "static_hold": "Static frame: one held image is enough",
    "anim_2d": "2D animation: make a character sheet to lock the style, then first/last-frame generation; for precise lip sync and motion, build an AE / Live2D / Spine project",
    "stop_motion": "Stop motion: shooting for real is the first choice (phone locked off + a stop-motion app, about 12 frames per second); AI generation only approximates the stepped feel",
    "film_footage": "Film / TV footage: the picture is cut from an existing film, series or short drama; a remake has to find the same clip in the source and cut it (rights belong to the studio, commercial use needs a licence); without the source, shoot it yourself with the same shot size, camera setup and lighting, or approximate it with AI",
})
# AI edits on filmed footage: what was done, which routing rule rebuilds it, how in one line
AI_EDITS = {
    "face_swap": ("换脸", "R12-owned-footage-edit", "拍好后用视频编辑模型换人，保留动作"),
    "lip_sync": ("对口型/改台词", "R13-redub", "拍好后配新台词，再用口型重配模型改嘴型"),
    "restyle": ("整段风格化重绘", "R12-owned-footage-edit", "拍好后用视频编辑模型按参考风格重绘，保留动作和构图"),
    "outfit_swap": ("AI 换装", "R05-garment", "先出试穿图确认，再用视频模型或编辑模型换装"),
    "bg_replace": ("抠像换背景", "R12-owned-footage-edit", "绿幕拍摄后抠像合成；没有绿幕时用视频编辑模型换背景"),
    "object_edit": ("加/删/换物体", "R12-owned-footage-edit", "拍好后用视频编辑模型改画面里的物体"),
    "beautify": ("美颜/瘦脸", None, "剪映、美颜相机等的美颜功能即可，不需要生成模型"),
}
AI_EDITS_EN = {  # (what was done, how) in English, same keys as AI_EDITS
    "face_swap": ("face swap", "after the shoot, swap the person with a video-editing model, keeping the motion"),
    "lip_sync": ("lip sync / new lines", "after the shoot, record the new lines, then redo the mouth with a lip-sync model"),
    "restyle": ("full stylized repaint", "after the shoot, repaint with a video-editing model in the reference style, keeping motion and composition"),
    "outfit_swap": ("AI outfit swap", "make a try-on still to approve first, then swap the outfit with a video or editing model"),
    "bg_replace": ("keyed background replacement", "shoot on green screen and key / composite; without a green screen, replace the background with a video-editing model"),
    "object_edit": ("object added / removed / replaced", "after the shoot, change the object in frame with a video-editing model"),
    "beautify": ("beauty filter / face slimming", "the beauty tools in CapCut, beauty camera apps etc. are enough, no generative model needed"),
}
CAPSULE_ENGINES = {"seedance2.0": (4, 15), "minimax-h3": (4, 15)}


def shot_prompts(shot: dict) -> dict:
    """Reverse-engineered prompts for one shot: the agent's review wins over the VLM (it is the later, checked pass)."""
    out = {}
    for src in ((shot.get("vlm") or {}).get("replication") or {}, (shot.get("review") or {}).get("replication") or {}):
        out.update({k: v for k, v in src.items() if k in ("image_prompt", "video_prompt", "video_prompt_en") and v})
    return out


def _where(cx: float | None, cy: float | None) -> tuple[str, str] | None:
    """Where the measured subject sits in the frame, (zh, en)."""
    if cx is None or cy is None:
        return None
    h = ("左侧", "left") if cx < 0.38 else ("右侧", "right") if cx > 0.62 else ("中间", "centre")
    v = ("上部", "upper") if cy < 0.38 else ("下部", "lower") if cy > 0.62 else ("", "")
    if h[1] == "centre" and not v[1]:
        return "主体在画面正中", "subject centred in frame"
    return f"主体在画面{v[0]}{h[0]}".replace("上部中间", "上部正中").replace("下部中间", "下部正中"), \
        f"subject in the {(v[1] + ' ') if v[1] else ''}{h[1]} of the frame".replace("upper centre", "upper middle").replace("lower centre", "lower middle")


def framing_words(shot: dict) -> tuple[str, str]:
    """Shot size, camera angle, subject position and camera move as a prompt prefix, (report language, English).
    The readers' free-text prompts tend to keep the style words and drop these, which flattens the camera in a remake."""
    from .aspects.base import seen
    from .i18n import lang

    asp = shot.get("aspects") or {}
    fr = (asp.get("framing") or {}).get("result") or {}
    fm = (asp.get("framing") or {}).get("measured") or {}
    cm = (asp.get("camera") or {}).get("measured") or {}
    v = shot.get("review") or shot.get("vlm") or {}
    size = fr.get("shot_size") or v.get("shot_size")
    angle = fr.get("camera_angle")
    comp = seen(shot, "framing", "composition")
    comp = comp.get("agent") or comp.get("vlm")
    where = _where(fm.get("center_x"), fm.get("center_y")) if fm.get("subject") in ("face", "focus") else None
    move = cm.get("move") or (v.get("camera_move") if v.get("camera_move") not in (None, "", "固定", "static") else None)
    from .aspects.vocab import ZH2EN, canon, show

    loc = [x for x in (show(size), show(angle), comp or (where and (where[1] if lang() == "en" else where[0])),
                       move and T("镜头{m}", "camera {m}", m=show(move))) if x]

    def en_of(x):  # the English prompt always gets English words, whatever the report language
        c = canon(x) if x else None
        return ZH2EN.get(c) or (x if x and x.isascii() else None)

    en = [en_of(size), en_of(angle),
          comp if comp and comp.isascii() else (where[1] if where and not comp else None),
          move and ("camera " + (en_of(move) or "moves"))]
    return T("，", ", ").join(loc), ", ".join(x for x in en if x)


def _with_framing(prompt: str, words: str) -> str:
    """Prefix the framing words unless the prompt already states each of them."""
    if not prompt or not words:
        return prompt
    sep = "，" if "，" in words else ", "
    missing = [w for w in words.split(sep) if w and w not in prompt]
    if not missing:
        return prompt
    end = "。" if not words.isascii() else ". "
    return sep.join(missing) + end + prompt


def _move_words(f: dict) -> str:
    """Measured camera / whole-picture motion of a rendered shot in words (what the code camera should do)."""
    cam = f.get("camera")
    if cam in (None, "unknown", "static"):
        return T("固定", "static")
    if cam == "static_with_subject_motion":
        return T("固定机位，画面内元素在动", "static frame, elements move inside it")
    bits = []
    zoom = f.get("zoom_per_s", 0.0)
    if abs(zoom) > 0.01:
        bits.append(T("推近 {z:.0%}/s", "push in {z:.0%}/s", z=zoom) if zoom > 0 else T("拉远 {z:.0%}/s", "pull out {z:.0%}/s", z=-zoom))
    if f.get("pan_px_per_s", 0.0) > 8:
        d = f.get("pan_dir_deg", 0.0) % 360
        where = T("右", "right") if d < 45 or d >= 315 else T("下", "down") if d < 135 else T("左", "left") if d < 225 else T("上", "up")
        bits.append(T("画面向{w}移", "picture drifts {w}", w=where))
    if abs(f.get("rot_deg_per_s", 0.0)) > 1:
        bits.append(T("旋转", "rotates"))
    return T("，", ", ").join(bits) or T("固定机位，画面内元素在动", "static frame, elements move inside it")


def code_scene(shot: dict) -> dict:
    """What a code-rendered shot draws, for rebuilding it: the picture (image readers' description), whether it is
    particle / point-cloud graphics on black, the measured camera move and the confident on-screen text."""
    facts = (shot.get("deterministic") or {}).get("facts") or {}
    desc = (shot.get("review") or {}).get("description") or (shot.get("vlm") or {}).get("description") or ""
    text = shot.get("text") or {}
    sure = {it.get("text") for it in text.get("items", []) if it.get("conf", 0) >= 0.85}
    words: list[str] = []
    for tr in text.get("tracks", []):
        if tr.get("kind") == "subtitle":
            continue
        for w in tr.get("texts", []):
            if w in sure and w not in words:
                words.append(w)
    motion = shot.get("motion") or {}
    pal = motion.get("palette") or {}
    return {"picture": str(desc), "particles": facts.get("fine_dark", 0.0) > 0.5, "style": code_style(shot),
            "move": _move_words(shot.get("features") or {}), "on_screen_text": words[:6],
            "background": pal.get("background"), "palette": [c["hex"] for c in pal.get("colours", [])[:5]], "dots": motion.get("dots") or [],
            "events": motion.get("events", []), "sequences": motion.get("sequences", []), "layer": motion.get("layer"),
            "static": motion.get("static", []), "elements_sheet": motion.get("elements_sheet"),
            "strip": (shot.get("assets") or {}).get("strip"), "transition_in": shot.get("transition_in"),
            "flash_s": shot.get("flash_s"), **({"transition": shot["transition"]} if shot.get("transition") else {})}


# how a code-rendered picture is built, from the measured look; keys of CODE_STYLES
def code_style(shot: dict) -> str:
    facts = (shot.get("deterministic") or {}).get("facts") or {}
    text = shot.get("text") or {}
    if facts.get("fine_dark", 0.0) > 0.5:
        return "particles"
    if facts.get("fine_light", 0.0) > 0.5:
        return "lineart"
    kind = facts.get("vector_kind")
    if kind in ("procedural", "neon"):
        return kind
    sure = {it.get("text") for it in text.get("items", []) if it.get("conf", 0) >= 0.85}
    numbers = {w for tr in text.get("tracks", []) for w in tr.get("texts", [])
               if w in sure and re.search(r"[1-9]", w)}  # "000" / "0" are usually OCR noise on shapes
    if len(numbers) >= 3:
        return "data"
    if facts.get("ui_text", 0.0) > 0.5 or facts.get("ui_gray", 0.0) > 0.5 or facts.get("text_like", 0.0) > 0.6:
        return "ui"
    if kind in ("gradient", "colour_fields"):
        return "gradient"
    if text.get("text_coverage", 0.0) > 0.04:
        return "type"
    return "shapes"


def CODE_STYLES() -> dict[str, tuple[str, str]]:
    """style -> (short name, how to build it in a Remotion / HTML project)."""
    return {
        "particles": (T("粒子/点云", "particles / point cloud"),
                      T("Three.js 粒子系统（点按目标形状采样，形状间插值变形，加辉光后期），用 @remotion/three 逐帧渲染",
                        "Three.js particle system (points sampled on the target shape, morph between shapes, bloom), rendered frame by frame with @remotion/three")),
        "lineart": (T("线稿/点阵", "line art / dots"),
                    T("SVG 路径用 stroke-dashoffset 逐帧描线，或 Canvas 按噪声场画流线 / 按目标形状排点；线宽、颜色、密度按画面量",
                      "SVG paths drawn on with stroke-dashoffset, or Canvas flow lines from a noise field / dots placed on a target shape; "
                      "match stroke width, colour and density from the frame")),
        "procedural": (T("程序生成色场", "procedural colour field"),
                       T("GLSL 片元着色器（分形/噪声/plasma），Three.js ShaderMaterial 或 WebGL canvas，时间作 uniform 逐帧驱动",
                         "GLSL fragment shader (fractal / noise / plasma) via Three.js ShaderMaterial or a WebGL canvas, time passed as a uniform each frame")),
        "neon": (T("暗底辉光", "glow on dark"),
                 T("深色底 + 渐变填充文字/线条，CSS drop-shadow 或 SVG feGaussianBlur 叠两层做辉光，亮度随帧轻微呼吸",
                   "Dark ground + gradient-filled text / lines, glow from two stacked CSS drop-shadows or an SVG feGaussianBlur, brightness breathing per frame")),
        "data": (T("数据图表", "data chart"),
                 T("SVG/D3 比例尺画坐标和图形，数字用 interpolate() 逐帧计数，柱/线按 spring() 生长",
                   "SVG / D3 scales for axes and marks, numbers counted up with interpolate(), bars / lines grown with spring()")),
        "ui": (T("界面/文档", "UI / document"),
               T("HTML/CSS 按截图还原卡片和版式（圆角、阴影、字号），元素用 spring() 进场；真界面可直接录屏",
                 "HTML / CSS cards and layout matched to the frame (radius, shadow, type sizes), elements enter with spring(); a real UI can be screen-recorded")),
        "gradient": (T("渐变/色块", "gradients / colour fields"),
                     T("CSS 线性/径向渐变，或几个大圆加 filter: blur() 慢速漂移；毛玻璃卡片用 backdrop-filter",
                       "CSS linear / radial gradients, or a few large circles with filter: blur() drifting slowly; glass cards with backdrop-filter")),
        "type": (T("文字动效", "kinetic type"),
                 T("逐词/逐字 spring() 进场（位移+缩放+透明度），强调词加色块；字体、字号、行距按画面量",
                   "Word-by-word spring() entrances (offset + scale + opacity), highlight boxes on key words; match font, size and leading from the frame")),
        "shapes": (T("矢量图形", "vector shapes"),
                   T("SVG 图形 + interpolate()/spring() 关键帧，按画面量出位置和节奏",
                     "SVG shapes + interpolate() / spring() keyframes, positions and timing measured from the frame")),
    }


def _load(name: str):
    with (CAP / name).open(encoding="utf-8") as f:
        return yaml.safe_load(f)


class Planner:
    def __init__(self) -> None:
        self.routing = _load("routing.yaml")
        self.rules = {r["id"]: r for r in self.routing["rules"]}
        self.models = {}
        for f in sorted((CAP / "models").glob("*.yaml")):
            for m in (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("models", []):
                self.models[m["id"]] = m
        notes = _load("prompting.yaml") or {}
        self.prompting: dict[str, dict] = notes.get("models") or {}   # how to write prompts for each model
        self.keyframe_notes: list[str] = notes.get("keyframes") or []  # frame-picking practice shared by all models

    def edit_steps(self, edits: list | None) -> list[dict]:
        """Image readers' list of AI edits on a filmed shot -> post-production steps with candidate models."""
        out = []
        for e in edits or []:
            if not isinstance(e, dict) or e.get("kind") not in AI_EDITS or any(x["kind"] == e["kind"] for x in out):
                continue
            zh, rule_id, how = AI_EDITS[e["kind"]]
            zh_en, how_en = AI_EDITS_EN[e["kind"]]
            names = [model_name(self.models[m]["name"]) for m in (self.rules.get(rule_id) or {}).get("prefer", [])
                     if m in self.models and self.models[m]["status"] != "shutdown"][:3]
            out.append({"kind": e["kind"], "kind_zh": T(zh, zh_en), "evidence": str(e.get("evidence", ""))[:120], "rule": rule_id,
                        "how": T(how, how_en) + (T("（{n}）", " ({n})", n=" / ".join(names)) if names else "")})
        return out

    def plan_shot(self, label: str, shot: dict, video: dict, engine: str = "seedance2.0") -> dict:
        rule_id, executor, gen_type = LABEL_ROUTE.get(label, ("R14-ambient-broll", "capsule_cinema", "text_to_video"))
        rule = self.rules.get(rule_id, {})
        candidates = [{"id": m, "name": model_name(self.models[m]["name"]), "status": self.models[m]["status"]}
                      for m in rule.get("prefer", []) if m in self.models and self.models[m]["status"] != "shutdown"]
        plan = {"label": label, "rule": rule_id, "route": rule.get("route", []), "candidates": candidates,
                "verify": rule.get("verify", []), "executor": executor, "note": NOTE.get(label, "")}
        dur = float(shot["duration"])
        mat = shot.get("material") or {}
        user_assets = []
        for it in mat.get("items", []):
            if it.get("real_material"):
                where = T("整个画面", "whole frame") if it.get("region") == "full" else (
                    T("画面局部 x{:.0%} y{:.0%} 宽{:.0%} 高{:.0%}", "part of the frame x{:.0%} y{:.0%} w{:.0%} h{:.0%}").format(*it["bbox"])
                    if it.get("bbox") else T("画面局部", "part of the frame"))
                user_assets.append({"kind": it["kind"], "kind_zh": it.get("kind_zh", it["kind"]), "where": where,
                                    "description": it.get("description", ""), "reference": shot.get("assets", {}).get("first_frame")})
        if user_assets:
            plan["user_assets"] = user_assets
            plan["note"] += semi() + T("需要用户提供真实素材：", "real material the user must supply: ") \
                + join(T("{k}（{w}）", "{k} ({w})", k=a["kind_zh"], w=a["where"]) for a in user_assets)
        refs = mat.get("references") or []
        if refs:
            plan["references"] = refs
            plan["note"] += semi() + T("生成时作参考：", "references for generation: ") + join(dict.fromkeys(r["kind_zh"] for r in refs))
        if executor == "capsule_cinema":
            lo, hi = CAPSULE_ENGINES.get(engine, (4, 15))
            gen_dur = int(min(hi, max(lo, round(dur + 0.49))))
            rep = shot_prompts(shot)
            prompt = rep.get("video_prompt") or (shot.get("vlm") or shot.get("review") or {}).get("description") or ""
            # the measured / seen framing goes in front, so a remake keeps the camera height, angle and subject position
            fw, fw_en = framing_words(shot)
            still = T("，", ", ").join(w for w in fw.split(T("，", ", ")) if not w.startswith(T("镜头", "camera ")))
            plan["capsule"] = {
                "engine": engine, "generation_type": gen_type, "duration": gen_dur,
                "trim_to": round(dur, 3), "aspect_ratio": video.get("aspect_ratio", "9:16"),
                "prompt": _with_framing(prompt, fw), "prompt_en": _with_framing(rep.get("video_prompt_en", ""), fw_en),
                "image_prompt": _with_framing(rep.get("image_prompt", ""), still), "framing": fw,
                "needs_split": dur > hi,
            }
            if not prompt:
                plan["capsule"]["prompt_missing"] = T("未运行 VLM，缺少视频提示词；请用 --vlm 重新拆解或手动补写",
                                                      "VLM was not run, so there is no video prompt; re-run the breakdown with --vlm or write one by hand")
        if executor == "local_ffmpeg":
            m = shot.get("features", {})
            plan["local"] = {"zoom_per_s": m.get("zoom_per_s", 0.0), "pan_px_per_s": m.get("pan_px_per_s", 0.0),
                             "pan_dir_deg": m.get("pan_dir_deg", 0.0), "analysis_width": 480, "duration": round(dur, 3)}
        elif executor == "code_render_spec":
            plan["spec"] = {"text_layers": [l for l in shot.get("layers", []) if l["kind"] in ("subtitle", "title", "label")],
                            "beats": shot.get("beats", []), "duration": round(dur, 3), "scene": code_scene(shot)}
        return plan
