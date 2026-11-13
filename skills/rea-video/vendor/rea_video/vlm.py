"""OpenAI-compatible multimodal client (Gemini via proxy, Doubao, GPT, Qwen-VL...).

Config (first non-empty wins):
  REA_VLM_BASE_URL / REA_VLM_API_KEY / REA_VLM_MODEL
  VIDEO_ANALYSIS_BASE_URL / VIDEO_ANALYSIS_API_KEY / VIDEO_ANALYSIS_MODEL_NAME   (capsule-cinema)
  GEMINI3_BASE_URL / GEMINI3_API_KEY / GEMINI3_MODEL_NAME                        (capsule-cinema)
REA_VLM_MODEL may be a comma-separated fallback list.
REA_VLM_MEDIA = both | video | frames  (default both: a short clip as data:video/mp4 plus keyframes)
REA_VLM_VIDEO_PART = image_url | video_url  (how a clip is attached; unset: image_url, switching to video_url by
                     itself when the endpoint refuses the first form, as DashScope does)
REA_VLM_REASONING_EFFORT = low | medium | high  (passed through when set; thinking models answer these prompts
                     several times faster and cheaper on low)
"""
from __future__ import annotations

import base64
import copy
import hashlib
import http.client
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from . import __version__
from .classify import LABELS
from .util import LOG


@dataclass
class VLMConfig:
    base_url: str
    api_key: str
    models: list[str]
    timeout: float = 180.0
    media: str = "both"
    video_part: str = ""  # "" = find out: image_url first, video_url if that is refused
    reasoning_effort: str = ""

    @classmethod
    def from_env(cls) -> "VLMConfig | None":
        """First complete config wins; later configs on the same endpoint and key add their
        models as fallbacks (capsule-cinema keeps one model in VIDEO_ANALYSIS_* and a list in GEMINI3_*).
        A malformed value raises ValueError naming the variable: a typo must fail fast here, not
        silently run the VLM with no media (bad REA_VLM_MEDIA) or crash mid-run (bad timeout)."""
        cfg: VLMConfig | None = None
        for prefix, mkey in (("REA_VLM", "REA_VLM_MODEL"), ("VIDEO_ANALYSIS", "VIDEO_ANALYSIS_MODEL_NAME"), ("GEMINI3", "GEMINI3_MODEL_NAME")):
            base, key = os.getenv(f"{prefix}_BASE_URL", "").rstrip("/"), os.getenv(f"{prefix}_API_KEY", "")
            models = [m.strip() for m in os.getenv(mkey, "").split(",") if m.strip()]
            if not (base and key and models):
                continue
            if cfg is None:
                cfg = cls(base_url=base, api_key=key, models=models,
                          timeout=_timeout_from_env(), media=_media_from_env(),
                          video_part=_video_part_from_env(), reasoning_effort=_effort_from_env())
            elif prefix != "REA_VLM" and base == cfg.base_url and key == cfg.api_key:
                cfg.models += [m for m in models if m not in cfg.models]
        return cfg

    def describe(self) -> str:
        host = re.sub(r"^https?://", "", self.base_url).split("/")[0].rsplit("@", 1)[-1]  # 去掉 user:pass@
        return f"{','.join(self.models)} @ {host}"


def _timeout_from_env() -> float:
    var = "REA_VLM_TIMEOUT" if os.getenv("REA_VLM_TIMEOUT") is not None else "VIDEO_ANALYSIS_TIMEOUT_SECONDS"
    raw = os.getenv(var, "180")
    try:
        timeout = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{var} must be seconds (a number), got {raw!r}") from None
    if not timeout > 0:
        raise ValueError(f"{var} must be more than 0 seconds, got {raw!r}")
    return timeout


def _media_from_env() -> str:
    media = os.getenv("REA_VLM_MEDIA", "both")
    if media not in ("both", "video", "frames"):
        raise ValueError(f"REA_VLM_MEDIA must be both, video or frames, got {media!r}")
    return media


def _video_part_from_env() -> str:
    part = os.getenv("REA_VLM_VIDEO_PART", "").strip().lower()
    if part and part not in ("image_url", "video_url"):
        raise ValueError(f"REA_VLM_VIDEO_PART must be image_url or video_url, got {part!r}")
    return part


