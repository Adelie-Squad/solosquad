"""Agent-as-VLM: a multimodal agent looks at the shot images and answers the same questions
the VLM would. `build_tasks` writes what to look at; `apply_answers` folds the answers back
into the breakdown so the summary, reports and replication plan reflect what the agent saw.
"""
from __future__ import annotations

import re
import shlex
import time

from .classify import LABEL_ZH, LABELS, top
from . import aspects, narrative
from .narrative import ROLE_GUIDE
from .vlm import SHOT_PROMPT, shot_hints

SHOOT_LIKE = ("live_action", "avatar", "stop_motion", "film_footage")  # shots where "how was it shot / lit" applies
AGENT_WEIGHT = 0.85  # agent answers are softened toward uniform before fusion
IMAGE_SOURCES = ("ai_image", "photo", "graphic", "screenshot", "unknown")
EDIT_KINDS = ("face_swap", "lip_sync", "restyle", "outfit_swap", "bg_replace", "object_edit", "beautify")
ASSET_KINDS = ("real_footage", "photo", "screenshot", "screen_recording", "product_photo", "logo", "ai_image")

# category definitions, taken from the VLM prompt so both paths ask the same question
LABEL_GUIDE = re.search(r"底层画面类别.*?\n\n", SHOT_PROMPT, re.S).group(0).strip()
CONFUSIONS = re.search(r"注意区分：.*?\n\n", SHOT_PROMPT, re.S).group(0).strip()
ASPECT_GUIDE = aspects.review_guide()

