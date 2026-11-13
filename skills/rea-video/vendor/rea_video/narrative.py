"""What each shot is doing in the story: grabbing attention, adding information, delivering the conclusion ...

A remake that only swaps the subject keeps someone else's argument. The narrative line is the part worth keeping:
the order of the steps and what each one is for, to be refilled with the remaker's own cases and material.

Nothing here is measured. A role comes from a reader that followed the whole video: the agent's review
(`review_answers.json`, per shot `narrative`) or the whole-video VLM pass (`segments[].role` / `beat`, matched
to shots by time). The agent's answer wins where both exist.
"""
from __future__ import annotations

from .i18n import LangDict

ROLE_ZH = LangDict({"hook": "抓注意", "context": "交代背景", "info": "补信息", "proof": "给证据", "turn": "转折",
                    "payoff": "给结论", "cta": "引导行动", "mood": "渲染情绪"},
                   en={"hook": "grab attention", "context": "set the scene", "info": "add information", "proof": "show evidence",
                       "turn": "turn", "payoff": "deliver the conclusion", "cta": "call to action", "mood": "set the mood"})
ROLES = tuple(ROLE_ZH)
# one line per role, shared by the VLM prompt and the review instructions so both readers use the same words
ROLE_GUIDE = ("hook 抓注意（开头的悬念、反差、提问、痛点）｜context 交代背景（是谁、在哪、什么情况）｜info 补信息（讲解、步骤、卖点、数据）｜"
              "proof 给证据（案例、对比、演示、前后效果）｜turn 转折（反转、意外、“但是”）｜payoff 给结论（答案、观点、结果揭晓）｜"
              "cta 引导行动（关注、下单、评论）｜mood 渲染情绪（空镜、氛围、过渡，不推进信息）")

_ALIASES = {**{v: k for k, v in ROLE_ZH._zh.items()}, **{v: k for k, v in ROLE_ZH._en.items()},
            "钩子": "hook", "背景": "context", "铺垫": "context", "信息": "info", "证据": "proof", "反转": "turn",
            "结论": "payoff", "conclusion": "payoff", "行动号召": "cta", "情绪": "mood", "过渡": "mood"}


def role_code(v) -> str:
    """A role as answered (code, Chinese or English label, with stray text around it) -> code, or ""."""
    s = str(v or "").strip().lower()
    if s in ROLES:
        return s
    if s in _ALIASES:
        return _ALIASES[s]
    return next((r for r in ROLES if s.startswith(r)), "") or next((c for a, c in _ALIASES.items() if a in s), "")


def clean(v) -> dict | None:
    """One answer ({"role": ..., "point": ...}) to stored form; None when it says nothing."""
    if not isinstance(v, dict):
        return None
    role = role_code(v.get("role"))
    point = " ".join(str(v.get("point") or "").split())[:200]
    return {"role": role, "point": point} if role or point else None


def _from_whole(b: dict, start: float, end: float) -> dict | None:
    best, best_ov = None, 0.0
    for seg in (b.get("whole_video_vlm") or {}).get("segments") or []:
        if not isinstance(seg, dict) or not isinstance(seg.get("start"), (int, float)) or not isinstance(seg.get("end"), (int, float)):
            continue
        ov = min(end, seg["end"]) - max(start, seg["start"])
        if ov > best_ov:
            best, best_ov = seg, ov
    return clean({"role": best.get("role"), "point": best.get("beat")}) if best else None


def shot_roles(b: dict) -> dict[int, dict]:
    """{shot index: {"role", "role_zh", "point", "source"}} for the shots some reader placed in the story."""
    out = {}
    for r in b.get("shots", []):
        got, src = clean((r.get("review") or {}).get("narrative")), "agent"
        if not got:
            got, src = _from_whole(b, r["start"], r["end"]), "vlm"
        if got:
            out[r["index"]] = dict(got, role_zh=ROLE_ZH[got["role"]] if got["role"] else "", source=src)
    return out


def beats(b: dict) -> list[dict]:
    """The narrative line: consecutive shots doing the same job merged into one step, in order."""
    roles = shot_roles(b)
    out: list[dict] = []
    for r in b.get("shots", []):
        n = roles.get(r["index"])
        if not n:
            continue
        last = out[-1] if out else None
        if last and last["role"] == n["role"] and last["shots"][-1] == r["index"] - 1 and (n["role"] or last["points"] == [n["point"]]):
            last["end"] = r["end"]
            last["shots"].append(r["index"])
            if n["point"] and n["point"] not in last["points"]:
                last["points"].append(n["point"])
        else:
            out.append({"start": r["start"], "end": r["end"], "shots": [r["index"]], "role": n["role"], "role_zh": n["role_zh"],
                        "points": [n["point"]] if n["point"] else [], "source": n["source"]})
    return out