def _effort_from_env() -> str:
    effort = os.getenv("REA_VLM_REASONING_EFFORT", "").strip().lower()
    if effort and effort not in ("low", "medium", "high"):
        raise ValueError(f"REA_VLM_REASONING_EFFORT must be low, medium or high, got {effort!r}")
    return effort


SETUP_HINT = ("建议配置 VLM（任意 OpenAI 兼容的多模态模型，如 Gemini / GPT-4o / 豆包 / Qwen-VL）："
              "设置 REA_VLM_BASE_URL、REA_VLM_API_KEY、REA_VLM_MODEL（可写多个模型逗号分隔做备选），再加 --vlm 重跑")
SETUP_HINT_EN = ("configure a VLM (any OpenAI-compatible multimodal model, e.g. Gemini / GPT-4o / Doubao / Qwen-VL): "
                 "set REA_VLM_BASE_URL, REA_VLM_API_KEY and REA_VLM_MODEL (several models comma-separated as fallbacks), then rerun with --vlm")


def vlm_note(info: dict, review: dict | None = None) -> str:
    """One line for reports / summaries: did the VLM (or an agent's review) actually contribute, and what to do if not."""
    from .i18n import T, semi

    base = _vlm_note(info)
    if review and review.get("shots"):
        seen = T("由 {by} 看图复核 {n}/{of} 个镜头，已并入结论", "{by} reviewed {n}/{of} shots by eye; merged into the verdict",
                 by=review.get("by", "agent"), n=review["shots"], of=review.get("of", "?"))
        return seen if (info.get("status") or "off") == "off" else f"{base.split(semi())[0]}{semi()}{seen}"
    return base


def _vlm_note(info: dict) -> str:
    from .i18n import T

    status = info.get("status") or ("ok" if info.get("used") else "off")
    asked, total = info.get("asked_shots", 0), info.get("total_shots", 0)
    # more shots than the call cap: the rest never went to the VLM, which "active" alone would hide
    capped = T("；只送了 {a}/{n} 个镜头，其余只靠确定性取证（--max-vlm-shots 可调）",
               "; only {a}/{n} shots were sent, the rest rely on deterministic forensics (raise --max-vlm-shots)", a=asked, n=total) if 0 < asked < total else ""
    if status == "ok":
        return T("VLM 已生效（{m}）", "VLM active ({m})", m=info.get("model", "")) + capped
    if status == "partial":
        return T("VLM 部分生效（{m}：{ok}/{asked} 个镜头有结果，整片分析{w}）；失败的镜头只靠确定性取证",
                 "VLM partly active ({m}: {ok}/{asked} shots answered, whole-video pass {w}); failed shots rely on deterministic forensics only",
                 m=info.get("model", ""), ok=info.get("ok_shots", 0), asked=info.get("asked_shots", 0),
                 w=(T("有", "succeeded") if info.get("whole_ok") else T("失败", "failed"))) + capped
    limited = T("实拍/AI/3D 的区分只靠像素统计，可信度有限", "live action / AI / 3D are told apart from pixel statistics only, so confidence is limited")
    if status == "failed":
        err = (info.get("errors") or [""])[0]
        return T("VLM 已请求但全部调用失败（{m}：{e}），本次等同未开 VLM；{l}。可稍后重试或换模型",
                 "VLM requested but every call failed ({m}: {e}), so this run is the same as no VLM; {l}. Retry later or switch models",
                 m=info.get("model", ""), e=err[:80], l=limited)
    if status == "not_configured":
        return T("VLM 已请求但没找到配置，本次未开 VLM；{l}。{h}", "VLM requested but no configuration found, so this run had no VLM; {l}. {h}", l=limited, h=T(SETUP_HINT, SETUP_HINT_EN))
    return T("未开 VLM；{l}。能看图的 agent：运行 rea-video review 逐镜看图并 apply-review 并入；否则{h}",
             "No VLM; {l}. An agent that can see images: run rea-video review, look at each shot and merge with apply-review; otherwise {h}", l=limited, h=T(SETUP_HINT, SETUP_HINT_EN))


