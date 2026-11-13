"""Cross-shot entities for the human report: who is in the video (characters), where it happens (scenes),
what appears in it (props), the script (who says what, when) and the open questions the reader should check.

The VLM whole-video pass and the agent review both answer the same `cast` shape; the review wins when present.
Everything here is tolerant of missing data: with no VLM and no review the report still gets a props list from
the per-shot references and a "no cast available" note instead of an empty section.
"""
from __future__ import annotations

from .i18n import LangDict, T, join, semi

KIND_ZH = LangDict({"person": "真人", "animal": "动物", "cartoon": "卡通形象", "avatar": "数字人", "product": "商品", "other": "其他"},
                   en={"person": "person", "animal": "animal", "cartoon": "cartoon character", "avatar": "digital avatar", "product": "product", "other": "other"})
_KINDS = tuple(KIND_ZH)
_MAX = 12


def _shots(v) -> list[int]:
    out: list[int] = []
    for x in v if isinstance(v, list) else []:
        try:
            i = int(x)
        except (TypeError, ValueError):
            continue
        if i > 0 and i not in out:
            out.append(i)
    return out


def _s(d: dict, k: str, n: int = 200) -> str:
    v = d.get(k)
    return str(v).strip()[:n] if isinstance(v, (str, int, float)) and str(v).strip() else ""


def clean_cast(raw) -> dict:
    """Validate a `cast` answer (VLM or agent). Returns {} when nothing usable is in it."""
    if not isinstance(raw, dict):
        return {}
    chars, scenes, props = [], [], []
    for i, c in enumerate(raw.get("characters") or []):
        if not isinstance(c, dict) or not (_s(c, "name") or _s(c, "look")):
            continue
        kind = c.get("kind") if c.get("kind") in _KINDS else "other"
        chars.append({"id": _s(c, "id", 8) or chr(ord("A") + len(chars)), "name": _s(c, "name", 40), "kind": kind,
                      "look": _s(c, "look", 300), "role": _s(c, "role", 80), "voice": _s(c, "voice", 80), "shots": _shots(c.get("shots"))})
    for sc in raw.get("scenes") or []:
        if not isinstance(sc, dict) or not (_s(sc, "where") or _s(sc, "look")):
            continue
        scenes.append({"id": _s(sc, "id", 8) or f"S{len(scenes) + 1}", "where": _s(sc, "where", 80), "when": _s(sc, "when", 40),
                       "look": _s(sc, "look", 200), "shots": _shots(sc.get("shots"))})
    for p in raw.get("props") or []:
        if not isinstance(p, dict) or not _s(p, "name"):
            continue
        props.append({"name": _s(p, "name", 60), "note": _s(p, "note", 160), "shots": _shots(p.get("shots"))})
    out = {"characters": chars[:_MAX], "scenes": scenes[:_MAX], "props": props[:_MAX * 2], "style": _s(raw, "style", 200)}
    return out if (chars or scenes or props or out["style"]) else {}


def _props_from_shots(b: dict) -> list[dict]:
    """Fallback props: the per-shot `material.references` (things seen in AI / 3D shots that the remake needs as reference)."""
    seen: dict[str, dict] = {}
    for r in b.get("shots", []):
        for a in (r.get("material") or {}).get("references", []):
            key = (a.get("kind_zh") or a.get("kind") or "") + "|" + (a.get("description") or "")[:40]
            p = seen.setdefault(key, {"name": a.get("kind_zh") or a.get("kind") or "", "note": a.get("description") or "", "shots": []})
            if r["index"] not in p["shots"]:
                p["shots"].append(r["index"])
    return list(seen.values())


def cast(b: dict) -> dict:
    """Merged cast for the report: review > VLM whole-video answer; props fall back to per-shot references.
    Adds `source` ("review" | "vlm" | None) and `face_shots` (shots where a face detector saw people)."""
    rv = b.get("review_cast") or {}
    vl = clean_cast(b.get("whole_video_vlm") or {})
    out = {"characters": rv.get("characters") or vl.get("characters") or [],
           "scenes": rv.get("scenes") or vl.get("scenes") or [],
           "props": rv.get("props") or vl.get("props") or [],
           "style": rv.get("style") or vl.get("style") or "",
           "source": "review" if rv else ("vlm" if vl else None)}
    if not out["props"]:
        out["props"] = _props_from_shots(b)
    if not out["style"]:
        styles = []
        for r in b.get("shots", []):
            st = ((r.get("vlm") or {}).get("style") or "").strip()
            if st and st not in styles:
                styles.append(st)
        out["style"] = semi().join(styles[:2])
    out["face_shots"] = [r["index"] for r in b.get("shots", []) if isinstance(r.get("faces"), (int, float)) and r["faces"] >= 0.3]
    return out


def speaker_label(b: dict, sid: str) -> str:
    """How a separated voice (S1, S2 ...) is called in the report: the name a viewer gave it, else "说话人 N"."""
    for sp in (b.get("speakers") or {}).get("speakers") or []:
        if sp.get("id") == sid:
            return sp.get("name") or T("说话人 {n}", "Speaker {n}", n=sid[1:])
    return ""


