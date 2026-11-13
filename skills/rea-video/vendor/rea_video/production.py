"""From per-shot breakdown to a production plan: how the shots would actually be made again.

Edit shots (cut detection) are the facts; making them is organised differently:
  AI shots      -> generation units: consecutive same-scene shots one model call can produce together,
                   sized by the chosen model's limits (duration, multi-shot, references) and routing rules S01-S06
  filmed shots  -> shooting setups: shots grouped by scene (not only adjacent ones) and, inside a scene,
                   by camera setup (shot size + support), so each setup is lit and shot once
  code / screen -> one code composition per contiguous run
  still motion  -> rebuilt locally from one image
"""
from __future__ import annotations

from .i18n import LangDict, T, join, lang, model_name, semi, shot_ids

import json
import re
from pathlib import Path

import cv2

from .util import read_image
from .classify import LABEL_ZH
from .aspects.camera import SUPPORT_ZH
from .aspects.vocab import canon, show
from .plan import CODE_STYLES, Planner, code_scene, shot_prompts

GEN_LABELS = ("ai_video", "cg_3d", "anim_2d")
SHOOT_LABELS = ("live_action", "stop_motion")
GEN_ZH = LangDict({"ai_video": "AI 视频", "cg_3d": "3D 渲染", "anim_2d": "2D 动画"}, en={"ai_video": "AI video", "cg_3d": "3D render", "anim_2d": "2D animation"})
CODE_LABELS = ("code_render", "screen_capture")
LOCAL_LABELS = ("still_motion", "static_hold")
SIZE_ORDER = {"远景": 0, "全景": 1, "中景": 2, "近景": 3, "特写": 4,  # zh / en shot-size words (aspects.framing.SIZES);
              "wide shot": 0, "full shot": 1, "medium shot": 2, "medium close-up": 3, "close-up": 4, "extreme close-up": 5}  # full names: no prefix clashes
PRODUCT_KINDS = ("product_photo", "logo")



# how a scene is entered, for the motion timeline headings
_TRANSITION_IN = {"dissolve": ("叠化", "dissolve"), "fade": ("淡入", "fade"), "wipe": ("划像", "wipe"), "slide": ("推移", "slide"),
                  "whip": ("甩镜", "whip pan"), "zoom": ("缩放", "zoom"), "spin": ("旋转", "spin"), "blur": ("模糊", "blur"),
                  "glitch": ("故障", "glitch"), "shake": ("抖动", "shake")}

def _norm(s: str) -> str:
    return s.replace("-", "").replace("_", "").replace(" ", "").lower()


# ---------------------------------------------------------------- scene similarity
def _hist(path: Path):
    im = read_image(path)
    if im is None:
        return None
    h = cv2.calcHist([cv2.cvtColor(im, cv2.COLOR_BGR2HSV)], [0, 1, 2], None, [18, 4, 4], [0, 180, 0, 256, 0, 256])
    cv2.normalize(h, h)
    return h


def scene_signatures(shots: list[dict], out: Path) -> dict[int, list]:
    sig = {}
    for r in shots:
        hs = [_hist(out / r["assets"][k]) for k in ("first_frame", "last_frame") if r.get("assets", {}).get(k)]
        sig[r["index"]] = [h for h in hs if h is not None]
    return sig


def scene_distance(a: list, b: list) -> float:
    """Smallest colour-distribution distance between any key frame of two shots (0 = same, 1 = unrelated)."""
    d = [cv2.compareHist(x, y, cv2.HISTCMP_BHATTACHARYYA) for x in a for y in b]
    return float(min(d)) if d else 1.0


HUES = ((10, "红", "red"), (22, "橙", "orange"), (35, "黄", "yellow"), (78, "绿", "green"),  # OpenCV hue (0-180) bands
        (100, "青", "cyan"), (130, "蓝", "blue"), (170, "紫", "purple"), (181, "红", "red"))


def lit_colours(paths: list[Path], top: int = 3, min_share: float = 0.15) -> list[str]:
    """Main colours of the lit part of a shot's key frames (what the glowing elements are coloured), most first."""
    votes: dict[tuple, float] = {}
    n = 0
    for p in paths:
        im = read_image(p)
        if im is None:
            continue
        hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).reshape(-1, 3)
        lit = hsv[hsv[:, 2] > 60]
        if not len(lit):
            continue
        n += 1
        grey = lit[:, 1] < 60
        votes[("白", "white")] = votes.get(("白", "white"), 0.0) + float(grey.mean())
        hue = lit[~grey][:, 0]
        lo = 0
        for hi, zh, en in HUES:
            votes[(zh, en)] = votes.get((zh, en), 0.0) + float(((hue >= lo) & (hue < hi)).sum()) / len(lit)
            lo = hi
    ranked = sorted(votes.items(), key=lambda kv: -kv[1])
    return [T(*w) for w, v in ranked[:top] if n and v / n >= min_share]


def code_motion_md(scenes: list[dict]) -> list[str]:
    """Per-shot motion timeline of the code shots (measured): what appears where, when, how and in what colour."""
    from .motion import event_line, layer_line, static_line

    L = ["", T("逐镜动效时间轴（工具测量：位置是占画面宽高的百分比，颜色是元素稳定后的取色；配合关键帧条看）",
               "Per-shot motion timeline (measured: positions in % of frame width / height, colours sampled once the element settles; "
               "read together with the key-frame strip)"), ""]
    for sc in scenes:
        head = f"#{sc['shot']} {sc['start']:.1f}–{sc['end']:.1f}s"
        if sc.get("transition_in") == "flash":
            head += T("（闪亮切入：切进来时整幅画面先变亮，{s:.1f}s 内回落）", " (flash cut: the picture opens bright and settles in {s:.1f}s)",
                      s=sc.get("flash_s") or 0)
        elif sc.get("transition_in") in _TRANSITION_IN:
            head += T("（{t}切入）", " ({t} in)", t=T(*_TRANSITION_IN[sc["transition_in"]]))
        n_ev = len(sc.get("events") or [])
        L.append('<details class="ref"><summary>' + T("动效 {h} · {n} 个", "Motion {h} · {n} events", h=head, n=n_ev) + "</summary>")
        L.append("")
        if sc.get("strip"):
            L += [f"![{head}]({sc['strip']})", ""]
        if sc.get("background") and sc.get("dots"):
            L.append(T("- 背景 {bg}；粒子颜色 {c}", "- Ground {bg}; dot colours {c}", bg=sc["background"], c=" ".join(sc["dots"])))
        elif sc.get("background"):
            L.append(T("- 背景 {bg}；其他主色 {c}", "- Ground {bg}; other main colours {c}", bg=sc["background"],
                       c=" ".join(c for c in sc.get("palette") or [] if c != sc["background"]) or "—"))
        if sc.get("elements_sheet"):
            L += [T("元素截图（编号对应下面的动效；L 是持续运动层的镜头中段和结尾，S 是整镜不动的元素），原分辨率单张在 `shots/` 里：",
                    "Element crops (numbers match the motion list below; L = the continuously moving layer mid-shot and at the end, "
                    "S = elements that never move), full-size files in `shots/`:"),
                  "", f"![{head}]({sc['elements_sheet']})", ""]
        for k, e in enumerate(sc.get("static") or [], 1):
            L.append(f"- S{k}. " + T("整镜不动：", "never moves: ") + static_line(e))
        if sc.get("layer"):
            L.append("- " + layer_line(sc["layer"]))
        for q in sc.get("sequences") or []:
            L.append("- " + T("依次出现：{n} 个同样大小的元素，间隔 {i:.2f}s，每个用时约 {e:.2f}s（下面第 {k} 条）",
                             "In sequence: {n} same-size elements, {i:.2f}s apart, about {e:.2f}s each (items {k} below)",
                             n=q["n"], i=q["interval"], e=q["each"], k=T("、", ", ").join(str(x + 1) for x in q["events"])))
        for i, ev in enumerate(sc.get("events") or [], 1):
            L.append(f"{i}. " + event_line(ev))
        if not (sc.get("events") or sc.get("layer") or sc.get("static")):
            L.append(T("- 没有测到元素运动（静止画面或只有细微变化）", "- No element motion measured (still picture or only slight changes)"))
        L += ["", "</details>", ""]
    return L


