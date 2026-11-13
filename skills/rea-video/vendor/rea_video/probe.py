"""Container-level provenance: camera tags, encoder/editor signatures, AIGC labels, C2PA.

Metadata is strong evidence when present (an iPhone make/model tag means camera footage
entered the pipeline; an AIGC label means a generator declared itself) but it is often
stripped by social platforms, so absence proves nothing."""
from __future__ import annotations

from .i18n import LangDict, T

import json
import re
from pathlib import Path

from .media import VideoInfo

# signature -> (category, label). category: generator | editor | renderer | camera | platform
SIGNATURES: list[tuple[str, str, str]] = [
    (r"kling|kuaishou.*ai|可灵", "generator", "Kling"),
    (r"jimeng|dreamina|即梦", "generator", "Jimeng/Dreamina"),
    (r"seedance|doubao.*video", "generator", "Seedance"),
    (r"hailuo|minimax", "generator", "MiniMax/Hailuo"),
    (r"\bveo\b|google.*(deepmind|veo)|synthid", "generator", "Google Veo"),
    (r"\bsora\b|openai", "generator", "OpenAI Sora"),
    (r"runway|gen-?4", "generator", "Runway"),
    (r"pika(?:[ ._-]?(?:labs|art|ai))?(?![a-z])", "generator", "Pika"),
    (r"vidu|shengshu|生数", "generator", "Vidu"),
    (r"pixverse", "generator", "PixVerse"),
    (r"luma|dream ?machine", "generator", "Luma"),
    (r"wanx|tongyi|万相", "generator", "Wan/Tongyi"),
    (r"capcut|剪映|jianying", "editor", "CapCut/剪映"),
    (r"premiere|adobe", "editor", "Adobe"),
    (r"final ?cut|imovie", "editor", "Apple editor"),
    (r"davinci|resolve", "editor", "DaVinci Resolve"),
    (r"remotion", "renderer", "Remotion"),
    (r"blender", "renderer", "Blender"),
    (r"after ?effects", "renderer", "After Effects"),
    (r"motion ?canvas", "renderer", "Motion Canvas"),
    (r"puppeteer|playwright|headless ?chrom", "renderer", "Headless browser"),
    (r"obs ?studio|\bobs\b", "screen", "OBS"),
    (r"screen ?record|屏幕录制|quicktime player", "screen", "Screen recorder"),
    (r"douyin|抖音|bytedance", "platform", "Douyin"),
    (r"Tencent CAPD MTS|\(T-tech\)", "platform", "WeChat transcode"),
    (r"Wxmm_", "platform", "WeChat Channels"),
    (r"\bvid:v[0-9a-z]{8,}", "platform", "Douyin/TikTok"),
    (r"kuaishou|快手", "platform", "Kuaishou"),
    (r"xiaohongshu|小红书", "platform", "Xiaohongshu"),
    (r"ISO Media file produced by Google", "platform", "YouTube"),
]

CAMERA_KEYS = ("com.apple.quicktime.make", "com.apple.quicktime.model", "make", "model", "com.android.manufacturer",
               "com.android.model", "location", "com.apple.quicktime.location.iso6709")
AIGC_KEYS = ("aigc", "ai_generated", "aigc_label", "contentproducer", "produceid")


FREE_TEXT_KEYS = {"title", "description", "comment", "synopsis", "summary", "lyrics", "keywords", "subject", "purl",
                  "artist", "album", "album_artist", "show", "episode_id", "genre", "copyright"}


def _flatten_tags(raw: dict) -> dict[str, str]:
    tags: dict[str, str] = {}
    for k, v in (raw.get("format", {}).get("tags") or {}).items():
        tags[f"format.{k}"] = str(v)
    for i, s in enumerate(raw.get("streams", [])):
        for k, v in (s.get("tags") or {}).items():
            tags[f"stream{i}.{k}"] = str(v)
    return tags


_SKIP_BOXES = {b"mdat", b"free", b"skip", b"wide"}


def _scan_bytes(path: Path, limit: int = 8 << 20) -> bytes:
    """Metadata bytes of an MP4/MOV: every top-level box except mdat (compressed frames contain random
    ASCII like "vEo"). Other containers fall back to the first / last 4 MB."""
    size = path.stat().st_size
    out: list[bytes] = []
    with path.open("rb") as f:
        pos, total, iso = 0, 0, False
        while pos + 8 <= size and total < limit:
            f.seek(pos)
            hdr = f.read(16)
            box_size, kind, head = int.from_bytes(hdr[:4], "big"), hdr[4:8], 8
            if not re.fullmatch(rb"[a-zA-Z0-9 \xa9]{4}", kind):
                break
            if box_size == 1 and len(hdr) >= 16:
                box_size, head = int.from_bytes(hdr[8:16], "big"), 16
            elif box_size == 0:
                box_size = size - pos
            if box_size < head:
                break
            iso = iso or kind == b"ftyp"
            if kind not in _SKIP_BOXES:
                f.seek(pos)
                chunk = f.read(min(box_size, limit - total))
                out.append(chunk)
                total += len(chunk)
            pos += box_size
        if iso:
            return b"".join(out)
        f.seek(0)
        head_bytes = f.read(min(4 << 20, size))
        tail = b""
        if size > 4 << 20:
            f.seek(max(0, size - (4 << 20)))
            tail = f.read(4 << 20)
    return head_bytes + tail


AIGC_LABEL_ZH = LangDict({"1": "属于 AI 生成合成内容", "2": "可能为 AI 生成合成内容", "3": "疑似 AI 生成合成内容"},
                         en={"1": "labelled as AI-generated synthetic content", "2": "possibly AI-generated synthetic content", "3": "suspected AI-generated synthetic content"})


