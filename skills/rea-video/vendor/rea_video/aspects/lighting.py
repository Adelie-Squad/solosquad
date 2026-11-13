"""Lighting: where the key light comes from, how strong against the shadow side, how soft, what colour, what else
is lit; then a named set-up with gear to rebuild it.

Measured on the frame's subject (aspects.subject): the face split at the nose, or the in-focus region split at its
centre. In linear light:
  ratio        brighter half / darker half (light ratio; 2:1 = one stop)
  key_side     which half of the picture is brighter
  top_bottom   upper / lower part of the subject (light from above vs from below: screens, desk bounce)
  transition   width of the lit -> shadow ramp across the subject (narrow = hard light); only when ratio >= 1.4
  subject_luma / bg_luma / dark_share / point_lights   exposure, separation, low light, visible lamps
  warmth / bg_warmth   Lab b* of subject and lit background (mixed colour temperatures)
  bg_blur      background sharpness / subject sharpness (shallow depth of field)
The set-up table (SETUPS) maps these to a named set-up; add rows there for new lighting styles. Rim light, catchlight
shape and the actual light source are the image readers' call. Platform transcodes crush shadows: hardness and
fill are the least reliable measurements."""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..i18n import T, semi

from .base import (FILMED, PHOTOGRAPHIC, Aspect, Field, ShotCtx, field_table, mode_seen, register, seen, video_seen,
                   weighted_median, weighted_mode)

MEASURES = ("ratio", "top_bottom", "transition", "subject_luma", "bg_luma", "dark_share", "warmth", "bg_warmth", "bg_blur", "point_lights",
            "bg_std")
OUTDOOR_WORDS = ("户外", "室外", "街", "公园", "海边", "沙滩", "山", "田野", "操场", "天台", "阳台外", "outdoor", "outside", "exterior",
                 "street", "park", "beach", "seaside", "mountain", "field", "rooftop", "playground")
INDOOR_WORDS = ("室内", "indoor", "interior", "inside")
HARD_TRANSITION = 0.16   # lit -> shadow ramp narrower than this share of the subject = hard light
FROM_BELOW_TB = 0.85     # top / bottom luma below this = lit from below (screen, desk bounce)


def hard_light(m: dict) -> bool:
    return m.get("transition") is not None and m["transition"] <= HARD_TRANSITION


def from_below(m: dict) -> bool:
    return (m.get("top_bottom") or 1.0) < FROM_BELOW_TB


def is_outdoor(location: str | None) -> bool:
    """What an image reader said about the place (either language) names an outdoor spot and not an indoor one."""
    loc = (location or "").lower()
    return bool(loc) and any(k in loc for k in OUTDOOR_WORDS) and not any(k in loc for k in INDOOR_WORDS)


def _lin(gray: np.ndarray) -> np.ndarray:
    return (gray.astype(np.float32) / 255.0) ** 2.2


def _px(x0: float, y0: float, x1: float, y1: float, w: int, h: int) -> tuple[int, int, int, int]:
    return max(0, int(x0 * w)), max(0, int(y0 * h)), min(w, int(x1 * w)), min(h, int(y1 * h))