# ---------------------------------------------------------------- model choice
def pick_model(planner: Planner, engine: str) -> tuple[dict | None, dict | None]:
    """-> (the user's engine as a capability entry, the model the generation units are planned for).
    Plan for the named model when the capability map has it as a video generator (shot by shot if it cannot do
    multi-shot); a name the map does not know falls back to the first live multi-shot model in R11."""
    live = {k: m for k, m in planner.models.items() if m.get("status") not in ("shutdown", "deprecated")}
    eng = next((m for m in live.values() if _norm(m["id"]) == _norm(engine)), None)
    if eng and eng.get("category") == "video" and {"video.t2v", "video.i2v_first_frame"} & set(eng.get("primitives", [])):
        return eng, eng
    best = None
    for mid in (planner.rules.get("R11-recurring-character") or {}).get("prefer", []):
        m = live.get(mid)
        if m and m.get("status") == "ga" and "video.multi_shot" in m.get("primitives", []):
            best = m
            break
    return eng, best or eng


PROMPTING_FIELDS = (("structure", "结构"), ("language", "语言"), ("length", "长度"), ("multi_shot", "多镜头和时间"),
                    ("references", "参考素材怎么指代"), ("dialogue", "台词和声音"), ("negatives", "不想要的内容"), ("camera", "运镜"),
                    ("frame_mode", "首帧 / 首尾帧模式下写什么"), ("frames", "帧图和参考图"), ("rewriter", "自动改写"))


def prompting_md(notes: dict, full: bool = False) -> list[str]:
    """One model's prompt-writing notes as bullet lines; full adds what is unverified and the sources."""
    L = [f"- **{zh}**：{notes[k]}" for k, zh in PROMPTING_FIELDS if notes.get(k)]
    for k, zh in (("pitfalls", "注意"),) + ((("unverified", "待核实"), ("sources", "来源")) if full else ()):
        if notes.get(k):
            L += [f"- **{zh}**："] + [f"  - {x}" for x in notes[k]]
    return L


def _limits(m: dict | None) -> dict:
    lim = (m or {}).get("limits") or {}
    d = lim.get("duration_s") or {}
    return {"max": float(d.get("max") or 10), "min": float(d.get("min") or 0), "refs": lim.get("refs") or {},
            "multi_shot": "video.multi_shot" in (m or {}).get("primitives", []),
            "ref_video": "video.reference_video" in (m or {}).get("primitives", []),
            "multi_ref": "video.multi_reference" in (m or {}).get("primitives", []),
            "first_frame": "video.i2v_first_frame" in (m or {}).get("primitives", []),
            "exclusive": bool(lim.get("exclusive_inputs")),
            "first_last": "video.i2v_first_last" in (m or {}).get("primitives", []),
            "native_audio": bool(((m or {}).get("audio") or {}).get("native"))}


# ---------------------------------------------------------------- generation units
INPUT_ZH = LangDict({"text": "文字提示词", "first_frame": "首帧图", "last_frame": "尾帧图", "ref_image": "参考图", "ref_video": "参考视频"},
                    en={"text": "text prompt", "first_frame": "first frame", "last_frame": "last frame", "ref_image": "reference image",
                        "ref_video": "reference video"})
METHOD_ZH = LangDict({"t2v": "文生视频", "i2v": "首帧图生视频", "first_last": "首尾帧生视频", "reference": "多参考生成"},
                     en={"t2v": "text to video", "i2v": "first-frame image to video", "first_last": "first + last frame to video",
                         "reference": "multi-reference generation"})


def _fed(u: dict) -> str:
    """The inputs a unit uses besides the prompt, short: "首帧 + 尾帧 + 参考图"."""
    return " + ".join(INPUT_ZH[x["kind"]] for x in u.get("inputs") or [] if x["need"] != "no" and x["kind"] != "text")


def _first_note(u: dict) -> str:
    """The plain "first frame from the source" note: already in the unit's input table, so the overview leaves it out."""
    c = u.get("continuity") or ""
    return c if c.startswith(T("首帧：", "first frame:")) else ""


def _inputs(seg: list[dict], lim: dict, refs: list[dict], prev_id: str | None, parts: int) -> tuple[str, list[dict]]:
    """What one generation call is fed, each with where it comes from and why -> (method, inputs).
    need: "yes" required, "opt" worth it, "no" not used (kept so the reader sees it was considered).
    Models whose frame inputs and reference inputs cannot share a request (lim["exclusive"]: Seedance 2.x API) get
    one mode per unit: references when a product or person must stay the same, else first / last frames."""
    first, last = seg[0], seg[-1]
    one = len(seg) == 1 and parts == 1
    moves = (first.get("features") or {}).get("camera") not in (None, "static", "unknown")
    imgs = [r for r in refs if r["tag"].startswith("@图片")]
    by_ref = bool(imgs) and lim.get("multi_ref", True)
    frames_alone = lim.get("exclusive") and by_ref  # frames can only ride along as references
    out = [{"kind": "text", "need": "yes", "source": T("见下面的提示词", "see the prompt below"),
            "why": T("描述画面、动作和运镜；其他输入都只是约束它", "describes picture, action and camera; every other input only constrains it")}]
    as_ref = T("。这个模型首帧和参考图不能同时传：作为第 {n} 张参考图传入，提示词写「@图片{n} 作为首帧」（即梦全能参考支持，API 多半不支持）",
               "; this model takes frame inputs or references, not both: pass it as one more reference image and write "
               "“@图片{n} as the first frame” in the prompt (Jimeng's omni-reference accepts this; most APIs do not, drop it if refused)",
               n=len(imgs) + 1)
    if prev_id or lim["first_frame"]:
        src = (T("{p} 生成结果的最后一帧", "the last frame of {p}'s result", p=prev_id) if prev_id else
               T("原片 `{f}`（换产品、人物或画风时，用图像模型照下面的首帧提示词重画）",
                 "source frame `{f}` (to change product, person or style, redraw it with an image model from the first-frame prompt below)",
                 f=first["assets"]["first_frame"]))
        why = (T("和上一段硬切相连，同一场景，首帧接上才不会跳", "hard cut from the previous unit in the same scene; matching the first frame keeps it from jumping")
               if prev_id else T("构图、景别、主体位置一次锁定；只给文字，每次生成的构图都不一样",
                                 "locks composition, shot size and subject position; with text alone every generation frames it differently"))
        out.append({"kind": "first_frame", "need": "opt" if frames_alone else "yes", "source": src + (as_ref if frames_alone else ""), "why": why})
    if len(seg) > 1:
        out.append({"kind": "last_frame", "need": "no", "source": "—",
                    "why": T("一次出多个镜头，尾帧只能约束最后一镜，不用", "several shots in one call; a last frame would only constrain the final shot")})
    elif frames_alone:
        out.append({"kind": "last_frame", "need": "no", "source": "—",
                    "why": T("这一单元用参考图保住商品和人物，这个模型在参考模式下不收尾帧", "this unit uses references to keep the product and people; the model takes no last frame alongside them")})
    elif one and lim["first_last"] and (moves or first["duration"] >= 3):
        out.append({"kind": "last_frame", "need": "opt",
                    "source": T("原片 `{f}`，处理方式同首帧", "source frame `{f}`, treated like the first frame", f=last["assets"]["last_frame"]),
                    "why": T("镜头有运镜或动作，给定终点画面，模型只补中间过程，动作和落幅更接近原片",
                             "the shot moves; pinning the end frame leaves the model only the in-between, so motion and the final framing stay close to the source")})
    if imgs:
        out.append({"kind": "ref_image", "need": "yes", "source": semi().join(f"`{r['tag']}` " + r["what"] for r in imgs),
                    "why": T("首帧只管第一帧，后面画面里的商品和人靠参考图保持一致",
                             "the first frame only fixes frame one; reference images keep the product and people consistent after it")})
    vid = next((r for r in refs if r["tag"] == "@视频1"), None)
    if vid:
        out.append({"kind": "ref_video", "need": "opt", "source": "`@视频1` " + vid["what"].split("：")[0].split(": ")[0],
                    "why": T("照着学动作、运镜和剪辑节奏；只作参考，不会复制画面",
                             "follow the action, camera move and cutting rhythm; reference only, the picture is not copied")})
    elif lim["ref_video"]:
        out.append({"kind": "ref_video", "need": "no", "source": "—",
                    "why": T("这一单元用首尾帧锁构图，这个模型在首尾帧模式下不收参考视频，动作和运镜写进提示词",
                             "this unit locks framing with first / last frames; the model takes no reference video alongside them, so put action and camera move in the prompt")})
    else:
        out.append({"kind": "ref_video", "need": "no", "source": "—",
                    "why": T("这个模型不支持参考视频，动作和运镜都要写进提示词", "this model takes no reference video; put action and camera move in the prompt")})
    used = {x["kind"] for x in out if x["need"] != "no"}
    method = ("reference" if used & {"ref_image", "ref_video"} else
              "first_last" if "last_frame" in used else "i2v" if "first_frame" in used else "t2v")
    return method, out