def _data_uri(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("no JSON object in VLM response")
    out = json.loads(m.group(0))
    if not isinstance(out, dict):
        raise ValueError("VLM answer is not a JSON object")
    return out


class VLMClient:
    # after this many requests in a row fail on every model, stop calling the service for this run
    MAX_DEAD_REQUESTS = 2
    REQUEST_ERRORS = (400, 413, 415, 422)  # the endpoint rejects this request's content, not the service being down

    def __init__(self, cfg: VLMConfig, cache_dir: Path | None = None):
        self.cfg = cfg
        self.cache_dir = cache_dir
        self.dead_requests = 0
        self.models = list(cfg.models)  # reordered: the last model that answered goes first
        self.video_part = cfg.video_part if cfg.video_part in ("image_url", "video_url") else "image_url"
        self._part_settled = cfg.video_part in ("image_url", "video_url")  # set by the user, or learned from an answer / a second refusal
        self._lock = threading.Lock()
        host = re.sub(r"^https?://", "", cfg.base_url).split("/")[0].rsplit("@", 1)[-1].split(":")[0]
        if cfg.base_url.lower().startswith("http://") and host not in ("localhost", "127.0.0.1", "::1", "[::1]"):
            LOG.warning("REA_VLM_BASE_URL 不是 https，API key 会明文发送到 %s", host)
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    @property
    def gave_up(self) -> bool:
        return self.dead_requests >= self.MAX_DEAD_REQUESTS

    def _post(self, model: str, content: list[dict], max_tokens: int) -> str:
        body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}],
                           "max_tokens": max_tokens, "temperature": 0.2,
                           **({"reasoning_effort": self.cfg.reasoning_effort} if self.cfg.reasoning_effort else {})}).encode()
        # urllib's default "Python-urllib/x.y" gets a 403 from some gateways, which looks like a bad key
        req = urllib.request.Request(self.cfg.base_url + "/chat/completions", data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.cfg.api_key}",
                                              "User-Agent": f"rea-video/{__version__}"})
        with urllib.request.urlopen(req, timeout=self.cfg.timeout) as resp:
            data = json.loads(resp.read().decode())
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:  # e.g. "choices": [] after a safety block -> try the next model
            raise ValueError(f"no answer in VLM response: {str(data)[:160]}") from exc
        if isinstance(content, list):  # some gateways return content parts
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        if not isinstance(content, str) or not content.strip():
            raise ValueError("empty VLM answer")
        return content

    def ask_json(self, prompt: str, media: list[tuple[Path, str]], max_tokens: int = 4096) -> dict:
        # Use the configured order, not self.models: successful fallbacks reorder
        # the latter during a run. Never include the API key in the cache identity.
        request = {"prompt": prompt, "base_url": self.cfg.base_url.rstrip("/"),
                   "models": self.cfg.models, "max_tokens": max_tokens,
                   **({"reasoning_effort": self.cfg.reasoning_effort} if self.cfg.reasoning_effort else {})}
        h = hashlib.sha1(json.dumps(request, sort_keys=True, ensure_ascii=False).encode())
        for p, mime in media:
            h.update(mime.encode())
            h.update(hashlib.sha1(p.read_bytes()).digest())
        key = h.hexdigest()
        cached = self.cache_dir / f"{key}.json" if self.cache_dir else None
        if cached and cached.is_file():
            try:
                got = json.loads(cached.read_text(encoding="utf-8"))
                if isinstance(got, dict):
                    return got
            except (OSError, ValueError):
                pass  # a half-written file from an interrupted run: ask again
        if self.gave_up:
            raise RuntimeError("VLM skipped: service failed on every model for earlier requests")
        has_video = any(mime.startswith("video/") for _, mime in media)
        part = self.video_part
        swapped = False

        def build(video_part: str) -> list[dict]:
            parts = [{"type": video_part, video_part: {"url": _data_uri(p, mime)}} if mime.startswith("video/")
                     else {"type": "image_url", "image_url": {"url": _data_uri(p, mime)}} for p, mime in media]
            return parts + [{"type": "text", "text": prompt}]

        content = build(part)
        last: Exception | None = None
        refused = False
        for model in list(self.models):
            for attempt in range(2):
                try:
                    t = time.time()
                    text = self._post(model, content, max_tokens)
                    out = parse_json(text)
                    out["_model"] = model
                    out["_seconds"] = round(time.time() - t, 1)
                    if cached:
                        tmp = cached.with_name(f"{cached.name}.{os.getpid()}.{threading.get_ident()}.part")
                        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
                        tmp.replace(cached)
                    with self._lock:  # shots run in a thread pool
                        self.dead_requests = 0
                        if has_video:
                            self.video_part, self._part_settled = part, True
                        if model in self.models and self.models[0] != model:
                            self.models.remove(model)
                            self.models.insert(0, model)
                    return out
                except urllib.error.HTTPError as exc:
                    try:
                        why = exc.read()[:300].decode(errors="ignore").strip()
                    except Exception:
                        why = ""
                    last = RuntimeError(f"HTTP {exc.code} {exc.reason}: {why}" if why else f"HTTP {exc.code} {exc.reason}")
                    LOG.warning("VLM %s attempt %d failed: %s", model, attempt + 1, str(last)[:200])
                    if exc.code in self.REQUEST_ERRORS:
                        if has_video and not self._part_settled and not swapped:
                            # some endpoints take a clip only as a video_url part: try that form once
                            part, swapped = "video_url", True
                            content = build(part)
                            continue
                        if swapped:  # refused both ways: this endpoint does not take clips, stop trying the other form
                            with self._lock:
                                self._part_settled = True
                        # this request is what the endpoint refuses (too large, video not accepted): the same
                        # bytes will not pass a second time, and other shots are not affected
                        refused = True
                        break
                    if exc.code == 429:
                        try:
                            wait = float(exc.headers.get("Retry-After") or 5)
                        except (TypeError, ValueError):
                            wait = 5.0
                        time.sleep(min(max(wait, 1.0), 30.0))
                    elif 400 <= exc.code < 500 and exc.code != 408:
                        break  # bad key, unknown model: retrying this model changes nothing, the next one may answer
                    else:
                        time.sleep(1.5)
                except (OSError, http.client.HTTPException, ValueError, KeyError) as exc:
                    last = exc
                    LOG.warning("VLM %s attempt %d failed: %s", model, attempt + 1, str(exc)[:200])
                    time.sleep(1.5)
        if not refused and not isinstance(last, (ValueError, KeyError)):  # transport/server errors, not a bad answer
            with self._lock:
                self.dead_requests += 1
        raise RuntimeError(f"all VLM models failed: {last}")


