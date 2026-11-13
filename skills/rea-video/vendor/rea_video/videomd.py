"""VIDEO.md: a video breakdown laid out for models. Read the card, then the map, then open only the file you need.

The output directory is the package. Levels, each cheaper than the next:
  L0  VIDEO.md front matter  the card: what the video is, how it was made, how sure        ~150 tokens
  L1  VIDEO.md body          overview, open questions and the map of every file below       ~1k tokens
  L2  video/<topic>.md       one topic per file; video/timeline.md is the spine: one line per shot
  L3  video/shots/07.md      everything about one shot: what is visible, what is inferred and why, remake prompts
  L4  breakdown.json, shots/, stems/, sfx/, packaging/   raw data and media
Every file opens with front matter saying what it covers and roughly how many tokens it holds, so a reader can decide
before opening it. Paths are relative to the package root. In timeline lines a key ending in `~` is the tools'
inference; keys without it are what is visible on screen or measured directly. The spec is https://github.com/videomd/videomd; reading and checking use the `videomd` package.
"""
from __future__ import annotations

import html
import re
import shutil
from pathlib import Path

import yaml

from . import entities, narrative
from .classify import LABEL_ZH
from .i18n import T, join

FORMAT = "videomd"
VERSION = 1
ENTRY = "VIDEO.md"
DIR = "video"
BLOCK = "videomd-timeline"
MAP_BLOCK = "videomd-map"

# producer-side values -> the neutral ids in the spec
DECIDED_BY = {"deterministic": "tools", "fused": "model", "fused_agent": "agent", "user": "human"}
OVERLAY_ID = {"huazi": "styled_text"}
# shot-boundary kinds from the cut detector -> transition ids in the spec; plain cuts are not written
TRANSITION_ID = {"jump": "jump_cut", "fade": "fade_through", "dissolve": "dissolve", "wipe": "wipe", "flash": "flash",
                 "slide": "slide", "whip": "whip_pan", "zoom": "zoom", "spin": "spin", "blur": "blur", "glitch": "glitch",
                 "shake": "shake", "effect": "effect"}

# timeline keys, in line order; `~` = inferred by the tools
KEYS = ("story", "seen", "layers", "camera", "transition", "overlay", "made~", "material~", "remake", "flag")


# ------------------------------------------------------------------ helpers ---------------------------------------

def tokens(text: str) -> int:
    """Rough token count: ~4 ASCII characters per token, ~1.5 tokens per 2 CJK characters."""
    ascii_n = sum(c.isascii() for c in text)
    return int(ascii_n / 4 + (len(text) - ascii_n) * 0.75) + 1


def _one_line(s, limit: int | None = None) -> str:
    s = re.sub(r"\s+", " ", str(s or "")).replace(" | ", " / ").replace("|", "/").strip()
    return s[:limit] + "…" if limit and len(s) > limit else s


def _front(meta: dict, body: str) -> str:
    fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=1000).strip()
    return f"---\n{fm}\n---\n\n{body.strip()}\n"


def _sized(meta: dict, body: str) -> str:
    """Front matter + body, with the body's size in the front matter."""
    return _front({**meta, "tokens": tokens(body)}, body)


_RE_DETAILS = re.compile(r'^<details(?: class="ref")?><summary>(.*)</summary>$')


def _plain(lines: list[str]) -> str:
    """A report section without the HTML folds: a model reads the whole file it opened."""
    out = []
    for ln in lines:
        m = _RE_DETAILS.match(ln.strip())
        if m:
            out.append(f"**{html.unescape(m.group(1))}**")
        elif ln.strip() != "</details>" and not ln.startswith("!["):  # images: paths live in front matter (`frames`) or the map
            out.append(ln)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def _shot_name(i: int) -> str:
    return f"{i:02d}"


# ------------------------------------------------------------------ timeline (the spine) --------------------------

_TRANSITION_WORDS = {"jump_cut": ("跳切", "jump cut"), "fade_through": ("黑场/白场过渡", "fade through"), "dissolve": ("叠化", "dissolve"),
                     "wipe": ("划像", "wipe"), "flash": ("闪白", "flash"), "slide": ("推移", "slide"), "whip_pan": ("甩镜", "whip pan"),
                     "zoom": ("缩放转场", "zoom"), "spin": ("旋转转场", "spin"), "blur": ("模糊转场", "blur"), "glitch": ("故障转场", "glitch"),
                     "shake": ("抖动转场", "shake"), "effect": ("转场特效", "transition effect")}


