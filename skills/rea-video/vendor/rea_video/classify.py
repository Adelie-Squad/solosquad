"""Production-method classification: deterministic forensics + optional VLM, fused.

Base layer labels (what produced the moving picture of the shot):
  live_action    实拍（摄像机/手机拍摄）
  ai_video       AI 生成视频（文生/图生/参考生视频）
  avatar         数字人口播（AI 驱动的说话人）
  cg_3d          3D 渲染（Blender/C4D/UE 等）
  code_render    代码/模板渲染（MG、文字、UI、图表、PPT 式卡片）
  screen_capture 屏幕录制/网页截图
  still_motion   静态图片 + 推拉摇移（Ken Burns 图片动效）
  static_hold    静帧停留（图片或卡片定格，无运动）
  anim_2d        2D 动画（手绘逐帧、Live2D、AE/Spine 角色动画、Flash 风格）
  stop_motion    定格动画（实物/黏土/纸偶逐帧拍摄）
  film_footage   影视片段（剪进来的电影、电视剧、短剧画面：影视解说、混剪、名场面）
anim_2d / stop_motion have no pixel test yet (held frames "on twos" look like a frame-rate conversion); film_footage is
camera footage like any other, so pixels cannot tell who shot it (the tools only collect hints: letterbox, 24/25fps
source). Only an image reader (VLM or agent) can call these three, see UNMEASURED.
Overlays (composited on top): subtitle / title / label text, static graphics, layout template.

Deterministic evidence is decisive for *temporal* questions (is anything moving? is the
whole frame a rigid zoom of one still image? exact frozen pixels?) and for *rendered vs
photographic* texture. It is weak for live-action vs AI vs 3D, which the VLM decides;
fusion weights reflect that."""
from __future__ import annotations

import math
import re
from difflib import SequenceMatcher

from .i18n import LangDict, T, join

LABELS = ["live_action", "ai_video", "avatar", "cg_3d", "code_render", "screen_capture", "still_motion", "static_hold",
          "anim_2d", "stop_motion", "film_footage"]
# labels the deterministic layer cannot score: decided by image readers only (see pipeline._vlm_gate)
UNMEASURED = ("anim_2d", "stop_motion", "film_footage")
LABEL_ZH = LangDict({
    "live_action": "实拍",
    "ai_video": "AI 生成视频",
    "avatar": "数字人口播",
    "cg_3d": "3D 渲染",
    "code_render": "代码/模板渲染",
    "screen_capture": "屏幕录制/截图",
    "still_motion": "静态图 + 推拉动效",
    "static_hold": "静帧停留",
    "anim_2d": "2D 动画",
    "stop_motion": "定格动画",
    "film_footage": "影视片段",
}, en={
    "live_action": "live action",
    "ai_video": "AI-generated video",
    "avatar": "AI avatar (talking head)",
    "cg_3d": "3D render",
    "code_render": "code / template render",
    "screen_capture": "screen recording / screenshot",
    "still_motion": "still image + pan/zoom",
    "static_hold": "static hold",
    "anim_2d": "2D animation",
    "stop_motion": "stop motion",
    "film_footage": "film / TV footage",
})
IMAGE_SOURCE_ZH = LangDict({"ai_image": "AI 生成图", "photo": "真实照片", "graphic": "设计/渲染图形", "screenshot": "截图", "unknown": "未知"},
                           en={"ai_image": "AI-generated image", "photo": "photo", "graphic": "designed / rendered graphic", "screenshot": "screenshot", "unknown": "unknown"})
# how much to trust the deterministic layer per label (VLM weight is 1.0)
DET_WEIGHT = {"static_hold": 1.6, "still_motion": 1.4, "code_render": 1.0, "screen_capture": 0.6,
              "cg_3d": 0.5, "live_action": 0.6, "ai_video": 0.6, "avatar": 0.4, "anim_2d": 0.3, "stop_motion": 0.3,
              "film_footage": 0.3}


# weight of the model's opinion (VLM or an agent's review) relative to the deterministic layer
# calibrated on the first real-Gemini run (eval/articles.yaml, 2026-10-30): 1.0 let a confident
# but wrong VLM override 24fps/transcode evidence on AI videos; 0.7 keeps its gains on 3D / UI shots
VLM_WEIGHT = 0.7