SHOT_PROMPT = """你是视频制作逆向工程专家。判断这个镜头的「底层画面」是用什么方式制作的，并给出可复刻的描述。
只依据你在画面里看到的证据；不确定时如实给出概率分布。

底层画面类别（label_probs 的 key，概率和为 1）：
- live_action：真实摄像机/手机实拍（真实人物与环境、真实光影与物理、传感器噪声、手持抖动、对焦呼吸、运动模糊自然）
- ai_video：AI 生成视频（文生/图生/参考生视频）。常见破绽：物体或手指形变、纹理"沸腾"闪烁、物理不合理、文字乱码、背景人物畸形、过于完美的光线与皮肤、动作缓慢漂浮、镜头结尾定格
- avatar：数字人口播（一张人像被音频驱动说话，嘴型驱动、头部轻微摆动、身体几乎不动）
- cg_3d：传统 3D 渲染（Blender/C4D/UE），几何干净、材质规则、光影一致、运动精确无形变
- code_render：代码/模板渲染的画面（MG 动效、文字排版、UI、图表、PPT 式卡片、渐变/毛玻璃/霓虹辉光背景、分形和着色器生成的色场，以及暗底上的粒子/点云/线框数据可视化：Remotion/HTML/Canvas、Three.js、Manim、AE Plexus/Trapcode 这类按参数生成的图形）
- screen_capture：屏幕录制或网页/应用截图（真实界面元素、光标、滚动）
- still_motion：一张静态图片做推拉摇移（Ken Burns），画面内部无独立运动
- static_hold：静帧定格（图片或卡片停留不动）
- anim_2d：2D 动画（手绘逐帧、Live2D、AE/Spine 角色动画、扁平插画风动画）：线条和平涂色块、角色有骨骼或逐帧动作，常见"一拍二"（每两帧才变一次）
- stop_motion：定格动画（黏土、毛毡、纸偶、乐高等实物逐帧拍摄）：真实材质和灯光、动作一顿一顿、帧间轻微闪烁、指纹和纹理细节
- film_footage：剪进来的已有影视作品画面（电影、电视剧、网剧、竖屏短剧的片段，影视解说、混剪、名场面合集常见）：认得出的演员或剧集、专业剧组的布光和多机位、大量群演和成套布景、片头片尾字幕、台标或平台水印、嵌在黑边里的宽画幅

如果画面是实拍或写实画面，再拆「怎么拍、怎么打光」（aspects 里各项），纯图形/文字/界面画面这些字段写"不适用"。

另外判断画面里有没有「引入的真实素材」：实拍片段、真实照片、商品实拍图、品牌 Logo、网页/App 截图或录屏。
请在 embedded_assets 里逐个列出。注意两种情况不同：画面本身由 AI 生成 / 3D 建模 / 实拍时，里面出现的商品、Logo、人物
只是复刻要准备的参考（照样列出，系统会归为「参考素材」）；只有贴进版式里的录屏、截图、照片、视频片段才是真实像素。

注意区分：卡通/3D 风格的 AI 视频（形变、闪烁、不精确）与真正的 3D 渲染（几何稳定、精确）；
AI 生成的写实视频与实拍（看手、文字、背景细节、物理）；AI 生成的动画风视频（形变、线条游移）与真正的 2D 动画（线条稳定、按帧精确）；
AI 仿定格风格（材质在帧间漂移）与真正的定格动画（同一实物、光照不变、只有逐帧位移）；
影视片段（剪自已有的电影/电视剧/短剧：live_action 只用于视频作者或客户自己拍的画面）与 AI 短剧（脸过于完美且千人一面、手和文字出错、群演和背景稀少、物体形变）；"影视效果""剧情需要"这类免责声明在 AI 短剧解说里也常见，不能单独作为影视片段的证据；
暗底发光粒子拼成的器官、人体、地球、分子等科普画面是代码渲染（粒子系统），不是 3D 实体模型，也不是 AI 视频或实拍：亮部由成千上万个点或细线组成、没有连续的明暗表面，常配 HUD 式章节牌和引线标注。
代码绘制的画面没有材质纹理：大面积平滑渐变、纯色块、辉光、毛玻璃卡片、CSS 3D 翻转卡片都是代码渲染，不是 3D 渲染（3D 渲染有布料/木纹/金属等材质、有投影和物体间的光影关系）；分形缩放、plasma 之类彩虹色场是着色器生成，不是实拍或 AI 视频。

实拍（或定格）画面如果被 AI 二次加工过，在 ai_edits 里逐个列出：换脸、对口型/改台词、整段风格化重绘、AI 换装、抠像换背景/绿幕、
加删换物体、美颜瘦脸。依据要写看得到的破绽（脸部边缘、嘴型和下巴不跟、头发与背景交界、光线不一致）。没有就写 []。

确定性分析给出的参考信号（可能有误，以画面为准）：
{hints}

只返回 JSON，不要任何其他文字：
{{
  "label_probs": {{"live_action": 0, "ai_video": 0, "avatar": 0, "cg_3d": 0, "code_render": 0, "screen_capture": 0, "still_motion": 0, "static_hold": 0, "anim_2d": 0, "stop_motion": 0, "film_footage": 0}},
  "image_source": "ai_image|photo|graphic|screenshot|unknown",
  "evidence": ["具体可见证据，尽量指明位置/时间"],
  "generator_guess": "可能的生成模型或工具（如 Seedance/Kling/Veo/Hailuo/Blender/Remotion/剪映 模板），无法判断写 unknown",
  "description": "镜头内容：主体、动作、场景、景别、运镜、光线；代码渲染画面写清图形元素是什么（粒子/渐变/图表/卡片/文字/矢量图形）、拼成什么形状、颜色、怎么动（进场方式、流向、变形、镜头推/环绕）、文字和数字组件在哪",
  "shot_size": "特写|近景|中景|全景|远景",
  "camera_move": "固定|推|拉|摇|移|跟|环绕|手持",
  "style": "画风/质感关键词",
  "overlay_text": ["后期叠加在画面上的文字（字幕/标题），不含场景里的实物文字"],
  "aspects": <<SHOT_ASPECTS>>,
  "material_origin": "real|ai_generated|rendered|mixed（画面主要来自真实素材 / AI 生成 / 制作方渲染 / 混合）",
  "embedded_assets": [{{"kind": "real_footage|photo|screenshot|screen_recording|product_photo|logo|ai_image", "description": "是什么、在画面哪里", "is_real_material": true}}],
  "ai_edits": [{{"kind": "face_swap|lip_sync|restyle|outfit_swap|bg_replace|object_edit|beautify", "evidence": "看到的破绽"}}],
  "replication": {{
    "image_prompt": "复刻首帧的中文图像提示词（主体、构图、光线、风格，具体可执行）",
    "video_prompt": "复刻该镜头的中文视频提示词：写清动作过程和结束状态、运镜；只写想要的内容，不写否定句",
    "video_prompt_en": "same video prompt in English"
  }}
}}"""