def _transition_in(r: dict) -> dict:
    """The spec's transition_in for a shot record: type, and length / direction when measured; {} for a plain cut."""
    tid = TRANSITION_ID.get(r.get("transition_in") or "cut")
    if not tid:
        return {}
    tr = r.get("transition") or {}
    return {"type": tid, **({"duration": tr["duration"]} if tr.get("duration") else {}),
            **{k: tr[k] for k in ("direction", "via", "mode") if tr.get(k)}}


def timeline_line(r: dict, roles: dict, units: dict) -> str:
    from .report import CAMERA_ZH, _layers, _origin, _route

    base = r["base"]
    f = {}
    n = roles.get(r["index"]) or {}
    if n.get("role_zh") or n.get("point"):
        f["story"] = _one_line(join(x for x in (n.get("role_zh"), n.get("point")) if x), 48)
    desc = (r.get("vlm") or r.get("review") or {}).get("description")
    if desc:
        f["seen"] = _one_line(desc, 60)
    f["camera"] = CAMERA_ZH.get((r.get("features") or {}).get("camera", "unknown"), "—")
    trans = TRANSITION_ID.get(r.get("transition_in") or "cut")
    if trans:
        dur = (r.get("transition") or {}).get("duration")
        f["transition"] = T(*_TRANSITION_WORDS[trans]) + (f" {dur:.1f}s" if dur and dur >= 0.1 else "")
    if _layers(r) != "—":
        f["overlay"] = _layers(r)
    made = f"{base['label_zh']} {base['confidence']:.0%}"
    alt = next(((k, v) for k, v in sorted(base["probs"].items(), key=lambda kv: -kv[1]) if k != base["label"] and v >= 0.01), None)
    if alt and base["decided_by"] != "user":
        made += T(" · 次选 {l} {p:.0%}", " · runner-up {l} {p:.0%}", l=LABEL_ZH[alt[0]], p=alt[1])
    f["made~"] = made
    f["material~"] = _one_line(_origin(r), 40)
    f["remake"] = _one_line(_route(r, units), 30)
    flags = []
    if base["decided_by"] == "user":
        flags.append(T("用户纠正", "user correction"))
    elif base["confidence"] < 0.6:
        flags.append(T("低置信", "low confidence"))
    if base.get("uncertain"):
        flags.append(T("待确认", "to confirm"))
    if base.get("disputed"):
        flags.append(T("有分歧", "disputed"))
    if flags:
        f["flag"] = ",".join(flags)
    head = f"#{_shot_name(r['index'])} {r['start']:.1f}-{r['end']:.1f}"
    return " | ".join([head] + [f"{k} {f[k]}" for k in KEYS if f.get(k)])


def _legend() -> list[str]:
    return [T("每行一个镜头：`#编号 起-止(秒) | 键 值 | …`。键后带 `~` 的是工具推断，不带的是画面里看得到或直接测得的。",
              "One shot per line: `#<n> start-end (s) | key value | …`. A key ending in `~` is the tools' inference; keys without it are visible on screen or measured directly."),
            T("`story` 在叙事里的作用和讲的点 · `seen` 画面里看到的 · `camera` 运镜 · `overlay` 叠加层 · `made~` 制作方式（推断）· "
              "`material~` 素材来源（推断）· `remake` 复刻路线 · `flag` 需要复核",
              "`story` job in the story and the point · `seen` what is on screen · `camera` camera move · `overlay` overlays · `made~` how it was made (inferred) · "
              "`material~` where the material came from (inferred) · `remake` remake route · `flag` needs a second look"),
            T("某一镜的全部细节在 `{d}/shots/编号.md`（如 `{d}/shots/07.md`）。", "Full detail for a shot is in `{d}/shots/<n>.md` (e.g. `{d}/shots/07.md`).", d=DIR)]


# ------------------------------------------------------------------ per-shot files ---------------------------------

