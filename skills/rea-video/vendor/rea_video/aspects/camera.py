"""Camera: how the camera was held and moved, which lens / device.

Support and movement come from the global-motion fit already computed for every shot (features.motion_summary):
jittery translation = handheld, smooth translation = moving rig or careful handheld, none = fixed. Lens and device
are the image readers' call (perspective distortion, depth of field, picture quality)."""
from __future__ import annotations

from ..i18n import LangDict, T, join, semi

from .base import FILMED, PHOTOGRAPHIC, Aspect, Field, ShotCtx, field_table, register, seen, weighted_mode

SUPPORT = {"handheld_like": "handheld", "smooth_move": "moving", "static": "fixed", "static_with_subject_motion": "fixed",
           "planar_zoom_pan": "fixed"}
SUPPORT_ZH = LangDict({"handheld": "手持", "moving": "移动机位（稳定器/手持平移）", "fixed": "固定机位（三脚架/支架/放在桌上）"},
                      en={"handheld": "handheld", "moving": "moving camera (gimbal / handheld pan)", "fixed": "fixed camera (tripod / mount / on the desk)"})


class Camera(Aspect):
    def __init__(self):
        super().__init__(key="camera", title="机位", title_en="Camera", shot_fields=[
            Field("camera_support", "拍摄方式", "手持自拍（前置镜头）|他人手持|三脚架/支架固定|稳定器|桌面俯拍支架|无法判断", prefer="seen", en="camera support"),
            Field("lens", "镜头", "手机前置广角|手机后置主摄|手机长焦|相机人像/长焦|无法判断（依据：透视变形、背景虚化）", prefer="seen", en="lens"),
            Field("speed", "速度", "正常|慢动作|延时摄影|变速（先快后慢等）|倒放；依据（水花、头发、人流、云的运动）", prefer="seen", en="speed"),
        ], video_fields=[
            Field("setups", "机位/场景", "一共几个场景、几个机位，各拍什么", prefer="seen", en="set-ups / locations"),
            Field("gear_guess", "推测设备", "手机/相机档次、稳定器、麦克风（领夹麦/机顶麦）、补光灯等，写依据", prefer="seen", en="likely gear"),
        ])

    def measure(self, ctx: ShotCtx) -> dict:
        f = ctx.features
        cam = f.get("camera")
        move = None
        z, pan = f.get("zoom_per_s", 0.0) or 0.0, f.get("pan_px_per_s", 0.0) or 0.0
        if abs(z) > 0.01:
            move = T("推", "push-in") if z > 0 else T("拉", "pull-out")
        elif pan > 6:
            move = T("摇/移", "pan / track")
        return {"support": SUPPORT.get(cam), "motion": cam, "move": move,
                "shake": round(float(f.get("sign_flip_rate", 0.0) or 0.0), 3)}

    def interpret(self, shot: dict) -> dict:
        m = ((shot.get("aspects") or {}).get(self.key) or {}).get("measured") or {}
        s = seen(shot, self.key, "camera_support")
        from .vocab import show

        return {"support": m.get("support"), "support_zh": s.get("agent") or s.get("vlm") or SUPPORT_ZH.get(m.get("support")),
                "move": show(m.get("move"))}

    def summarize(self, shots: list[dict], b: dict) -> dict:
        main = [r for r in shots if r["base"]["label"] in FILMED] or [r for r in shots if r["base"]["label"] in PHOTOGRAPHIC]
        if not main:
            return {}
        res = {r["index"]: (r.get("aspects") or {}).get(self.key, {}).get("result") or {} for r in main}
        sup, shares = weighted_mode([(res[r["index"]].get("support"), r["duration"]) for r in main])
        # "mixed" when a second way of holding the camera covers a real part of the video
        second = sorted(shares.items(), key=lambda kv: -kv[1])[1:2]
        support = "mixed" if second and second[0][1] >= 0.3 else sup
        moves, _ = weighted_mode([(res[r["index"]].get("move"), r["duration"]) for r in main])
        text = join(f"{SUPPORT_ZH.get(k, k)} {v:.0%}" for k, v in shares.items())
        lines = [T("机位：{t}", "Camera: {t}", t=text or T("未测出", "not measured")) + (semi() + T("常见运镜 {m}", "typical move {m}", m=moves) if moves else "")]
        return {"result": {"support": support}, "support_shares": shares, "lines": lines,
                "fields": field_table(self, main, b, {"camera_support": SUPPORT_ZH.get(support, T("混合：", "mixed: ") + text) if support else None})}


register(Camera())