# appended to SHOT_PROMPT when one clip covers several jump-cut pieces of the same take
TAKE_NOTE = """
这段片子是同一机位、同一条素材剪成的 {n} 段（跳剪），后面几段从片段开头后 {cuts} 秒开始。
制作方式、拍法和素材（label_probs、aspects、embedded_assets 等）对整段给一次即可；
另外加一个 segments 数组，按顺序给每一段的内容，共 {n} 项：
"segments": [{{"description": "这一段的主体、动作和结束状态", "replication": {{"video_prompt": "复刻这一段的中文视频提示词", "video_prompt_en": "same in English"}}}}]
"""


def take_results(raw: dict, n: int) -> list[dict]:
    """Split one answer about a jump-cut take into per-piece answers: the shared verdict, with each piece's own
    description and video prompt when the model gave one per piece."""
    segs = raw.pop("segments", None)
    segs = segs if isinstance(segs, list) and len(segs) == n else [None] * n
    out = []
    for seg in segs:
        r = copy.deepcopy(raw)
        if isinstance(seg, dict):
            if isinstance(seg.get("description"), str) and seg["description"].strip():
                r["description"] = seg["description"]
            rep = seg.get("replication")
            if isinstance(rep, dict):
                r["replication"] = {**(r.get("replication") or {}), **{k: v for k, v in rep.items() if isinstance(v, str) and v.strip()}}
        out.append(r)
    return out