def _shot_file(r: dict) -> str:
    from .report import _shot_detail_md

    base = r["base"]
    probs = sorted(base["probs"].items(), key=lambda kv: -kv[1])
    assets = r.get("assets") or {}
    meta = {
        FORMAT: VERSION, "part": "shot", "shot": r["index"], "time": [round(r["start"], 3), round(r["end"], 3)],
        "camera": (r.get("features") or {}).get("camera", "unknown"),
        "overlays": sorted({OVERLAY_ID.get(l["kind"], l["kind"]) for l in r.get("layers", [])}),
        "inferred": {"made": base["label"], "p": base["confidence"],
                     "alternatives": dict([(k, v) for k, v in probs if k != base["label"] and v > 0][:2]),
                     "decided_by": DECIDED_BY.get(base["decided_by"], base["decided_by"]), "real_material": bool((r.get("material") or {}).get("has_real_material"))},
        "flags": [k for k in ("uncertain", "disputed") if base.get(k)] + (["low_confidence"] if base["confidence"] < 0.6 and base["decided_by"] != "user" else []),
        **({"transition_in": _transition_in(r)} if _transition_in(r) else {}),
        "frames": {k: v for k, v in (("sheet", assets.get("sheet")), ("first", assets.get("first_frame")), ("last", assets.get("last_frame"))) if v},
    }
    title = T("# 镜头 {i} · {a}–{z}s · {v}", "# Shot {i} · {a}–{z}s · {v}", i=r["index"], a=f"{r['start']:.1f}", z=f"{r['end']:.1f}", v=r.get("verdict", ""))
    return _sized(meta, title + "\n\n" + _plain(_shot_detail_md(r)))


# ------------------------------------------------------------------ topic files ------------------------------------

def _topics(b: dict) -> list[tuple[str, str, str, list[str]]]:
    """(file stem, title, when to read it, report section lines)."""
    from .report import _audio_md, _cast_md, _content_md, _remake_md, _visual_md, packaging_md

    return [
        ("content", T("内容与结构", "Content and structure"), T("要讲什么、叙事线、结构时间轴、台词", "what it says, the narrative line, structure, the script"), _content_md(b)),
        ("cast", T("角色、场景与道具", "Cast, scenes and props"), T("做角色参考图、写首帧提示词", "reference images for characters, first-frame prompts"), _cast_md(b)),
        ("sound", T("声音", "Sound"), T("人声、BGM、音效、节拍和来源", "voice, music, sound effects, beats and sources"), _audio_md(b)),
        ("look", T("拍法、打光与剪辑", "Camera, lighting and editing"), T("有实拍镜头时：景别、机位、布光、器材", "for filmed shots: framing, camera, lighting, kit"), _visual_md(b)),
        ("packaging", T("剪辑包装", "Packaging"), T("字幕、花字、贴纸、画中画的时间和样式", "subtitles, styled text, stickers, picture-in-picture: timing and style"), packaging_md(b)),
        ("remake", T("复刻方案", "Remake plan"), T("生成单元、拍摄场次、代码合成、要准备的真实素材", "generation units, shoots, code builds, real material to collect"), _remake_md(b)),
    ]


def _has_body(text: str) -> bool:
    return sum(1 for ln in text.splitlines() if ln.strip() and not ln.startswith("#")) >= 1


# ------------------------------------------------------------------ entry (L0 + L1) -----------------------------------

def _card(b: dict) -> dict:
    s, src = b["summary"], b["source"]
    from . import __version__

    readers = ["tools"] + (["model"] if b["analysis"]["vlm"].get("used") else []) + (["agent"] if (b["analysis"].get("review") or {}).get("shots") else [])
    if any(r["base"]["decided_by"] == "user" for r in b["shots"]):
        readers.append("human")
    source = {"file": src["filename"]}
    digest = _sha256(src.get("path"))
    if digest:
        source["sha256"] = digest
    source.update({"duration": src["duration"], "size": f"{src['width']}x{src['height']}", "fps": src["fps"], "aspect": src["aspect_ratio"]})
    return {
        FORMAT: VERSION, "name": slug(Path(src["filename"]).stem), "description": _description(b),
        "source": source, "shots": len(b["shots"]), "lang": b.get("lang", "zh"),
        "made_mix": {m["label"]: m["ratio"] for m in s["production_mix"]}, "confidence": s["confidence"],
        "readers": readers, "open_questions": len(entities.open_questions(b)),
        "generator": {"name": "rea-video", "version": __version__},
    }