INSTRUCTIONS = f"""你是这次的 VLM：逐个镜头看图，判断「底层画面」的制作方式，把答案写进 review_answers.json，然后运行
  rea-video apply-review <输出目录> --by <你的名字>
把你的判断并入结论（会重写 breakdown.json、report.md、report.html）。

怎么看：
1. 先看 storyboard.jpg 建立整体印象；每个镜头看 images 里的 sheet（首/中/尾联系表，一张就够，不用另开首尾帧）。
   要细看时运行顶层的 zoom_cmd，把 {{start}} {{end}} {{id}} 换成该镜头的值。
2. priority=high 的镜头（低置信、次选接近、转码后实拍/AI 待确认）一定要看；其余镜头也尽量都答。
3. common_evidence 是整片共有的工具证据（帧率、转码），每镜 tool.evidence 里不再重复。只依据画面证据，独立判断（这里不给 VLM 的答案，它会在融合时单独计入）。tool 一栏是确定性取证的结果，可能有误，但帧率类证据（24→30 重复帧）和 AIGC 标识可靠，
   和画面印象冲突时不要轻易推翻（见 SKILL.md「平台转码视频」）。
4. 看不出就把概率分散开，例如 ai_video 0.55 / live_action 0.45，并在 evidence 写清缺什么证据。
5. 没看过的镜头不要填（label_probs 保持 {{}}），apply-review 会跳过它。

{LABEL_GUIDE}

{CONFUSIONS}

每个镜头要填：label_probs（{len(LABELS)} 类，和为 1）、image_source（{"|".join(IMAGE_SOURCES)}）、evidence（看到的具体证据）、
description（主体、动作、场景、运镜；代码渲染画面写清图形元素是什么（粒子/渐变/图表/卡片/文字/矢量图形）、拼成什么形状、颜色、怎么动、文字和数字组件在哪，报告的「代码合成」逐镜表直接用它；代码镜头另有 images.strip 关键帧条（约每 0.5 秒一张），报告「逐镜动效时间轴」已测好每个元素的位置、出现时间、方向、快慢和色值，你按编号补「它是什么」即可，例如"1–12：圆角图标卡片，依次弹入"）、embedded_assets（画面里的真实素材：截图、照片、实拍片段、Logo，
kind 取 {"|".join(ASSET_KINDS)}，is_real_material 为 true/false）。
某个镜头其实是多刀合并的（暗底图形卡和暗底口播交替时，切点分数低容易被合成一个长镜头）就加 split_suggestion：
{{"cuts": [切点秒数], "labels": [各段类别，比 cuts 多一个], "note": "看到的交替结构"}}，报告会在该镜头标注拆分建议；不是合并段就不要填。
画面里拍到了带字的东西（手机屏幕、包装、招牌）时填 overlay_text：这一镜后期加上去的字幕、花字、标注原文列表（画面本身的字不要写），报告会把其余 OCR 文字当成画面内容；没有这种情况就不填。
同一段成片在片中出现不止一次（开头先放一段成片当预告、结尾完整放；或中途回放），在较短的那一处填 same_clip_as：另一处的镜头号（整数），复刻时只生成一次；不是就不要填。
实拍或定格镜头被 AI 二次加工过时填 ai_edits：[{{"kind": "{"|".join(EDIT_KINDS)}", "evidence": "看到的破绽"}}]（换脸、对口型、风格化、换装、换背景、加删物体、美颜）；没有就留空。
AI 生成 / 3D / 实拍镜头再填 replication：image_prompt（复刻首帧的<PROMPT_LANG>图像提示词：景别、机位高度和俯仰角、主体在画面里的位置和朝向、主体、光线、风格，具体可执行）、
video_prompt（复刻该镜头的<PROMPT_LANG>视频提示词：先写景别、机位角度、主体在画面里的位置，再写动作过程和结束状态、运镜；只写想要的内容，不写否定句）、video_prompt_en（英文版）。
这些提示词会被合并进「生成单元」的多镜头提示词，所以每镜只写这一镜的内容，统一的风格和场景描述写在 description 里即可。

实拍/写实镜头再填 aspects（怎么拍、怎么打光；纯图形/界面画面不填），像素测不出的部分靠你看：
{ASPECT_GUIDE}
答案模板只给可能是实拍的镜头预留了 aspects；别的镜头你判成实拍时，照顶层 shot_aspects_template 的结构加上。
工具已经测了景别、主体光比、主光左右/上下、软硬、色温、背景虚化（见每镜 aspects），你主要补：机位角度、
拍摄方式（自拍/支架）、主光是什么光源、眼神光、轮廓光/背景灯、画面里可见的光源；和测量冲突时写明依据。
最后在答案顶层的 aspects 里写整片：机位/场景、推测设备、整体布光、剪辑手法、视频形式。

每个镜头再填 narrative（这个镜头在讲什么）：role 选它在叙事上的作用，point 用一句话写它讲的那一点（去掉具体的人和产品也成立的写法，
例如"用反常识的数字开场"而不是"说水豚每天睡 12 小时"）。先通读 storyboard.jpg 和每镜的 said（这一镜里的字幕；没有字幕时是语音识别听到的话，可能有同音错字）再填，作用是相对整片说的：
{ROLE_GUIDE}
报告会把它连成「叙事线」：复刻时保留这条线，把案例和素材换成自己的。

答案顶层的 story 写整片的看点（报告开头的「核心看点」就用它，写给想学这条视频的人）：summary 一句话说这条视频是什么、靠什么吸引人；
hook 开头几秒怎么抓住人（写清第几秒、画面和字幕做了什么）；highlights 2–4 条这条视频能火 / 能卖货的关键做法，每条写手法 + 在哪一秒 + 为什么有效，
例如"0–6 秒先放 AI 成片预告：观众先看到结果，才有动力看完教程"，不要写空话（"节奏紧凑""画面精美"）。
答案顶层的 cast 写整片的角色、场景和道具（看 storyboard.jpg 和各镜截图）：characters 每个主要角色一条（id 编号、name 称呼、kind person|animal|cartoon|avatar|product|other、
look 外观写到能据此再画出同一个角色、role 作用、voice 音色、shots 出场镜头号）；同一个角色在不同镜头要认成同一个。scenes 每个地点一条（id、where、when、look、shots）；
props 道具 / 商品 / Logo（name、note、shots）；style 一句整体视觉风格与调色。

剪辑包装（tasks.packaging，有才做）：
- stickers：工具找到的贴纸 / 动图 / 画中画，看 image（贴纸截图）和 frame_cmd 抽的帧，在答案 packaging.stickers 里填
  is_overlay（true = 后期贴上去的；false = 画面本身的东西，例如 3D 里突然出现的物体）和 what（表情包 / GIF / emoji / 箭头 / 小窗里放的什么）。
- text：工具分好类的花字 / 标题 / 文字标注，分错了就在 packaging.text 里填 kind（subtitle / huazi / title / label / counter / scene；counter 是跳动的数字）。
- 工具漏掉的贴纸、动图，写进 packaging.missed：{{"t0": 秒, "t1": 秒, "what": "...", "where": "画面位置"}}。"""



