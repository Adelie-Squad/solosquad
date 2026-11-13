"""rea-video command line."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .util import ASR_LANGS, LOG, OCR_LANGS, load_env_files, read_json, setup_logging, read_image
from .i18n import LANGS, T, set_lang
from .classify import LABELS
from .vlm import vlm_note



def _env(args) -> None:
    from .memory import pref

    # 不读当前目录的 .env：在别人的仓库里运行时，它可以改 VLM 地址或 CAPSULE_CINEMA_PYTHON
    files = [Path(__file__).resolve().parent.parent / ".env"]
    explicit = getattr(args, "env_file", None)
    env_file = explicit or pref("env_file")
    if env_file:
        if not Path(env_file).expanduser().is_file():
            # silently skipping it made people think the VLM was configured
            msg = T("找不到配置文件 {p}", "env file not found: {p}", p=env_file)
            if explicit:
                raise SystemExit(f"rea-video: {msg}")
            LOG.warning("%s%s", msg, T("（来自 prefs env_file）", " (from prefs env_file)"))
        files.insert(0, Path(env_file))
    loaded = load_env_files(files)
    if loaded:
        LOG.debug("env loaded from %s", loaded)


def _ocr_lang(args) -> None:
    """--ocr-lang (or prefs ocr_lang) -> $REA_OCR_LANG, which overlay.get_ocr reads."""
    from .memory import pref

    lang = getattr(args, "ocr_lang", None) or pref("ocr_lang")
    if lang:
        if lang not in OCR_LANGS:
            raise SystemExit(f"错误：不支持的 OCR 语言 {lang}（可选：{', '.join(OCR_LANGS)}）")
        os.environ["REA_OCR_LANG"] = lang


def _asr_lang(args) -> None:
    """--asr-lang (or prefs asr_lang) -> $REA_ASR_LANG, which speech.transcribe reads."""
    from .memory import pref

    lang = getattr(args, "asr_lang", None) or pref("asr_lang")
    if lang:
        if lang not in ASR_LANGS:
            raise SystemExit(f"错误：不支持的语音识别语言 {lang}（可选：{', '.join(ASR_LANGS)}）")
        os.environ["REA_ASR_LANG"] = lang


def _check_vlm_config() -> None:
    """Fail fast on a misconfigured VLM: a typo in REA_VLM_MEDIA must not silently run text-only."""
    from .vlm import VLMConfig

    try:
        VLMConfig.from_env()
    except ValueError as exc:
        raise SystemExit(f"rea-video: {exc}")


def cmd_decompose(args) -> int:
    from .pipeline import decompose

    _ocr_lang(args)
    _asr_lang(args)

    out = Path(args.out) if args.out else Path("out") / Path(args.video).stem
    from .memory import pref

    meta = read_json(Path(args.meta)) if args.meta else None
    use_vlm = args.vlm or (pref("vlm") == "on" and not args.no_vlm)
    if use_vlm:
        _check_vlm_config()
    stems = not args.no_stems and pref("stems", "on") == "on"
    lang = args.lang or pref("lang", "zh")
    if lang not in LANGS:
        raise SystemExit(f"错误：不支持的报告语言 {lang}（可选：{', '.join(LANGS)}）")
    b = decompose(args.video, out, use_vlm=use_vlm, whole_vlm=not args.no_whole, ocr=not args.no_ocr,
                  workers=args.workers, engine=args.engine or pref("engine", "seedance2.0"), platform_meta=meta, stems=stems,
                  packaging=not args.no_packaging, lang=lang, asr=not args.no_asr, max_shots_vlm=max(1, args.max_vlm_shots),
                  speakers=not args.no_speakers)
    print(json.dumps({"out": str(out), "verdict": b["summary"]["verdict"], "shots": b["summary"]["shots"],
                      "confidence": b["summary"]["confidence"], "vlm": b["summary"]["vlm"],
                      "report": str(out / "report.html")}, ensure_ascii=False, indent=2))
    return 0


def cmd_review(args) -> int:
    """Write review_tasks.json + review_answers.json so a multimodal agent can act as the VLM."""
    from .review import build_tasks

    out = Path(args.out_dir)
    b = read_json(out / "breakdown.json")
    set_lang(b.get("lang", "zh"))
    tasks, answers = build_tasks(b, str(out))
    from .util import dumps_rows

    (out / "review_tasks.json").write_text(dumps_rows(tasks), encoding="utf-8")
    ans_path = out / "review_answers.json"
    if args.force or not ans_path.is_file():
        ans_path.write_text(dumps_rows(answers), encoding="utf-8")
    high = [s for s in tasks["shots"] if s["priority"] == "high"]
    print(f"{len(tasks['shots'])} 个镜头待看图复核，其中 {len(high)} 个优先：" + ", ".join(f"{s['id']}({'; '.join(s['why'])})" for s in high))
    print(f"说明和图片路径：{out / 'review_tasks.json'}")
    print(f"把答案填进：{ans_path}")
    print(f"然后运行：rea-video apply-review {out} --by <你的名字>")
    return 0


def cmd_apply_review(args) -> int:
    from .pipeline import finalize
    from .review import apply_answers

    out = Path(args.out_dir)
    b = read_json(out / "breakdown.json")
    if args.lang:
        b["lang"] = args.lang
    set_lang(b.get("lang", "zh"))
    answers = read_json(Path(args.answers) if args.answers else out / "review_answers.json")
    from .memory import pref

    log = apply_answers(b, answers, by=args.by or pref("reviewer"))
    b = finalize(b, out)
    for p in log["problems"]:
        print(f"跳过 {p}")
    if log.get("unanswered"):
        print(f"没作答、已跳过 {len(log['unanswered'])} 个镜头")
    changed = [(r["id"], log["before"][r["id"]], r["base"]["label"]) for r in b["shots"]
               if r["id"] in log["before"] and log["before"][r["id"]] != r["base"]["label"]]
    print(f"已并入 {len(log['applied'])}/{len(b['shots'])} 个镜头；改判 {len(changed)} 个" +
          ("：" + ", ".join(f"{i} {a}→{c}" for i, a, c in changed) if changed else ""))
    print(f"结论: {b['summary']['verdict']}")
    print(f"VLM: {b['summary']['vlm']}")
    if log.get("packaging"):
        print("已并入包装复核：" + ", ".join(f"{k} {n}" for k, n in log["packaging"].items()))
    if not log["applied"] and not log.get("packaging") and not log["problems"]:
        print("答案文件里没有可并入的镜头（先按 review_tasks.md 填 review_answers.json）")
    return 0 if log["applied"] or log.get("packaging") else 1


def cmd_stems(args) -> int:
    from .stems import extract_stems

    out = Path(args.out) if args.out else Path("out") / Path(args.video).stem
    print(json.dumps(extract_stems(args.video, out), ensure_ascii=False, indent=2))
    return 0


def cmd_probe(args) -> int:
    from .media import video_info
    from .probe import provenance

    info = video_info(args.video)
    p = provenance(info)
    p.pop("tags", None) if not args.tags else None
    print(json.dumps({"width": info.width, "height": info.height, "fps": info.fps, "duration": info.duration,
                      "vcodec": info.vcodec, "aspect_ratio": info.aspect_ratio, "provenance": p}, ensure_ascii=False, indent=2))
    return 0


def cmd_eval(args) -> int:
    from .evaluate import evaluate

    _ocr_lang(args)

    if args.vlm:
        _check_vlm_config()
    res = evaluate(Path(args.labels), Path(args.out), use_vlm=args.vlm, ocr=not args.no_ocr, reuse=not args.fresh,
                   only=set(args.only.split(",")) if args.only else None, stems=args.stems)
    print(json.dumps(res["summary"], ensure_ascii=False, indent=2))
    gone = res["summary"].get("missing")
    if gone:
        print("rea-video: " + T("只评了 {n}/{m} 个样本，其余找不到文件：{ids}", "scored {n} of {m} videos, files missing for: {ids}",
                                  n=res["summary"]["videos"], m=res["summary"]["videos_listed"], ids=", ".join(gone)), file=sys.stderr)
    return 0


def cmd_videomd(args) -> int:
    from .videomd import write

    root = Path(args.out_dir)
    if args.check:
        from .videomd import check

        errs = check(root)
        print("\n".join(errs) if errs else T("符合 VIDEO.md 规范", "conforms to the VIDEO.md spec"))
        return 1 if errs else 0
    b = read_json(root / "breakdown.json")
    set_lang(b.get("lang", "zh"))
    print(write(b, root))
    return 0


def cmd_pdf(args) -> int:
    from .pdf import write_pdf

    try:
        print(write_pdf(Path(args.out_dir)))
    except RuntimeError as e:
        print(f"rea-video: {e}", file=sys.stderr)
        return 1
    return 0


# SoloSquad vendored copy: the capsule-cinema integration (capsule / remake-plan / remake-run /
# capsule-draft) is removed. It imported another checkout's code and ran an external interpreter
# chosen by env or .env, and drives paid generation. See ../../UPSTREAM.md.
def _removed(args) -> int:
    raise SystemExit("rea-video: capsule-cinema commands are not in the SoloSquad vendored copy")


cmd_capsule = cmd_remake_plan = cmd_remake_run = cmd_capsule_draft = _removed


def cmd_assemble(args) -> int:
    from .remake import assemble

    print(assemble(Path(args.breakdown), Path(args.results), Path(args.out) if args.out else None, overlays=args.overlays))
    return 0


def cmd_tiles(args) -> int:
    """Time-labelled frame grid for close inspection of a passage."""
    import cv2
    import numpy as np

    from .media import extract_frame, video_info
    from .visual import shot_sheet

    # bad numbers used to die deep inside numpy / PIL with a traceback, or silently print an empty result
    if args.every <= 0:
        raise SystemExit("rea-video: --every 必须大于 0（两次抽帧的间隔秒数）")
    if args.start < 0:
        raise SystemExit("rea-video: --start 不能小于 0")
    if args.cols < 1:
        raise SystemExit("rea-video: --cols 至少为 1")
    if args.max < 1:
        raise SystemExit("rea-video: --max 至少为 1")
    if args.cell < 1:
        raise SystemExit("rea-video: --cell 至少为 1")
    info = video_info(args.video)
    end = args.end if args.end is not None else info.duration
    if args.start >= end:
        raise SystemExit(f"rea-video: --end 必须大于 --start（视频时长 {info.duration:.2f} 秒）")
    times = list(np.arange(args.start, end, args.every))[: args.max]
    import tempfile

    frames = []
    with tempfile.TemporaryDirectory() as tmpd:
        for i, t in enumerate(times):
            p = extract_frame(args.video, float(t), Path(tmpd) / f"tile_{i:03d}.jpg", width=args.cell)
            img = read_image(p)
            if img is not None:
                frames.append(img)
    rows = [frames[i:i + args.cols] for i in range(0, len(frames), args.cols)]
    paths = []
    for r, row in enumerate(rows):
        out = Path(args.out) if len(rows) == 1 else Path(args.out).with_name(f"{Path(args.out).stem}_{r + 1}{Path(args.out).suffix}")
        shot_sheet(row, [float(t) for t in times[r * args.cols:(r + 1) * args.cols]], out, n=len(row), cell_w=args.cell)
        paths.append(str(out))
    print(json.dumps({"tiles": paths, "times": [round(float(t), 3) for t in times]}, ensure_ascii=False))
    return 0


def cmd_frames(args) -> int:
    from .particles import scene_frames

    if args.every <= 0:
        raise SystemExit("rea-video: --every 必须大于 0")
    out = Path(args.out_dir)
    if not (out / "breakdown.json").is_file():
        raise SystemExit(f"rea-video: {out} 下没有 breakdown.json，先运行 decompose")
    res = scene_frames(out, every=args.every, n_points=args.points, all_shots=args.all)
    if not res["scenes"]:
        print(T("没有粒子镜头（加 --all 对所有镜头取帧）", "no particle shots (add --all to cover every shot)"))
        return 0
    print(json.dumps({"scenes": len(res["scenes"]), "file": str(out / "frames" / "scenes.json"),
                      "cuts": [s["start"] for s in res["scenes"]]}, ensure_ascii=False))
    return 0


def cmd_compare(args) -> int:
    from .particles import compare

    if args.every <= 0:
        raise SystemExit("rea-video: --every 必须大于 0")
    for p in (args.ref, args.remake):
        if not Path(p).is_file():
            raise SystemExit(f"rea-video: 找不到 {p}")
    res = compare(args.ref, args.remake, every=args.every, invert=args.invert, out=Path(args.out) if args.out else None,
                  scenes=Path(args.scenes) if args.scenes else None, worst=args.worst)
    brief = {k: res[k] for k in ("score", "place", "shape", "inverted", "worst") if k in res}
    if res.get("scenes"):
        brief["lowest_scenes"] = res["scenes"][:5]
    if res.get("sheet"):
        brief["sheet"] = res["sheet"]
    print(json.dumps(brief, ensure_ascii=False, indent=1))
    return 0


def cmd_summary(args) -> int:
    """Compact, agent-friendly view of a breakdown (instead of reading the whole JSON)."""
    from .i18n import T, join

    b = read_json(Path(args.breakdown))
    set_lang(b.get("lang", "zh"))
    s = b["summary"]
    lines = [f"{b['source']['filename']} | {b['source']['duration']}s {b['source']['width']}x{b['source']['height']} {b['source']['fps']}fps",
             f"{T('结论', 'Verdict')}: {s['verdict']}", f"{T('置信度', 'Confidence')}: {s['confidence']}", f"VLM: {s.get('vlm') or vlm_note(b['analysis']['vlm'])}", ""]
    from . import narrative

    steps = narrative.beats(b)
    if steps:
        lines[-1:-1] = [T("叙事线", "Narrative") + ": " + " → ".join(
            f"#{s['shots'][0]}" + (f"-{s['shots'][-1]}" if len(s['shots']) > 1 else "") + f" {s['role_zh'] or (s['points'] or ['?'])[0][:16]}" for s in steps)]
    vc = b.get("video_context") or {}
    if vc.get("transcoded"):
        lines.append(T("平台转码: {p}（噪声类证据失效；原生 30fps 无重复帧: {n}）", "Platform transcode: {p} (noise evidence unusable; native 30fps without duplicate frames: {n})",
                       p=join(vc.get("platform", [])), n=vc.get("native30")))
    prov = b.get("provenance", {})
    if prov.get("aigc") or prov.get("hints"):
        lines.append(f"{T('元数据', 'Metadata')}: aigc={prov.get('aigc')} hints={prov.get('hints')}")
    from .aspects import shot_text
    from .memory import hint_for, patterns

    pats = patterns()
    low_n = sum(r["base"]["confidence"] < 0.6 for r in b["shots"])
    mark_low = low_n <= len(b["shots"]) / 2  # when most shots are low, one line says so instead of a tag on every row
    if not mark_low:
        sure = [str(r["index"]) for r in b["shots"] if r["base"]["confidence"] >= 0.6]
        lines.append(T("低置信: {n}/{m} 镜置信度 <0.6，都要复核", "Low confidence: {n}/{m} shots below 0.6, review them all", n=low_n, m=len(b["shots"]))
                     + (T("（只有 #{s} 不用）", " (all but #{s})", s=",".join(sure)) if sure else ""))
    notes: list[str] = []  # the same "待确认" sentence repeats across shots: number it, print each once below the table

    def note_ref(text: str) -> str:
        if text not in notes:
            notes.append(text)
        return T("待确认{i}", "open question {i}", i="①②③④⑤⑥⑦⑧⑨⑩"[notes.index(text)] if notes.index(text) < 10 else f"({notes.index(text) + 1})")

    for r in b["shots"]:
        base = r["base"]
        alt = sorted(base["probs"].items(), key=lambda kv: -kv[1])[1]
        det = r["deterministic"]["probs"]
        past = None if base["decided_by"] == "user" else hint_for(max(det, key=det.get), pats)
        mat = (r.get("material") or {}).get("origin_zh", "")
        second = T("(用户纠正)", "(user correction)") if base["decided_by"] == "user" else T("(次选 {l} {p:.2f})", "(runner-up {l} {p:.2f})", l=alt[0], p=alt[1])
        lines.append(f"#{r['index']:>2} {r['start']:7.2f}-{r['end']:7.2f} {base['label']:<14} {base['confidence']:.2f} {second} "
                     f"| {T('素材', 'material')}:{mat} | {T('叠加', 'overlays')}:{','.join(sorted({l['kind'] for l in r.get('layers', [])})) or '-'} | {r['features'].get('camera')}"
                     + (T("  ← 低置信，需要复核", "  ← low confidence, review it") if mark_low and base["confidence"] < 0.6 else "")
                     + (f"  ← {note_ref(base['uncertain'])}" if base.get("uncertain") else "")
                     + (T("  ← 有分歧：{d}", "  ← disputed: {d}", d=base["disputed"]) if base.get("disputed") else "")
                     + (T("  ← 用户纠正过素材来源", "  ← material origin corrected by the user") if (r.get("material") or {}).get("user_corrected") else "")
                     + (f"  ← {past}" if past else "")
                     + (f" | {shot_text(r, brief=True)}" if r["base"]["label"] in ("live_action", "avatar") and shot_text(r, brief=True) else "")
                     + (T(" | 动效 {n} 个，元素截图 {f}", " | {n} motion events, element crops {f}", n=len(r["motion"].get("events", [])),
                          f=r["motion"]["elements_sheet"]) if r["base"]["label"] in ("code_render", "screen_capture")
                        and (r.get("motion") or {}).get("elements_sheet") else ""))
    if notes:
        lines += [f"{note_ref(n)}: {n}" for n in notes]
    if s.get("aspects"):
        lines += [""] + s["aspects"]
    from .entities import cast

    c = cast(b)
    if c["characters"] or c["scenes"]:
        lines.append("")
        for ch in c["characters"]:
            lines.append(f"{T('角色', 'Character')} {ch['id']} {ch['name']} | {ch['look']} | {T('镜头', 'shots')} {','.join(str(i) for i in ch['shots']) or '-'}")
        for sc in c["scenes"]:
            lines.append(f"{T('场景', 'Scene')} {sc['id']} {sc['where']} {sc['when']} | {sc['look']} | {T('镜头', 'shots')} {','.join(str(i) for i in sc['shots']) or '-'}")
    a = b.get("audio", {})
    if a.get("has_audio"):
        mu = a.get("music", {})
        lines += ["", f"{T('人声', 'Voice')}: {a.get('voice', {}).get('present')} ({a.get('voice', {}).get('ratio')}) | {T('音乐', 'Music')}: {mu.get('present')} "
                      f"{(T('无明显节拍', 'no beat') if mu.get('no_beat') else (str(mu['tempo_bpm']) + 'BPM' if mu.get('tempo_bpm') is not None else ''))} {(mu.get('key') or {}).get('tonic', '')}{(mu.get('key') or {}).get('mode', '')} | "
                      f"{T('音效', 'SFX')}: {_sfx_count(b)} | {T('卡点', 'beat-synced')}: {a.get('beat_synced_edit')}"]
        if (b.get("sound_sources") or {}).get("summary_zh"):
            lines.append(f"{T('声音来源', 'Sound sources')}: " + b["sound_sources"]["summary_zh"])
        if (b.get("stems") or {}).get("ok"):
            lines.append(T("音轨: stems/original.wav（原声） stems/vocals.wav（人声） stems/music.wav（配乐）",
                           "Stems: stems/original.wav (original) stems/vocals.wav (voice) stems/music.wav (music)"))
    pk = b.get("packaging")
    if pk:
        tag = T("包装", "Packaging")
        lines += [""] + [f"{tag}: {x}" for x in (pk.get("summary_zh") or [T("没有检出后期叠加的文字或贴纸", "no overlaid text or stickers detected")])]
        low = [st for st in pk.get("stickers", []) if not st.get("in_picture") and st.get("confidence") in ("low", "vlm")]
        if low:
            lines.append(f"{tag}: " + T("需要看图确认的贴纸 ", "stickers to confirm by eye ") + join(f"{st['id']} {st['t0']:.1f}-{st['t1']:.1f}s" for st in low)
                         + T("（截图在 packaging/）", " (crops under packaging/)"))
        if pk.get("files"):
            lines.append(f"{T('包装文件', 'Packaging files')}: " + " ".join(pk["files"].values()))
    print("\n".join(lines))
    return 0


def _sfx_count(b: dict) -> str:
    sfx = (b.get("audio_plan") or {}).get("sfx_merged", [])
    maybe = sum(1 for e in sfx if e.get("confidence") == "low")
    sure = len(sfx) - maybe
    return f"{sure}" + (T(" + 可能 {m}（待确认）", " + {m} possible (unconfirmed)", m=maybe) if maybe else "")


def cmd_correct(args) -> int:
    """The user says a shot is wrong: fix this breakdown and remember the correction."""
    from .memory import correct
    from .pipeline import finalize

    out = Path(args.out_dir)
    b = read_json(out / "breakdown.json")
    real = None if args.real is None else args.real == "yes"
    try:
        logged = correct(b, label=args.label, real=real, shots=args.shots, start=args.start, end=args.end, note=args.note or "")
    except ValueError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 2
    b = finalize(b, out)
    changed = [f"{c['shot']} {c['before']}→{c['label']}" for c in logged if c.get("label") and c["before"] != c["label"]]
    print(f"已纠正 {len(logged)} 个镜头" + (("：" + ", ".join(changed)) if changed else "") + "，并记入记忆")
    print(f"结论: {b['summary']['verdict']}")
    return 0


def cmd_models(args) -> int:
    """List the generation models the capability map knows, or print how to write prompts for one of them."""
    from .plan import Planner
    from .production import _norm, prompting_md

    pl = Planner()
    live = {k: m for k, m in pl.models.items() if m.get("status") not in ("shutdown", "deprecated")}
    if not args.model:
        for cat, title in (("video", "视频"), ("image", "图像（出首帧 / 关键帧）"), ("character", "人物驱动")):
            print(f"{title}:")
            for mid, m in live.items():
                if m["category"] == cat:
                    lim = (m.get("limits") or {}).get("duration_s") or {}
                    extra = [f"≤{lim['max']:g}s" if lim.get("max") else "", "一次多镜头" if "video.multi_shot" in m["primitives"] else "",
                             "有提示词写法" if mid in pl.prompting else ""]
                    print(f"  {mid:22s} {m['name']}" + ("  · " + " · ".join(x for x in extra if x) if any(extra) else ""))
        print("\n看某个模型的提示词写法：rea-video models <id>；关键帧通用做法：rea-video models keyframes")
        return 0
    if args.model == "keyframes":
        print("关键帧通用做法：\n" + "\n".join(f"- {x}" for x in pl.keyframe_notes))
        return 0
    m = next((x for x in live.values() if _norm(x["id"]) == _norm(args.model)), None)
    if not m:
        print(f"rea-video: 能力地图里没有 {args.model}；rea-video models 列出全部", file=sys.stderr)
        return 2
    lim = m.get("limits") or {}
    d = lim.get("duration_s") or {}
    facts = [f"单次 {d.get('min', 0):g}–{d['max']:g}s" if d.get("max") else "", "可一次多镜头" if "video.multi_shot" in m["primitives"] else "",
             "首帧" if "video.i2v_first_frame" in m["primitives"] else "", "首尾帧" if "video.i2v_first_last" in m["primitives"] else "",
             "多参考" if "video.multi_reference" in m["primitives"] else "", "参考视频" if "video.reference_video" in m["primitives"] else "",
             "原生音频" if (m.get("audio") or {}).get("native") else ""]
    print(f"{m['id']} · {m['name']}" + (" · " + " · ".join(x for x in facts if x) if any(facts) else ""))
    if args.plan:  # re-plan an existing breakdown for this model: units, inputs and report are rewritten, the measurements stay
        from .pipeline import finalize

        out = Path(args.plan)
        b = read_json(out / "breakdown.json")
        set_lang(b.get("lang", "zh"))
        b = finalize(b, out, engine=m["id"])
        print(T("已按 {m} 重出复刻方案：{p}", "Remake plan redone for {m}: {p}", m=m["id"], p=b["summary"].get("production", "")))
    notes = pl.prompting.get(m["id"])
    if not notes:
        print("这个模型还没有记录提示词写法，按通用规则写。")
        return 0
    print("\n".join(prompting_md(notes, full=True)))
    if m["category"] == "video":
        print("\n关键帧通用做法：rea-video models keyframes")
    return 0


def cmd_prefs(args) -> int:
    from .memory import PREF_KEYS, add_note, load_prefs, remove_note, set_pref

    if args.key and args.value is None and "=" in args.key:  # also accept `prefs key=value`
        args.key, args.value = args.key.split("=", 1)
    if args.key and args.key not in PREF_KEYS:
        print(f"错误：未知偏好 {args.key}（可选：{', '.join(PREF_KEYS)}；用法 rea-video prefs <key> <value>）", file=sys.stderr)
        return 2
    try:
        if args.note:
            add_note(args.note)
        elif args.remove_note:
            remove_note(args.remove_note)
        elif args.key and args.unset:
            set_pref(args.key, None)
        elif args.key and args.value is not None:
            set_pref(args.key, args.value)
        elif args.key:
            print(load_prefs().get(args.key, ""))
            return 0
    except ValueError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 2
    prefs = load_prefs()
    for k, desc in PREF_KEYS.items():
        print(f"{k:<9} = {prefs.get(k, '（未设置）')}    # {desc}")
    for i, n in enumerate(prefs.get("notes", []), 1):
        print(f"说明 {i}: {n}")
    return 0


def cmd_memory(args) -> int:
    from .memory import export_labels, summary_lines

    if args.export_labels:
        n = export_labels(Path(args.export_labels))
        print(f"已导出 {n} 条视频的纠正到 {args.export_labels}（先把 path 填好，再用 rea-video eval 评测）")
        return 0
    print("\n".join(summary_lines()))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="rea-video", description="逆向拆解视频：逐镜头判断实拍 / AI 生成 / 代码渲染 / 混合，并生成复刻方案")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--env-file", help="额外的 .env（例如 capsule-cinema/.env，用于 VLM 配置）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("decompose", help="拆解一条视频")
    d.add_argument("video")
    d.add_argument("-o", "--out")
    d.add_argument("--vlm", action="store_true", help="启用多模态大模型（VLM）看画面逐镜判断；建议开，不开也能跑，只是实拍/AI/3D 的区分更弱")
    d.add_argument("--no-vlm", action="store_true", help="本次不开 VLM（覆盖 prefs 里的 vlm=on）")
    d.add_argument("--no-whole", action="store_true", help="跳过整片结构/文案 VLM 分析")
    d.add_argument("--no-ocr", action="store_true", help="不做 OCR（字幕/花字时间轴也会跳过，只剩贴纸检测）")
    d.add_argument("--ocr-lang", choices=OCR_LANGS, help="字幕/花字的语言：zh 中英（默认）、ja 日文（首次使用自动下载识别模型）；也可用 prefs ocr_lang 设成默认")
    d.add_argument("--no-packaging", action="store_true", help="跳过剪辑包装层（整片字幕时间轴、花字、贴纸/动图、音效卡点）；省掉约每分钟 30–50 秒")
    d.add_argument("--lang", choices=LANGS, help="报告、结论和 VLM 描述的语言：zh（默认）/ en；按用户提问的语言选，也可用 prefs lang 设成默认")
    d.add_argument("--workers", type=int, default=3)
    d.add_argument("--max-vlm-shots", type=int, default=60, help="最多发给 VLM 的调用数（默认 60；镜头更多时优先看最拿不准的，其余只靠确定性取证）")
    d.add_argument("--engine", help="复刻方案按哪个视频模型规划（rea-video models 列出的 id；默认 prefs 里的 engine，否则 seedance2.0）")
    d.add_argument("--meta", help='平台元数据 JSON，例如 {"music": {"title": "xx", "author": "yy", "is_original": false, "popular": true}}')
    d.add_argument("--no-asr", action="store_true", help="不做本地语音识别（装了 rea-video[asr] 才会做：在人声干声上识别台词和时间，首次使用下载约 160 MB 模型）")
    d.add_argument("--asr-lang", choices=ASR_LANGS, help="台词的语言：auto（默认，SenseVoice 自动识别中/英/日/韩/粤）、bn 孟加拉语（换用孟加拉语识别模型，首次使用自动下载约 90 MB）；也可用 prefs asr_lang 设成默认")
    d.add_argument("--no-speakers", action="store_true", help="不区分说话人（装了 rea-video[asr] 才会做：在人声干声上分出谁在什么时候说话，多人时每人输出一条 stems/voice_S1.wav；首次使用下载约 35 MB 模型）")
    d.add_argument("--no-stems", action="store_true", help="不做人声/配乐分离（默认会输出 stems/original.wav、vocals.wav、music.wav）")
    d.set_defaults(func=cmd_decompose)

    st = sub.add_parser("stems", help="只把声音剥离成 原声 / 人声 / 配乐 三条轨")
    st.add_argument("video")
    st.add_argument("-o", "--out")
    st.set_defaults(func=cmd_stems)

    p = sub.add_parser("probe", help="只看容器元数据/来源线索")
    p.add_argument("video")
    p.add_argument("--tags", action="store_true")
    p.set_defaults(func=cmd_probe)

    e = sub.add_parser("eval", help="在带标注的样本集上评测拆解准确率")
    e.add_argument("labels", help="labels.yaml")
    e.add_argument("-o", "--out", default="out/eval")
    e.add_argument("--vlm", action="store_true")
    e.add_argument("--no-ocr", action="store_true")
    e.add_argument("--ocr-lang", choices=OCR_LANGS, help="同 decompose --ocr-lang")
    e.add_argument("--fresh", action="store_true", help="不复用已有拆解结果")
    e.add_argument("--only", default="", help="只重新拆解这些 id（逗号分隔），其余复用缓存并重新分类")
    e.add_argument("--stems", action="store_true", help="对带音频真值的样本做人声分离，并在干声上重测唱/说")
    e.set_defaults(func=cmd_eval)

    c = sub.add_parser("capsule", help="导出 capsule-cinema 的视频分析 JSON（供生成胶囊草稿）")
    c.add_argument("breakdown")
    c.add_argument("-o", "--out")
    c.set_defaults(func=cmd_capsule)

    r = sub.add_parser("remake-plan", help="为 AI 类镜头生成 capsule-cinema 复刻任务")
    r.add_argument("breakdown")
    r.add_argument("--capsule-root", help="capsule-cinema 仓库；默认 $CAPSULE_CINEMA_ROOT、prefs capsule_root，再退到 ~/code/github/capsule-cinema")
    r.add_argument("--engine", help="换用另一个视频引擎；默认沿用拆解时的引擎")
    r.add_argument("--mode", default="first_last_frame", choices=["first_last_frame", "image_to_video", "text_to_video"])
    r.add_argument("--labels", default="", help="只复刻这些底层类别（逗号分隔），默认 ai_video,cg_3d,live_action,avatar,anim_2d,stop_motion")
    r.set_defaults(func=cmd_remake_plan)

    rr = sub.add_parser("remake-run", help="用 capsule-cinema 执行 remake-plan 生成的任务（会计费，先 --dry-run）")
    rr.add_argument("jobs", help="remake-plan 输出的 jobs.json")
    rr.add_argument("--capsule-root", help="须与 remake-plan 时一致；默认同 remake-plan")
    rr.add_argument("--dry-run", action="store_true", help="只列出任务和参数，不调用模型")
    rr.add_argument("--only", default="", help="只跑这些镜头（逗号分隔）")
    rr.add_argument("--python", help="capsule-cinema 的 Python；默认 $CAPSULE_CINEMA_PYTHON 或 <capsule-root>/.venv/bin/python")
    rr.set_defaults(func=cmd_remake_run)

    cd = sub.add_parser("capsule-draft", help="用拆解结果生成 capsule-cinema 胶囊草稿")
    cd.add_argument("breakdown")
    cd.add_argument("--capsule-root", help="capsule-cinema 仓库；默认 $CAPSULE_CINEMA_ROOT、prefs capsule_root，再退到 ~/code/github/capsule-cinema")
    cd.add_argument("--capsule-name", default="")
    cd.add_argument("--capsule-display-name", default="")
    cd.add_argument("--write-capsule", action="store_true", help="落盘到 capsule-cinema 的 capsules/")
    cd.add_argument("--overwrite-capsule", action="store_true")
    cd.add_argument("--python", help="capsule-cinema 的 Python；默认同 remake-run")
    cd.set_defaults(func=cmd_capsule_draft)

    a = sub.add_parser("assemble", help="把复刻结果按原时间线拼回，并输出对比视频")
    a.add_argument("breakdown")
    a.add_argument("results", help="remake-run 输出的 results.json（或自己写的同格式文件）")
    a.add_argument("-o", "--out")
    a.add_argument("--overlays", action="store_true",
                   help="把测得的字幕 / 花字 / 标题按原样式叠回换掉的镜头（保留原片的镜头本来就有）；贴纸只列出来，要自己找素材")
    a.set_defaults(func=cmd_assemble)

    t = sub.add_parser("tiles", help="按时间抽帧拼图，近距离检查某一段（agent 复核用）")
    t.add_argument("video")
    t.add_argument("--start", type=float, default=0.0)
    t.add_argument("--end", type=float)
    t.add_argument("--every", type=float, default=0.5)
    t.add_argument("--cols", type=int, default=6)
    t.add_argument("--cell", type=int, default=320)
    t.add_argument("--max", type=int, default=48)
    t.add_argument("-o", "--out", default="out/tiles.jpg")
    t.set_defaults(func=cmd_tiles)

    fr = sub.add_parser("frames", help="粒子镜头按场景切分，取原尺寸帧、测光晕 / 粒子颜色 / 粒子数，并从原片取粒子目标点（decompose 遇到粒子镜头会自动跑）")
    fr.add_argument("out_dir", help="decompose 的输出目录")
    fr.add_argument("--every", type=float, default=0.25, help="采样间隔秒数（默认 0.25）")
    fr.add_argument("--points", type=int, default=4000, help="每个场景取多少个目标点（默认 4000）")
    fr.add_argument("--all", action="store_true", help="所有镜头都做，不只是粒子镜头")
    fr.set_defaults(func=cmd_frames)

    cp = sub.add_parser("compare", help="逐帧给复刻打分（粒子 / 图形落在哪、形状重合度），列出最差的时刻并拼对比图")
    cp.add_argument("ref", help="原片")
    cp.add_argument("remake", help="复刻成片")
    cp.add_argument("--every", type=float, default=0.5, help="采样间隔秒数（默认 0.5）")
    cp.add_argument("--invert", choices=["auto", "yes", "no"], default="auto", help="复刻换了深浅底时先反相再比（默认自动判断）")
    cp.add_argument("--scenes", help="frames/scenes.json：按场景汇总分数")
    cp.add_argument("--worst", type=int, default=8, help="对比图里放几个最差时刻（默认 8）")
    cp.add_argument("-o", "--out", help="输出目录：compare.json 和 compare_worst.jpg")
    cp.set_defaults(func=cmd_compare)

    sm = sub.add_parser("summary", help="紧凑打印拆解结果（低置信镜头会被标出来）")
    sm.add_argument("breakdown")
    sm.set_defaults(func=cmd_summary)

    rl = sub.add_parser("videomd", help="从 breakdown.json 重新生成给模型读的拆片包（VIDEO.md + video/）；decompose 和 apply-review 会自动生成")
    rl.add_argument("out_dir")
    rl.add_argument("--check", action="store_true", help="只校验目录是否符合 VIDEO.md 规范（https://github.com/videomd/videomd），不重写")
    rl.set_defaults(func=cmd_videomd)

    pd = sub.add_parser("pdf", help="把 report.html 打印成 report.pdf（用本机的 Chrome / Chromium / Edge，折叠内容全部展开）")
    pd.add_argument("out_dir")
    pd.set_defaults(func=cmd_pdf)

    rv = sub.add_parser("review", help="能看图的 agent 当 VLM：生成逐镜看图任务和答案模板")
    rv.add_argument("out_dir", help="decompose 的输出目录")
    rv.add_argument("--force", action="store_true", help="覆盖已有的 review_answers.json")
    rv.set_defaults(func=cmd_review)

    ar = sub.add_parser("apply-review", help="把 agent 看图的答案并入结论，重写 breakdown.json 和报告")
    ar.add_argument("out_dir")
    ar.add_argument("answers", nargs="?", help="答案文件（默认 <out_dir>/review_answers.json）")
    ar.add_argument("--by", help="复核者名字（写进报告）")
    ar.add_argument("--lang", choices=LANGS, help="在这一步换报告语言：结论、证据和报告文字重新生成，VLM 已写好的描述和提示词保持原语言")
    ar.set_defaults(func=cmd_apply_review)

    co = sub.add_parser("correct", help="用户指出判错：改正这条视频的结论，并记入记忆（以后同类镜头会提示复核）")
    co.add_argument("out_dir", help="decompose 的输出目录")
    co.add_argument("--shots", help="镜头编号，逗号分隔（如 3,5 或 shot_003），all 表示整条；也可用 --start/--end 指定时间段")
    co.add_argument("--start", type=float)
    co.add_argument("--end", type=float)
    co.add_argument("--label", help="正确的底层类别：" + "、".join(LABELS))
    co.add_argument("--real", choices=["yes", "no"], help="是否用了用户真实素材")
    co.add_argument("--note", help="用户的原话或理由，例如「这是定格动画，不是 AI」")
    co.set_defaults(func=cmd_correct)

    mo = sub.add_parser("models", help="列出能力地图里的生成模型；带模型 id 时打印这个模型的提示词写法和关键帧要求")
    mo.add_argument("model", nargs="?", help="模型 id（如 seedance-2.5、kling-3.0）；keyframes 打印关键帧通用做法")
    mo.add_argument("--plan", metavar="OUT_DIR", help="把这个拆解目录的复刻方案改按该模型重出（不重新拆解）")
    mo.set_defaults(func=cmd_models)

    pf = sub.add_parser("prefs", help="查看 / 设置用户偏好（默认引擎、是否开 VLM、VLM 配置文件、复核者、自由文字说明）")
    pf.add_argument("key", nargs="?")
    pf.add_argument("value", nargs="?")
    pf.add_argument("--unset", action="store_true")
    pf.add_argument("--note", help="追加一条给 agent 看的偏好说明，例如「报告尽量短」")
    pf.add_argument("--remove-note", type=int, metavar="N")
    pf.set_defaults(func=cmd_prefs)

    me = sub.add_parser("memory", help="看记住了什么：偏好、常见纠正类型；可导出为评测样本")
    me.add_argument("--export-labels", metavar="YAML")
    me.set_defaults(func=cmd_memory)

    for sp in sub.choices.values():  # also accept `rea-video decompose x.mp4 --env-file ...`
        sp.add_argument("--env-file", default=argparse.SUPPRESS, help=argparse.SUPPRESS)

    args = ap.parse_args(argv)
    setup_logging(args.verbose)
    _env(args)
    from .media import MediaError

    try:
        return args.func(args)
    except MediaError as exc:  # missing ffmpeg / unreadable video: one line, not a traceback
        hint = ""
        if "not found on PATH" in str(exc):
            hint = T("\n安装 ffmpeg：macOS `brew install ffmpeg`，Ubuntu/Debian `sudo apt install ffmpeg`",
                     "\ninstall ffmpeg: macOS `brew install ffmpeg`, Ubuntu/Debian `sudo apt install ffmpeg`")
        print(f"rea-video: {exc}{hint}", file=sys.stderr)
        if args.verbose:
            raise
        return 2
    except FileNotFoundError as exc:  # wrong path to a video / breakdown.json / answers file
        if args.verbose:
            raise
        print("rea-video: " + T(f"找不到文件：{exc.filename}", f"file not found: {exc.filename}"), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