def slug(stem: str) -> str:
    """A card name: lowercase letters, digits and single hyphens, at most 64 characters."""
    s = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")[:64].strip("-")
    return s or "video"


def _description(b: dict) -> str:
    """What the video is about first, then how it was made: an agent picks a package by this line."""
    about = _one_line((b.get("whole_video_vlm") or {}).get("summary"), 600)
    made = join(f"{m['label_zh']} {m['ratio']:.0%}" for m in b["summary"]["production_mix"])
    made = T("制作方式（推断）：{m}", "Made with (inferred): {m}", m=made)
    return _one_line(f"{about} {made}" if about else made, 1000)


def _sha256(path) -> str | None:
    """sha256 of the whole source file, when it is still where the breakdown found it."""
    import hashlib

    if not path or not Path(path).is_file():
        return None
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _overview(b: dict, files: list[tuple[str, str, str, int]]) -> str:
    s = b["summary"]
    w = b.get("whole_video_vlm") or {}
    L = [f"# {b['source']['filename']}", "", T("**结论**（推断）：{v}", "**Verdict** (inferred): {v}", v=s["verdict"])]
    if w.get("summary"):
        L.append(T("**讲什么**：{s}", "**What it says**: {s}", s=_one_line(w["summary"], 200)))
    steps = narrative.beats(b)
    if steps:
        L.append(T("**叙事线**：", "**Narrative**: ") + " → ".join(
            f"#{st['shots'][0]:02d}" + (f"-{st['shots'][-1]:02d}" if len(st["shots"]) > 1 else "") + f" {st['role_zh'] or _one_line((st['points'] or ['?'])[0], 16)}"
            for st in steps))
    L.append(T("**制作方式**（推断，按时长）：", "**Made with** (inferred, by duration): ") + join(f"{m['label_zh']} {m['ratio']:.0%}" for m in s["production_mix"]))
    if s.get("production"):
        L.append(T("**复刻**：{p}", "**Remake**: {p}", p=s["production"]))
    rm = s.get("real_material") or {}
    if rm.get("shots"):
        L.append(T("**要拿到的真实素材**：{n} 个镜头（{r:.0%} 时长），清单见 `{d}/remake.md`", "**Real material to collect**: {n} shots ({r:.0%} of the duration), list in `{d}/remake.md`", d=DIR,
                   n=len(rm["shots"]), r=rm["ratio"]))
    qs = entities.open_questions(b)
    L += ["", T("## 不确定点", "## Open questions"), ""] + ([f"- {_one_line(q, 160)}" for q in qs[:8]] or [T("- 没有", "- None")])
    if len(qs) > 8:
        L.append(T("- 另有 {n} 处，见 `{d}/timeline.md` 里带 `flag` 的行", "- {n} more, see the `flag` lines in `{d}/timeline.md`", d=DIR, n=len(qs) - 8))
    L += ["", T("## 地图", "## Map"), "",
          T("先读本页；要细节时只打开需要的文件。每行是 `路径 | 约 token | 里面有什么 · 什么时候读`，路径相对本目录。",
            "Read this page first; for detail, open only the file you need. Each line is `path | ~tokens | what is in it · when to read it`; paths are relative to this directory."), "",
          f"```{MAP_BLOCK}"]
    L += [f"{p} | {n if n else '-'} | {_one_line(title)} · {_one_line(when)}" for p, title, when, n in files] + ["```"]
    L += ["", T("## 读法", "## How to read"), ""] + [f"- {x}" for x in _legend()] + [
        T("- 「看到的」可以对着截图核实；「推断」是工具和看图模型的判断，依据写在每镜文件的「判断依据」里，两者对不上时以截图为准。",
          "- What is “seen” can be checked against the frames; what is “inferred” is the tools' and image readers' judgement, with the basis in each shot file. When they disagree, trust the frames.")]
    return "\n".join(L)


