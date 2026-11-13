"""What the tool remembers across runs: user preferences and user corrections.

Stored as plain files in $REA_VIDEO_HOME (default ~/.rea-video):
  prefs.json        default flags (engine, vlm, env_file, stems, reviewer) and free-text notes for agents
  corrections.jsonl one line per correction: what the tools / VLM / agent said, what the user says is right

Corrections are used in three ways and never silently change the classifier weights:
  1. applied to that video at once, and again whenever the same file is decomposed later;
  2. shown as hints in review tasks and `summary` ("users often correct cg_3d -> ai_video");
  3. exported as eval labels (`rea-video memory --export-labels`), so rule changes are measured on them.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .classify import LABEL_ZH, LABELS, top
from .i18n import T, semi
from .util import ASR_LANGS, OCR_LANGS

PREF_KEYS = {
    "engine": "复刻计划默认的视频引擎（decompose / remake-plan 的 --engine）",
    "vlm": "decompose 是否默认开 VLM：on / off",
    "env_file": "默认的 VLM 配置文件（等同每次加 --env-file）",
    "stems": "decompose 是否默认做人声/配乐分离：on / off",
    "reviewer": "apply-review 默认的复核者名字",
    "ocr_lang": "字幕/花字 OCR 的语言：zh（中英，默认）/ ja（日文，首次使用自动下载约 10 MB 识别模型）",
    "asr_lang": "本地语音识别的语言：auto（SenseVoice 自动识别中/英/日/韩/粤，默认）/ bn（孟加拉语，首次使用自动下载约 90 MB 识别模型）",
    "capsule_root": "capsule-cinema 仓库位置（remake-plan / remake-run / capsule-draft 的 --capsule-root；也可设 $CAPSULE_CINEMA_ROOT）",
    "lang": "报告和结论的语言：zh（默认）/ en；agent 应按用户提问的语言选，用户明确指定时以指定为准",
}
ON_OFF = ("on", "off")
HINT_MIN = 2  # a correction pattern becomes a hint once it has been seen this many times


def home() -> Path:
    return Path(os.getenv("REA_VIDEO_HOME", str(Path.home() / ".rea-video"))).expanduser()


# ---------------- preferences ----------------------------------------------------------------------

def load_prefs() -> dict:
    try:
        return json.loads((home() / "prefs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_prefs(prefs: dict) -> None:
    home().mkdir(parents=True, exist_ok=True)
    (home() / "prefs.json").write_text(json.dumps(prefs, ensure_ascii=False, indent=2), encoding="utf-8")


def set_pref(key: str, value: str | None) -> dict:
    if key not in PREF_KEYS:
        raise ValueError(f"未知偏好 {key}（可选：{', '.join(PREF_KEYS)}；自由文字偏好用 prefs --note）")
    if value is not None and key in ("vlm", "stems") and value not in ON_OFF:
        raise ValueError(f"{key} 只能是 on / off")
    if value is not None and key == "ocr_lang" and value not in OCR_LANGS:
        raise ValueError(f"ocr_lang 只能是 {' / '.join(OCR_LANGS)}")
    if value is not None and key == "asr_lang" and value not in ASR_LANGS:
        raise ValueError(f"asr_lang 只能是 {' / '.join(ASR_LANGS)}")
    if value is not None and key in ("env_file", "capsule_root"):
        value = str(Path(value).expanduser().resolve())
    prefs = load_prefs()
    if value is None:
        prefs.pop(key, None)
    else:
        prefs[key] = value
    _save_prefs(prefs)
    return prefs


def add_note(text: str) -> dict:
    prefs = load_prefs()
    notes = prefs.setdefault("notes", [])
    if text not in notes:
        notes.append(text)
    _save_prefs(prefs)
    return prefs


def remove_note(index: int) -> dict:
    prefs = load_prefs()
    notes = prefs.get("notes", [])
    if not 1 <= index <= len(notes):
        raise ValueError(f"没有第 {index} 条偏好说明（共 {len(notes)} 条）")
    notes.pop(index - 1)
    _save_prefs(prefs)
    return prefs


def pref(key: str, default=None):
    return load_prefs().get(key, default)


def capsule_root(explicit: str | None = None) -> Path:
    """capsule-cinema 仓库：命令行 > $CAPSULE_CINEMA_ROOT > prefs capsule_root > ~/code/github/capsule-cinema。"""
    raw = explicit or os.getenv("CAPSULE_CINEMA_ROOT") or pref("capsule_root") or str(Path.home() / "code/github/capsule-cinema")
    return Path(raw).expanduser().resolve()


# ---------------- corrections ----------------------------------------------------------------------

def load_corrections() -> list[dict]:
    p = home() / "corrections.jsonl"
    if not p.is_file():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def _top(p: dict | None) -> str | None:
    return top(p)[0] if p and sum(p.values()) > 0 else None


def _select(breakdown: dict, shots: str | None, start: float | None, end: float | None) -> list[dict]:
    recs = breakdown["shots"]
    if shots in (None, "", "all") and start is None and end is None:
        return recs
    if start is not None or end is not None:
        start = start if start is not None else 0.0
        e = end if end is not None else breakdown["source"]["duration"]
        return [r for r in recs if min(r["end"], e) - max(r["start"], start) > 0.5 * r["duration"]]
    want = set()
    for tok in shots.split(","):
        tok = tok.strip()
        want.add(tok if tok.startswith("shot_") else f"shot_{int(tok):03d}")
    return [r for r in recs if r["id"] in want]


def correct(breakdown: dict, *, label: str | None = None, real: bool | None = None, shots: str | None = None,
            start: float | None = None, end: float | None = None, note: str = "", record: bool = True) -> list[dict]:
    """Mark shots with the user's answer (rec["user"]) and log each correction. Call finalize() afterwards."""
    if label is not None and label not in LABELS:
        raise ValueError(f"未知类别 {label}（可选：{', '.join(LABELS)}）")
    if label is None and real is None:
        raise ValueError("至少给出 --label 或 --real")
    recs = _select(breakdown, shots, start, end)
    if not recs:
        raise ValueError("没有选中任何镜头（检查 --shots / --start / --end）")
    ctx = breakdown.get("video_context") or {}
    logged = []
    for r in recs:
        user = dict(r.get("user") or {})
        if label is not None:
            user["label"] = label
        if real is not None:
            user["real_material"] = real
        if note:
            user["note"] = note
        user["time"] = time.strftime("%Y-%m-%d %H:%M")
        entry = {
            "time": user["time"], "video": breakdown["source"]["filename"], "video_key": breakdown["source"].get("sha256_head"),
            "duration": breakdown["source"]["duration"], "shot": r["id"], "start": r["start"], "end": r["end"],
            "before": r["base"]["label"], "before_conf": r["base"]["confidence"],
            "tool": _top(r["deterministic"]["probs"]), "vlm": _top((r.get("vlm") or {}).get("label_probs")),
            "review": _top((r.get("review") or {}).get("label_probs")),
            "real_before": bool((r.get("material") or {}).get("has_real_material")),
            "label": label, "real_material": real, "note": note,
            "context": {"transcoded": ctx.get("transcoded"), "platform": ctx.get("platform"), "native30": ctx.get("native30"),
                        "family": r["deterministic"]["facts"].get("temporal_family"),
                        "pulldown": r["deterministic"]["facts"].get("pulldown"), "aigc": bool((breakdown.get("provenance") or {}).get("aigc"))},
        }
        r["user"] = user
        logged.append(entry)
    if record:
        home().mkdir(parents=True, exist_ok=True)
        with (home() / "corrections.jsonl").open("a", encoding="utf-8") as f:
            for e in logged:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return logged