def _tiles_cmd(video, t0: float, t1: float, every: float, out: str) -> str:
    """Shell-ready `rea-video tiles` command (paths quoted: file names often have spaces)."""
    return (f"rea-video tiles {shlex.quote(str(video))} --start {t0:.2f} --end {t1:.2f} --every {every:g} "
            f"-o {shlex.quote(out)}")

def _strip_glosses(d):
    """Measured aspect values carry a reader's gloss in brackets ("正面（光从镜头方向来…）"); the agent has the
    field guide in the instructions, so keep the value only."""
    if isinstance(d, dict):  # also drop empty values and the code twin of a readable field (support / support_zh)
        return {k: _strip_glosses(v) for k, v in d.items()
                if v is not None and f"{k}_zh" not in d and f"{k}_name" not in d}
    if isinstance(d, str):
        return re.sub(r"（[^（）]*）|\s\([^()]*\)", "", d).strip() or d
    return d


def _priority(rec: dict, ctx: dict) -> tuple[str, list[str]]:
    det = (rec.get("deterministic") or {}).get("probs") or {}
    probs = sorted(det.items(), key=lambda kv: -kv[1])
    label, conf = probs[0] if probs else ("", 1.0)
    why = []
    if conf < 0.65:
        why.append(f"置信度低（{conf:.0%}）")
    if len(probs) > 1 and probs[0][1] - probs[1][1] < 0.25:
        why.append(f"次选 {LABEL_ZH.get(probs[1][0], probs[1][0])} 接近（{probs[1][1]:.0%}）")
    if (rec.get("base") or {}).get("disputed"):
        why.append(rec["base"]["disputed"])
    facts = (rec.get("deterministic") or {}).get("facts", {})
    if label == "ai_video" and facts.get("pulldown") in ("24→30", "24→60", "25→30?"):
        why.append("只有 24fps 源的帧率证据：AI 和 24p 相机实拍都会这样，看画面定")
    if facts.get("transcode_degraded") and label in ("ai_video", "live_action"):
        why.append("平台转码，实拍/AI 待确认")
    return ("high" if why else "normal"), why