def parse_aigc(value: str) -> dict | None:
    """GB 45438-2025 implicit label, e.g. {"Label": "1", "ContentProducer": "...", "ProduceID": "..."}."""
    try:
        data = json.loads(value)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", value or "")
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except ValueError:
            return None
    if not isinstance(data, dict):
        return None
    label = str(data.get("Label", data.get("label", ""))).strip()
    return {"label": label, "meaning": AIGC_LABEL_ZH.get(label, T("未知取值", "unknown value")),
            "content_producer": data.get("ContentProducer", ""), "produce_id": data.get("ProduceID", ""),
            "content_propagator": data.get("ContentPropagator", ""), "propagate_id": data.get("PropagateID", "")}


def _printable_strings(raw: bytes, min_len: int = 6) -> str:
    return " ".join(m.decode("ascii") for m in re.findall(rb"[\x20-\x7e]{%d,}" % min_len, raw))


def provenance(info: VideoInfo) -> dict:
    path = Path(info.path)
    tags = _flatten_tags(info.raw)
    evidence: list[dict] = []
    hints: dict[str, list[str]] = {"generator": [], "generator_weak": [], "editor": [], "renderer": [], "camera": [], "screen": [], "platform": []}

    lower_tags = {k.lower(): v for k, v in tags.items()}
    aigc = None
    for key, value in lower_tags.items():
        short = key.split(".", 1)[-1]
        if short in CAMERA_KEYS:
            hints["camera"].append(f"{short}={value}")
        if any(a in short for a in AIGC_KEYS) or re.search(r"\baigc\b", value, re.I):
            aigc = parse_aigc(value) or {"label": "", "meaning": T("无法解析", "could not be parsed"), "raw": value[:200]}
            strong = aigc.get("label") in ("1", "2", "3")
            evidence.append({"kind": "aigc_label", "detail": T("AIGC 隐式标识 Label={l}（{m}），生成服务方编码 {p}",
                                                               "Implicit AIGC label Label={l} ({m}), content producer code {p}",
                                                               l=aigc.get('label'), m=aigc.get('meaning'), p=aigc.get('content_producer') or '—'),
                             "weight": "strong" if strong else "weak"})
            if aigc.get("label") == "1":
                hints["generator"].append(T("AIGC 标识（{m}）", "AIGC label ({m})", m=aigc.get('meaning')))

    # tags a tool writes about itself (encoder, handler, software ...) versus text a person typed (title,
    # description, comment ...): a generator named in typed text is what the video is about, not how it was made
    typed = {k for k in tags if k.lower().split(".", 1)[-1] in FREE_TEXT_KEYS}
    blob = " ".join(f"{k}={v}" for k, v in tags.items() if "aigc" not in k.lower() and k not in typed)
    prose = " ".join(tags[k] for k in typed if "aigc" not in k.lower())
    raw_bytes = _scan_bytes(path)
    strings = _printable_strings(raw_bytes)
    for pattern, cat, label in SIGNATURES:
        # a name must start a word: "vidu" is not in "individual", "resolve" not in "unresolved"
        starts = rf"(?<![a-z0-9])(?:{pattern})"
        if re.search(starts, blob, re.I) or (cat != "generator" and re.search(starts, prose, re.I)):
            hints[cat].append(label)
            evidence.append({"kind": f"{cat}_signature", "detail": T("元数据包含 {l}", "Metadata contains {l}", l=label), "weight": "medium"})
        elif cat == "generator" and re.search(starts, prose, re.I):
            # shown in the report only: it moves no score and does not pair with a C2PA manifest
            evidence.append({"kind": "generator_text", "detail": T("标题/描述里提到 {l}", "Title / description mentions {l}", l=label), "weight": "weak"})
        elif cat in ("generator", "renderer", "editor") and re.search(rf"\b(?:{pattern})\b", strings, re.I):
            # weaker: readable string inside container boxes (udta/uuid/xmp); a generator name here is only a hint
            # for the report, it does not move the score (short names like "veo" also occur by chance)
            hints[f"{cat}_weak" if cat == "generator" else cat].append(f"{label}?")
            evidence.append({"kind": f"{cat}_bytes", "detail": T("容器内可读字符串出现 {l}", "Readable string {l} found inside the container", l=label), "weight": "weak"})

    if b"c2pa" in raw_bytes or b"jumb" in raw_bytes:
        # cameras (Pixel, Leica ...) sign C2PA too: only a generator named alongside the manifest counts as AI
        named = hints["generator_weak"]
        evidence.append({"kind": "c2pa", "detail": T("发现 C2PA/JUMBF 内容凭证盒", "C2PA / JUMBF content-credential box found")
                         + (T("（{n}）", " ({n})", n=", ".join(named)) if named else ""), "weight": "strong" if named else "medium"})
        if named:
            hints["generator"].append(T("C2PA 凭证", "C2PA credential") + T("：", ": ") + ", ".join(n.rstrip("?") for n in named))
    if hints["camera"]:
        evidence.append({"kind": "camera_tags", "detail": "; ".join(hints["camera"][:4]), "weight": "strong"})

    encoder = lower_tags.get("format.encoder") or next((v for k, v in lower_tags.items() if k.endswith(".encoder")), "")
    handlers = sorted({v for k, v in lower_tags.items() if k.endswith("handler_name")})
    return {
        "container": info.raw.get("format", {}).get("format_name"),
        "encoder": encoder,
        "handlers": handlers,
        "creation_time": lower_tags.get("format.creation_time", ""),
        "aigc": aigc,
        "hints": {k: sorted(set(v)) for k, v in hints.items() if v},
        "evidence": evidence,
        "tags": tags,
    }