WHOLE_PROMPT = """你是短视频拆解专家。完整观看并**仔细收听**这条视频，拆解它的结构、文案、声音与整体制作方式。
声音要拆到可以复刻：旁白是真人还是 TTS、音色；背景音乐的风格/情绪/节奏/是否 AI 生成或知名歌曲；
判断音乐来源时结合视频形式：AI 音乐 MV（整片一首歌、歌词唱的就是画面内容）大概率是 AI 生成的歌；普通视频的垫底配乐大概率是现成曲库；
能认出歌名就写出来；lyrics_match_content 表示歌词是否在唱这条视频的具体内容/角色/商品。
每一个音效出现的时间点、类型，以及它对应画面上的什么事件。
剪辑包装要拆全：字幕之外的花字、标题、章节牌、标签（含跟着物体走的标注）逐个列出时间、样式和动画；
后期贴上去的表情包、GIF 动图、emoji、贴纸、画中画小窗、箭头圈注逐个列出出现/消失时间和位置（画面本身的内容不算）。
角色要跨镜头认成同一个：给每个主要角色（人、动物、卡通形象、数字人、作为主角的商品）一个编号，外观写到能据此把同一个角色再画出来；场景同理（同一地点不同机位算一个场景）；道具 / 商品 / Logo 单独列。
结构要拆出叙事线：segments 每一段除了写 beat（这一段在讲什么，一句话），还要在 role 里选它在叙事上的作用：
<<NARRATIVE_ROLES>>
已检测到的镜头切分（秒，按顺序即镜头 #1、#2…）：{shots}

只返回 JSON：
{{
  "summary": "一句话概括",
  "format": "口播|剧情|商品展示|知识讲解|MV|混剪|影视解说|其他",
  "hook": "开头 3 秒如何抓人",
  "highlights": ["这条视频能火 / 能卖货的关键做法，2–4 条，每条写手法 + 在哪一秒 + 为什么有效，不写空话"],
  "segments": [{{"start": 0.0, "end": 3.0, "role": "<<NARRATIVE_ENUM>>", "beat": "这一段在讲什么（一句话，换个题材也能照着写的那种）", "copy": "这一段的旁白/字幕文案", "audio": "人声/音乐/音效"}}],
  "narration": {{"type": "tts|human|none|mixed", "voice": "性别/年龄感/音色", "style": "语速、情绪、口癖", "language": "zh|en|...",
                 "lines": [{{"start": 0.0, "end": 2.0, "speaker": "角色编号或 旁白", "text": "台词/旁白原文"}}]}},
  "music": {{"present": true, "segments": [{{"start": 0.0, "end": 10.0}}], "style": "风格", "genre": "流派", "mood": "情绪",
            "instruments": ["主要乐器"], "bpm_estimate": 0, "has_vocals": false,
            "source_guess": "ai_generated|stock_library|popular_song|original|unknown", "song_guess": "若是知名歌曲写歌名，否则空",
            "lyrics_excerpt": "若有人声演唱，摘几句歌词", "lyrics_match_content": false,
            "ending": "natural_end|fade_out|hard_cut",
            "beat_synced_cuts": false}},
  "sfx": [{{"t": 0.0, "type": "whoosh|pop|ding|click|typing|impact|laugh|applause|notification|cash|other", "description": "听到的声音",
           "sync_with": "cut|text_pop|action|transition|none"}}],
  "ambience": "环境声（街道、室内、无）",
  "mix": "人声/BGM/音效的音量关系，是否有人声出现时压低音乐（ducking）",
  "subtitles": {{"present": true, "style": "字体/描边/颜色/位置/逐字高亮等"}},
  "text_effects": [{{"t": 0.0, "text": "花字/标题/标签上的字", "kind": "花字|标题|章节牌|标签|弹幕", "style": "字体、颜色、描边、底框、大小",
                    "animation": "弹出/缩放/抖动/打字机/逐字高亮/滑入/无"}}],
  "stickers": [{{"t0": 0.0, "t1": 1.0, "what": "表情包/GIF 动图/emoji/静态贴纸/画中画小窗/箭头圈注", "where": "画面位置",
                "description": "贴的是什么", "animated": true}}],
  "style": "整体视觉风格与调色：画风、质感、色调、可参照的风格（如皮克斯 / 胶片感 / ins 风）",
  "characters": [{{"id": "A", "name": "称呼（角色名 / 商品名 / 主播 / 旁白者）", "kind": "person|animal|cartoon|avatar|product|other",
                  "look": "外观：体型、发型或毛色、服装、配饰、标志性特征", "role": "在视频里的作用（主角 / 配角 / 被介绍的商品 / 旁白）",
                  "voice": "有台词时的音色，没有留空", "shots": [1, 2]}}],
  "scenes": [{{"id": "S1", "where": "地点 / 环境", "when": "白天|夜晚|室内|不明", "look": "布景、色调、光线", "shots": [1, 2]}}],
  "props": [{{"name": "道具 / 商品 / Logo / 文件", "note": "出现在哪、起什么作用", "shots": [1]}}],
  "aspects": <<VIDEO_ASPECTS>>,
  "overall_production": "整体制作方式判断（实拍/AI生成/代码渲染/混合）与理由",
  "warnings": []
}}"""