def frame_light(bgr: np.ndarray, subj: dict) -> dict | None:
    """Lighting measurements of one frame around its subject."""
    h, w = bgr.shape[:2]
    bx, by, bw, bh = subj["box"]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    lm = subj.get("landmarks")
    if subj["kind"] == "face":  # skin band below the hairline, inside the cheeks; split at the nose
        x0, y0, x1, y1 = _px(bx + 0.12 * bw, by + 0.25 * bh, bx + 0.88 * bw, by + 0.92 * bh, w, h)
        mid = lm[2][0] if lm else bx + bw / 2
        bg_box = (bx - 0.6 * bw, by - 0.4 * bh, bx + 1.6 * bw, 1.0)  # head and shoulders
    else:
        x0, y0, x1, y1 = _px(bx, by, bx + bw, by + bh, w, h)
        mid = bx + bw / 2
        bg_box = (bx - 0.1 * bw, by - 0.1 * bh, bx + 1.1 * bw, by + 1.1 * bh)
    xm = int(mid * w)
    if x1 - x0 < 12 or y1 - y0 < 12 or not (x0 + 4 < xm < x1 - 4):
        return None
    region = gray[y0:y1, x0:x1]
    lmean = float(_lin(gray[y0:y1, x0:xm]).mean()) + 1e-4
    rmean = float(_lin(gray[y0:y1, xm:x1]).mean()) + 1e-4
    ratio = max(lmean, rmean) / min(lmean, rmean)
    key_side = "left" if lmean > rmean else "right"
    top = float(_lin(gray[y0:int(y0 + 0.35 * (y1 - y0)), x0:x1]).mean()) + 1e-4
    bottom = float(_lin(gray[int(y0 + 0.65 * (y1 - y0)):y1, x0:x1]).mean()) + 1e-4
    transition = None
    if ratio >= 1.4:
        prof = _lin(gray[y0 + (y1 - y0) // 4: y0 + 3 * (y1 - y0) // 4, x0:x1]).mean(axis=0)
        k = max(3, (len(prof) // 12) | 1)
        prof = np.convolve(prof, np.ones(k) / k, mode="valid")
        if len(prof) > 8:
            p = prof if key_side == "right" else prof[::-1]  # rise from shadow to lit
            lo, hi = float(np.percentile(p, 10)), float(np.percentile(p, 90))
            if hi - lo > 1e-3:
                transition = max(0, int(np.argmax(p >= lo + 0.8 * (hi - lo))) - int(np.argmax(p >= lo + 0.2 * (hi - lo)))) / len(p)
    mask = np.ones((h, w), bool)
    a0, b0, a1, b1 = _px(*bg_box, w, h)
    mask[b0:b1, a0:a1] = False
    has_bg = mask.mean() > 0.12
    lap = np.abs(cv2.Laplacian(gray, cv2.CV_32F))
    subj_sharp = float(lap[y0:y1, x0:x1].mean()) + 1e-3
    out = {"ratio": ratio, "key_side": key_side, "top_bottom": top / bottom, "transition": transition,
           "subject_luma": float(np.median(region)), "dark_share": float((gray < 28).mean()),
           "warmth": float(lab[y0:y1, x0:x1, 2].astype(np.float32).mean() - 128),
           "bg_luma": None, "bg_warmth": None, "bg_blur": None, "point_lights": 0, "bg_std": None}
    if has_bg:
        out["bg_luma"] = float(np.median(gray[mask]))
        out["bg_std"] = float(gray[mask].std())  # a seamless backdrop / plain wall is nearly one tone
        out["bg_blur"] = float(lap[mask].mean()) / subj_sharp
        lit_bg = mask & (gray > 50)
        if lit_bg.sum() > 200:
            out["bg_warmth"] = float(lab[..., 2][lit_bg].astype(np.float32).mean() - 128)
        hot = ((gray > 235) & mask).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(hot, connectivity=8)
        out["point_lights"] = int(sum(1 for i in range(1, n) if 2 <= stats[i, cv2.CC_STAT_AREA] <= 0.004 * h * w))
    return out


def words(m: dict) -> dict:
    """Plain-language reading of measurements (one shot, or a video's medians)."""
    if not m or m.get("ratio") is None:
        return {}
    r, side = m["ratio"], {"left": T("画面左侧", "frame left"), "right": T("画面右侧", "frame right")}.get(m.get("key_side"), "?")
    key = (T("正面（光从镜头方向来，主体两侧亮度接近）", "frontal (from the camera side; both sides of the subject about equally bright)") if r < 1.35
           else (T("{side}偏前方", "{side}, three-quarter front", side=side) if r < 2.5 else T("{side}（侧光）", "{side} (side light)", side=side)))
    tb = m.get("top_bottom") or 1.0
    vert = (T("从下往上（屏幕/桌面反光/低位光源）", "from below (screen / desk bounce / low source)") if from_below(m)
            else (T("从上往下（顶灯/路灯/高位光源）", "from above (ceiling light / street lamp / high source)") if tb > 1.35 else T("与主体同高", "at subject height")))
    tr = m.get("transition")
    quality = ((T("柔光（几乎没有明暗分界）", "soft light (almost no lit / shadow edge)") if r < 1.35 else T("无法判断", "unclear")) if tr is None
               else T("柔光（明暗过渡宽）", "soft light (wide lit-to-shadow ramp)") if tr >= 0.32
               else T("硬光（明暗分界清楚）", "hard light (sharp shadow edge)") if hard_light(m) else T("中等柔度", "medium-soft"))
    warm = m.get("warmth") or 0.0
    ct = (T("偏暖（约 3000–4000K）", "warm (about 3000–4000K)") if warm > 14
          else (T("偏冷（日光/冷白 LED）", "cool (daylight / cool-white LED)") if warm < 4 else T("中性（约 5000K）", "neutral (about 5000K)")))
    blur = m.get("bg_blur")
    depth = None if blur is None else (T("背景明显虚化（浅景深/人像模式）", "background clearly blurred (shallow depth of field / portrait mode)") if blur < 0.45
                                       else T("背景略虚", "background slightly soft") if blur < 0.8 else T("背景清晰", "background sharp"))
    sep = None
    if m.get("bg_luma") is not None and m.get("subject_luma") is not None:
        d = m["subject_luma"] - m["bg_luma"]
        sep = (T("主体比背景亮", "subject brighter than background") if d > 25
               else (T("背景比主体亮（逆光/背景灯更亮）", "background brighter than subject (backlit / background lights brighter)") if d < -25
                     else T("主体和背景亮度接近", "subject and background about equally bright")))
    low = (m.get("subject_luma", 255) < 95 and (m.get("dark_share") or 0) > 0.25) or (m.get("bg_luma") is not None and m["bg_luma"] < 35)
    return {"key_direction": key, "vertical": vert,
            "ratio": T("约 {r:.1f}:1（相差 {st:.1f} 档）", "about {r:.1f}:1 ({st:.1f} stops)", r=r, st=math.log2(max(r, 1.0))),
            "quality": quality, "color_temp": ct, "depth": depth, "separation": sep, "low_light": bool(low),
            "mixed_color": m.get("bg_warmth") is not None and abs(m["bg_warmth"] - warm) > 10,
            "point_lights": int(m.get("point_lights") or 0)}


# Lighting set-ups, first match wins. `when(m, w)` gets the measurements and their reading.
# gear: per subject kind ("face" = people, "other" = desk / product / hands). name_en / detail_en / gear_en: English report.
SETUPS = [
    # ---- outdoor (needs an image reader to say "outdoor"; pixels cannot tell a window from the sky)
    {"key": "outdoor_backlit", "name": "户外逆光（太阳或亮天空在主体后方）", "name_en": "outdoor backlight (sun or bright sky behind the subject)",
     "when": lambda m, w: w.get("outdoor") and not w["low_light"] and m.get("bg_luma") is not None and m["bg_luma"] - m.get("subject_luma", 0) > 25,
     "detail": "太阳在主体后方或侧后方，头发和肩膀有亮边，脸靠天空和地面反光照亮；常在日出日落前后拍（黄金时刻）",
     "detail_en": "sun behind or behind-and-beside the subject, rim on hair and shoulders, face lit by sky and ground bounce; usually shot around sunrise / sunset (golden hour)",
     "gear": {"face": ["傍晚太阳低时拍，人背对太阳", "正面用反光板（金色更暖）或补光灯提亮脸", "曝光按脸测，天空允许过曝一点"],
              "other": ["物品背光放，边缘会被勾亮", "正面用白卡/反光板补光"]},
     "gear_en": {"face": ["shoot when the sun is low, subject with their back to it", "bounce board (gold for warmth) or a fill light from the front to lift the face",
                          "expose for the face; let the sky clip a little"],
                 "other": ["place the object against the light so its edges get a rim", "white card / bounce board as fill from the front"]}},
    {"key": "outdoor_sun", "name": "户外直射阳光（硬光）", "name_en": "outdoor direct sun (hard light)",
     "when": lambda m, w: w.get("outdoor") and not w["low_light"] and (m["ratio"] >= 2.0 or hard_light(m)),
     "detail": "晴天阳光直接照在主体上，阴影边缘清楚、反差大",
     "detail_en": "direct sun on the subject: sharp shadow edges, high contrast",
     "gear": {"face": ["让太阳在人物侧前方 45°，避开正午顶光", "暗部用反光板补，或拍摄时站到有反光的浅色墙边"],
              "other": ["阳光斜射时拍，影子更长更有质感", "暗部用白卡补光"]},
     "gear_en": {"face": ["put the sun 45° to the front-side of the subject; avoid midday top light", "fill the shadow side with a bounce board, or stand next to a light-coloured wall"],
                 "other": ["shoot with the sun low and raking: longer shadows, more texture", "white card to fill the shadows"]}},
    {"key": "outdoor_soft", "name": "户外阴天/背阴处柔光", "name_en": "outdoor soft light (overcast / open shade)",
     "when": lambda m, w: w.get("outdoor") and not w["low_light"],
     "detail": "阴天或站在建筑阴影里，天空当一盏大柔光灯，几乎没有硬阴影",
     "detail_en": "overcast sky or the shade of a building: the sky is one huge soft source, almost no hard shadows",
     "gear": {"face": ["阴天或找建筑的阴影处，面朝开阔的天空", "可选：反光板从下方补一点眼神光"],
              "other": ["放在阴影里、面朝开阔天空", "白色泡沫板反光让暗部更亮"]},
     "gear_en": {"face": ["overcast day or open shade next to a building, subject facing the open sky", "optional: bounce board from below for a little catchlight"],
                 "other": ["place it in the shade facing the open sky", "white foam board to bounce light into the shadows"]}},
    # ---- studio looks
    {"key": "low_key", "name": "低调光（主体被单独照亮，背景压黑）", "name_en": "low key (subject lit on its own, background held black)",
     "when": lambda m, w: (m.get("bg_luma") is not None and m["bg_luma"] < 22 and not m.get("point_lights")
                           and m.get("subject_luma", 0) >= 100 and (m.get("dark_share") or 0) > 0.4),
     "detail": "一盏控制得很窄的主光只照主体，背景不打光、保持全黑，戏剧感强",
     "detail_en": "one tightly controlled key lights only the subject; the background gets no light and stays black; dramatic",
     "gear": {"face": ["一盏 LED + 带蜂巢/束光筒的柔光箱，从侧前方打", "背景用黑布或离墙远一点，不要补光", "可选：背后加一盏弱轮廓灯"],
              "other": ["黑色背景布 + 一盏带束光筒的灯从侧上方打物品", "用黑卡挡住溢到背景的光"]},
     "gear_en": {"face": ["one LED with a gridded softbox / snoot, from the front-side", "black backdrop or keep well away from the wall; no fill", "optional: a weak rim light from behind"],
                 "other": ["black backdrop + one snooted light on the object from high side", "black card to flag light spilling onto the background"]}},
    {"key": "high_key", "name": "高调光（整体明亮、几乎没有暗部）", "name_en": "high key (bright overall, almost no shadows)",
     "when": lambda m, w: (w.get("g") or {}).get("mean_l", 0) > 68 and ((w.get("g") or {}).get("dark_share") or 0) < 0.02 and m["ratio"] < 1.6,
     "detail": "主体和背景都打得很亮，白色或浅色背景，阴影几乎被补光抹掉；常见于美妆、产品、清新风",
     "detail_en": "subject and background both lit bright, white or pale background, shadows filled almost away; common in beauty, product and airy looks",
     "gear": {"face": ["两盏大柔光箱在人物两侧 45°，再加一盏打亮白色背景", "或白天大窗户 + 白墙，曝光稍微加一点"],
              "other": ["白色无缝背景纸 + 两侧柔光箱 + 一盏打背景", "白色泡沫板围住物品补光"]},
     "gear_en": {"face": ["two large softboxes at 45° either side, plus one light on the white background", "or a big window by day + white wall, exposed a touch bright"],
                 "other": ["white seamless paper + softboxes both sides + one light on the background", "white foam boards around the object as fill"]}},
    {"key": "colored_ambient", "name": "彩色氛围光（RGB 灯 / 霓虹）", "name_en": "coloured ambient light (RGB lights / neon)",
     "when": lambda m, w: ((w.get("g") or {}).get("bright_sat", 0) > 0.5 and ((w.get("g") or {}).get("hue_bins") or 0) >= 2
                           and not w["low_light"]),
     "detail": "画面里的光带明显颜色（蓝紫、粉红等），通常是 RGB 灯带、彩色补光灯或霓虹招牌，主体可能被两种颜色从两侧夹打",
     "detail_en": "the light carries strong colour (blue-purple, pink ...), usually RGB strips, coloured fill lights or neon signs; the subject may be cross-lit in two colours",
     "gear": {"face": ["主光仍用白光柔光箱照脸，避免肤色发怪", "背景或侧后方放 RGB 灯棒 / 灯带，选两种对比色（蓝 + 粉、青 + 橙）"],
              "other": ["两盏 RGB 灯从左右两侧打不同颜色", "背景墙用灯带洗出渐变色"]},
     "gear_en": {"face": ["keep a white softbox as the key on the face so skin stays natural", "RGB tubes / strips behind or to the back-side, two contrasting colours (blue + pink, teal + orange)"],
                 "other": ["two RGB lights from left and right in different colours", "LED strip to wash the back wall in a gradient"]}},
    {"key": "product_still", "name": "产品静物布光（无缝背景）", "name_en": "product still-life lighting (seamless background)",
     "when": lambda m, w: (w.get("subject_kind") == "other" and m.get("bg_std") is not None and m["bg_std"] < 12
                           and not w["low_light"]),
     "detail": "物品放在干净的纯色背景上，背景几乎没有纹理，光从上方或两侧柔和地包住物品",
     "detail_en": "object on a clean plain background with almost no texture; soft light wraps it from above or both sides",
     "gear": {"other": ["静物台或无缝背景纸（白/灰/彩色）", "顶部一盏大柔光箱，两侧各一盏或白卡", "亮面物品（玻璃、金属、手机）用柔光布围起来，避免反射出灯和人"],
              "face": ["纯色背景纸 + 两侧柔光箱", "人离背景 1 米以上，避免影子落在背景上"]},
     "gear_en": {"other": ["shooting table or seamless paper (white / grey / coloured)", "one large softbox overhead, one each side or white cards",
                           "tent glossy objects (glass, metal, phones) in diffusion so the lights and you do not reflect"],
                 "face": ["plain paper backdrop + softboxes both sides", "subject at least 1 m from the backdrop so no shadow lands on it"]}},
    # ---- the original set-ups
    {"key": "ambient_low_light", "name": "夜景/弱光环境光，没有专门补光", "name_en": "night / low-light ambient, no dedicated fill",
     "when": lambda m, w: w["low_light"],
     "detail": "主光来自环境（路灯、招牌、室内顶灯、屏幕），主体偏暗、反差由环境决定",
     "detail_en": "the key is whatever is there (street lamps, signs, ceiling lights, screens); the subject sits dark and contrast is set by the surroundings",
     "gear": {"face": ["手机夜景/人像模式，找一盏路灯或招牌做主光，人站在灯斜下方", "想更干净：镜头旁加一个低亮度暖色 LED 小灯（3200K）"],
              "other": ["找一处有台灯/氛围灯的位置，把物品放在灯下", "想更干净：加一盏低亮度 LED 小灯从侧上方照物品"]},
     "gear_en": {"face": ["phone night / portrait mode; use a street lamp or sign as the key, subject just off-axis below it",
                          "for a cleaner picture: a small dim warm LED (3200K) next to the lens"],
                 "other": ["find a spot with a desk lamp / mood light and put the object under it", "for a cleaner picture: a small dim LED from high side on the object"]}},
    {"key": "back_lit", "name": "逆光/背景比主体亮", "name_en": "backlit / background brighter than subject",
     "when": lambda m, w: m.get("bg_luma") is not None and m["bg_luma"] - m.get("subject_luma", 0) > 40,
     "detail": "背景（窗户、天空、亮墙）比主体亮，主体靠反光或曝光补偿",
     "detail_en": "the background (window, sky, bright wall) is brighter than the subject, which relies on bounce or exposure compensation",
     "gear": {"face": ["背对窗户坐，或在镜头侧加反光板/补光灯把脸提亮"], "other": ["物品背对窗户，正面放反光板或白卡补光"]},
     "gear_en": {"face": ["sit with your back to the window, with a bounce board / fill light at the camera to lift the face"],
                 "other": ["object with its back to the window, bounce board or white card as fill from the front"]}},
    {"key": "soft_front", "name": "正面柔光（平光）", "name_en": "soft frontal light (flat light)",
     "when": lambda m, w: m["ratio"] < 1.35,
     "detail": "大面积光从镜头方向来，主体上几乎没有阴影：面朝窗户、环形灯，或大柔光箱放在镜头后方",
     "detail_en": "a large source from the camera side, almost no shadow on the subject: facing a window, a ring light, or a big softbox behind the camera",
     "gear": {"face": ["环形灯（18 寸）或带柔光罩的 LED 平板灯，放在手机正后方略高处", "或白天面朝窗户，窗户在镜头后面"],
              "other": ["桌面正上方/镜头后方放一盏大柔光灯（或两盏左右对称 45°）", "白色桌面或白卡反光，阴影会更淡"]},
     "gear_en": {"face": ["18-inch ring light or a diffused LED panel just behind and above the phone", "or face a window by day, window behind the camera"],
                 "other": ["one large soft light straight above the desk / behind the camera (or two, symmetrical at 45°)", "white desk or white cards to bounce; shadows go lighter"]}},
    {"key": "key_fill", "name": "侧前方主光 + 补光（标准布光）", "name_en": "three-quarter key + fill (standard set-up)",
     "when": lambda m, w: m["ratio"] < 2.5,
     "detail": "主光在主体一侧斜前方，另一侧有补光或反光板把阴影提亮",
     "detail_en": "key from the front-side of the subject, fill light or bounce board on the other side lifting the shadows",
     "gear": {"face": ["主光：LED + 柔光箱/柔光伞，人物 45° 侧前方、略高于眼睛", "补光：另一侧反光板或低亮度小灯", "可选：背后加轮廓灯"],
              "other": ["主光：LED + 柔光箱从桌面一侧 45° 斜上方打", "另一侧白卡/反光板补光", "可选：后方加一盏轮廓灯勾边"]},
     "gear_en": {"face": ["key: LED + softbox / umbrella, 45° to the front-side, a little above eye level", "fill: bounce board or a small dim light on the other side",
                          "optional: a rim light from behind"],
                 "other": ["key: LED + softbox from 45° high on one side of the desk", "white card / bounce board as fill on the other side", "optional: a rim light from behind for edge"]}},
    {"key": "hard_side", "name": "单侧主光，补光很弱（明暗对比强）", "name_en": "single side key, very little fill (high contrast)",
     "when": lambda m, w: True,
     "detail": "主光在一侧，另一侧明显暗下去，接近伦勃朗光/侧光",
     "detail_en": "key on one side, the other side falls off clearly; close to Rembrandt / side light",
     "gear": {"face": ["一盏 LED + 柔光箱放在人物侧面 60–90°", "不补光，或用黑旗压暗另一侧"],
              "other": ["一盏灯从侧面低角度打，制造长影子", "另一侧不补光或用黑卡吸光"]},
     "gear_en": {"face": ["one LED + softbox at 60–90° to the side of the subject", "no fill, or a black flag to darken the other side"],
                 "other": ["one light from the side at a low angle for long shadows", "no fill on the other side, or black card to soak up bounce"]}},
]


def setup_for(m: dict, w: dict, subject_kind: str = "face", location: str | None = None, grade: dict | None = None) -> dict:
    """location: what an image reader said about the place ("户外 白天 街边"); grade: the grade aspect's measurements."""
    if not w:
        return {}
    ctx = {**w, "outdoor": is_outdoor(location), "g": grade or {}, "subject_kind": subject_kind}
    s = next(s for s in SETUPS if s["when"](m, ctx))
    notes = []
    g = grade or {}
    if s["key"] == "ambient_low_light" and g.get("bright_sat", 0) > 0.5 and (g.get("hue_bins") or 0) >= 2:
        notes.append(T("暗处的光带明显颜色：霓虹招牌或 RGB 氛围灯", "the light in the dark carries strong colour: neon signs or RGB mood lights"))
    if from_below(m):
        notes.append(T("主体下半部偏亮：可能有来自下方的光（屏幕、桌面反光）", "lower half of the subject is brighter: likely light from below (screen, desk bounce)"))
    if w["mixed_color"]:
        notes.append(T("主体和背景色温不一致：混合光源（例如暖色灯 + 冷色窗光/屏幕）",
                       "subject and background differ in colour temperature: mixed sources (e.g. warm lamp + cool window light / screen)"))
    if w.get("depth"):
        notes.append(w["depth"])
    kind = "face" if subject_kind == "face" else "other"
    gear_en = (s.get("gear_en") or {}).get(kind) or s["gear"][kind]
    return {"key": s["key"], "name": T(s["name"], s.get("name_en")), "detail": T(s["detail"], s.get("detail_en")), "notes": notes,
            "gear": [T(z, e) for z, e in zip(s["gear"][kind], gear_en)]}


class Lighting(Aspect):
    def __init__(self):
        super().__init__(key="lighting", title="打光", title_en="Lighting", shot_fields=[
            Field("location", "场景", "室内|户外；白天|夜晚；具体场景（卧室/办公室/桌面/街边/车内…）", prefer="seen", en="location"),
            Field("key_light", "主光", "主光方向与高度（如：画面左前方 45° 略高）及光源（窗户/环形灯/柔光箱/台灯/路灯/屏幕/顶灯）", prefer="seen", en="key light"),
            Field("light_quality", "软硬", "柔光|硬光|混合，依据（阴影边缘、投影）", en="soft / hard"),
            Field("fill_light", "补光", "有无补光/反光板，暗部多暗", prefer="seen", en="fill"),
            Field("rim_light", "轮廓光", "有无轮廓光/背景灯（头发、肩膀、物体边缘的亮边）", prefer="seen", en="rim / backlight"),
            Field("catchlight", "眼神光", "眼神光形状（方形=柔光箱/窗，圆环=环形灯，点状=小灯/路灯，无）；没有人脸写不适用", prefer="seen", en="catchlight"),
            Field("practicals", "可见光源", "画面里能看到的光源（台灯、灯带、路灯、招牌、屏幕）", prefer="seen", en="practicals"),
            Field("color_temp", "色温", "暖|中性|冷|混合（主体和背景是否不同色温）", en="colour temperature"),
            Field("lighting_setup", "布光方案", "一句话布光方案（如：环形灯正面平光 + 暖色背景灯；两盏柔光箱 45° 夹打桌面）", prefer="seen", en="lighting set-up"),
        ], video_fields=[
            Field("lighting_overall", "整体布光", "整片的布光方案：主光、补光、轮廓光、环境光、色温；不同场景分别写", prefer="seen", en="overall lighting"),
        ])

    def measure(self, ctx: ShotCtx) -> dict:
        per, kinds = [], []
        for f, s in zip(ctx.frames, ctx.subjects):
            if s and s["kind"] != "frame":
                m = frame_light(f, s)
                if m:
                    per.append(m)
                    kinds.append(s["kind"])
        if not per:
            return {}
        out = {"subject": max(dict.fromkeys(kinds), key=kinds.count), "frames": len(per)}
        for k in MEASURES:
            vals = [m[k] for m in per if m.get(k) is not None]
            if vals:
                out[k] = round(float(np.median(vals)), 3)
        sides = [m["key_side"] for m in per]
        out["key_side"] = max(dict.fromkeys(sides), key=sides.count)
        return out

    def interpret(self, shot: dict) -> dict:
        m = ((shot.get("aspects") or {}).get(self.key) or {}).get("measured") or {}
        w = words(m)
        if not w:
            return {}
        loc = seen(shot, self.key, "location")
        g = ((shot.get("aspects") or {}).get("grade") or {}).get("measured")
        st = setup_for(m, w, m.get("subject", "face"), loc.get("agent") or loc.get("vlm"), g)
        return {**w, "setup": st.get("key"), "setup_name": st.get("name")}

    def summarize(self, shots: list[dict], b: dict) -> dict:
        filmed = [r for r in shots if r["base"]["label"] in FILMED]
        main = [r for r in (filmed or [r for r in shots if r["base"]["label"] in PHOTOGRAPHIC])
                if ((r.get("aspects") or {}).get(self.key) or {}).get("measured", {}).get("ratio") is not None]
        if not main:
            return {}
        ms = [(r["aspects"][self.key]["measured"], r["duration"]) for r in main]
        med = {k: weighted_median([(m.get(k), w) for m, w in ms]) for k in MEASURES}
        med["key_side"], _ = weighted_mode([(m.get("key_side"), w) for m, w in ms])
        kind, _ = weighted_mode([(m.get("subject"), w) for m, w in ms])
        w = words(med)
        loc = {**mode_seen(main, self.key, "location"), **video_seen(b, self.key, "location")}
        gm = [(((r.get("aspects") or {}).get("grade") or {}).get("measured") or {}, r["duration"]) for r in main]
        g = {k: weighted_median([(x.get(k), d) for x, d in gm]) for k in ("mean_l", "dark_share", "bright_sat", "hue_bins")}
        st = setup_for(med, w, kind or "face", loc.get("agent") or loc.get("vlm"), {k: v for k, v in g.items() if v is not None})
        lines = [T("打光：{n}。主光 {k}，{v}；光比 {r}；{q}；色温{c}", "Lighting: {n}. Key light {k}, {v}; lighting ratio {r}; {q}; colour temperature {c}",
                   n=st["name"], k=w["key_direction"], v=w["vertical"], r=w["ratio"], q=w["quality"], c=w["color_temp"])
                 + (semi() + semi().join(st["notes"]) if st.get("notes") else "")]
        if not filmed:
            lines.append(T("（画面不是实拍：以上是画面里的光影，用于写生成提示词，不是拍摄方案）",
                           "(not live footage: the above describes the light in the picture, for generation prompts, not a shooting plan)"))
        return {"result": {"setup": st["key"]}, "measured": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in med.items()},
                "words": w, "setup": st, "filmed": bool(filmed), "lines": lines,
                "fields": field_table(self, main, b, {"light_quality": w["quality"], "color_temp": w["color_temp"]})}


register(Lighting())