def build_tasks(breakdown: dict, out_dir: str) -> tuple[dict, dict]:
    """-> (tasks, empty answer template)."""
    video = breakdown["source"]["path"]
    ctx = breakdown.get("video_context") or {}
    from .memory import hint_for, patterns

    pats = patterns()
    shots = []
    said: dict[int, str] = {}  # subtitles inside each shot: what the shot says, for its place in the story
    subs = [c for c in (breakdown.get("packaging") or {}).get("text_cues", []) if c.get("kind") == "subtitle" and c.get("text")]
    for rec in breakdown["shots"]:
        said[rec["index"]] = " ".join(c["text"] for c in subs if rec["start"] <= (c["t0"] + c["t1"]) / 2 < rec["end"])[:160]
        if not said[rec["index"]]:  # no burned-in subtitles here: what the recognizer heard, when it ran
            said[rec["index"]] = " ".join(ln["text"] for ln in (breakdown.get("speech") or {}).get("lines") or []
                                          if rec["start"] <= (ln["start"] + ln["end"]) / 2 < rec["end"])[:160]
    for rec in breakdown["shots"]:
        # only the deterministic layer is shown: the agent should judge independently of any VLM answer
        ranked = sorted(rec["deterministic"]["probs"].items(), key=lambda kv: -kv[1])
        alt = ranked[1:2]
        prio, why = _priority(rec, ctx)
        dl, dp = top(rec["deterministic"]["probs"])
        past = hint_for(dl, pats)
        if past:
            prio, why = "high", why + [past]
        shoot_like = any(l in SHOOT_LIKE for l, _ in ranked[:2])
        shots.append({
            "id": rec["id"], "index": rec["index"], "start": rec["start"], "end": rec["end"], "duration": rec["duration"],
            "priority": prio, "why": why,
            "tool": {"label": dl, "label_zh": LABEL_ZH[dl], "confidence": round(dp, 3),
                     "second": [alt[0][0], round(alt[0][1], 3)] if alt else None,
                     "evidence": rec["deterministic"]["evidence"][:6]},
            # the tool's top label is already in "tool"; drop it from the raw hints
            "hints": shot_hints(rec["features"], rec["deterministic"]["facts"], dl, dp).split("; 确定性初判=")[0],
            **({"aspects": {k: v["result"] for k, v in (rec.get("aspects") or {}).items() if v.get("result")}} if shoot_like else {}),
            # the sheet already holds first / middle / last; separate first / last frames would triple the image tokens
            **({"said": said[rec["index"]]} if said.get(rec["index"]) else {}),
            "images": {"sheet": rec["assets"]["sheet"], **({"strip": rec["assets"]["strip"]} if rec["assets"].get("strip") else {})},
            "_shoot_like": shoot_like,
        })
    pack = breakdown.get("packaging") or {}
    pk_tasks, pk_answers = None, None
    if pack:
        sts = [st for st in pack.get("stickers", []) if st.get("bbox")]
        txt = [c for c in pack.get("text_cues", []) if c["kind"] not in ("subtitle",)]
        pk_tasks = {"stickers": [{"id": st["id"], "t0": st["t0"], "t1": st["t1"], "kind_zh": st["kind_zh"], "confidence": st.get("confidence"),
                                  "in_picture": bool(st.get("in_picture")), "image": st.get("image"), "bbox": st["bbox"],
                                  "frame_cmd": _tiles_cmd(video, st["t0"], st["t1"], 0.25, f"{out_dir}/check_{st['id']}.jpg")}
                                 for st in sts],
                    "text": [{"id": c["id"], "t0": c["t0"], "t1": c["t1"], "text": c["text"], "kind": c["kind"], "style": c.get("style_zh", "")}
                             for c in txt[:80]]}
        pk_answers = {"stickers": [{"id": st["id"], "is_overlay": None, "what": ""} for st in sts],
                      "text": [{"id": c["id"], "kind": ""} for c in txt[:80]], "missed": []}
    shoot = {s["id"]: s.pop("_shoot_like") for s in shots}
    # whole-video evidence (frame rate, transcode) repeats on most shots: state it once at the top
    from collections import Counter

    seen_in = Counter(e for s in shots for e in set(s["tool"]["evidence"]))
    common = [e for e, n in seen_in.items() if len(shots) >= 4 and n > len(shots) / 2]
    for s in shots:
        s["tool"]["evidence"] = [e for e in s["tool"]["evidence"] if e not in common]
        if "aspects" in s:
            s["aspects"] = _strip_glosses(s["aspects"])
    instructions = INSTRUCTIONS.replace("<PROMPT_LANG>", "英文" if breakdown.get("lang") == "en" else "中文")
    if breakdown.get("lang") == "en":
        instructions += "\n\n报告语言是英文：evidence、description、image_prompt、video_prompt 和其他自由文本都用英文写（video_prompt_en 可以和 video_prompt 相同）。"
    tasks = {"instructions": instructions, "video": video, "storyboard": "storyboard.jpg",
             "zoom_cmd": _tiles_cmd(video, 0, 0, 0.2, f"{out_dir}/check_ID.jpg")
             .replace("--start 0.00 --end 0.00", "--start {start} --end {end}").replace("check_ID.jpg", "check_{id}.jpg"),
             "shot_aspects_template": aspects.review_template(),
             "video_context": {k: ctx.get(k) for k in ("transcoded", "platform", "native30", "film_hint_share") if k in ctx},
             "aigc": (breakdown.get("provenance") or {}).get("aigc"),
             **({"common_evidence": common} if common else {}),
             "shots": shots}
    if pk_tasks:
        tasks["packaging"] = pk_tasks
    answers = {"by": "", "shots": [{"id": s["id"], "time": f"{s['start']:.2f}-{s['end']:.2f}",
                                     "label_probs": {}, "image_source": "unknown",
                                     "evidence": [], "description": "", "narrative": {"role": "", "point": ""}, "embedded_assets": [], "ai_edits": [], "same_clip_as": None,
                                     "replication": {"image_prompt": "", "video_prompt": "", "video_prompt_en": ""},
                                     **({"aspects": aspects.review_template()} if shoot[s["id"]] else {})} for s in shots],
               "aspects": aspects.review_template(video=True),
               "story": {"summary": "", "hook": "", "highlights": [""]},
               "cast": {"style": "", "characters": [{"id": "A", "name": "", "kind": "", "look": "", "role": "", "voice": "", "shots": []}],
                        "scenes": [{"id": "S1", "where": "", "when": "", "look": "", "shots": []}], "props": [{"name": "", "note": "", "shots": []}]}}
    if pk_answers:
        answers["packaging"] = pk_answers
    return tasks, answers