from .aspects import prompt_block as _aspect_block  # noqa: E402
from .narrative import ROLE_GUIDE as _ROLE_GUIDE, ROLES as _ROLES  # noqa: E402

WHOLE_PROMPT = WHOLE_PROMPT.replace("<<NARRATIVE_ROLES>>", _ROLE_GUIDE).replace("<<NARRATIVE_ENUM>>", "|".join(_ROLES))

SHOT_PROMPT = SHOT_PROMPT.replace("<<SHOT_ASPECTS>>", _aspect_block(video=False))
WHOLE_PROMPT = WHOLE_PROMPT.replace("<<VIDEO_ASPECTS>>", _aspect_block(video=True))


def shot_hints(features: dict, facts: dict, det_top: str, det_prob: float) -> str:
    keys = ["noise_sigma", "temporal_noise", "flat_ratio", "palette95", "dup_ratio", "camera", "kenburns_score", "local_motion_ratio"]
    parts = [f"{k}={features.get(k):.3g}" if isinstance(features.get(k), float) else f"{k}={features.get(k)}" for k in keys]
    parts.append(f"temporal_family={facts.get('temporal_family')}, pulldown={facts.get('pulldown')}, graphic_score={facts.get('graphic_score')}, fine_dark={facts.get('fine_dark')}, vector_fill={facts.get('vector_fill')}")
    parts.append(f"确定性初判={det_top} ({det_prob:.0%})")
    return "; ".join(parts)