def script(b: dict) -> list[dict]:
    """Lines of dialogue / narration with time and speaker, from the whole-video VLM; falls back to segment copy.
    With more than one separated voice, each line also says which voice it is ("voice": S1 ...)."""
    w = b.get("whole_video_vlm") or {}
    who = b.get("speakers") or {}
    turns = who.get("turns") or [] if who.get("count", 0) >= 2 else []
    rows = []
    for ln in ((w.get("narration") or {}).get("lines") or []):
        if isinstance(ln, dict) and _s(ln, "text"):
            rows.append({"start": ln.get("start"), "end": ln.get("end"), "speaker": _s(ln, "speaker", 20), "text": _s(ln, "text", 200)})
            if turns and isinstance(ln.get("start"), (int, float)) and isinstance(ln.get("end"), (int, float)):
                from .speakers import speaker_at

                voice = speaker_at(turns, float(ln["start"]), float(ln["end"]))
                if voice:
                    rows[-1]["voice"] = voice
    if rows:
        return rows
    for ln in ((b.get("speech") or {}).get("lines") or []):  # machine transcript: below the VLM's, above segment copy
        if isinstance(ln, dict) and _s(ln, "text"):
            voice = _s(ln, "speaker", 8) if turns else ""
            rows.append({"start": ln.get("start"), "end": ln.get("end"), "speaker": speaker_label(b, voice) if voice else "",
                         "text": _s(ln, "text", 200), "source": "asr", **({"voice": voice} if voice else {})})
    if rows:
        return rows
    for seg in w.get("segments") or []:
        if isinstance(seg, dict) and _s(seg, "copy"):
            rows.append({"start": seg.get("start"), "end": seg.get("end"), "speaker": "", "text": _s(seg, "copy", 200)})
    return rows


def open_questions(b: dict) -> list[str]:
    """What a reader should verify by eye / ear, collected from every part of the breakdown. Ordered: picture, material, audio, packaging."""
    q: list[str] = []
    s = b.get("summary") or {}
    vlm = (b.get("analysis") or {}).get("vlm") or {}
    status = vlm.get("status") or ("ok" if vlm.get("used") else "off")
    reviewed = ((b.get("analysis") or {}).get("review") or {}).get("shots")
    if s.get("vlm") and status in ("off", "not_configured", "failed") and not reviewed:
        q.append(T("VLM 没有生效（{v}）：实拍 / AI / 3D 的区分只靠信号取证，建议配置多模态模型后加 --vlm 重跑，或由 agent 看图复核",
                   "The VLM did not run ({v}): live action / AI / 3D is decided by signal forensics alone; configure a multimodal model and rerun with --vlm, or have an agent review the frames", v=s["vlm"]))
    for r in b.get("shots", []):
        base = r.get("base") or {}
        tag = T("镜头 #{i}（{a:.1f}–{z:.1f}s）", "Shot #{i} ({a:.1f}–{z:.1f}s)", i=r["index"], a=r["start"], z=r["end"])
        if base.get("disputed"):
            q.append(f"{tag}{T('：', ': ')}{base['disputed']}")
        elif base.get("uncertain"):
            q.append(f"{tag}{T('：', ': ')}{base['uncertain']}")
        elif base.get("confidence", 1) < 0.6:
            alt = sorted((base.get("probs") or {}).items(), key=lambda kv: -kv[1])[:2]
            q.append(tag + T("：{l} 只有 {c:.0%} 置信", ": {l} at only {c:.0%} confidence", l=base.get("label_zh", ""), c=base["confidence"])
                     + (T("，次选 {a}", ", runner-up {a}", a=alt[1][0]) if len(alt) > 1 else ""))
        unsure = sorted({it.get("kind_zh", "") for it in (r.get("material") or {}).get("items", []) if it.get("real_material") is None})
        if unsure:
            q.append(tag + T("：{k} 是真实素材还是生成的，待确认", ": {k}: real material or generated, to confirm", k=join(unsure)))
    if (b.get("audio") or {}).get("has_audio") and not vlm.get("whole_ok"):
        # an image review covers the picture; the soundtrack is only heard by a model that takes video
        fx = bool((b.get("stems") or {}).get("effects"))
        q.append(T("声音没有 AI 听过{r}：人声是真人还是 TTS 是按波形推断的；音效{f}。可以在「声音」里试听分轨和每处音效核对",
                   "No AI listened to the soundtrack{r}: real voice versus TTS is inferred from the waveform; the effects {f}. "
                   "Play the stems and each effect under “Sound” to check",
                   r=T("（复核只看了画面）", " (the review covered the picture only)") if reviewed else "",
                   f=T("是从单独分离出的音效轨里找的，类型是按声音特征估的", "were found on the separated effects track and their types are estimated from the sound")
                   if fx else T("是从混音里按突然变响的点找的，人声的爆破音、配乐的鼓点也可能被算进去", "were picked off the mix where the sound jumps, so plosives and drum hits can be counted too")))
    from .sound_source import MUSIC_ZH, VOICE_ZH

    src = b.get("sound_sources") or {}
    for k, name, names in (("music", T("背景音乐", "music"), MUSIC_ZH), ("voice", T("人声", "voice"), VOICE_ZH)):
        v = src.get(k) or {}
        probs = v.get("probs") or {}
        top = max(probs.values()) if probs else 1.0
        if v and (v.get("source") == "unknown" or top < 0.6):
            lean = v.get("leaning") or (max(probs, key=probs.get) if probs else "")
            q.append(T("{n}来源待确认：更像{s}（{p:.0%}），确认方法见「声音」", "{n} source to confirm: most likely {s} ({p:.0%}); how to check is under “Sound”",
                       n=name, s=names.get(lean, v.get("source_zh", "")), p=top))
    pack = b.get("packaging") or {}
    low = [st for st in pack.get("stickers", []) if not st.get("in_picture") and st.get("confidence") in ("low", "vlm")]
    if low:
        q.append(T("贴纸 / 动图 {n} 处需要看图确认是不是后期贴的（截图在 packaging/）：{ids}",
                   "{n} stickers / GIFs need a look to confirm they were added in post (crops under packaging/): {ids}",
                   n=len(low), ids=join(f"{st['id']} {st['t0']:.1f}s" for st in low[:6])))
    seen: set[str] = set()
    return [x for x in q if not (x in seen or seen.add(x))]