def _clean_split(sp) -> tuple[dict | None, str | None]:
    """Optional reviewer note that a shot is really several cuts: {cuts: [秒], labels: [类别], note}. Malformed
    input is reported, not raised: the answers file is written by an agent and one bad field must not stop apply-review."""
    if not isinstance(sp, dict) or not sp.get("cuts"):
        return None, None
    cuts_in, labels_in = sp.get("cuts"), sp.get("labels") or []
    if not isinstance(cuts_in, list) or not isinstance(labels_in, list):
        return None, "split_suggestion 的 cuts / labels 要是列表"
    try:
        cuts = [float(c) for c in cuts_in]
    except (TypeError, ValueError):
        return None, "split_suggestion.cuts 里有不是数字的秒点"
    bad = [x for x in labels_in if x not in LABELS]
    if bad:
        return None, f"split_suggestion.labels 有未知类别 {bad}（可选：{', '.join(LABELS)}）"
    return {"cuts": sorted(cuts)[:12], "labels": list(labels_in)[:12], "note": str(sp.get("note", ""))[:300]}, None


def _clean(ans: dict) -> tuple[dict | None, str | None]:
    probs = ans.get("label_probs") or {}
    if not isinstance(probs, dict):
        return None, "label_probs 不是一个对象"
    bad = [k for k in probs if k not in LABELS]
    if bad:
        return None, f"未知类别 {bad}（可选：{', '.join(LABELS)}）"
    vals = {}
    for k in LABELS:
        try:
            vals[k] = max(0.0, float(probs.get(k, 0) or 0))
        except (TypeError, ValueError):
            return None, f"{k} 的概率不是数字"
    total = sum(vals.values())
    if total <= 0:
        return None, "label_probs 全为 0（没作答），跳过"
    u = 1.0 / len(LABELS)
    soft = {k: AGENT_WEIGHT * v / total + (1 - AGENT_WEIGHT) * u for k, v in vals.items()}
    src = ans.get("image_source") if ans.get("image_source") in IMAGE_SOURCES else "unknown"
    rep_in = ans.get("replication") if isinstance(ans.get("replication"), dict) else {}
    rep = {k: str(rep_in.get(k) or "").strip() for k in ("image_prompt", "video_prompt", "video_prompt_en") if str(rep_in.get(k) or "").strip()}
    assets = []
    for e in ans.get("embedded_assets") or []:
        if isinstance(e, dict) and e.get("kind") in ASSET_KINDS:
            assets.append({"kind": e["kind"], "description": str(e.get("description", "")),
                           "is_real_material": bool(e.get("is_real_material", e["kind"] != "ai_image"))})
    split, err = _clean_split(ans.get("split_suggestion"))
    if err:
        return None, err
    ev = ans.get("evidence")
    if isinstance(ev, str):  # a bare string would otherwise be listed one character per line (same as normalize_shot_result)
        ev = [ev] if ev.strip() else []
    elif not isinstance(ev, list):
        ev = []
    return {"label_probs": soft, "raw_probs": {k: round(v / total, 3) for k, v in vals.items()}, "image_source": src,
            "evidence": [str(x) for x in ev][:8], "description": str(ans.get("description", "")),
            "embedded_assets": assets, "replication": rep, "aspects": aspects.clean_answers(ans.get("aspects")),
            "split_suggestion": split, "narrative": narrative.clean(ans.get("narrative")),
            "same_clip_as": int(ans["same_clip_as"]) if str(ans.get("same_clip_as", "")).strip().isdigit() else None,
            # the words added in post (subtitles, styled text, labels), like the VLM's overlay_text: OCR text in the
            # shot that matches none of them is part of the picture (a filmed phone screen, a gift box)
            "overlay_text": [str(x) for x in ans["overlay_text"] if str(x).strip()] if isinstance(ans.get("overlay_text"), list) else None,
            "ai_edits": [{"kind": e["kind"], "evidence": str(e.get("evidence", ""))} for e in (ans.get("ai_edits") or [])
                         if isinstance(e, dict) and e.get("kind") in EDIT_KINDS]}, None