INSERT_LABELS = CODE_LABELS + LOCAL_LABELS  # made separately and cut in during editing
def reused_footage(gen: list[dict]) -> dict[int, int]:
    """Generated shots an image reader marked as the same clip as another generated shot (a trailer cut from the
    finished clip up front, a replay): {shot shown again: shot it is cut from}. Pixels alone cannot tell this from
    the same setup at another moment (eval daihuo: the trailer and the finished clip differ as much as two talking-head
    shots from one camera), so only the reader's mark counts."""
    ids = {r["index"] for r in gen}
    out: dict[int, int] = {}
    for r in gen:
        src = (r.get("review") or {}).get("same_clip_as") or (r.get("vlm") or {}).get("same_clip_as")
        if isinstance(src, int) and src in ids and src != r["index"] and src not in out:
            out[r["index"]] = src
    return out


def _runs(shots: list[dict], same_scene, labels: tuple, skip: set[int] | None = None) -> list[list[dict]]:
    """Runs of generated shots that may share one generation: same scene, joined by hard cuts. Shots cut in
    between them (UI, screenshots, stills) do not break a run: the generated shots are produced back to back
    and the inserts are placed in the edit, which is how a talk-plus-UI video is usually made."""
    runs, cur, gap = [], [], False
    for r in shots:
        lab = r["base"]["label"]
        if lab not in labels or r["index"] in (skip or ()):
            if (lab in INSERT_LABELS or r["index"] in (skip or ())) and cur:
                gap = True
                continue
            if cur:
                runs.append(cur)
            cur, gap = [], False
            continue
        joinable = cur and same_scene(cur[-1], r) and (gap or r.get("transition_in") in ("cut", "jump", "flash"))
        if cur and not joinable:
            runs.append(cur)
            cur = []
        cur.append(r)
        gap = False
    if cur:
        runs.append(cur)
    return runs


def _split_run(run: list[dict], lim: dict, hard: dict, unit_min: float) -> list[list[dict]]:
    """Fewest units first, then avoid multi-shot units past the preferred hard-cut length and units under the
    minimum generation length (dynamic programming over cut points)."""
    if not lim["multi_shot"]:
        return [[r] for r in run]
    cap = min(lim["max"], hard["max"])
    n = len(run)
    best = [0.0] + [float("inf")] * n
    prev = [0] * (n + 1)
    for j in range(1, n + 1):
        for i in range(j - 1, -1, -1):
            seg = run[i:j]
            dur = sum(r["duration"] for r in seg)
            if len(seg) > 1 and dur > cap:
                break
            cost = 1.0 + (0.4 if len(seg) > 1 and dur > hard["prefer"] else 0.0) + (0.2 if dur < unit_min else 0.0)
            if best[i] + cost < best[j]:
                best[j], prev[j] = best[i] + cost, i
    out, j = [], n
    while j > 0:
        out.append(run[prev[j]:j])
        j = prev[j]
    return out[::-1]


def _style_line(shots: list[dict], aspect_ratio: str) -> str:
    """One style sentence for every unit (most common lighting reading across the generated shots, by duration),
    so separately generated units still look like one video."""
    orient = {"9:16": T("竖屏 9:16", "Vertical 9:16"), "16:9": T("横屏 16:9", "Horizontal 16:9"), "1:1": T("方形 1:1", "Square 1:1"),
              "3:4": T("竖屏 3:4", "Vertical 3:4"), "4:3": T("横屏 4:3", "Horizontal 4:3")}.get(aspect_ratio, aspect_ratio)
    bits = [orient]
    picks = []
    for key in ("setup_name", "quality", "color_temp", "depth"):
        votes: dict[str, float] = {}
        for r in shots:
            v = (((r.get("aspects") or {}).get("lighting") or {}).get("result") or {}).get(key)
            if v:
                votes[v] = votes.get(v, 0.0) + r["duration"]
        if votes:
            picks.append(max(votes.items(), key=lambda kv: kv[1])[0])
    if picks:
        bits.append(T("，", ", ").join(picks))
    return semi().join(bits)