# ------------------------------------------------------------------ write -------------------------------------------

def write(b: dict, out: Path) -> Path:
    """Write the package into `out` (the breakdown's output directory). Returns the entry file."""
    from .report import _unit_of

    d = out / DIR
    if d.is_dir():
        shutil.rmtree(d)  # generated: a re-run with a different shot count must not leave stale shot files
    (d / "shots").mkdir(parents=True)
    files: list[tuple[str, str, str, int]] = []

    def put(rel: str, text: str, title: str, when: str) -> None:
        (out / rel).write_text(text, encoding="utf-8")
        files.append((rel, title, when, tokens(text)))

    roles, units = narrative.shot_roles(b), _unit_of(b)
    lines = [timeline_line(r, roles, units) for r in b["shots"]]
    body = "\n".join([T("# 时间线", "# Timeline"), ""] + _legend() + ["", f"```{BLOCK}"] + lines + ["```"])
    put(f"{DIR}/timeline.md", _sized({FORMAT: VERSION, "part": "timeline", "shots": len(lines)}, body),
        T("时间线：一行一个镜头", "Timeline: one line per shot"), T("想知道某段讲什么、哪镜要复核、某镜怎么做", "what a stretch says, which shots need review, how a shot was made"))
    for stem, title, when, section in _topics(b):
        text = _plain(section)
        if _has_body(text):
            put(f"{DIR}/{stem}.md", _sized({FORMAT: VERSION, "part": stem}, text), title, when)
    shot_tokens = 0
    for r in b["shots"]:
        text = _shot_file(r)
        (d / "shots" / f"{_shot_name(r['index'])}.md").write_text(text, encoding="utf-8")
        shot_tokens += tokens(text)
    files.append((f"{DIR}/shots/*.md", T("逐镜细节，token 是每个文件的平均值", "Per-shot detail, tokens per file on average"),
                  T("核实某一镜：看得到的、推断和依据、提示词、帧图", "checking one shot: what is seen, the inference and its basis, prompts, frames"),
                  shot_tokens // max(1, len(b["shots"]))))
    if (out / "breakdown.json").is_file():
        files.append(("breakdown.json", T("完整原始数据", "Full raw data"), T("程序读取；模型一般不用打开", "for programs; a model rarely needs it"),
                      tokens((out / "breakdown.json").read_text(encoding="utf-8"))))
    for rel, what, when in (
            ("shots/", T("每镜的联系表和首尾帧", "contact sheet, first and last frame of each shot"), T("看图核实", "checking by eye")),
            ("storyboard.jpg", T("全片故事板", "storyboard of the whole video"), T("一眼看全片", "the whole video at a glance")),
            ("stems/", T("人声、配乐、音效分轨", "voice, music and effects stems"), T("听声音、复刻配音配乐", "listening, remaking the sound")),
            ("sfx/", T("每处音效的试听片段", "a clip of each sound effect"), T("找同款音效", "finding matching effects")),
            ("packaging/", T("字幕文件、包装时间轴、贴纸截图", "subtitle files, packaging timeline, sticker frames"), T("复刻字幕和包装", "remaking subtitles and packaging")),
            ("frames/", T("粒子场景：每场景原尺寸帧、测量值、取自原片的粒子目标点", "particle scenes: full-size frames, measurements and target points taken from the original"),
             T("复刻粒子画面", "remaking particle pictures")),
            ("audio.png", T("声音波形和节拍图", "waveform and beat chart"), T("看节奏", "seeing the rhythm"))):
        if (out / rel.rstrip("/")).exists():
            files.append((rel, what, when, 0))
    entry = out / ENTRY
    entry.write_text(_front(_card(b), _overview(b, files)), encoding="utf-8")
    return entry


# ------------------------------------------------------------------ read and check: the videomd reference library --

def read(root: Path) -> dict:
    """The package as data: {"card", "map", "timeline": [shot dicts], "shots": {n: front matter}}."""
    import videomd

    return videomd.read(root)


def check(root: Path) -> list[str]:
    """Problems that make `root` a non-conforming package (empty list = conforms), per the VIDEO.md spec."""
    import videomd

    return videomd.check(root)