def _sec(v) -> float | None:
    """0.5 / "0.5" / "00:03" / "1:02.5" -> seconds; anything else -> None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v else None
    if isinstance(v, str):
        try:
            parts = [float(x) for x in v.strip().rstrip("s").split(":")]
        except ValueError:
            return None
        if 1 <= len(parts) <= 3:
            return sum(x * 60 ** i for i, x in enumerate(reversed(parts)))
    return None


_TIME_KEYS = ("t", "t0", "t1", "start", "end")


def _items(v) -> list[dict]:
    """A list of dicts with clean time fields (bad times dropped, not crashing consumers)."""
    out = []
    for e in v if isinstance(v, list) else []:
        if not isinstance(e, dict):
            continue
        e = dict(e)
        for k in _TIME_KEYS:
            if k in e:
                sec = _sec(e[k])
                if sec is None:
                    del e[k]
                else:
                    e[k] = sec
        out.append(e)
    return out


def normalize_whole(raw) -> dict | None:
    """Coerce the whole-video answer to the shape WHOLE_PROMPT asks for, so one malformed field (a model answering
    "narration": "none", or "t": "00:03") cannot crash finalize -- and keep crashing, since the answer is cached."""
    if not isinstance(raw, dict):
        return None
    w = dict(raw)
    for k in ("narration", "music", "subtitles", "aspects"):
        if k in w and not isinstance(w[k], dict):
            del w[k]
    for k in ("segments", "sfx", "text_effects", "stickers", "characters", "scenes", "props"):
        if k in w:
            w[k] = _items(w[k])
    for k, sub in (("narration", "lines"), ("music", "segments")):
        if k in w and sub in w[k]:
            w[k] = dict(w[k], **{sub: _items(w[k][sub])})
    for k in ("summary", "format", "hook", "ambience", "mix", "style", "overall_production"):
        if k in w and w[k] is not None and not isinstance(w[k], str):
            w[k] = str(w[k])
    if "highlights" in w:
        h = w["highlights"] if isinstance(w["highlights"], list) else [w["highlights"]]
        w["highlights"] = [str(x) for x in h if isinstance(x, (str, int, float)) and str(x).strip()][:5]
    if "warnings" in w and not isinstance(w["warnings"], list):
        w["warnings"] = [str(w["warnings"])] if w["warnings"] else []
    return w


def normalize_shot_result(raw: dict) -> dict:
    probs = raw.get("label_probs")
    probs = probs if isinstance(probs, dict) else {}
    ev = raw.get("evidence")
    if isinstance(ev, str):  # a bare string would otherwise be listed one character per line
        raw["evidence"] = [ev] if ev.strip() else []
    elif not isinstance(ev, list):
        raw["evidence"] = []
    clean = {}
    for k in LABELS:
        try:
            clean[k] = max(0.0, float(probs.get(k, 0.0)))
        except (TypeError, ValueError):
            clean[k] = 0.0
    total = sum(clean.values()) or 1.0
    raw["label_probs"] = {k: v / total for k, v in clean.items()}
    # the answer is cached, so a wrong type here would break the report on every later run, not only this one
    for k in _SHOT_TEXT:
        if k in raw and not isinstance(raw[k], str):
            raw[k] = _text(raw[k])
    for k in ("embedded_assets", "ai_edits", "segments"):
        if k in raw:
            raw[k] = [e for e in raw[k] if isinstance(e, dict)] if isinstance(raw[k], list) else []
    if "overlay_text" in raw:
        v = raw["overlay_text"]
        raw["overlay_text"] = [_text(e) for e in (v if isinstance(v, list) else [v]) if e not in (None, "", [], {})]
    for k in ("aspects", "replication"):
        if k in raw and not isinstance(raw[k], dict):
            del raw[k]
    if "replication" in raw:
        raw["replication"] = {k: v if isinstance(v, str) else _text(v) for k, v in raw["replication"].items()}
    return raw


_SHOT_TEXT = ("description", "style", "generator_guess", "image_source", "shot_size", "camera_move", "material_origin")


def _text(v) -> str:
    """A model's stray list / number / null where a sentence was asked for, as one string."""
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return "；".join(_text(e) for e in v if e not in (None, ""))
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


def prompt_lang_note() -> str:
    """Appended to SHOT_PROMPT / WHOLE_PROMPT: free-text answers follow the report language (enum values stay as given)."""
    from .i18n import lang

    if lang() == "en":
        return ("\n\nWrite every free-text value (evidence, description, style, summary, copy, prompts, aspects answers) in English. "
                "Keep enum values exactly as listed. `image_prompt` and `video_prompt` in English; `video_prompt_en` may repeat it.")
    return ""
