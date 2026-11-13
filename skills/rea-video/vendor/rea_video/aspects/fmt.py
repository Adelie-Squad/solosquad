"""Format: what kind of filmed video this is, so the shooting plan speaks the right language.

  talking_head  a face is the subject of most filmed time and someone speaks (口播 / 访谈 / vlog 自拍)
  desk          no face as the subject, in-focus hands / objects, fixed camera, often shot from above (桌拍 / 教程)
  product       no face as the subject, objects / hands, handheld camera (开箱 / 带货 / 第一视角 POV)
  vlog          people or places, handheld, several places
  other
The image readers' answer to `format` wins when present."""
from __future__ import annotations

from ..i18n import LangDict, T, semi

from .base import FILMED, Aspect, Field, field_table, register, video_seen

FORMAT_ZH = LangDict({"talking_head": "人物口播", "desk": "桌面/物品拍摄（桌拍）", "product": "手持拍物品（开箱/带货/第一视角）",
                      "vlog": "vlog 随拍", "other": "其他实拍"},
                     en={"talking_head": "talking head", "desk": "tabletop / object shoot", "product": "handheld product shots (unboxing / selling / POV)",
                         "vlog": "vlog", "other": "other live footage"})
# camera-angle answers (either language) that mean the camera looks down at a desk
ABOVE_WORDS = ("顶拍", "俯拍", "top-down", "top down", "overhead", "high angle", "high-angle", "bird")


class Format(Aspect):
    def __init__(self):
        super().__init__(key="format", title="形式", title_en="Format", video_fields=[
            Field("format", "视频形式", "单人口播|访谈|桌面俯拍/开箱/教程|vlog 跟拍|商品展示|剧情|无实拍", prefer="seen", en="video format"),
        ])

    def summarize(self, shots: list[dict], b: dict) -> dict:
        filmed = [r for r in shots if r["base"]["label"] in FILMED]
        f_dur = sum(r["duration"] for r in filmed)
        if not filmed or f_dur < 0.2 * (sum(r["duration"] for r in shots) or 1):
            return {}

        def share(pred) -> float:
            return sum(r["duration"] for r in filmed if pred(r)) / f_dur

        def asp(r, k):
            return ((r.get("aspects") or {}).get(k) or {}).get("result") or {}

        face = share(lambda r: asp(r, "framing").get("subject") == "face")
        focus = share(lambda r: asp(r, "framing").get("subject") == "focus")
        from_above = share(lambda r: any(w in (asp(r, "framing").get("camera_angle") or "").lower() for w in ABOVE_WORDS))
        fixed = share(lambda r: asp(r, "camera").get("support") == "fixed")
        handheld = share(lambda r: asp(r, "camera").get("support") in ("handheld", "moving"))
        speech = bool(((b.get("audio") or {}).get("voice") or {}).get("present"))
        positions = ((b.get("aspects") or {}).get("editing") or {}).get("positions") or 1
        if face >= 0.5 and speech:
            kind = "talking_head"
        elif focus >= 0.5 and (from_above >= 0.3 or fixed >= 0.5):
            kind = "desk"
        elif focus >= 0.5 and handheld >= 0.5:
            kind = "product"
        elif handheld >= 0.5 and positions >= 2:
            kind = "vlog"
        else:
            kind = "other"
        seen = video_seen(b, self.key, "format")
        lines = [T("形式：{f}（人脸为主体 {a:.0%}、物品/手为主体 {b:.0%}、手持 {c:.0%}）", "Format: {f} (face as subject {a:.0%}, objects / hands as subject {b:.0%}, handheld {c:.0%})",
                   f=FORMAT_ZH[kind], a=face, b=focus, c=handheld)
                 + (semi() + T("看图判断：{s}", "image readers: {s}", s=seen.get("agent") or seen.get("vlm")) if seen else "")]
        return {"result": {"format": kind}, "shares": {"face": round(face, 3), "focus": round(focus, 3), "from_above": round(from_above, 3),
                                                        "fixed": round(fixed, 3), "handheld": round(handheld, 3)},
                "lines": lines, "fields": field_table(self, filmed, b, {"format": FORMAT_ZH[kind]})}


register(Format())