def _sig(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def no_repeats(f: dict) -> bool:
    """No duplicate frames of a 24/25 fps source: under 2% of frame pairs, or a single repeated frame in a
    short shot (a 24 -> 30 fps pull-up repeats every fifth frame, one repeat alone says nothing)."""
    return f.get("dup_ratio", 1) < 0.02 or f.get("dup_count", 99) <= 1


def _norm(d: dict[str, float]) -> dict[str, float]:
    s = sum(max(v, 0.0) for v in d.values()) or 1.0
    return {k: max(v, 0.0) / s for k, v in d.items()}


# Photographic-picture guards: platform transcodes make real footage look "rendered" (flat blocks, small palette).
# Each guard needs evidence a render cannot fake easily. Thresholds were measured over every shot of eval/*.yaml
# (labels, holdout, holdout2, articles, koubo).
RULES = {
    # dim footage: near-black blocks that still carry grain (a rendered dark background is one exact colour,
    # block std 0), lit parts not flat, and a face on screen (dark UI / 3D on black have no face)
    "lowlight": {"dark_ratio": 0.15, "dark_std": 0.3, "dark_flat_max": 0.65, "flat_lit_max": 0.3, "faces": 0.5},
    # a face held through the shot: cartoon / plush / illustrated faces in eval cover < 6% of the frame
    "big_face": {"area": 0.06, "presence": 0.5, "graphic_factor": 0.4},
    # lines of small OCR text (glyph height < 2% of the frame): 3D shots carry <= 2, screenshots 5-14
    "ui_text": {"height": 0.02, "mid": 4.5, "width": 0.7},
    # an avatar is a fixed frame; a moving / shaking camera argues for someone filming
    "avatar_moving_camera": 0.3,
    # fine graphics on black (particles, point clouds, thin lines, small text): the lit part has almost no gently
    # shaded pixels and many small bright peaks. Eval photo / 3D / AI frames on dark ground keep lit_smooth >= 0.47
    # and lit_peaks <= 10; a particle explainer video sits at lit_smooth 0.01-0.22, lit_peaks 5-67
    "fine_dark": {"dark": 0.4, "smooth": 0.3, "peaks": 4.0, "lit_max": 0.4, "lit_min": 0.002},
    # the same with a soft halo lit behind the dots (measured on the "spark" layer, the glow blurred out): a glowing
    # particle explainer sits at spark_smooth 0.03-0.17, spark_peaks 12-62, spark_ratio <= 0.03; eval AI / 3D / photo
    # frames keep spark_smooth >= 0.31
    # glow_min: the halo must be there (share of the frame lit by the blurred picture; 0.16-0.36 on the particle video),
    # so dark pictures without one (star fields, dark UI) stay with fine_dark above
    "fine_glow": {"smooth": 0.24, "peaks": 8.0, "spark_max": 0.08, "glow_min": 0.08},
    # thin dark lines / dots on a light ground: fine_dark on the inverted picture, with a looser smoothness bound
    # (anti-aliased dark strokes shade more than glowing dots)
    "fine_light": {"smooth": 0.35},
    # pictures made of vector fills, gradients and glows (no material texture). tex_fine = share of pixels with
    # fine detail left after a median filter and removing the smooth component (high-pass), so gradients and glows
    # count as zero and light film grain is mostly removed. Eval photo / AI shots >= 0.12 except one compressed
    # night street shot at 0.066; Blender plush >= 0.073 (plain walls, nearly colourless: sat_p90 <= 0.35); code
    # gradients 0.006-0.04, glass / neon / dashboards 0.03-0.13. The gradient test cuts at 0.06 and needs colour,
    # the colour-field and neon tests cut at 0.12 and need saturated colour. dark_guard: a rendered dark ground is
    # exactly flat (dark_flat >= 0.85 in the code sets); night footage keeps grain (dark_flat <= 0.77).
    # Procedural colour fields (fractals, shaders) are textured but almost all vivid (> 0.9) and either rainbow
    # (plasma: 8 hue bands) or very cleanly curving (fractal zoom 0.93). Vivid AI cartoons (capybara / lulukong in
    # holdout) reach vivid 0.97 but keep 2-3 hue bands and grad_clean <= 0.86
    "vector_fill": {"tex": 0.06, "grad": 0.12, "sat": 0.3, "vivid": 0.3, "vivid_tex": 0.12, "dark_flat": 0.8,
                    "neon_dark": 0.6, "neon_sat": 0.8, "neon_tex": 0.12, "rainbow": 0.85, "hues": 4.5, "clean": 0.9},
}


FILM_HINT_ZH = LangDict({"letterbox": "画面嵌在上下或左右的黑边里（影视解说常见的版式）",
                         "source_24": "素材是 24/25fps 源（电影、电视剧的帧率；AI 视频也常是这个帧率）"},
                        en={"letterbox": "the picture sits inside black bars (the usual film-recap layout)",
                            "source_24": "the source is 24/25fps (the frame rate of films and TV; AI video often uses it too)"})


def film_hints(f: dict, fps: float | None, pulldown: str | None) -> list[str]:
    """Hints that a photographic shot was cut from a film / series. letterbox: the picture inside fixed black bars,
    wider than tall (features.picture_box). source_24: a 24/25fps source, pulled up to 30 or native. source_24 alone is the AI-video signature too, so it only counts next to another hint."""
    out = []
    if f.get("picture_box") and f.get("picture_aspect", 0) >= 1.3:
        out.append("letterbox")
    native_film_rate = bool(fps and (23.5 <= fps <= 25.5) and f.get("dup_ratio", 1) < 0.05)
    if out and (pulldown in ("24→30", "24→60", "25→30?") or native_film_rate):
        out.append("source_24")
    return out


def lowlight_photo(f: dict, faces: float = 0.0) -> bool:
    """Dim footage with a person in it (see RULES["lowlight"]): crushed shadows shrink the palette and add flat
    blocks, so the "rendered texture" cues do not apply."""
    r = RULES["lowlight"]
    return (f.get("dark_ratio", 0.0) > r["dark_ratio"] and f.get("dark_std", 0.0) > r["dark_std"]
            and f.get("dark_flat", 1.0) < r["dark_flat_max"] and f.get("flat_lit", 1.0) < r["flat_lit_max"] and faces >= r["faces"])


PLATFORM_TRANSCODES = ("WeChat transcode", "WeChat Channels", "Douyin/TikTok", "Douyin", "Kuaishou", "Xiaohongshu", "YouTube")


def video_context(shots: list[dict], provenance: dict | None, fps: float | None) -> dict:
    """Whole-video facts the per-shot classifier needs.
    - transcoded: the file went through a platform re-encode (WeChat / Douyin / TikTok ...). Heavy
      compression wipes sensor noise, so "no noise" is no longer evidence for AI.
    - native30: in a 30 fps file, photographic shots carry no duplicated frames (no 24->30 pulldown).
      Phones record 30 fps natively; video generators mostly emit 24 fps."""
    plat = [h for h in ((provenance or {}).get("hints", {}).get("platform") or []) if h in PLATFORM_TRANSCODES]
    photo_dur = native_dur = 0.0
    for r in shots:
        f = r.get("features") or {}
        photo_like = (f.get("palette95", 0) >= 100 and f.get("flat_ratio", 1) <= 0.2) or lowlight_photo(f, r.get("faces", 0.0))
        if not photo_like or f.get("dup_ratio", 0) > 0.85:
            continue  # rendered graphics or frozen frames say nothing about camera cadence
        d = float(r.get("duration", 0))
        photo_dur += d
        if no_repeats(f) and f.get("sharp_period_ac", 0) < 0.45:
            native_dur += d
    native30 = bool(fps and 29 <= fps <= 31 and photo_dur >= 3 and native_dur / photo_dur >= 0.7)
    # photographic time carrying a film / TV hint (letterbox): a film recap or compilation looks like this
    film_dur = sum(float(r.get("duration", 0)) for r in shots
                   if (r.get("features") or {}).get("palette95", 0) >= 100 and film_hints(r.get("features") or {}, fps, None))
    total = sum(float(r.get("duration", 0)) for r in shots) or 1.0
    return {"transcoded": bool(plat), "platform": plat, "native30": native30, "fps": fps,
            "native30_share": round(native_dur / photo_dur, 3) if photo_dur else None,
            "film_hint_share": round(film_dur / total, 3)}


def deterministic(f: dict, overlay: dict | None = None, text: dict | None = None, faces: float = 0.0,
                  audio: dict | None = None, provenance: dict | None = None, fps: float | None = None,
                  ctx: dict | None = None) -> tuple[dict[str, float], list[str], dict]:
    """Return (probabilities, evidence lines in Chinese, derived facts)."""
    ctx = ctx or {}
    ev: list[str] = []
    facts: dict = {}
    noise, tnoise = f.get("noise_sigma", 0), f.get("temporal_noise", 0)
    flat, pal, axis = f.get("flat_ratio", 0), f.get("palette95", 999), f.get("axis_edge_ratio", 0)
    dup, per, reg = f.get("dup_ratio", 0), f.get("dup_period"), f.get("dup_regularity", 0)
    moving = f.get("moving_pair_ratio", 0)
    kb = f.get("kenburns_score", 0)
    zero = f.get("zero_pixel_ratio", 0)
    text_cov = (text or {}).get("text_coverage", 0.0)

    # ---- temporal family ---------------------------------------------------------
    frozen = dup > 0.85 and f.get("pair_mad_p90", 0) < 0.6
    sparse_anim = dup > 0.6 and moving > 0.01
    if frozen and not sparse_anim and f.get("start_end_mad", 0) < 1.0:
        family = "frozen"
        ev.append(T("画面几乎完全静止：{dup:.0%} 的相邻帧逐像素重复，首尾帧差 {mad:.2f}",
                    "Picture is almost entirely still: {dup:.0%} of adjacent frames are pixel-identical, first-to-last frame difference {mad:.2f}",
                    dup=dup, mad=f.get('start_end_mad', 0)))
    elif kb > 0.45:
        family = "planar"
        ev.append(T("整帧按单一刚体变换运动（拟合内点 {inl:.0%}，残差 {res:.2f}px，无局部运动）→ 静态图推拉：缩放 {zoom:+.1f}%/s，平移 {pan:.0f}px/s",
                    "Whole frame moves as one rigid transform ({inl:.0%} inliers, {res:.2f}px residual, no local motion) → pan/zoom on a still image: zoom {zoom:+.1f}%/s, pan {pan:.0f}px/s",
                    inl=f.get('rigid_inlier_ratio', 0), res=f.get('rigid_residual', 0), zoom=f.get('zoom_per_s', 0) * 100, pan=f.get('pan_px_per_s', 0)))
    elif dup > 0.5:
        family = "mostly_static"
        ev.append(T("{dup:.0%} 的相邻帧完全重复，只有局部元素在动（典型的模板/MG 动画或定格后局部动效）",
                    "{dup:.0%} of adjacent frames are exact duplicates, only local elements move (typical of template / motion-graphics animation, or a hold with local motion)", dup=dup))
    else:
        family = "dynamic"
    facts["temporal_family"] = family

    # ---- texture: rendered graphic vs photographic ------------------------------
    # flat colour blocks and a small palette are the most robust "rendered" cues; the
    # noise estimate is unreliable on text-heavy frames (glyph edges look like noise).
    graphic = (0.45 * _sig((flat - 0.20) / 0.05) + 0.35 * _sig((70 - pal) / 15) + 0.20 * _sig((axis - 0.33) / 0.03))
    lowlight = lowlight_photo(f, faces)
    facts["lowlight"] = lowlight
    if lowlight:
        # judge texture on the lit part only; the palette is small because the shadows are crushed
        lit_graphic = 0.75 * _sig((f.get("flat_lit", 0) - 0.20) / 0.05) + 0.25 * _sig((axis - 0.33) / 0.03)
        if lit_graphic < graphic:
            ev.append(T("低照度画面：{dark:.0%} 的区域接近全黑但带颗粒（不是纯色底），亮部平坦块只有 {lit:.0%}、且有人脸：平坦块/少色是暗部被压缩造成的，不按渲染特征算",
                        "Low-light shot: {dark:.0%} of the frame is near-black but grainy (not a solid fill), flat blocks cover only {lit:.0%} of the lit part, and there is a face: the flat blocks / small palette come from crushed shadows, not counted as rendered texture",
                        dark=f.get('dark_ratio', 0), lit=f.get('flat_lit', 0)))
            graphic = lit_graphic
    # a large face held through the shot is a photographic picture: plain walls and dark clothes make flat blocks
    # after a platform transcode (RULES["big_face"])
    bf = RULES["big_face"]
    big_face = faces >= bf["presence"] and f.get("face_area", 0.0) >= bf["area"] and family in ("dynamic", "mostly_static")
    facts["big_face"] = big_face
    facts["face_area"] = round(f.get("face_area", 0.0), 3) if faces >= 0.3 else 0.0
    if big_face and graphic > 0.25:
        ev.append(T("人脸占画面 {area:.0%}、{faces:.0%} 的采样帧都有：是人物近景画面，平坦色块多来自墙面/衣服，渲染特征降权",
                    "A face covers {area:.0%} of the frame and appears in {faces:.0%} of sampled frames: a close-up of a person, flat colour blocks mostly come from walls / clothing, rendered-texture cues down-weighted",
                    area=f.get('face_area', 0), faces=faces))
        graphic *= bf["graphic_factor"]
    fd = RULES["fine_dark"]
    fine_dark = 0.0
    if fd["lit_min"] < f.get("lit_ratio", 0.0):
        fine_dark = (_sig((f.get("dark_ratio", 0.0) - fd["dark"]) / 0.05) * _sig((fd["smooth"] - f.get("lit_smooth", 1.0)) / 0.05)
                     * _sig((f.get("lit_peaks", 0.0) - fd["peaks"]) / 1.0) * _sig((fd["lit_max"] - f.get("lit_ratio", 0.0)) / 0.04))
    fg = RULES["fine_glow"]
    glow_fine = 0.0
    if fd["lit_min"] < f.get("spark_ratio", 0.0) and f.get("glow_ratio", 0.0) >= fg["glow_min"]:
        glow_fine = (_sig((f.get("dark_ratio", 0.0) - fd["dark"]) / 0.05) * _sig((fg["smooth"] - f.get("spark_smooth", 1.0)) / 0.03)
                     * _sig((f.get("spark_peaks", 0.0) - fg["peaks"]) / 1.5) * _sig((fg["spark_max"] - f.get("spark_ratio", 0.0)) / 0.01))
    by_glow = glow_fine > fine_dark
    fine_dark = max(fine_dark, glow_fine)
    facts["fine_dark"] = round(fine_dark, 3)
    if fine_dark > 0.5:
        sm, pk = (f.get("spark_smooth", 0.0), f.get("spark_peaks", 0.0)) if by_glow else (f.get("lit_smooth", 0.0), f.get("lit_peaks", 0.0))
        ev.append(T("暗底上的亮部几乎全是细碎亮点/细线（{halo}亮部平滑过渡只占 {sm:.0%}，每百个亮像素 {pk:.0f} 个亮峰）：粒子/点云/线框类图形，"
                    "不是有明暗过渡的实拍、3D 表面或 AI 画面",
                    "On a dark ground the lit part is almost all fine dots / thin lines ({halo}only {sm:.0%} of lit pixels shade gently, "
                    "{pk:.0f} bright peaks per 100 lit pixels): particle / point-cloud / wireframe graphics, not a shaded photo, 3D surface or AI picture",
                    sm=sm, pk=pk, halo=T("去掉背后的柔光后，", "with the soft halo behind them taken out, ") if by_glow else ""))
        graphic = max(graphic, fine_dark)
    # the same on a light ground: thin dark lines / dots (line art, generative ink, dot matrices). Pages of small text
    # are left to the screenshot cues (RULES["ui_text"]), they are a document rather than line art
    ut = RULES["ui_text"]
    small_lines = sum(1 for tr in (text or {}).get("tracks", []) if tr.get("text_height", 1.0) < ut["height"])
    fl = RULES["fine_light"]
    fine_light = 0.0
    if fd["lit_min"] < f.get("ink_ratio", 0.0):
        fine_light = (_sig((f.get("light_ratio", 0.0) - fd["dark"]) / 0.05) * _sig((fl["smooth"] - f.get("ink_smooth", 1.0)) / 0.05)
                      * _sig((f.get("ink_peaks", 0.0) - fd["peaks"]) / 1.0) * _sig((fd["lit_max"] - f.get("ink_ratio", 0.0)) / 0.04)
                      * (1.0 - _sig((small_lines - ut["mid"]) / ut["width"])))
    facts["fine_light"] = round(fine_light, 3)
    if fine_light > 0.5:
        ev.append(T("浅色底上的深色部分几乎全是细线/细点（平滑过渡只占 {sm:.0%}）：线稿、生成式线条或点阵图形，不是有明暗的实拍或 3D 表面",
                    "On a light ground the dark part is almost all thin lines / dots (only {sm:.0%} shade gently): line art, generative strokes "
                    "or dot graphics, not a shaded photo or 3D surface", sm=f.get("ink_smooth", 0.0)))
        graphic = max(graphic, fine_light)
    vf = RULES["vector_fill"]
    tex = f.get("tex_fine", 1.0)
    # a rendered dark ground is one exact colour; dark parts of night footage keep grain after transcoding
    dark_guard = 1.0 - min(1.0, f.get("dark_ratio", 0.0) / 0.3) * (1.0 - _sig((f.get("dark_flat", 0.0) - vf["dark_flat"]) / 0.03))
    vec_parts = {
        # smooth coloured gradients with no texture at all (mesh-gradient backgrounds, CSS cards, UI)
        "gradient": _sig((vf["tex"] - tex) / 0.01) * _sig((f.get("grad_share", 0.0) - vf["grad"]) / 0.04)
                    * _sig((f.get("sat_p90", 0.0) - vf["sat"]) / 0.06),
        # large saturated colour fields with little texture (flat illustration, glassmorphism, brand colour blocks)
        "colour_fields": _sig((f.get("vivid", 0.0) - vf["vivid"]) / 0.08) * _sig((vf["vivid_tex"] - tex) / 0.02),
        # saturated glow on a dark ground (neon text, glowing lines)
        "neon": _sig((f.get("dark_ratio", 0.0) - vf["neon_dark"]) / 0.08) * _sig((f.get("sat_p90", 0.0) - vf["neon_sat"]) / 0.05)
                * _sig((vf["neon_tex"] - tex) / 0.02),
        # procedural rainbow colour fields (fractal zooms, plasma / noise shaders)
        "procedural": _sig((f.get("vivid", 0.0) - vf["rainbow"]) / 0.02)
                      * max(_sig((f.get("hue_n", 0.0) - vf["hues"]) / 0.3), _sig((f.get("grad_clean", 0.0) - vf["clean"]) / 0.01)),
    }
    vector = max(vec_parts.values()) * dark_guard * (1.0 - (0.8 if big_face else 0.0))
    facts["vector_fill"] = round(vector, 3)
    kind = max(vec_parts, key=vec_parts.get)
    facts["vector_kind"] = kind if vector > 0.5 else None
    if vector > 0.5:
        what = {"gradient": T("平滑彩色渐变", "smooth colour gradients"), "colour_fields": T("大块饱和纯色", "large saturated colour fields"),
                "neon": T("暗底上的饱和辉光", "saturated glow on a dark ground"), "procedural": T("程序生成的彩虹色场（分形/着色器）", "procedural rainbow colour fields (fractal / shader)")}[kind]
        ev.append(T("画面由{what}构成、几乎没有材质纹理（细纹理像素 {tex:.0%}；实拍、AI 和 3D 渲染的布料/皮肤/噪点都会留下纹理）：代码绘制的矢量/渐变图形",
                    "The picture is {what} with almost no material texture ({tex:.0%} fine-texture pixels; footage, AI and 3D renders keep fabric / skin / noise texture): vector / gradient graphics drawn by code",
                    what=what, tex=tex))
        graphic = max(graphic, vector)
    # (overlay text is a separate layer, so OCR coverage does not count toward the base)
    photo = 1.0 - graphic
    # fine high-frequency detail on flat ground = small text / UI (screenshots, docs, code cards)
    text_like = _sig((noise - 0.8) / 0.2) * _sig((flat - 0.4) / 0.08)
    # many lines of small OCR text = an interface / document screenshot; the noise cue above misses them on
    # platform transcodes, which smooth glyph edges (RULES["ui_text"])
    ut = RULES["ui_text"]
    small_lines = sum(1 for tr in (text or {}).get("tracks", []) if tr.get("text_height", 1.0) < ut["height"])
    ui_text = _sig((small_lines - ut["mid"]) / ut["width"])
    facts["ui_text"] = round(ui_text, 3)
    if ui_text > 0.5:
        ev.append(T("OCR 读到 {n} 行小字号文字：画面里有界面/文档截图", "OCR reads {n} lines of small text: the frame holds a UI / document screenshot", n=small_lines))
    # background pixels exactly unchanged while something moves = 2D compositing (code/MG)
    rsb = _sig((zero - 0.94) / 0.015) * _sig((0.1 - tnoise) / 0.03)
    facts["graphic_score"] = round(graphic, 3)
    facts["text_like"] = round(text_like, 3)
    facts["static_composite"] = round(rsb, 3)
    if graphic > 0.6:
        ev.append(T("纹理呈渲染特征：平坦色块 {flat:.0%}、95% 像素仅用 {pal} 种颜色、横竖直边 {axis:.0%}",
                    "Rendered texture: {flat:.0%} flat colour blocks, 95% of pixels use only {pal} colours, {axis:.0%} axis-aligned edges", flat=flat, pal=pal, axis=axis))
    elif graphic < 0.35:
        ev.append(T("纹理呈照片/视频特征：噪声 σ={noise:.2f}、用色 {pal} 种、平坦块 {flat:.0%}",
                    "Photographic texture: noise σ={noise:.2f}, {pal} colours, {flat:.0%} flat blocks", noise=noise, pal=pal, flat=flat))
    if text_like > 0.6:
        ev.append(T("平坦底色上有大量细小高频细节（小字号文字/界面），像截图或文档画面",
                    "Dense fine high-frequency detail on a flat background (small text / UI), looks like a screenshot or document"))
    if rsb > 0.6 and family != "frozen":
        ev.append(T("背景 {zero:.0%} 像素逐帧完全不变、只有局部元素在动：2D 合成/代码动效特征",
                    "{zero:.0%} of background pixels never change frame to frame while local elements move: 2D compositing / code-driven motion graphics", zero=zero))

    # ---- frame-rate fingerprints -------------------------------------------------
    pulldown = None
    if 0.12 <= dup <= 0.30 and per in (4, 5, 6) and reg > 0.25:
        pulldown = "24→30"
    elif 0.50 <= dup <= 0.66 and per in (1, 2, 3) and not (fps and fps < 47):
        # 24 -> 60 needs a 60 fps file; in a 30 fps file every other frame repeating is a 15 fps source or a picture
        # that barely moves (a camera filming a still phone screen, eval daihuo #10), not a generator's frame rate
        pulldown = "24→60"
    elif 0.03 <= dup <= 0.10 and per in (5, 6, 7) and reg > 0.25:
        pulldown = "25→30?"
    # platform re-encodes alternate frame quality with their GOP (I/P/B) pattern, which mimics the
    # sharpness rhythm of frame interpolation: only trust this cue on first-generation files
    resampled = (f.get("sharp_alt", 0) > 0.025 or f.get("sharp_period_ac", 0) > 0.45) and not ctx.get("transcoded")
    if resampled and not pulldown and family == "dynamic":
        pulldown = "interpolated"
        ev.append(T("逐帧清晰度呈周期性起伏（周期 {p} 帧，相关 {ac:.2f}），但没有重复帧：可能是插帧/帧率转换，也可能只是重新压缩留下的节奏（去掉了平台标记的转码文件也会这样），单凭这一条不能定 AI",
                    "Per-frame sharpness oscillates periodically (period {p} frames, correlation {ac:.2f}) with no duplicate frames: frame interpolation / rate conversion, or just the rhythm of a re-encode (transcodes whose platform tags were stripped show it too); not enough on its own to call AI",
                    p=f.get('sharp_period'), ac=f.get('sharp_period_ac', 0)))
    facts["pulldown"] = pulldown
    # duplicate-frame pulldown is measured cadence; "interpolated" is only a sharpness rhythm, which any re-encode
    # can fake when the platform tags that would switch it off are gone (re-compressed files, downloads with stripped metadata)
    dup_pd = bool(pulldown) and pulldown != "interpolated"
    # this shot's own cadence: a 30 fps file whose frames never repeat was captured at 30 fps (phones) rather than
    # generated at 24 and pulled up. Per shot, unlike ctx["native30"], so a mixed edit (AI opener + phone footage)
    # keeps the signature on the filmed shots. Platform re-encodes add a GOP sharpness rhythm, so that cue is skipped there.
    facts["native_cadence"] = bool(fps and 29 <= fps <= 31 and no_repeats(f) and not pulldown
                                   and (ctx.get("transcoded") or f.get("sharp_period_ac", 0) < 0.45))
    if dup_pd:
        ev.append(T("重复帧呈 {pd} 规律（{dup:.0%}，周期 {per}）：原始素材为 24/25fps 后转码，常见于 AI 生成视频、3D/动画渲染或电影素材",
                    "Duplicate frames follow a {pd} pattern ({dup:.0%}, period {per}): a 24/25fps source transcoded up, typical of AI-generated video, 3D / animation renders or cinema footage",
                    pd=pulldown, dup=dup, per=per))

    # ---- film / TV footage hints -------------------------------------------------
    # who shot the picture is not in the pixels (a film still is camera footage, an AI drama can look the same):
    # these only say "this may be a clip cut from a film or series", the call is left to an image reader
    hints = film_hints(f, fps, pulldown) if photo > 0.5 and family in ("dynamic", "mostly_static", "planar") else []
    facts["film_hints"] = hints
    if hints:
        ev.append(T("影视片段线索：{h}。这些只说明可能是剪进来的影视剧画面，和 AI 视频、自己拍的实拍在像素上分不开，要看图确认",
                    "Film / TV footage hints: {h}. They only suggest a clip cut from a film or series; pixels cannot tell it from AI video "
                    "or self-shot footage, an image reader has to confirm", h=join(FILM_HINT_ZH[k] for k in hints)))

    live_hint = 0.0
    live_hint += 1.2 * _sig((noise - 0.9) / 0.2)
    live_hint += 0.6 * _sig((tnoise - 0.8) / 0.15)
    live_hint += 0.3 * _sig((0.5 - zero) / 0.1)
    live_hint += 0.6 * (1.0 if f.get("camera") == "handheld_like" else 0.0)
    live_hint += 0.2 * (1.0 if dup < 0.03 else 0.0)
    live_hint -= (0.9 if dup_pd else 0.3 if pulldown else 0.0)
    # generators emit 24/25/30 fps; a native >=48 fps stream with no duplicated frames was
    # most likely captured by a phone/camera (or screen/game capture)
    native_hfr = bool(fps and fps >= 47 and dup < 0.05 and not pulldown)
    if native_hfr:
        live_hint += 1.0
        ev.append(T("原生 {fps:.0f}fps 且几乎无重复帧：生成模型通常输出 24/30fps，高帧率原生素材多为手机/相机拍摄",
                    "Native {fps:.0f}fps with almost no duplicate frames: generators usually output 24/30fps, native high-frame-rate footage is mostly phone / camera captured", fps=fps))
    facts["native_hfr"] = native_hfr
    cam_tags = bool((provenance or {}).get("hints", {}).get("camera"))
    if cam_tags:
        live_hint += 1.0
        ev.append(T("容器元数据含拍摄设备信息（make/model/location）", "Container metadata carries capture-device tags (make/model/location)"))
    if ctx.get("native30") and no_repeats(f) and not pulldown:
        live_hint += 0.9
        ev.append(T("整片是原生 30fps、实拍类镜头没有 24fps 源的重复帧（{share:.0%} 时长）：手机直出常见，生成模型多输出 24fps",
                    "The whole file is native 30fps and photographic shots carry no 24fps-source duplicate frames ({share:.0%} of the duration): typical of straight-from-phone footage, generators mostly output 24fps",
                    share=ctx.get('native30_share', 0)))
    live_hint = min(1.0, max(0.0, live_hint / 2.9))
    gen_tags0 = bool((provenance or {}).get("hints", {}).get("generator"))
    degraded = bool(ctx.get("transcoded") and noise < 0.9)
    facts["transcode_degraded"] = degraded
    if degraded and not pulldown and not gen_tags0 and ctx.get("native30") and facts["native_cadence"] and live_hint < 0.55:
        # the noise is gone but the camera cadence is not: native 30fps file, and this shot has it too
        live_hint = 0.55
        ev.append(T("经过平台二次转码（{plat}），传感器噪声被压没了；但整片和这一镜都是原生 30fps、没有 24fps 源的重复帧，按手机实拍算",
                    "Platform transcode ({plat}) has compressed the sensor noise away, but the file and this shot are native 30fps with no 24fps-source duplicate frames: counted as phone footage",
                    plat=join(ctx.get("platform", []))))
    elif degraded and not pulldown and not gen_tags0 and live_hint < 0.45:
        # compression erased the sensor noise: its absence no longer argues for AI
        live_hint = 0.45
        ev.append(T("经过平台二次转码（{plat}），传感器噪声被压没了：噪声类证据失效，实拍还是 AI 主要看帧率和画面内容",
                    "Platform transcode ({plat}) has compressed the sensor noise away: noise cues no longer apply, live action vs AI rests on frame rate and picture content",
                    plat=join(ctx.get("platform", []))))
    if live_hint > 0.6:
        ev.append(T("时域噪声 {tn:.2f}、逐像素不变比例 {zero:.0%}：存在传感器噪声，符合实拍",
                    "Temporal noise {tn:.2f}, {zero:.0%} of pixels unchanged frame to frame: sensor noise is present, consistent with live action", tn=tnoise, zero=zero))
    gen_tags = bool((provenance or {}).get("hints", {}).get("generator"))
    if gen_tags:
        ev.append(T("容器元数据包含生成式工具/AIGC 标识：", "Container metadata carries a generative tool / AIGC label: ") + ", ".join(provenance["hints"]["generator"][:3]))

    speech = bool((audio or {}).get("speech_likely"))
    if faces > 0.6 and family in ("dynamic", "mostly_static") and f.get("camera") in ("static", "static_with_subject_motion"):
        ev.append(T("{faces:.0%} 的采样帧有正脸且机位固定", "{faces:.0%} of sampled frames show a frontal face on a fixed camera", faces=faces)
                  + (T("，音轨有人声", ", voice on the audio track") if speech else ""))

    # ---- assemble scores ---------------------------------------------------------
    s = {k: 0.02 for k in LABELS}
    s["film_footage"] = 0.0  # scored only from film hints below; a floor here would dilute every other label
    if family == "frozen":
        # a frozen *rendered* card is code/template output; a frozen photo/AI picture is a still hold
        screenshot_like = graphic > 0.45 and axis > 0.42 and text_cov > 0.05
        s["static_hold"] += 3.0 * (1 - graphic)
        s["code_render"] += 3.0 * graphic * (0.5 if screenshot_like else 1.0)
        s["screen_capture"] += 3.0 * graphic * (0.6 if screenshot_like else 0.1)
    elif family == "planar":
        s["still_motion"] += 3.0 * kb * (0.35 if pulldown else 1.0)
        if pulldown:
            ev.append(T("但运动带有 24fps 源的帧率转换痕迹：更像生成视频里的缓慢推镜，而不是剪辑软件对静图做推拉",
                        "But the motion carries 24fps-source frame-rate conversion marks: more likely a slow push-in inside a generated video than an editor's pan/zoom on a still"))
            s["ai_video"] += 1.2
        s["screen_capture"] += 0.5 * graphic * (1 if abs(f.get("zoom_per_s", 0)) < 0.003 else 0.2)  # pure scroll
        s["ai_video"] += 0.3
    elif family == "mostly_static":
        s["code_render"] += 1.6 * graphic * (1 + 0.5 * rsb) * (1 - 0.5 * text_like * _sig((0.12 - f.get("saturation", 0.3)) / 0.04))
        s["screen_capture"] += 1.5 * graphic * text_like * (0.3 + _sig((0.12 - f.get("saturation", 0.3)) / 0.04))
        s["static_hold"] += 0.5 * photo
        s["cg_3d"] += 0.4 * graphic * (1 - text_like) * (1 - 0.8 * max(fine_dark, fine_light, vector))
        s["code_render"] += 1.2 * graphic * max(fine_dark, fine_light, vector)
        s["ai_video"] += 0.8 * photo * (1.4 if dup_pd else 1.0)
        s["live_action"] += 0.3 * photo * live_hint
    else:
        axis_f = 1.2 if axis > 0.38 else 0.8
        # near-grayscale frames built from a handful of colours are UI / documents (white pages, grey
        # cards, dark editors), not shaded 3D renders: shading spreads colours, product 3D is coloured
        ui_gray = _sig((0.04 - f.get("saturation", 0.3)) / 0.01) * _sig((20 - pal) / 3)
        facts["ui_gray"] = round(ui_gray, 3)
        code_cue = max(fine_dark, fine_light, vector)
        s["code_render"] += 1.5 * graphic * (0.3 + 1.2 * rsb + 1.0 * text_like + 0.8 * ui_gray + 1.2 * code_cue) * axis_f
        s["cg_3d"] += 1.5 * graphic * max(0.0, 1.1 - rsb - 0.8 * text_like) * (1 - 0.8 * ui_gray) * (1 - 0.8 * ui_text) * (1 - 0.8 * code_cue)
        s["screen_capture"] += 1.2 * graphic * ui_text
        if ui_gray > 0.5 and graphic > 0.6:
            ev.append(T("画面几乎无彩色（饱和度 {sat:.2f}）、只用 {pal} 种颜色：界面/文档类平面画面，不是有光影的 3D 渲染",
                        "Nearly colourless frame (saturation {sat:.2f}) with only {pal} colours: a flat UI / document picture, not a shaded 3D render",
                        sat=f.get('saturation', 0), pal=pal))
        s["screen_capture"] += 1.2 * graphic * text_like * (0.3 + _sig((0.12 - f.get("saturation", 0.3)) / 0.04))
        s["live_action"] += 1.5 * photo * live_hint
        s["ai_video"] += 1.5 * photo * (1 - live_hint) * (1.4 if dup_pd else 1.0)
        # a talking-head avatar is a fixed frame; a shaking handheld camera argues for a person filming
        moving_cam = RULES["avatar_moving_camera"] if f.get("camera") in ("handheld_like", "smooth_move") else 1.0
        s["avatar"] += 0.6 * photo * (1 if faces > 0.6 else 0.1) * (1.0 if speech else 0.4) * (1 - live_hint) * moving_cam
        if pulldown:
            s["cg_3d"] *= 1.2
    if hints:
        # a runner-up at most: enough to show up in the probabilities, never enough to win on hints alone
        s["film_footage"] += 0.25 * photo * len(hints)
    if gen_tags:
        s["ai_video"] += 1.0
        s["avatar"] += 0.3
    probs = _norm(s)
    facts["live_hint"] = round(live_hint, 3)
    return probs, ev, facts


def image_source_guess(f: dict, facts: dict) -> str:
    if facts.get("graphic_score", 0) > 0.6:
        return "graphic"
    if f.get("axis_edge_ratio", 0) > 0.45 and f.get("noise_sigma", 1) < 0.2:
        return "screenshot"
    return "unknown"  # photo vs AI image needs the VLM


# Labels that answer the same first question ("how was the picture made?") and differ only in subtype.
# Fusion decides the group first, then the subtype inside it: when the tools say "AI video" and an agent says
# "digital avatar", both are votes for "generated" and must not be outvoted by a third source's "live action".
GROUPS = {"ai_video": "generated", "avatar": "generated", "cg_3d": "rendered", "code_render": "rendered", "anim_2d": "rendered",
          "stop_motion": "live_action", "film_footage": "live_action"}


def group_of(label: str) -> str:
    return GROUPS.get(label, label)


def _group_sum(d: dict[str, float]) -> dict[str, float]:
    g: dict[str, float] = {}
    for k, v in d.items():
        g[group_of(k)] = g.get(group_of(k), 0.0) + v
    return g


def _log_pool(det_p: float, vlm_p: float, det_w: float) -> float:
    return math.exp(det_w * 0.6 * math.log(det_p + 1e-4) + VLM_WEIGHT * math.log(vlm_p + 1e-3))


def fuse(det: dict[str, float], vlm: dict[str, float] | None, family: str, majority: str | None = None) -> dict[str, float]:
    """Two stages: which group made the picture (generated / filmed / rendered / screen / still), then which subtype.
    majority: the tools' top label when one of the two image readers backs its group (see pipeline._majority)."""
    if not vlm:
        return det
    vlm = _norm({k: float(vlm.get(k, 0.0)) for k in LABELS})
    # hard temporal constraints: a frozen shot cannot be a generated *video*
    mult = {k: 1.0 for k in LABELS}
    if family == "frozen":
        for k in ("ai_video", "live_action", "avatar", "cg_3d", "still_motion", "anim_2d", "stop_motion", "film_footage"):
            mult[k] = 0.05
    if family == "planar":
        for k in ("live_action", "avatar", "film_footage"):
            mult[k] = 0.2
    # the tools cannot tell film / TV footage from self-shot footage (both are camera pictures), so inside the filmed
    # group their live-action score stands for both and the image reader picks the subtype
    pool_det = dict(det, film_footage=max(det.get("film_footage", 0.0), det.get("live_action", 0.0)))
    sub = {k: _log_pool(pool_det.get(k, 0.0), vlm.get(k, 0.0), DET_WEIGHT[k]) * mult[k] for k in LABELS}
    raw = {k: _log_pool(pool_det.get(k, 0.0), vlm.get(k, 0.0), DET_WEIGHT[k]) for k in LABELS}
    dg, vg = _group_sum(det), _group_sum(vlm)
    members: dict[str, list[str]] = {}
    for k in LABELS:
        members.setdefault(group_of(k), []).append(k)
    out: dict[str, float] = {}
    for g, ks in members.items():
        # the group trusts the tools as much as their favourite member; constraints scale it like its members
        w = DET_WEIGHT[max(ks, key=lambda k: det.get(k, 0.0))]
        cons = sum(sub[k] for k in ks) / (sum(raw[k] for k in ks) or 1e-12)
        gs = _log_pool(dg.get(g, 0.0), vg.get(g, 0.0), w) * cons
        inner = sum(sub[k] for k in ks) or 1e-12
        for k in ks:
            out[k] = gs * sub[k] / inner
    # the answer must be one that some source actually backs (top-2 of the deterministic layer
    # or of the model, or a member of the group either one ranks first), not a compromise nobody voted for
    backed = {k for src in (det, vlm) for k, _ in sorted(src.items(), key=lambda kv: -kv[1])[:2]}
    backed |= {k for src in (dg, vg) for k in members[max(src, key=src.get)] if det.get(k, 0.0) + vlm.get(k, 0.0) > 0.05}
    best = max(out, key=out.get)
    if best not in backed:
        for k in out:
            if k not in backed:
                out[k] *= 0.1
    # two of three sources agree on the group: one overconfident model must not outvote them (hard constraints above still apply)
    if majority and out[majority] > 0:
        if max(out, key=out.get) != majority:
            for k in out:
                if k != majority:
                    out[k] = min(out[k], out[majority] * 0.8)
        # and as a group: "AI video" + "avatar" together must not outvote it either
        gm = group_of(majority)
        cap = 0.8 * sum(v for k, v in out.items() if group_of(k) == gm)
        for g, ks in members.items():
            tot = sum(out[k] for k in ks)
            if g != gm and tot > cap:
                for k in ks:
                    out[k] *= cap / tot
    return _norm(out)


def top(probs: dict[str, float]) -> tuple[str, float]:
    k = max(probs, key=probs.get)
    return k, probs[k]


def decide(probs: dict[str, float]) -> tuple[str, float]:
    """Final call, two stages: the group with the most probability (how the picture was made), then its best
    subtype. Confidence is the group's probability: "AI video 35% / avatar 26% / live 38%" is a 61% call
    that the picture was generated."""
    g: dict[str, float] = {}
    for k, p in probs.items():
        g[group_of(k)] = g.get(group_of(k), 0.0) + p
    best = max(g, key=g.get)
    k = max((x for x in probs if group_of(x) == best), key=probs.get)
    return k, g[best]


def overlay_layers(overlay: dict | None, text: dict | None, template: dict | None) -> list[dict]:
    layers: list[dict] = []
    for tr in (text or {}).get("tracks", []):
        if not tr.get("axis_aligned", True) and tr["kind"] != "subtitle":
            continue  # tilted text is probably part of the scene
        layers.append({"kind": tr["kind"], "source": "code_or_editor", "band": tr["band"], "texts": tr["texts"],
                       "changing": tr["changing"], "y_center": tr.get("y_center"), "drift": tr.get("drift")})
    for b in (overlay or {}).get("boxes", []):
        if any(l["band"] == b["band"] and l["kind"] in ("subtitle", "title", "label") for l in layers):
            continue
        layers.append({"kind": "static_graphic", "source": "code_or_editor", "band": b["band"], "bbox": b["bbox"]})
    if template and template.get("frozen_edge_ratio", 0) > 0.25 and template.get("boxes"):
        layers.append({"kind": "layout_template", "source": "code_or_editor", "band": "frame",
                       "coverage": round(template.get("frozen_ratio", 0), 3)})
    return layers


# bases whose picture can carry printed words (packaging, signs, screens in the scene) that OCR also reads
# (a still image is often a screenshot or a poster whose words are its content: left alone)
SCENE_TEXT_BASES = ("live_action", "ai_video", "avatar", "cg_3d", "stop_motion")
SCENE_TEXT_DRIFT = 0.04  # the same words moved more than 4% of the frame: they sit on an object


def _same_words(ocr: str, overlay: str) -> bool:
    a, b = (re.sub(r"\s+", "", x).lower() for x in (ocr, overlay))
    if len(a) < 2 or not b:
        return False
    if a in b or b in a:
        return True
    m = SequenceMatcher(None, a, b, autojunk=False)
    blocks = m.get_matching_blocks()
    # a contiguous run of the same characters, not letters scattered across the line ("Aon" in "GAME CHANGER")
    return max(blk.size for blk in blocks) >= max(2, len(a) // 2) and sum(blk.size for blk in blocks) / len(a) >= 0.6


def drop_scene_text(layers: list[dict], label: str, vlm_overlay: list | None) -> tuple[list[dict], list[str]]:
    """Remove OCR text that belongs to the scene (logos and labels on products, signs) from the overlay layers.
    vlm_overlay: the image reader's list of post-production text (None when it did not answer). It is asked to
    leave out words printed on objects, so OCR tracks it does not mention are scene text.
    Without it, only text that moves with the picture is dropped."""
    if label not in SCENE_TEXT_BASES:
        return layers, []
    keep, dropped = [], []
    for l in layers:
        if not l.get("texts"):
            keep.append(l)
            continue
        if isinstance(vlm_overlay, list):
            said = [t for t in l["texts"] if any(_same_words(t, str(o)) for o in vlm_overlay)]
            scene = not said
            if said and len(said) < len(l["texts"]):  # one track can mix a subtitle with keyboard letters filmed behind it
                dropped.append(dict(l, texts=[t for t in l["texts"] if t not in said]))
                l = dict(l, texts=said)
        else:
            scene = (l.get("drift") or 0.0) > SCENE_TEXT_DRIFT
        (dropped if scene else keep).append(l)
    return keep, list(dict.fromkeys(t for l in dropped for t in l["texts"][:3]))


OVERLAY_KIND_ZH = LangDict({"subtitle": "字幕", "title": "标题", "label": "文字标注", "static_graphic": "图形贴片", "layout_template": "版式模板",
                            "huazi": "花字", "animated_sticker": "动态贴纸/GIF", "static_sticker": "静态贴纸", "pip": "画中画"},
                           en={"subtitle": "subtitles", "title": "title", "label": "text labels", "static_graphic": "static graphics", "layout_template": "layout template",
                               "huazi": "styled text", "animated_sticker": "animated sticker / GIF", "static_sticker": "static sticker", "pip": "picture-in-picture"})


def verdict_text(label: str, image_source: str | None, layers: list[dict]) -> str:
    base = LABEL_ZH[label]
    if label in ("static_hold", "still_motion") and image_source and image_source != "unknown":
        base += T("（{s}）", " ({s})", s=IMAGE_SOURCE_ZH.get(image_source, image_source))
    kinds = []
    for l in layers:
        name = OVERLAY_KIND_ZH.get(l["kind"], l["kind"])
        if name not in kinds:
            kinds.append(name)
    if kinds:
        return T("{base} + 代码/剪辑叠加（{kinds}）", "{base} + code / editor overlays ({kinds})", base=base, kinds=join(kinds))
    return base