def reapply(breakdown: dict) -> int:
    """Re-attach earlier corrections when the same file is decomposed again (matched by file hash + time)."""
    key = breakdown["source"].get("sha256_head")
    if not key:
        return 0
    n = 0
    for c in load_corrections():
        if c.get("video_key") != key:
            continue
        for r in breakdown["shots"]:
            if min(r["end"], c["end"]) - max(r["start"], c["start"]) > 0.5 * r["duration"]:
                user = dict(r.get("user") or {})
                if c.get("label"):
                    user["label"] = c["label"]
                if c.get("real_material") is not None:
                    user["real_material"] = c["real_material"]
                if c.get("note"):
                    user["note"] = c["note"]
                user["time"] = c["time"]
                r["user"] = user
                n += 1
    return n


# ---------------- what the corrections teach ---------------------------------------------------------

def patterns(corrections: list[dict] | None = None) -> list[dict]:
    """Label corrections grouped by (tool's label -> user's label), latest correction per shot only."""
    latest = {}
    for c in corrections if corrections is not None else load_corrections():
        if c.get("label"):
            latest[(c.get("video_key"), c["shot"])] = c
    groups: dict[tuple, list] = {}
    for c in latest.values():
        if c["before"] != c["label"]:
            groups.setdefault((c["tool"], c["label"]), []).append(c)
    out = []
    for (tool, right), cs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        out.append({"tool": tool, "right": right, "count": len(cs), "videos": len({c.get("video_key") for c in cs}),
                    "vlm_wrong": sum(1 for c in cs if c.get("vlm") and c["vlm"] != right),
                    "review_wrong": sum(1 for c in cs if c.get("review") and c["review"] != right),
                    "transcoded": sum(1 for c in cs if (c.get("context") or {}).get("transcoded"))})
    return out