def apply_answers(breakdown: dict, answers: dict, by: str | None = None) -> dict:
    """Store answers on the shots (rec["review"]) and return a change log. Call finalize() afterwards."""
    applied, problems, changes, unanswered = [], [], [], []
    if not isinstance(answers, dict):  # the answers file is written by an agent: a wrong shape is reported, not raised
        problems.append("答案文件不是一个对象")
        answers = {}
    by = by or answers.get("by") or "agent"
    recs = {r["id"]: r for r in breakdown["shots"]}
    shots_in = answers.get("shots") or []
    if not isinstance(shots_in, list):
        problems.append("shots 不是一个列表，跳过")
        shots_in = []
    for ans in shots_in:
        if not isinstance(ans, dict):
            problems.append("有一条答案不是一个对象，跳过")
            continue
        sid = ans.get("id")
        try:
            known = sid in recs
        except TypeError:  # an id that is a list / dict cannot be looked up
            problems.append(f"{sid!r}: 镜头 id 不是字符串")
            continue
        probs = ans.get("label_probs") or {}
        if not isinstance(probs, dict):
            problems.append(f"{sid}: label_probs 不是一个对象")
            continue
        if known and not any(probs.values()):
            unanswered.append(sid)  # left blank on purpose: listed once, not as a problem per shot
            continue
        if not known:
            problems.append(f"{sid}: 没有这个镜头")
            continue
        clean, err = _clean(ans)
        if err:
            problems.append(f"{sid}: {err}")
            continue
        clean["_by"] = by
        rec = recs[sid]
        before = rec["base"]["label"]
        rec["review"] = clean
        applied.append(sid)
        changes.append((sid, before))
    pk_applied: dict = {}
    pk = answers.get("packaging")
    if isinstance(pk, dict) and breakdown.get("packaging"):
        kinds = ("subtitle", "huazi", "title", "label", "counter", "scene")
        clean_pk = {"stickers": {str(a["id"]): {"is_overlay": bool(a["is_overlay"]), "what": str(a.get("what", ""))[:80]}
                                 for a in pk.get("stickers") or [] if isinstance(a, dict) and isinstance(a.get("is_overlay"), bool)},
                    "text": {str(a["id"]): a["kind"] for a in pk.get("text") or [] if isinstance(a, dict) and a.get("kind") in kinds},
                    "missed": [m for m in pk.get("missed") or [] if isinstance(m, dict) and "t0" in m], "by": by}
        if clean_pk["stickers"] or clean_pk["text"] or clean_pk["missed"]:
            breakdown["packaging"]["review"] = clean_pk
            pk_applied = {k: len(clean_pk[k]) for k in ("stickers", "text", "missed") if clean_pk[k]}
    st = answers.get("story") if isinstance(answers.get("story"), dict) else {}
    story = {"summary": str(st.get("summary") or "").strip()[:200], "hook": str(st.get("hook") or "").strip()[:200],
             "highlights": [str(x).strip()[:200] for x in (st.get("highlights") or []) if str(x).strip()][:5]}
    if any(story.values()):
        story["by"] = by
        breakdown["review_story"] = story
    whole = aspects.clean_answers(answers.get("aspects"), video=True)
    if whole:
        breakdown["review_aspects"] = whole
    from .entities import clean_cast

    cast = clean_cast(answers.get("cast"))
    if cast:
        cast["by"] = by
        breakdown["review_cast"] = cast
    breakdown.setdefault("analysis", {})["review"] = {"by": by, "shots": len(applied), "of": len(breakdown["shots"]),
                                                       "time": time.strftime("%Y-%m-%d %H:%M"), "problems": problems}
    return {"applied": applied, "problems": problems, "unanswered": unanswered, "before": dict(changes), "packaging": pk_applied}