def _unit(seg: list[dict], k: int, lim: dict, model: dict | None, style: str, cast: dict, prev_unit: dict | None,
          same_scene_prev: bool, unit_min: float) -> dict:
    t0, t1 = seg[0]["start"], seg[-1]["end"]
    dur = round(sum(r["duration"] for r in seg), 3)  # generated length; inserts cut in between are not generated
    ranges: list[list[float]] = []
    for r in seg:
        if ranges and abs(ranges[-1][1] - r["start"]) < 1e-3:
            ranges[-1][1] = r["end"]
        else:
            ranges.append([r["start"], r["end"]])
    contiguous = len(ranges) == 1
    votes: dict[str, float] = {}
    for r in seg:
        votes[r["base"]["label"]] = votes.get(r["base"]["label"], 0.0) + r["duration"]
    label = max(votes.items(), key=lambda kv: kv[1])[0]
    product, people = cast["product"], cast["people"]
    refs, tags = [], {}
    if product:
        tags["product"] = "@图片1"
        refs.append({"tag": "@图片1", "what": T("产品实拍图（正面 + 带 Logo 面），用户提供",
                                                "product photos (front + the side with the logo), supplied by the user"), "user": True})
    if people:
        tags["person"] = f"@图片{len(refs) + 1}"
        refs.append({"tag": tags["person"], "what": T("人物参考图（每个角色一张正脸 + 半身），保证跨镜头长相一致",
                                                      "character reference images (one frontal face + one half-body per character) so the look stays consistent across shots"), "user": True})
    # frame inputs and references cannot share a request on some models: a unit without product / people refs
    # goes the first / last frame way and gets no reference clip
    if lim["ref_video"] and (not lim.get("exclusive") or product or people):
        tags["video"] = "@视频1"
        span = join(f"{a:.1f}–{z:.1f}s" for a, z in ranges)
        refs.append({"tag": "@视频1", "what": T("原片 {span} 片段", "source clip {span}", span=span)
                     + (T("（剪掉中间插入的画面后拼成一段）", " (inserted shots removed, pieces joined)") if not contiguous else "")
                     + T("：参考动作、运镜和剪辑节奏（只作参考，不复制画面）",
                         ": reference for action, camera movement and cutting rhythm (reference only, do not copy the picture)"), "user": False})
    cont, chained = None, False
    if prev_unit and same_scene_prev and seg[0].get("transition_in") in ("cut", "jump", "flash") and abs(prev_unit["ranges"][-1][1] - t0) < 1e-3:
        cont, chained = T("首帧用 {p} 的尾帧，接上动作", "first frame = last frame of {p}, continue the action", p=prev_unit["id"]), True
    elif lim["first_frame"]:
        cont = T("首帧：参照原片第 {i} 镜首帧（{f}）的构图出图", "first frame: generate an image matching the composition of source shot {i}'s first frame ({f})",
                 i=seg[0]["index"], f=seg[0]["assets"]["first_frame"]) + (T("，产品换成 @图片1", ", with the product replaced by @图片1") if product else "")
    head = [style]
    if product:
        head.append(T("产品外观以 @图片1 为准，Logo 和细节保持一致", "Product appearance follows @图片1, keep the logo and details consistent"))
    if people:
        head.append(T("人物以 {t} 为准", "Characters follow {t}", t=tags["person"]))
    if "video" in tags:
        head.append(T("参考 @视频1 的动作、运镜和剪辑节奏", "Follow the action, camera movement and cutting rhythm of @视频1"))
    if len(seg) > 1:
        head.append(T("镜头之间硬切", "Hard cuts between shots"))
    lines, lines_en, missing = [], [], []
    acc = 0.0
    for i, r in enumerate(seg, 1):
        p = shot_prompts(r)
        text = p.get("video_prompt") or (r.get("vlm") or r.get("review") or {}).get("description") or ""
        if not text:
            missing.append(r["index"])
            text = T("（缺提示词：开 --vlm 或 agent 看图补写）", "(prompt missing: run --vlm or have the agent write one from the frames)")
        a, z = acc, acc + r["duration"]
        acc = z
        lines.append(T("镜头{i}（{a:.1f}–{z:.1f}s）：{text}", "Shot {i} ({a:.1f}–{z:.1f}s): {text}", i=i, a=a, z=z, text=text) if len(seg) > 1 else text)
        if p.get("video_prompt_en"):
            lines_en.append(f"Shot {i} ({a:.1f}-{z:.1f}s): {p['video_prompt_en']}" if len(seg) > 1 else p["video_prompt_en"])
    parts = 1
    if len(seg) == 1 and dur > lim["max"]:
        parts = int(-(-dur // lim["max"]))
    mode = "multi_shot" if len(seg) > 1 else ("split" if parts > 1 else "single")
    unit = {"id": f"G{k}", "kind": "generate", "label": label, "label_zh": LABEL_ZH[label],
            "shots": [r["index"] for r in seg], "start": round(t0, 3), "end": round(t1, 3), "duration": dur,
            "ranges": [[round(a, 3), round(z, 3)] for a, z in ranges],
            "mode": mode, "calls": parts, "model": (model or {}).get("id"), "model_name": model_name((model or {}).get("name")),
            "generate_s": max(dur, lim["min"], unit_min if len(seg) == 1 else 0), "refs": refs, "continuity": cont,
            "prompt": T("。", ". ").join(head) + T("。\n", ".\n") + "\n".join(lines),
            "prompt_en": "\n".join(lines_en) if len(lines_en) == len(seg) else "",
            "image_prompt": shot_prompts(seg[0]).get("image_prompt", "")}
    unit["method"], unit["inputs"] = _inputs(seg, lim, refs, prev_unit["id"] if chained else None, parts)
    if missing:
        unit["prompt_missing"] = missing
    if parts > 1:
        unit["note"] = T("单镜 {d:.1f}s 超过 {m} 单次上限 {mx:.0f}s：在动作停顿处切成 {p} 段，后一段用前一段尾帧作首帧（S02）",
                         "Single shot of {d:.1f}s exceeds the {m} per-call limit of {mx:.0f}s: split into {p} parts at pauses in the action, "
                         "each part starting from the previous part's last frame (S02)", d=dur, m=unit["model_name"], mx=lim["max"], p=parts)
    if unit["generate_s"] > dur + 0.5:
        unit["note"] = T("生成 {g:.0f}s 后剪到 {d:.1f}s（太短的镜头单独生成不稳定）",
                         "Generate {g:.0f}s and trim to {d:.1f}s (very short shots are unstable when generated on their own)", g=unit["generate_s"], d=dur)
    if not contiguous:
        unit["note"] = (unit.get("note", "") + semi() if unit.get("note") else "") + \
            T("这几镜在成片里被插入画面隔开：生成时连着出，剪辑时再把插入画面放回去",
              "In the final cut these shots are separated by inserts: generate them back to back and put the inserts back in the edit")
    if label == "anim_2d" or "anim_2d" in votes:
        unit["alt"] = T("另一条路：2D 动画工程。角色拆层做 Live2D / Spine 骨骼动画，或在 AE 里做；简单的扁平风格动画也可以让 LLM 写 "
                        "Lottie / Canvas 代码。口型、动作要逐帧精确时比视频模型可控（R19）",
                        "Alternative: a 2D animation project. Split the character into layers and rig it in Live2D / Spine, or animate in After Effects; "
                        "simple flat-style animation can also be Lottie / Canvas code written by an LLM. More controllable than a video model when "
                        "lip sync and motion must be frame-accurate (R19)")
    if label == "cg_3d" or "cg_3d" in votes:
        unit["alt"] = T("另一条路：3D 工程。让 LLM 写 Blender 脚本或 Three.js 场景，角色/道具建模一次、按镜头设机位渲染，"
                        "多角度和角色一致性最好，改文案和镜头也只是改代码",
                        "Alternative: a 3D project. Have an LLM write a Blender script or a Three.js scene; model the characters / props once and "
                        "render each shot from its own camera. Best for multiple angles and character consistency, and changing copy or shots is "
                        "just a code change")
    return unit


# ---------------------------------------------------------------- shooting setups
def _setups(shots: list[dict], sig: dict, thr: float, b: dict) -> list[dict]:
    from .entities import cast as _cast

    filmed = [r for r in shots if r["base"]["label"] in SHOOT_LABELS]
    scenes: list[list[dict]] = []
    named: list[dict] = []
    # an image reader who named the scenes knows where each shot was filmed better than colour histograms do
    # (a talking head and a desk shot of a phone in the same office have the same colours)
    cs = [sc for sc in _cast(b).get("scenes") or [] if sc.get("shots")]
    where = {i: k for k, sc in enumerate(cs) for i in sc["shots"]}
    if filmed and all(r["index"] in where for r in filmed):
        for k, sc in enumerate(cs):
            rs = [r for r in filmed if where[r["index"]] == k]
            if rs:
                scenes.append(rs)
                named.append(sc)
    else:
        for r in filmed:
            d = [(min(scene_distance(sig[r["index"]], sig[m["index"]]) for m in sc), i) for i, sc in enumerate(scenes)]
            best = min(d) if d else (1.0, -1)
            if best[0] <= thr:
                scenes[best[1]].append(r)
            else:
                scenes.append([r])
    out = []
    for si, sc in enumerate(scenes, 1):
        groups: dict[tuple, list[dict]] = {}
        for r in sc:
            a = r.get("aspects") or {}
            # group on normalised values: free-text answers ("近景（手持物品特写）") would split one setup into many
            raw = str(((a.get("framing") or {}).get("result") or {}).get("shot_size") or "")
            size = next((k for k in SIZE_ORDER if (canon(raw) or "").startswith(k)), raw or "—")
            cam = (a.get("camera") or {}).get("result") or {}
            support = SUPPORT_ZH.get(cam.get("support"), cam.get("support_zh") or "—")
            groups.setdefault((size, support), []).append(r)
        light = (((sc[0].get("aspects") or {}).get("lighting") or {}).get("result") or {})
        desc = (sc[0].get("vlm") or sc[0].get("review") or {}).get("description", "")
        if named:
            nm = named[si - 1]
            desc = T("，", ", ").join(str(x) for x in (nm.get("where"), nm.get("look")) if x) or desc
        setups = []
        for (size, support), rs in sorted(groups.items(), key=lambda kv: SIZE_ORDER.get(kv[0][0], 9)):
            setups.append({"shot_size": show(size), "support": support, "shots": [r["index"] for r in rs],
                           "screen_s": round(sum(r["duration"] for r in rs), 2),
                           "take_s": round(sum(r["duration"] for r in rs) + 2.0 * len(rs), 1),
                           "moves": sorted({show(((r.get("aspects") or {}).get("camera") or {}).get("result", {}).get("move")) or T("固定", "static") for r in rs})})
        post = [dict(e, shot=r["index"]) for r in sc for e in (r.get("ai_edits") or [])]
        out.append({"id": f"S{si}", "kind": "shoot", "shots": [r["index"] for r in sc], "post": post,
                    "stop_motion": [r["index"] for r in sc if r["base"]["label"] == "stop_motion"],
                    "screen_s": round(sum(r["duration"] for r in sc), 2), "description": desc,
                    "lighting": _light_words(sc[0], light),
                    "setups": setups})
    return out


def _light_words(r: dict, light: dict) -> str:
    """Lighting in a few plain words: what the image reader called the setup, else the measured setup and colour."""
    seen = (((r.get("review") or r.get("vlm") or {}).get("aspects") or {}).get("lighting") or {}).get("lighting_setup")
    if seen:
        return str(seen)
    short = lambda x: re.split(r"[（(]", str(x))[0].strip() if x else ""  # noqa: E731  "正面（光从镜头方向来…）" -> "正面"
    return T("，", ", ").join(x for x in (light.get("setup_name"), short(light.get("key_direction")) and T("主光{d}", "key light {d}", d=short(light.get("key_direction"))),
                                         light.get("color_temp")) if x)


# ---------------------------------------------------------------- whole plan
def production_plan(b: dict, out: Path, engine: str = "seedance2.0") -> dict:
    shots = b["shots"]
    planner = Planner()
    seg = planner.routing.get("segmentation", {}).get("defaults", {})
    hard = seg.get("multishot_hardcut_s") or {"prefer": 8, "max": 10}
    thr = float(seg.get("same_scene_distance", 0.5))
    unit_min = float((seg.get("generation_unit_s") or {}).get("min", 4))
    sig = scene_signatures(shots, out)
    from .entities import cast as _cast

    # scenes an image reader named beat colour histograms (a close-up and a wide shot of one table differ in colour)
    named = {i: k for k, sc in enumerate(_cast(b).get("scenes") or []) for i in sc.get("shots") or []}

    def same_scene(a: dict, c: dict) -> bool:
        if a["index"] in named and c["index"] in named:
            return named[a["index"]] == named[c["index"]]
        return scene_distance(sig[a["index"]], sig[c["index"]]) <= thr

    same_prev = {r["index"]: same_scene(p, r) for p, r in zip(shots, shots[1:])}
    eng, model = pick_model(planner, engine)
    lim = _limits(model)
    gen = [r for r in shots if r["base"]["label"] in GEN_LABELS]
    # product / people that recur across the video are referenced in every unit, not only where they were detected
    cast = {"product": any(it.get("kind") in PRODUCT_KINDS and (it.get("real_material") or it in m.get("references", []))
                           for r in (shots if gen else []) for m in [r.get("material") or {}] for it in m.get("items", []) + m.get("references", [])),
            "people": sum(r["duration"] for r in gen if (r.get("faces") or 0) > 0.3) >= 1.0}
    style = _style_line(gen, b["source"].get("aspect_ratio", "")) if gen else ""
    reused = reused_footage(gen)
    units: list[dict] = []
    for run in _runs(shots, same_scene, GEN_LABELS, skip=set(reused)):
        for segm in _split_run(run, lim, hard, unit_min):
            prev = units[-1] if units else None
            units.append(_unit(segm, len(units) + 1, lim, model, style, cast, prev, same_prev.get(segm[0]["index"], False), unit_min))
    units.sort(key=lambda u: u["start"])
    for k, u in enumerate(units, 1):
        u["id"] = f"G{k}"
    for again, src in sorted(reused.items()):
        u = next((u for u in units if src in u["shots"]), None)
        if u:
            u.setdefault("reused", []).append({"shot": again, "from": src})
    plan: dict = {"model": (model or {}).get("id"), "model_name": model_name((model or {}).get("name")),
                  "model_limits": {k: lim[k] for k in ("max", "min", "multi_shot", "ref_video", "native_audio")},
                  "rules": {"hardcut_s": hard, "same_scene_distance": thr}, "units": units}
    gen_shots = sum(len(u["shots"]) for u in units)
    if units:
        calls = sum(u["calls"] for u in units)
        plan["calls"] = calls
        plan["gen_shots"] = gen_shots
        if model and (not eng or eng["id"] != model["id"]):
            plan["engine_note"] = T("能力地图里没有可用来生成视频的 {e}，这里按 {m} 规划（单次 ≤{mx:.0f}s），共 {c} 次；可选的模型用 `rea-video models` 查看",
                                    "The capability map has no video generator named {e}; this plan is for {m} (≤{mx:.0f}s per call), {c} call{cs} in total. "
                                    "`rea-video models` lists the models to choose from",
                                    e=model_name(eng["name"]) if eng else engine, m=model_name(model["name"]), mx=lim["max"], c=calls, cs=_s(calls))
        if model and planner.prompting.get(model["id"]):
            plan["prompting"] = planner.prompting[model["id"]]
        voice = ((b.get("audio") or {}).get("voice") or {}).get("present")
        vsrc = ((b.get("sound_sources") or {}).get("voice") or {}).get("source")
        if lim["native_audio"]:
            plan["audio_note"] = T("模型可以同时生成动作音效和环境声", "the model can generate action sound effects and ambience along with the picture") + \
                (semi() + (T("口播建议单独 TTS 再混进去，方便改文案和卡时间", "voice-over is better done as separate TTS and mixed in, so copy and timing stay editable")
                           if vsrc == "tts" else
                           T("口播是真人录的：单独录好再混进去，不让视频模型生成，方便改文案和卡时间",
                             "the voice was recorded by a person: record it separately and mix it in rather than having the video model speak, so copy and timing stay editable"))
                 if voice else "")
        from .packaging import overlays_at

        on_gen = list(dict.fromkeys(k for u in units for a, z in u["ranges"] for k in overlays_at(b.get("packaging"), a, z)))
        if on_gen:  # generated picture stays clean; the packaging is laid on afterwards, so a new wording can move it
            plan["overlay_note"] = T("生成单元镜头上的{k}属于后期包装，不写进提示词；参考帧上带着的先擦掉，生成后按「剪辑包装层」的时间轴叠回",
                                     "the {k} on the generated shots is post-production packaging: keep it out of the prompts, erase it from reference frames, "
                                     "and lay it back on from the packaging timeline after generation", k=join(on_gen))
    plan["shoot"] = _setups(shots, sig, thr, b)
    code, cur = [], []
    for r in shots + [None]:
        if r is not None and r["base"]["label"] in CODE_LABELS:
            cur.append(r)
            continue
        if cur:
            code.append({"id": T("段{n}", "Part {n}", n=len(code) + 1), "kind": "code", "shots": [x["index"] for x in cur],
                         "start": cur[0]["start"], "end": cur[-1]["end"], "duration": round(cur[-1]["end"] - cur[0]["start"], 3),
                         "screen_capture": [x["index"] for x in cur if x["base"]["label"] == "screen_capture"],
                         "text_tracks": sum(len((x.get("text") or {}).get("tracks", [])) for x in cur),
                         "scenes": [{"shot": x["index"], "start": x["start"], "end": x["end"], **code_scene(x),
                                     "colours": lit_colours([out / x["assets"][k] for k in ("first_frame", "last_frame")
                                                             if (x.get("assets") or {}).get(k)])} for x in cur]})
            cur = []
    plan["code"] = code
    ps = out / "frames" / "scenes.json"
    # only shots still built as particles: a review that relabels a shot drops its scenes from the plan
    particle_shots = {sc["shot"] for c in code for sc in c["scenes"] if sc.get("style") == "particles"}
    if particle_shots and ps.exists():
        try:
            plan["particle_scenes"] = [{k: sc.get(k) for k in ("id", "shot", "start", "end", "points", "frames")} | {"measure": {
                k: (sc.get("measure") or {}).get(k) for k in ("ground", "halo", "colours", "dots", "dot_px", "box")}}
                for sc in json.loads(ps.read_text(encoding="utf-8")).get("scenes", []) if sc.get("shot") in particle_shots]
        except (OSError, ValueError, TypeError):
            pass
    plan["local"] = [{"shot": r["index"], "label_zh": r["base"]["label_zh"], "duration": r["duration"]}
                     for r in shots if r["base"]["label"] in LOCAL_LABELS]
    plan["avatar"] = [r["index"] for r in shots if r["base"]["label"] == "avatar"]
    plan["footage"] = footage_runs(shots)
    plan["_labels"] = {r["index"]: r["base"]["label"] for r in shots}
    plan["summary"] = summary_line(plan, b)
    del plan["_labels"]
    return plan


def footage_runs(shots: list[dict]) -> list[dict]:
    """Film / TV clips in a row: the stretches to find in the source."""
    runs, cur = [], []
    for r in shots + [None]:
        if r is not None and r["base"]["label"] == "film_footage":
            cur.append(r)
            continue
        if cur:
            runs.append({"shots": [x["index"] for x in cur], "start": cur[0]["start"], "end": cur[-1]["end"],
                         "duration": round(cur[-1]["end"] - cur[0]["start"], 3)})
            cur = []
    return runs


def _s(n: int) -> str:
    """English plural suffix (unused in Chinese)."""
    return "" if n == 1 else "s"


def summary_line(plan: dict, b: dict) -> str:
    bits = []
    if plan["units"]:
        kinds: dict[str, int] = {}
        for u in plan["units"]:
            for i in u["shots"]:
                lab = plan["_labels"][i]
                kinds[lab] = kinds.get(lab, 0) + 1
        what = " + ".join(T("{g} {v} 镜", "{v} {g} shot{s}", g=GEN_ZH.get(k, k), v=v, s=_s(v)) for k, v in kinds.items())
        nu = len(plan["units"])
        again = sum(len(u.get("reused") or []) for u in plan["units"])
        bits.append(T("{what} → {u} 个生成单元、{c} 次 {m} 调用", "{what} → {u} generation unit{us}, {c} {m} call{cs}",
                      what=what, u=nu, us=_s(nu), c=plan["calls"], cs=_s(plan["calls"]), m=plan["model_name"])
                    + (T("（另有 {n} 镜是同一段成片重复使用，直接剪）", " (plus {n} shot{s} reusing the same clip, just cut)", n=again, s=_s(again)) if again else ""))
    if plan["shoot"]:
        n_set = sum(len(s["setups"]) for s in plan["shoot"])
        n_shot = sum(len(s["shots"]) for s in plan["shoot"])
        n_stop = sum(len(s.get("stop_motion", [])) for s in plan["shoot"])
        what = T("实拍", "live action") if not n_stop else (T("定格动画", "stop motion") if n_stop == n_shot else T("实拍 / 定格", "live action / stop motion"))
        n_sc = len(plan["shoot"])
        bits.append(T("{what} {n} 镜 → {sc} 个场景、{st} 个机位", "{what} {n} shot{s1} → {sc} scene{s2}, {st} camera setup{s3}",
                      what=what, n=n_shot, s1=_s(n_shot), sc=n_sc, s2=_s(n_sc), st=n_set, s3=_s(n_set)))
        n_post = len({e["shot"] for s in plan["shoot"] for e in s.get("post", [])})
        if n_post:
            bits.append(T("其中 {n} 镜拍完还要 AI 加工（{k}）", "{n} of them need{v} AI processing after the shoot ({k})",
                          n=n_post, v="s" if n_post == 1 else "", k=join(dict.fromkeys(e["kind_zh"] for s in plan["shoot"] for e in s["post"]))))
    if plan["code"]:
        n = sum(len(c["shots"]) for c in plan["code"])
        bits.append(T("代码渲染/录屏 {n} 镜 → 1 个代码工程", "code render / screen capture {n} shot{s} → 1 code project", n=n, s=_s(n))
                    + (T("（{n} 段）", " ({n} parts)", n=len(plan["code"])) if len(plan["code"]) > 1 else ""))
    if plan["local"]:
        n = len(plan["local"])
        bits.append(T("静图推拉/静帧 {n} 镜 → 本地重建", "still-image move / static frame {n} shot{s} → rebuilt locally", n=n, s=_s(n)))
    if plan.get("footage"):
        n = sum(len(f["shots"]) for f in plan["footage"])
        bits.append(T("影视片段 {n} 镜 → 找原片剪辑", "film / TV footage {n} shot{s} → cut from the source", n=n, s=_s(n)))
    if plan["avatar"]:
        n = len(plan["avatar"])
        bits.append(T("数字人 {n} 镜 → TTS + 数字人驱动", "digital avatar {n} shot{s} → TTS + avatar driver", n=n, s=_s(n)))
    return semi().join(bits)


def report_parts(plan: dict) -> dict[str, list[str]]:
    """The remake plan cut at its subsections, so a report can place each part under the step it belongs to:
    pre (AI notes and the input primer), units, shoot, code, local, footage. The summary line is left out."""
    heads = {T("### 生成单元", "### Generation units"): "units", T("### 拍摄场次", "### Shooting scenes"): "shoot",
             T("### 代码合成", "### Code composition"): "code", T("### 本地重建", "### Local rebuild"): "local",
             T("### 影视原片", "### Film / TV source"): "footage"}
    parts: dict[str, list[str]] = {}
    key = "pre"
    for line in report_md(plan)[4:]:  # "", "## 复刻方案", "", "**summary**"
        if line in heads:
            key = heads[line]
            continue
        parts.setdefault(key, []).append(line)
    return {k: v for k, v in parts.items() if any(x.strip() for x in v)}


def particle_scenes_md(scenes: list[dict]) -> list[str]:
    """Particle shots split into scenes (the dots regroup without a cut), with the measured look and the target points."""
    if not scenes:
        return []
    L = ["", T("**粒子场景**（镜头内粒子重组成新形状就算一个新场景；`frames/` 里每个场景有首 / 中 / 尾原尺寸帧，"
               "`frames/points/scene_XX.json` 是从原片中间帧取的亮点，每行 `x y r g b a`，x、y 是 0–1 坐标：粒子直接摆到这些点上就是原片的形状，"
               "不用照描述去猜；`frames/scenes.json` 的 `track` 是粒子重心和散开程度随时间的变化）",
               "**Particle scenes** (a new scene whenever the dots regroup into a new shape inside a shot; `frames/` holds first / middle / last "
               "full-size frames per scene, `frames/points/scene_XX.json` the lit dots of the original's middle frame, one `x y r g b a` per row "
               "with x, y in 0–1: put the particles on these points and you have the original shape, no guessing from a description; "
               "`track` in `frames/scenes.json` follows the dots' centre and spread over time)"), "",
         T("| 场景 | 镜头 | 时间 | 光晕 | 粒子颜色 | 粒子数 | 范围 (x0 y0 x1 y1) |", "| Scene | Shot | Time | Halo | Dot colours | Dots | Area (x0 y0 x1 y1) |"),
         "|---|---|---|---|---|---|---|"]
    for sc in scenes:
        m = sc.get("measure") or {}
        halo = m.get("halo") or {}
        hw = (T("{c}，中心 ({x:.2f}, {y:.2f})，半径 {r:.2f}", "{c}, centre ({x:.2f}, {y:.2f}), radius {r:.2f}", c=halo["colour"],
                x=halo["centre"][0], y=halo["centre"][1], r=halo["radius"]) if halo else "—")
        cols = " ".join(c["hex"] for c in m.get("colours") or []) or "—"
        box = " ".join(f"{v:.2f}" for v in m.get("box") or []) or "—"
        L.append(f"| {sc['id']} | #{sc['shot']} | {sc['start']:.1f}–{sc['end']:.1f}s | {hw} | {cols} | {m.get('dots') or '—'} | {box} |")
    L += ["", T("做完用 `rea-video compare 原片 成片 --scenes frames/scenes.json -o 对比目录` 打分（浅底复刻会自动反相再比），"
                "按 `compare_worst.jpg` 先改分数最低的场景。",
                "When built, score it with `rea-video compare original remake --scenes frames/scenes.json -o dir` (a light-ground remake is "
                "inverted before comparing) and fix the lowest-scoring scenes first, from `compare_worst.jpg`.")]
    return L


def report_md(plan: dict) -> list[str]:
    if not plan:
        return []
    L = ["", T("## 复刻方案", "## Remake plan"), "", f"**{plan['summary']}**", ""]
    if plan.get("engine_note"):
        L += [f"- {plan['engine_note']}"]
    if plan["units"]:
        lim = plan["model_limits"]
        L += [T("- 分组规则：同场景、硬切相连的 AI 镜头合并为一次生成；单次 ≤{mx:.0f}s；单元内连续硬切尽量 ≤{p}s、最多 {m}s；在叠化/淡入淡出和换场景处切开",
                "- Grouping: AI shots in the same scene joined by hard cuts are generated in one call; ≤{mx:.0f}s per call; "
                "consecutive hard cuts inside a unit preferably ≤{p}s, at most {m}s; split at dissolves / fades and scene changes",
                mx=lim["max"], p=plan["rules"]["hardcut_s"]["prefer"], m=plan["rules"]["hardcut_s"]["max"])]
        if plan.get("audio_note"):
            L.append(T("- 声音：{a}", "- Audio: {a}", a=plan["audio_note"]))
        if plan.get("overlay_note"):
            L.append(T("- 包装层：{a}", "- Packaging: {a}", a=plan["overlay_note"]))
        if plan.get("prompting"):
            L.append(T("- 下面的提示词是通用写法；用 {m} 生成前，按它的写法改写（时间和镜头怎么分、参考素材怎么指代、台词和不想要的内容怎么写）：",
                       "- The prompts below are written generically; before generating with {m}, rewrite them the way it expects "
                       "(timing and shots, how references are addressed, dialogue, exclusions): `rea-video models {i}`",
                       m=plan["model_name"], i=plan["model"]))
            if lang() == "zh":
                L += ["", "<details><summary>" + f"{plan['model_name']} 的提示词写法" + "</summary>", ""] + prompting_md(plan["prompting"]) + ["", "</details>"]
        L += ["", T("AI 视频模型能吃这几种输入，每个生成单元下面写了要喂哪些、从哪来：",
                    "A video model can take these inputs; each generation unit below lists which ones to feed and where they come from:"),
              T("- **文字提示词**：必需，描述画面、动作、运镜", "- **Text prompt**: always; describes the picture, action and camera"),
              T("- **首帧图**：锁住第一帧的构图和主体。不给就是纯文生，构图每次都不一样",
                "- **First frame**: locks the composition and subject of frame one. Without it this is plain text-to-video and framing changes every time"),
              T("- **尾帧图**：再锁住最后一帧，模型只补中间过程。适合单个有运镜或动作的镜头",
                "- **Last frame**: also locks the final frame so the model only fills in between. Suits a single shot with a camera move or action"),
              T("- **参考图**：商品、人物的样子，让多个镜头里长得一样（提示词里用 `@图片1` 指代）",
                "- **Reference images**: how the product and people look, so they stay the same across shots (`@图片1` in the prompt)"),
              T("- **参考视频**：照着学动作、运镜和节奏，不复制画面（`@视频1`）；不是每个模型都支持",
                "- **Reference video**: copy the action, camera move and rhythm, not the picture (`@视频1`); not every model takes one"),
              "", T("### 生成单元", "### Generation units"), "",
              T("每个单元一次生成。表里是要喂给模型的东西，展开单元看来源和提示词。",
                "One generation per unit. The table lists what to feed the model; open a unit for where each input comes from and the prompt."), "",
              T("| 单元 | 镜头 | 时间 | 时长 | 方式 | 要喂的 | 衔接 |", "| Unit | Shots | Time | Duration | Mode | Feed | Continuity |"), "|---|---|---|---|---|---|---|"]
        mode_zh = LangDict({"multi_shot": "一次多镜头", "single": "单镜", "split": "超长切段"},
                           en={"multi_shot": "multi-shot", "single": "single shot", "split": "long shot, split"})
        for u in plan["units"]:
            sh = f"#{u['shots'][0]}" + (f"–#{u['shots'][-1]}" if len(u["shots"]) > 1 else "")
            sh = shot_ids(u["shots"]) if len(u["ranges"]) > 1 else sh
            when = join(f"{a:.1f}–{z:.1f}s" for a, z in u["ranges"])
            L.append(f"| {u['id']} | {sh} | {when} | {u['duration']:.1f}s | {mode_zh[u['mode']]}"
                     f"{T('（{c} 次）', ' ({c} calls)', c=u['calls']) if u['calls'] > 1 else ''}"
                     f" | {_fed(u) or '—'} | {u['continuity'] if u.get('continuity') and u['continuity'] != _first_note(u) else '—'} |")
        reuse = [(x, u["id"]) for u in plan["units"] for x in u.get("reused") or []]
        if reuse:
            L += ["", T("同一段成片用了不止一次（看图认出的）：只生成一次，剪辑时再放到每一处。",
                        "The same clip is used more than once (spotted by the image reader): generate it once and place it at each spot in the edit.")]
            L += [T("- #{a} 和 #{s} 是同一段画面：从 {u} 的成片里剪出来", "- #{a} and #{s} are the same footage: cut it from {u}'s result",
                    a=x["shot"], s=x["from"], u=uid) for x, uid in reuse]
        for u in plan["units"]:
            L += ["", "<details><summary>" + T("{id} · 镜头 {sh} · {d:.1f}s · {m}", "{id} · shots {sh} · {d:.1f}s · {m}",
                                               id=u["id"], sh=shot_ids(u["shots"]), d=u["duration"], m=METHOD_ZH[u["method"]] if u.get("method") else u["label_zh"])
                  + "</summary>", ""]
            if u.get("inputs"):
                need = LangDict({"yes": "要", "opt": "建议", "no": "不用"}, en={"yes": "yes", "opt": "worth it", "no": "no"})
                L += [T("| 输入 | 要不要 | 从哪来 | 为什么 |", "| Input | Needed | From | Why |"), "|---|---|---|---|"]
                L += [f"| {INPUT_ZH[x['kind']]} | {need[x['need']]} | {x['source']} | {x['why']} |" for x in u["inputs"]]
                L.append("")
            elif u["refs"]:
                L.append(T("- 参考素材：", "- References: ") + semi().join(f"`{r['tag']}` {r['what']}" for r in u["refs"]))
            if u.get("image_prompt"):
                L.append(T("- 首帧图像提示词：{p}", "- First-frame image prompt: {p}", p=u["image_prompt"]))
            for k in ("note", "alt"):
                if u.get(k):
                    L.append(f"- {u[k]}")
            if u.get("prompt_missing"):
                L.append(T("- 镜头 {sh} 缺提示词", "- Shots {sh} have no prompt", sh=shot_ids(u["prompt_missing"])))
            L += ["", "```text", u["prompt"], "```"]
            if u.get("prompt_en"):
                L += ["", T("英文提示词：", "English prompt:"), "", "```text", u["prompt_en"], "```"]
            L += ["", "</details>"]
    if plan["shoot"]:
        L += ["", T("### 拍摄场次", "### Shooting scenes"), "",
              T("同一场景的镜头集中拍完再换场景；场景内先拍大景别再拍特写，不用重新布光。每条前后多留约 1s 余量。",
                "Shoot every shot of one scene before moving to the next; within a scene, shoot the wider sizes first and the close-ups last "
                "so the lighting is set only once. Leave about 1s of handle at both ends of every take."), ""]
        for s in plan["shoot"]:
            L.append(T("**{id}**：镜头 {sh}（成片 {scr}s）", "**{id}**: shots {sh} ({scr}s on screen)",
                       id=s["id"], sh=shot_ids(s["shots"]), scr=s["screen_s"])
                     + (semi() + s["description"] if s.get("description") else ""))
            if s.get("lighting"):
                L.append(T("- 布光：{l}", "- Lighting: {l}", l=s["lighting"]))
            for st in s["setups"]:
                L.append(T("- 机位 {size} · {sup} · {mv}：镜头 {sh}，成片 {scr}s，建议拍 {take}s",
                           "- Setup {size} · {sup} · {mv}: shots {sh}, {scr}s on screen, shoot about {take}s",
                           size=st["shot_size"], sup=st["support"], mv="/".join(st["moves"]), sh=shot_ids(st["shots"]),
                           scr=st["screen_s"], take=st["take_s"]))
            if s.get("stop_motion"):
                L.append(T("- 定格动画（{sh}）：相机固定，每秒约 12 张逐帧拍；用定格 App 的洋葱皮对位，灯光全程不动（避免闪烁）",
                           "- Stop motion ({sh}): camera locked off, about 12 frames per second shot one at a time; line up frames with a "
                           "stop-motion app's onion skin and keep the lighting fixed throughout (avoids flicker)",
                           sh=shot_ids(s["stop_motion"])))
            for e in s.get("post", []):
                L.append(T("- 拍完后 #{s} 要 AI 加工：{k}", "- After the shoot, #{s} needs AI processing: {k}", s=e["shot"], k=e["kind_zh"])
                         + (T("（{e}）", " ({e})", e=e["evidence"]) if e.get("evidence") else "")
                         + (f" → {e['how']}" if e.get("how") else ""))
            L.append("")
    if plan["code"]:
        L += ["", T("### 代码合成", "### Code composition"), "",
              T("一个 Remotion/HTML 工程，按文字轨和版式重建（文字、界面 100% 可控，改文案只改数据）；可以让 LLM 直接写这个工程。",
                "One Remotion / HTML project rebuilt from the text tracks and layout (text and UI are 100% controllable; changing copy is a data "
                "change). An LLM can write this project directly."), ""]
        for c in plan["code"]:
            L.append(T("- {id}：镜头 {sh}（{a:.1f}–{z:.1f}s）", "- {id}: shots {sh} ({a:.1f}–{z:.1f}s)",
                       id=c["id"], sh=shot_ids(c["shots"]), a=c["start"], z=c["end"])
                     + (semi() + T("其中 {sh} 用真实界面录屏", "{sh} use real screen recordings", sh=shot_ids(c["screen_capture"]))
                        if c["screen_capture"] else ""))
        scenes = [sc for c in plan["code"] for sc in c.get("scenes", [])]
        if any(sc.get("strip") or sc.get("elements_sheet") for sc in scenes):
            L += ["", T("复刻资产（都在报告目录里，复刻时和下面的数据一起交给写代码的人或 LLM）：",
                        "Remake assets (all in the report folder; hand them over together with the data below to whoever writes the code, or to an LLM):"),
                  T("- `shots/shot_XXX_first.jpg` / `_last.jpg`：每镜首尾帧原分辨率，对版式、字号、留白",
                    "- `shots/shot_XXX_first.jpg` / `_last.jpg`: first / last frame of each shot at full size, for layout, type size and margins"),
                  T("- `shots/shot_XXX_strip.jpg`：约每 0.5 秒一张的关键帧条，看动画过程",
                    "- `shots/shot_XXX_strip.jpg`: key frames about every 0.5 s, to follow the animation"),
                  T("- `shots/shot_XXX_elements.jpg` 和 `_el_NN.jpg` / `_st_NN.jpg` / `_ly_NN.jpg`：每个元素停稳后的原分辨率截图，编号对应动效时间轴；"
                    "图形照着重画，图标、Logo、插画这类画不出来的可以直接抠图用",
                    "- `shots/shot_XXX_elements.jpg` and `_el_NN.jpg` / `_st_NN.jpg` / `_ly_NN.jpg`: full-size crop of every element once settled, "
                    "numbered as in the motion timeline; redraw shapes from them, cut out icons, logos and illustrations that cannot be redrawn"),
                  T("- `packaging/overlays.ass`、`packaging/timeline.json`：文字的时间、位置、颜色",
                    "- `packaging/overlays.ass`, `packaging/timeline.json`: timing, position and colour of the text")]
        if scenes:
            styles = CODE_STYLES()
            used = list(dict.fromkeys(sc.get("style", "shapes") for sc in scenes))
            L += ["", T("画面做法（按工具测得的画面类型）：", "How to build the pictures (by the measured picture type):")]
            L += [f"- {styles[k][0]}{T('：', ': ')}{styles[k][1]}" for k in used]
            if "particles" in used:
                L += ["", T("粒子类镜头：每一镜粒子拼成什么形状、怎么动是复刻好坏的关键，章节牌、标注、数字等 HUD 文字用 HTML 层叠在上面，"
                            "按下表逐镜做，不要所有镜头共用一个背景。",
                            "Particle shots: what shape the particles form in each shot and how it moves decides whether the remake works; "
                            "chapter cards, labels and counters go in an HTML layer on top. Build shot by shot from the table below, not one shared background.")]
            L += ["", T("| 镜头 | 时间 | 做法 | 画面 | 运镜 | 主色 | 画面文字 |", "| Shot | Time | Build | Picture | Camera | Colours | On-screen text |"),
                  "|---|---|---|---|---|---|---|"]
            for sc in scenes:
                pic = sc["picture"].replace("|", "/").replace("\n", " ") or T("（待看图补：画面元素拼成什么、怎么动）",
                                                                              "(to fill from the images: what the elements form and how they move)")
                cols = (T("底 {bg}", "ground {bg}", bg=sc["background"]) + " · " + (T("粒子 ", "dots ") + " ".join(sc["dots"]) if sc.get("dots") else
                                                                                   " ".join(c for c in sc["palette"] if c != sc["background"]))
                        if sc.get("background") else T('、', ', ').join(sc['colours']) or '—')
                L.append(f"| #{sc['shot']} | {sc['start']:.1f}–{sc['end']:.1f}s | {styles[sc.get('style', 'shapes')][0]} | {pic} | {sc['move']} | "
                         f"{cols} | {' / '.join(w.replace('|', '/') for w in sc['on_screen_text']) or '—'} |")
            L += particle_scenes_md(plan.get("particle_scenes") or [])
            L += code_motion_md(scenes)
    if plan["local"]:
        L += ["", T("### 本地重建", "### Local rebuild"), "", "- " + semi().join(f"#{x['shot']} {x['label_zh']} {x['duration']:.1f}s" for x in plan["local"])
              + T("：一张图 + 测得的缩放/平移参数，ffmpeg 直接出", ": one image + the measured zoom / pan parameters, rendered straight from ffmpeg")]
    if plan.get("footage"):
        L += ["", T("### 影视原片", "### Film / TV source"), "",
              T("- 这些镜头剪自已有的影视作品：找到原片对应片段再剪，版权属于片方，商用要授权；不用原片时按同样景别、机位和打光自己拍，或用 AI 做近似画面",
                "- These shots are cut from existing films or series: find the same clips in the source and cut them; rights belong to the studio and commercial use needs a licence. "
                "Without the source, shoot them yourself with the same shot size, camera setup and lighting, or approximate them with AI"), ""]
        for f in plan["footage"]:
            L.append(f"- {f['start']:.1f}–{f['end']:.1f}s " + T("{n} 镜", "{n} shot{s}", n=len(f["shots"]), s=_s(len(f["shots"]))))
    return L