def hint_for(tool_label: str, pats: list[dict]) -> str | None:
    hits = [p for p in pats if p["tool"] == tool_label and p["count"] >= HINT_MIN]
    if not hits:
        return None
    return semi().join(T("用户过去 {n} 次把工具判的「{a}」改成「{b}」", "users have changed the tool's \"{a}\" to \"{b}\" {n} times before",
                         n=p['count'], a=LABEL_ZH.get(p['tool'], p['tool']), b=LABEL_ZH[p['right']])
                       for p in hits) + T("，请重点核对", "; check this one carefully")


def summary_lines() -> list[str]:
    prefs = load_prefs()
    cs = load_corrections()
    lines = [T("记忆目录: {h}", "Memory dir: {h}", h=home())]
    set_prefs = {k: v for k, v in prefs.items() if k in PREF_KEYS}
    lines.append(T("偏好: ", "Preferences: ") + (T("，", ", ").join(f"{k}={v}" for k, v in set_prefs.items()) if set_prefs else T("（未设置）", "(none set)")))
    for i, n in enumerate(prefs.get("notes", []), 1):
        lines.append(T("  说明 {i}: {n}", "  Note {i}: {n}", i=i, n=n))
    if not cs:
        lines.append(T("纠正: 还没有记录（用户指出判错时运行 rea-video correct）", "Corrections: none yet (run rea-video correct when the user points out a wrong call)"))
        return lines
    videos = {c.get("video_key") for c in cs}
    lines.append(T("纠正: {n} 条，涉及 {v} 条视频", "Corrections: {n} across {v} videos", n=len(cs), v=len(videos)))
    for p in patterns(cs):
        extra = [T("VLM 也判错 {n}", "VLM also wrong {n}", n=p['vlm_wrong'])] if p["vlm_wrong"] else []
        extra += [T("agent 复核也判错 {n}", "agent review also wrong {n}", n=p['review_wrong'])] if p["review_wrong"] else []
        extra += [T("其中转码视频 {n}", "{n} transcoded", n=p['transcoded'])] if p["transcoded"] else []
        lines.append(T("  工具「{a}」→ 用户「{b}」 {c} 个镜头 / {v} 条视频", "  tool \"{a}\" → user \"{b}\": {c} shots / {v} videos",
                       a=LABEL_ZH.get(p['tool'], p['tool']), b=LABEL_ZH[p['right']], c=p['count'], v=p['videos'])
                     + (T("（{e}）", " ({e})", e=T("，", ", ").join(extra)) if extra else ""))
    real = [c for c in cs if c.get("real_material") is not None and c["real_material"] != c.get("real_before")]
    if real:
        lines.append(T("  真实素材判断被纠正 {n} 次（漏标 {m}，误标 {f}）", "  real-material calls corrected {n} times (missed {m}, false {f})",
                       n=len(real), m=sum(1 for c in real if c['real_material']), f=sum(1 for c in real if not c['real_material'])))
    for c in [c for c in cs if c.get("note")][-5:]:
        lines.append(T("  备注（{v} {s}）: {n}", "  note ({v} {s}): {n}", v=c['video'], s=c['shot'], n=c['note']))
    lines.append(T("把纠正过的视频导出为评测样本：rea-video memory --export-labels eval/user_labels.yaml",
                   "Export the corrected videos as eval samples: rea-video memory --export-labels eval/user_labels.yaml"))
    return lines


def export_labels(path: Path) -> int:
    """Write corrected shots as eval segments (only the corrected time ranges are scored)."""
    import yaml

    by_video: dict[str, dict] = {}
    for c in load_corrections():
        v = by_video.setdefault(c.get("video_key") or c["video"], {"video": c["video"], "shots": {}})
        v["shots"][c["shot"]] = {**v["shots"].get(c["shot"], {}), **{k: c[k] for k in ("start", "end")},
                                 **({"label": c["label"]} if c.get("label") else {}),
                                 **({"real": c["real_material"]} if c.get("real_material") is not None else {})}
    videos = []
    for key, v in by_video.items():
        shots = sorted(v["shots"].values(), key=lambda s: s["start"])
        entry = {"id": f"user_{Path(v['video']).stem}"[:60], "path": f"<填入 {v['video']} 的路径>", "source": "user_corrections",
                 "video_key": key}
        segs = [[round(s["start"], 3), round(s["end"], 3), s["label"]] for s in shots if "label" in s]
        reals = [[round(s["start"], 3), round(s["end"], 3), s["real"]] for s in shots if "real" in s]
        if segs:
            entry["segments"] = segs
        if reals:
            entry["real_material"] = reals
        videos.append(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("# 由 rea-video memory --export-labels 从用户纠正生成；只评纠正过的时间段。path 需要手动填。\n"
                    + yaml.safe_dump({"videos": videos}, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return len(videos)
