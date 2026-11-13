"""decompose(): the end-to-end reverse-engineering pass for one video."""
from __future__ import annotations

import hashlib
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from . import SCHEMA, __version__
from .assets import detect_embedded, material_summary
from .audio import analyze_audio, merge_audio_with_vlm
from .sound_source import MUSIC_ZH, classify_sound_sources, per_clip_audio
from .classify import FILM_HINT_ZH, LABEL_ZH, OVERLAY_KIND_ZH, RULES, UNMEASURED, decide, deterministic, drop_scene_text, fuse, group_of, image_source_guess, overlay_layers, top, verdict_text, video_context
from .features import collect_samples, crop_box, intersect_box, photo_letterbox, shot_features
from .media import cut_clip, extract_frame, require_tools, video_info
from .overlay import ocr_frames, persistent_template, shot_ocr_frames, shot_ocr_items, static_overlays, summarize_text
from .plan import Planner
from .probe import provenance
from .motion import element_crops, motion_events, palette, strip_frames
from .shots import build_track, detect_shots
from .util import LOG, fmt_time, round_floats, write_json, read_image
from . import aspects
from .faces import shot_faces
from .visual import LABEL_SHORT, shot_sheet, storyboard
from .i18n import T, join, semi, set_lang
from .vlm import SHOT_PROMPT, TAKE_NOTE, WHOLE_PROMPT, VLMClient, VLMConfig, normalize_shot_result, normalize_whole, prompt_lang_note, shot_hints, take_results, vlm_note


def _sha256_head(path: Path, limit: int = 64 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        h.update(f.read(limit))
    return h.hexdigest()


TAKE_MAX_S, TAKE_MAX_PIECES = 12.0, 8  # one VLM look at most this long / this many jump-cut pieces


def vlm_units(records: list[dict], max_calls: int) -> list[list[dict]]:
    """Group shots for the VLM: jump-cut pieces of one take (same camera setup, cut apart in the edit) are one
    clip and one call; every other shot is its own call. Past `max_calls`, the calls go to the units the
    pixel statistics are least sure about, weighted by length, rather than to the first ones in the video."""
    units: list[list[dict]] = []
    for r in records:
        u = units[-1] if units else None
        if (u and r.get("transition_in") == "jump" and len(u) < TAKE_MAX_PIECES
                and r["end"] - u[0]["start"] <= TAKE_MAX_S):
            u.append(r)
        else:
            units.append([r])
    if len(units) <= max_calls:
        return units

    def need(u: list[dict]) -> float:
        sure = min(top(r["deterministic"]["probs"])[1] for r in u)
        return (u[-1]["end"] - u[0]["start"]) * (1.05 - sure)

    keep = sorted(sorted(range(len(units)), key=lambda k: -need(units[k]))[:max_calls])
    return [units[k] for k in keep]


# modules that only run in finalize(): a change there needs no new decode. Everything else measures the video.
_FINALIZE_ONLY = {"classify.py", "report.py", "plan.py", "production.py", "entities.py", "narrative.py", "review.py", "cli.py",
                  "evaluate.py", "remake.py", "memory.py", "i18n.py", "visual.py", "sound_source.py", "__init__.py"}
_DECODE_FP: str | None = None


def decode_fingerprint() -> str:
    """Hash of the code that measures a video (decode, shots, features, audio, packaging). `rea-video eval`
    reuses a stored breakdown only while this is unchanged, so a change to the measuring code cannot hide behind
    features cached from the old code."""
    global _DECODE_FP
    if _DECODE_FP is None:
        import hashlib

        root = Path(__file__).parent
        h = hashlib.sha1()
        for f in sorted([*root.glob("*.py"), *root.glob("aspects/*.py")]):
            if f.name not in _FINALIZE_ONLY or f.parent != root:
                h.update(f.name.encode() + f.read_bytes())
        _DECODE_FP = h.hexdigest()[:16]
    return _DECODE_FP


def decompose(video: str | Path, out_dir: str | Path, *, use_vlm: bool = False, whole_vlm: bool = True,
              ocr: bool = True, workers: int = 3, engine: str = "seedance2.0", max_shots_vlm: int = 60,
              platform_meta: dict | None = None, stems: bool = True, memory: bool = True, packaging: bool = True, asr: bool = True,
              lang: str = "zh", speakers: bool = True) -> dict:
    lang = set_lang(lang)
    require_tools()
    t0 = time.time()
    video = Path(video).expanduser().resolve()
    out = Path(out_dir).expanduser().resolve()
    (out / "shots").mkdir(parents=True, exist_ok=True)
    info = video_info(video)
    prov = provenance(info)
    LOG.info("video %s %dx%d %.2ffps %.2fs", video.name, info.width, info.height, info.fps, info.duration)

    track = build_track(str(video), info)
    shots = detect_shots(track)
    LOG.info("detected %d shots", len(shots))
    marks = [s.t(b) for s in shots for b in s.beats]
    audio = analyze_audio(str(video), [s.start for s in shots[1:]], marks) if info.has_audio else {"has_audio": False}
    stems_job = None
    if info.has_audio and stems:  # strip the soundtrack: original.wav / vocals.wav / music.wav
        from .audio import refine_with_stems
        from .stems import extract_stems

        def run_stems() -> dict:
            got = extract_stems(video, out)
            if got.get("ok"):
                refine_with_stems(audio, got["vocals"])  # only rewrites the vocal-style fields, read after the shot loop
            return got

        # the separation model runs in native code and leaves the shot analysis free to run alongside it
        LOG.info("separating stems (vocals / music) in the background")
        stems_pool = ThreadPoolExecutor(max_workers=1)
        stems_job = stems_pool.submit(run_stems)
        stems_pool.shutdown(wait=False)

    # ---------------- packaging layer: subtitles / 花字 / stickers on one timeline ---------------
    pack = None
    if packaging:
        from .packaging import analyze as analyze_packaging, anchored_sfx, visual_events

        LOG.info("packaging layer: subtitle timeline, 花字, stickers%s", "" if ocr else " (no OCR: stickers only)")
        pack = analyze_packaging(video, info, [s.start for s in shots[1:]], out, ocr=ocr,
                                 speech=bool((audio.get("voice") or {}).get("present")) if audio.get("has_audio") else False)
        if info.has_audio:
            ev = [e for e in visual_events(pack["text_cues"], pack["stickers"], []) if e["type"] != "subtitle_in"]
            pack["sfx_anchored"] = anchored_sfx(video, ev, (audio.get("sfx") or {}).get("events", []))
        pack["version"] = PACKAGING_VERSION
    ocr_items = pack.pop("_ocr_items", None) if pack else None  # whole-video OCR hits, reused per shot below
    ocr_step = float((pack or {}).get("ocr", {}).get("step_s") or 0.0)

    shot_records: list[dict] = []
    template_frames: list[np.ndarray] = []
    samples_by_shot = {}
    for s in shots:
        smp = collect_samples(str(video), info, s)
        samples_by_shot[s.index] = smp
        if smp.frames:
            template_frames.extend([smp.frames[0], smp.frames[-1]])
    template = persistent_template(template_frames[:60]) if len(shots) >= 2 else {"frozen_ratio": 0.0, "boxes": []}

    from .packaging import clean_region

    still_pool = ThreadPoolExecutor(max_workers=4)
    stills = []
    for s in shots:
        smp = samples_by_shot[s.index]
        crop = clean_region(pack["stickers"], s.start, s.end) if pack else None
        # a film / TV clip letterboxed into the frame: black bars read as flat, frozen, few-colour "rendered" pixels,
        # so the picture is measured inside its box
        lbox = photo_letterbox(smp.frames)
        if lbox:
            crop = intersect_box(lbox["box"], crop)
        # a sticker / GIF sitting on the shot would skew the picture statistics: measure the rest of the frame
        feats = shot_features(collect_samples(str(video), info, s, crop=crop) if crop else smp, info.fps)
        if lbox:
            feats.update(picture_box=[round(v, 4) for v in lbox["box"]], picture_aspect=round(lbox["aspect"], 3),
                         bar_share=round(lbox["bar_share"], 3))
        if crop and not lbox:
            feats["measured_region"] = list(crop)
        ov = static_overlays(smp.frames)
        if ocr:
            hits = shot_ocr_items(ocr_items, ocr_step, s.start, s.end)
            if hits is None:  # no whole-video pass, or too sparse here: read a few of this shot's own frames
                hits = ocr_frames(smp.frames, smp.frame_times, max_frames=shot_ocr_frames(s.duration))
            text = summarize_text(hits)
        else:
            text = {"tracks": [], "text_coverage": 0.0, "items": []}
        embedded = detect_embedded(smp.frames, text.get("items"))
        # faces, framing and light are read on the picture itself (inside the letterbox), not on the bars
        pic = [crop_box(f, lbox["box"]) for f in smp.frames] if lbox else smp.frames
        fd = shot_faces(pic)
        faces = fd["presence"]
        areas = [p["face"]["area"] for p in fd["frames"] if p.get("face")]
        feats["face_presence"] = faces
        feats["face_area"] = float(np.median(areas)) if areas else 0.0
        asp = aspects.measure_shot(pic, fd, feats, s.duration)
        probs, evidence, facts = deterministic(feats, ov, text, faces, audio, prov, fps=info.fps)
        layers = overlay_layers(ov, text, template)
        sid = f"shot_{s.index:03d}"
        shot_sheet(smp.frames, smp.frame_times, out / "shots" / f"{sid}.jpg")
        still_w = min(1080, info.display_size[0] or 1080)  # never upscale; rotated video: displayed width
        # full-resolution first / last frames (remake keyframes): ffmpeg runs in the background while the next shot is measured
        stills.append(still_pool.submit(extract_frame, video, s.start + min(0.05, s.duration / 4), out / "shots" / f"{sid}_first.jpg", still_w))
        stills.append(still_pool.submit(extract_frame, video, max(s.start, s.end - min(0.08, s.duration / 4)),
                                        out / "shots" / f"{sid}_last.jpg", still_w))
        motion = None
        if top(probs)[0] in ("code_render", "screen_capture") or facts.get("graphic_score", 0.0) >= 0.5:
            # rendered picture: element-level motion timeline, key-frame strip and hex palette for a code remake
            motion = motion_events(video, info, s.start, s.duration, text.get("items"))
            sframes, stimes = strip_frames(video, info, s.start, s.duration)
            if sframes:
                shot_sheet(sframes, stimes, out / "shots" / f"{sid}_strip.jpg", n=len(sframes), cell_w=200)
                motion["palette"] = palette(sframes[-1])
                motion["palette_start"] = palette(sframes[0])
                if facts.get("fine_dark", 0.0) > 0.5:  # particles: the frame average is the black ground, keep the dots' own colours
                    from .particles import lit_palette

                    motion["dots"] = lit_palette(sframes)
            sheet = element_crops(video, info, s.start, s.end, motion, out / "shots", sid, min(1080, info.display_size[0] or 1080))
            if sheet:
                motion["elements_sheet"] = sheet
        rec = {
            "id": sid, **s.to_dict(), "features": round_floats(feats), "faces": round(faces, 3),
            "aspects": round_floats(asp), "overlay": round_floats(ov), "text": text, "layers": layers, "embedded_assets": round_floats(embedded),
            "deterministic": {"probs": round_floats(probs), "evidence": evidence, "facts": facts},
            "assets": {"sheet": f"shots/{sid}.jpg", "first_frame": f"shots/{sid}_first.jpg", "last_frame": f"shots/{sid}_last.jpg"},
            "vlm": None,
        }
        if motion is not None:
            rec["motion"] = round_floats(motion)
            if (out / "shots" / f"{sid}_strip.jpg").exists():
                rec["assets"]["strip"] = f"shots/{sid}_strip.jpg"
        shot_records.append(rec)
        dl, dp = top(probs)
        LOG.info("%s %s-%s det=%s(%.0f%%) %s", sid, fmt_time(s.start), fmt_time(s.end), dl, dp * 100, facts.get("temporal_family"))

    for job in stills:
        job.result()
    still_pool.shutdown()

    # ---------------- VLM pass ------------------------------------------------------
    # "used" means at least one VLM answer actually came back; "status" says why not otherwise.
    vlm_info = {"used": False, "requested": use_vlm, "status": "off"}
    whole = None
    if use_vlm:
        cfg = VLMConfig.from_env()
        if cfg is None:
            LOG.warning("--vlm requested but no VLM config found (REA_VLM_* / VIDEO_ANALYSIS_* / GEMINI3_*); continuing without it")
            vlm_info = {"used": False, "requested": True, "status": "not_configured", "error": "no_config"}
        else:
            client = VLMClient(cfg, out / "vlm_cache")
            vlm_info = {"used": False, "requested": True, "status": "failed", "model": cfg.describe(), "media": cfg.media, "errors": []}

            def run_unit(unit: list[dict]) -> None:
                """One VLM call per unit: a single shot, or the jump-cut pieces of one take seen as one clip."""
                first, last = unit[0], unit[-1]
                span = last["end"] - first["start"]
                media = []
                if cfg.media in ("both", "frames"):
                    mid = unit[len(unit) // 2]
                    media += [(out / first["assets"]["first_frame"], "image/jpeg"), (out / mid["assets"]["sheet"], "image/jpeg"),
                              (out / last["assets"]["last_frame"], "image/jpeg")]
                lead = max(unit, key=lambda r: r["duration"])
                dl, dp = top(lead["deterministic"]["probs"])
                prompt = SHOT_PROMPT.format(hints=shot_hints(lead["features"], lead["deterministic"]["facts"], dl, dp))
                if len(unit) > 1:
                    prompt += TAKE_NOTE.format(n=len(unit), cuts=", ".join(f"{r['start'] - first['start']:.2f}" for r in unit[1:]))
                prompt += prompt_lang_note()
                fallback = None
                try:
                    if cfg.media in ("both", "video"):  # a clip that fails to encode costs this unit its video, not the run
                        clip = cut_clip(video, first["start"], min(span, 12.0), out / "clips" / f"{first['id']}.mp4", width=480)
                        media.insert(0, (clip, "video/mp4"))
                    raw = client.ask_json(prompt, media)
                except Exception as exc:  # keep going; deterministic result stands
                    raw = None
                    if cfg.media == "both":
                        try:
                            raw = client.ask_json(prompt, [m for m in media if m[1] != "video/mp4"])
                            fallback = "frames_only"
                        except Exception as exc2:  # pragma: no cover
                            exc = exc2
                    if raw is None:
                        vlm_info["errors"].append(f"{first['id']}: {str(exc)[:160]}")
                        return
                answers = take_results(raw, len(unit)) if len(unit) > 1 else [raw]
                for i, (rec, ans) in enumerate(zip(unit, answers)):
                    rec["vlm"] = normalize_shot_result(ans)
                    if fallback:
                        rec["vlm"]["_fallback"] = fallback
                    if len(unit) > 1:
                        rec["vlm"]["take"] = {"shots": [r["index"] for r in unit], "piece": i + 1}

            units = vlm_units(shot_records, max_shots_vlm)
            with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
                list(pool.map(run_unit, units))
            if whole_vlm:
                try:
                    low = cut_clip(video, 0, info.duration, out / "clips" / "whole_480p.mp4", width=480, audio=True, crf=30)
                    cuts = ", ".join(f"{r['start']:.2f}" for r in shot_records)
                    whole = normalize_whole(client.ask_json(WHOLE_PROMPT.format(shots=cuts) + prompt_lang_note(), [(low, "video/mp4")],
                                                             # a long video has more lines, effects and segments to list: a fixed budget cut
                                                             # the answer off mid-JSON and the whole pass was paid for and lost
                                                             max_tokens=int(min(16000, max(6000, 2000 + 100 * info.duration)))))
                except Exception as exc:
                    vlm_info["errors"].append(f"whole: {str(exc)[:160]}")
            asked = [r for u in units for r in u]
            ok_shots = sum(1 for r in asked if r.get("vlm"))
            vlm_info.update(ok_shots=ok_shots, asked_shots=len(asked), total_shots=len(shot_records), calls=len(units), whole_ok=whole is not None)
            if ok_shots == len(asked) and (whole is not None or not whole_vlm):
                vlm_info.update(used=True, status="ok")
            elif ok_shots or whole is not None:
                vlm_info.update(used=True, status="partial")
            else:
                LOG.warning("VLM: every call failed (%s); result is deterministic only", (vlm_info["errors"] or ["?"])[0])

    stem_info: dict = stems_job.result() if stems_job else {}
    heard: dict = {}
    who: dict = {}
    on_stem = bool(stem_info.get("ok"))
    voice_src = stem_info["vocals"] if on_stem else video  # music under the voice confuses speaker and speech models alike
    if speakers and info.has_audio and (audio.get("voice") or {}).get("style") != "singing":  # a song: nothing to tell apart
        from . import speakers as spk

        if spk.available():
            LOG.info("separating speakers (%s)", "vocal stem" if on_stem else "full mix")
            who = dict(spk.diarize(voice_src), source="vocals_stem" if on_stem else "mix")
            if who.get("ok"):
                spk.name_speakers(who, [ln for ln in (((whole or {}).get("narration") or {}).get("lines") or []) if isinstance(ln, dict)])
                if on_stem and who.get("count", 0) >= 2:  # one track per speaker; with a single voice that is vocals.wav itself
                    who["tracks"] = spk.write_tracks(stem_info["vocals"], who["turns"], out)
        else:
            who = {"ok": False, "reason": "not_installed"}
    if asr and info.has_audio:
        from . import speech

        if speech.available():  # optional extra; on the vocal stem when there is one, music makes a recognizer invent words
            LOG.info("transcribing speech (%s)", "vocal stem" if on_stem else "full mix")
            heard = dict(speech.transcribe(voice_src, turns=who.get("turns") if who.get("count", 0) >= 2 else None),
                         source="vocals_stem" if on_stem else "mix")
        else:
            heard = {"ok": False, "reason": "not_installed"}
    breakdown = {
        "schema": SCHEMA, "tool": {"name": "rea-video", "version": __version__}, "lang": lang,
        "source": {"path": str(video), "filename": video.name, "sha256_head": _sha256_head(video), "width": info.width,
                   "height": info.height, "fps": round(info.fps, 3), "duration": round(info.duration, 3), "vcodec": info.vcodec,
                   "aspect_ratio": info.aspect_ratio, "has_audio": info.has_audio, "rotation": info.rotation},
        "provenance": {k: v for k, v in prov.items() if k != "tags"}, "summary": {},
        "audio": round_floats(audio), "global_layers": round_floats(template), "whole_video_vlm": whole,
        "shots": shot_records, "analysis": {"vlm": vlm_info, "ocr": ocr, "seconds": round(time.time() - t0, 1), "decode_fp": decode_fingerprint()},
        "assets": {"storyboard": "storyboard.jpg"},
        "platform_meta": platform_meta or {},
        "stems": {k: (Path(v).name if k in ("original", "vocals", "music") else v) for k, v in stem_info.items()},
        "speech": heard,
        "speakers": who,
        "per_clip_audio": per_clip_audio(str(video), [s.start for s in shots[1:]], info.duration) if info.has_audio else {},
    }
    if pack is not None:
        breakdown["packaging"] = round_floats(pack)
    if memory:
        from .memory import reapply

        n = reapply(breakdown)
        if n:
            LOG.info("re-applied %d earlier user correction(s) for this file", n)
    if any(((r.get("deterministic") or {}).get("facts") or {}).get("fine_dark", 0.0) > 0.5 for r in shot_records):
        from .particles import scene_frames

        LOG.info("particle shots: scenes, full-size frames and target points (frames/)")
        try:  # an extra for the remake: a failure here must not lose the breakdown and report
            sc = scene_frames(out, breakdown=breakdown)
            breakdown["particle_scenes"] = {"file": "frames/scenes.json", "count": len(sc["scenes"])}
        except Exception as exc:  # noqa: BLE001
            LOG.warning("particle scenes skipped (%s: %s); rerun with `rea-video frames %s`", type(exc).__name__, exc, out)
    finalize(breakdown, out, engine=engine)
    LOG.info("done in %.1fs -> %s", time.time() - t0, out)
    return breakdown


DOUBT_CAP = 0.7
PACKAGING_VERSION = 2


PULLDOWN_24 = ("24→30", "24→60", "25→30?")


def _ai_or_live_doubt(label: str, facts: dict, prov: dict, vctx: dict, seen_live: float = 0.0,
                      seen: bool = True) -> str | None:
    """On platform-transcoded files only two things settle AI vs live action: an AIGC label (AI) or a
    native-30fps camera signature (live). Without them, cap the confidence and say why.
    24fps-source pulldown alone is not decisive: AI video, stop motion and cinema cameras all produce it.
    seen_live: how strongly the image readers (VLM / agent) think the shot was filmed."""
    if label not in ("ai_video", "live_action") or prov.get("aigc"):
        return None
    hints = facts.get("film_hints") or []
    if hints and not seen:
        # a letterboxed picture: a film recap or compilation looks exactly like this, and so can an AI drama
        return T("{l}还是影视片段待确认：{h}；剪进来的影视剧画面和{l}在像素上分不开，需要看图（认得出的演员或剧集、台标、群演和布景的规模）",
                 "{l} or film / TV footage, to confirm: {h}; a clip cut from a film or series cannot be told from {l} by pixels, needs an image reader "
                 "(recognisable actors or series, a channel logo, the scale of extras and sets)",
                 l=LABEL_ZH[label], h=join(FILM_HINT_ZH[k] for k in hints))
    if label == "ai_video" and facts.get("pulldown") in PULLDOWN_24 and not (prov.get("hints") or {}).get("generator"):
        # a cinema / mirrorless camera shooting 24p and exported at 30 fps leaves the same cadence as a generator:
        # measured on a phone clip converted 30 -> 24 -> 30, the tools call it AI at 89%
        if seen_live >= 0.5:
            return T("AI 还是 24p 相机实拍待确认：帧率痕迹只说明素材是 24fps 源，看图的一方认为是实拍，又没有 AIGC 标识",
                     "AI or 24p camera footage, to confirm: the frame-rate marks only say the source was 24fps, the image reader calls it live action, and there is no AIGC label")
        if not seen:
            return T("AI 还是 24p 相机实拍 / 影视片段待确认：只有帧率证据（24fps 源，电影和电视剧也是这个帧率）、没有 AIGC 标识，需要看图确认",
                     "AI, 24p camera footage or film / TV footage, to confirm: only frame-rate evidence (a 24fps source, which films and TV share) and no AIGC label, needs an image reader")
    if label == "ai_video" and facts.get("pulldown") == "interpolated" and not (prov.get("hints") or {}).get("generator"):
        # a sharpness rhythm with no duplicate frames: a re-encode whose platform tags were stripped leaves the same rhythm
        if seen_live >= 0.5:
            return T("AI 还是实拍待确认：只有清晰度节奏、没有重复帧（重新压缩也会留下），看图的一方认为是实拍，又没有 AIGC 标识",
                     "AI or live action, to confirm: only a sharpness rhythm and no duplicate frames (re-encodes leave it too), the image reader calls it live action, and there is no AIGC label")
        return T("AI 还是实拍待确认：只有清晰度节奏、没有重复帧（重新压缩也会留下）、没有 AIGC 标识，需要看图确认",
                 "AI or live action, to confirm: only a sharpness rhythm, no duplicate frames (re-encodes leave it too) and no AIGC label, needs an image reader")
    fps = vctx.get("fps") or 0
    if (label == "ai_video" and not seen and not facts.get("pulldown") and not facts.get("transcode_degraded")
            and not (prov.get("hints") or {}).get("generator") and not 23.5 <= fps <= 25.5):
        # a 30/60 fps file with no frame-rate marks and no label (a native 24/25 fps file is itself a generator's rate):
        # the AI call rests on the picture being clean (little sensor noise). Platform
        # re-encodes (X, YouTube, Bilibili ... downloads, and any file whose platform tags were stripped) wipe the noise too
        return T("AI 还是实拍待确认：没有 24fps 源的重复帧、没有 AIGC 或生成工具标识，判 AI 主要靠画面干净、传感器噪声少；"
                 "从平台下载、重新压缩过的实拍也会这样，需要看图确认",
                 "AI or live action, to confirm: no 24fps-source duplicate frames and no AIGC / generator label, so the AI call rests on a clean "
                 "picture with little sensor noise; live footage downloaded from a platform or re-compressed looks the same, needs an image reader")
    if not facts.get("transcode_degraded"):
        return None
    if label == "live_action" and not facts.get("pulldown"):
        if vctx.get("native30") or (facts.get("native_cadence") and seen_live >= 0.5):
            return None  # camera cadence on the file, or on this shot plus an image reader that saw filmed footage
        return T("实拍还是 AI 待确认：平台转码抹掉了噪声证据，这一镜没有 24fps 源的重复帧，但整片不是原生 30fps，需要看图确认",
                 "Live action or AI, to confirm: the platform transcode erased the noise cues; this shot carries no 24fps-source duplicate frames, but the file is not native 30fps throughout, needs an image reader")
    if label == "ai_video":
        return T("实拍 / 定格还是 AI 待确认：没有 AIGC 标识；24fps 源痕迹在 AI、定格动画、电影机拍摄里都会出现",
                 "Live action / stop motion or AI, to confirm: no AIGC label; 24fps-source marks appear in AI video, stop motion and cinema-camera footage alike")
    return T("实拍还是 AI 待确认：画面源自 24fps 素材且没有 AIGC 标识，不是手机原生 30fps 的特征",
             "Live action or AI, to confirm: the picture comes from 24fps material with no AIGC label, not the signature of native 30fps phone footage")


def _user_real(material: dict, real: bool) -> None:
    """Apply the user's answer to "does this shot use real (user-supplied) material?"."""
    if real and not material["has_real_material"]:
        material["items"].append({"kind": "user_marked", "kind_zh": T("用户标注的真实素材", "real material marked by the user"), "region": "unknown",
                                  "real_material": True, "source": "user"})
    if not real:
        for it in material["items"]:
            if it.get("real_material"):
                it["real_material"] = False
                it["note"] = T("用户纠正：不是真实素材", "User correction: not real material")
    material["has_real_material"] = real
    if real and material["origin"] in ("ai_generated", "rendered", "unknown"):
        material["origin"], material["origin_zh"] = "mixed", T("混合（含真实素材）", "mixed (includes real material)")
    if not real and material["origin"] in ("real", "mixed"):
        material["origin"], material["origin_zh"] = "unknown", T("待确认（用户说不是真实素材）", "to confirm (user says it is not real material)")
    material["user_corrected"] = True


def visual_opinion(rec: dict) -> dict | None:
    """What a model saw in the shot: the VLM answer, an agent's review (rea-video apply-review), or both averaged."""
    v, a = rec.get("vlm"), rec.get("review")
    if not (v and a):
        return v or a
    merged = dict(v)
    merged["label_probs"] = {k: (v["label_probs"].get(k, 0.0) + a["label_probs"].get(k, 0.0)) / 2 for k in LABEL_ZH}
    merged["embedded_assets"] = (v.get("embedded_assets") or []) + (a.get("embedded_assets") or [])
    return merged


AI_LIVE_AXIS = ("ai_video", "live_action", "avatar")


MUSIC_STEM_SILENT_DB = -50.0  # accompaniment stem this quiet holds no music (eval case dual_role: -60 dB; quiet BGM in eval daihuo: -33 dB)
SCENE_SOUND_LABELS = ("live_action", "ai_video", "avatar", "film_footage", "stop_motion", "anim_2d")  # pictures that come with their own sound


def reviewer_name(by: str) -> str:
    """How a reviewer is named in the report: an AI assistant as such (no model name), a person by their name."""
    from .report import _AGENTS

    return T("AI 助手", "AI assistant") if str(by).lower() in _AGENTS else str(by)


def _placed_in_edit(e: dict, cuts: list[float] | None = None) -> bool:
    """An effect added in the edit: it lands on a text pop or a sticker, or it sits alone (loud, with digital silence
    around it on the effects track) on a cut. A sound that only meets a cut is not enough: filmed and generated shots
    start with their own action sounds and the live sound jumps at every cut (eval cases v11 / v12: a box set down,
    fruit dropping in, a lid twisted, all on cuts)."""
    on = e.get("on") or {}
    t = float(e.get("t", -9))
    at_cut = any(abs(t - c) <= 0.2 for c in cuts or [])
    # a subtitle that changes at a cut is the cut itself (eval case unboxing: tearing sounds on every cut, the line
    # changing with it), so a text or sticker pop counts only away from a cut
    if on and on.get("type") != "cut" and not at_cut:
        return True
    return bool(on) and float(e.get("level_db", -99)) >= -30 and float(e.get("bed_db", 0)) <= -80


def _label_at(shots: list[dict], t: float) -> str | None:
    r = next((r for r in shots if r["start"] <= t < r["end"]), None)
    return (r.get("base") or {}).get("label") if r else None


def _vlm_gate(rec: dict, vprobs: dict | None, vctx: dict) -> dict | None:
    """When only one image reader answered (the VLM, or an agent review, not both), let it decide only where
    image readers have proved reliable. Measured on eval/articles + holdout + holdout2: they fix 3D vs
    code-render vs screen-capture confusions, but on the AI / live-action / avatar axis they are confidently
    wrong, where the tools have frame-rate and container evidence. With both readers, _majority arbitrates.
    Returns the probs to fuse, or None to ignore them."""
    if not vprobs or (rec.get("review") and rec.get("vlm")):
        return vprobs
    facts = rec["deterministic"]["facts"]
    ranked = sorted(rec["deterministic"]["probs"].items(), key=lambda kv: -kv[1])
    (d, dp), (_, sp) = ranked[0], ranked[1]
    v = top(vprobs)[0]
    # a photographic answer on a shot with a person in it (a big face, a dim shot with a face, or a face over
    # RULES["big_face"]["area"]) overrides texture cues that rank "rendered" first: plain walls, crushed shadows and
    # screenshots pasted over the person all look flat after a transcode
    # Only when the tools' top two include a rendered label: inside the AI / live / avatar axis the tools' frame-rate
    # evidence still decides (eval holdout2 dual_role_realcat: Gemini calls an AI presenter "avatar").
    rendered_top = d not in AI_LIVE_AXIS or ranked[1][0] not in AI_LIVE_AXIS
    person = (v in AI_LIVE_AXIS and rendered_top
              and bool(facts.get("big_face") or facts.get("lowlight") or facts.get("face_area", 0) >= RULES["big_face"]["area"]))
    if v in UNMEASURED:  # 2D animation / stop motion: the tools cannot score them, so they cannot back them either
        return vprobs
    # the tools are undecided when no label reaches 0.4 and the reader's pick trails the runner-up by a hair:
    # a lip macro with no face found scores 3D 0.35 / AI 0.27 / live 0.22 (issue #8 #22-#27), which is no call
    undecided = dp < 0.4 and vprobs.get(v, 0.0) > 0 and rec["deterministic"]["probs"].get(v, 0.0) >= 0.15 \
        and sp - rec["deterministic"]["probs"].get(v, 0.0) <= 0.08
    # inside the tools' first group (3D vs code render: both "rendered") the reader picks the subtype; the tools
    # only measured "rendered texture", which is the part the reader cannot see wrong (particle explainer #5 / #21:
    # tools 3D then AI, reader code render)
    same_group = group_of(v) == group_of(d) == "rendered"
    # an agent review is the only reader: it looked at the frames with the tools' evidence beside it and the rules in
    # SKILL.md, so it may pick a label outside the tools' top two (eval daihuo: a camera filming a real phone reads
    # as 3D / code render after a transcode, tools 40% / agent 97.5%). Hard frame-rate evidence below still wins.
    # The exception holds only when fusing actually lands on the agent's pick; a compromise label nobody voted for
    # is worse than the tools' call (eval holdout2 dual_role_realcat: agent "still image move" + tools "code render"
    # fused to "AI video").
    agent_only = bool(rec.get("review")) and not rec.get("vlm") \
        and decide(fuse(rec["deterministic"]["probs"], vprobs, facts.get("temporal_family", "dynamic")))[0] == v
    if v not in (d, ranked[1][0]) and not person and not undecided and not same_group and not agent_only:  # it must back one of the tools' two best guesses
        return None
    # the tools' confidence only protects the AI / live axis (frame-rate evidence), not a "rendered" texture call
    if (d in AI_LIVE_AXIS or v in AI_LIVE_AXIS) and not (person and d not in AI_LIVE_AXIS):
        # a sharpness rhythm alone (pulldown "interpolated", no duplicate frames) is not frame-rate evidence
        if dp >= 0.65 and dp - sp >= 0.25 and facts.get("pulldown") != "interpolated":  # tools are sure: frame-rate evidence beats "looks real / looks like a presenter"
            return None
    if (v == "live_action" and facts.get("transcode_degraded") and not vctx.get("native30")
            and not facts.get("native_cadence") and not (agent_only and not facts.get("pulldown"))):
        # transcoded 24fps-source footage never becomes live action on looks alone; a shot that itself carries
        # no duplicate frames in a 30 fps file has the camera cadence, so the reader's eye decides there
        # (issue #8 lipstick ad: AI opener with pulldown + 75 s of phone footage without, whole-video native30 False)
        return None
    return vprobs


def _majority(rec: dict) -> str | None:
    """The tools' top label when one of the two image readers (VLM, agent review) puts the same group first
    (generated / filmed / rendered ..., classify.GROUPS) and the other does not: "AI video" from the tools and
    "avatar" from the agent are two votes for "generated". Not the reverse: VLM and agent tend to misread the same picture the same way (measured on
    eval/articles.yaml and holdout2), so their agreement against the tools is left to the normal fusion."""
    v, a = ((rec.get(k) or {}).get("label_probs") for k in ("vlm", "review"))
    if not (v and a and sum(v.values()) > 0 and sum(a.values()) > 0):
        return None
    d = top(rec["deterministic"]["probs"])[0]
    if (top(v)[0] == d) != (top(a)[0] == d):  # same subtype: tools + agent say code render, the VLM says 3D
        return d
    gd, gv, ga = group_of(d), _top_group(v), _top_group(a)
    if (gv == gd) != (ga == gd):
        return d
    # the two readers disagree with each other and with the tools' first choice: side with the one that backs the
    # tools' runner-up (qing_mv #29: tools 3D then AI video, agent AI video, VLM live action -> AI video)
    ranked = sorted(rec["deterministic"]["probs"].items(), key=lambda kv: -kv[1])
    if gv != ga and len(ranked) > 1 and ranked[1][1] >= 0.15:
        d2 = ranked[1][0]
        if (gv == group_of(d2)) != (ga == group_of(d2)):
            return d2
    return None


def _top_group_label(probs: dict[str, float]) -> str:
    """The best label inside the group with the most probability."""
    g = _top_group(probs)
    return max((k for k in probs if group_of(k) == g), key=probs.get)


def _top_group(probs: dict[str, float]) -> str:
    g: dict[str, float] = {}
    for k, p in probs.items():
        g[group_of(k)] = g.get(group_of(k), 0.0) + p
    return max(g, key=g.get)


def _agent_review_dispute(dt: str, vt: dict | None, rv: dict | None, reviewed: bool, decided: str) -> str | None:
    """An agent-only review (no VLM) disagreeing with the tools on the AI/live axis cannot flip
    the label — the fusion deliberately follows the tools there (eval-calibrated, see _vlm_gate)
    — but the disagreement must stay visible instead of hiding inside a confident-looking label.
    Mirrors the VLM disputed flag above."""
    if decided == "user" or vt or not rv or sum(rv.values()) == 0 or reviewed:
        return None
    if (group_of(_top_group_label(rv)) == "live_action") != (group_of(dt) == "live_action"):
        return T("工具判{d}、看图复核判{r}，融合规则在 AI/实拍轴上跟了工具（评测校准）：请对照截图核实复核证据是否真的看得见",
                 "Tools say {d}, the image review says {r}; on the AI / live-action axis the fusion follows the tools (eval-calibrated): check the frames to see whether the review's evidence is really visible",
                 d=LABEL_ZH[dt], r=LABEL_ZH[_top_group_label(rv)])
    return None


def finalize(breakdown: dict, out: Path, engine: str | None = None) -> dict:
    """(Re)classify every shot from stored features + VLM answers, plan replication,
    summarise and write breakdown.json / reports. Safe to call again after the
    classifier changes (no re-decoding)."""
    out = Path(out)
    set_lang(breakdown.get("lang", "zh"))
    # remember the engine: apply-review / correct / eval call finalize without one and must not reset it
    engine = breakdown["engine"] = engine or breakdown.get("engine") or "seedance2.0"
    if breakdown.get("whole_video_vlm") is not None:  # older runs stored the raw answer
        breakdown["whole_video_vlm"] = normalize_whole(breakdown["whole_video_vlm"])
    shot_records = breakdown["shots"]
    audio = breakdown.get("audio", {})
    prov = breakdown.get("provenance", {})
    template = breakdown.get("global_layers", {})
    planner = Planner()
    pack = breakdown.get("packaging")
    if pack:
        from .packaging import merge_vlm, shot_layers

        for st in pack.get("stickers", []):
            st.pop("in_picture", None)
            st.pop("in_picture_why", None)
        merge_vlm(pack, breakdown.get("whole_video_vlm"))
        from .packaging import apply_review as apply_pack_review

        apply_pack_review(pack)
        from .packaging import relocalize

        src = breakdown["source"]
        relocalize(pack, src.get("width") if src.get("rotation") in (90, 270) else src.get("height"))
    vctx = video_context(shot_records, prov, breakdown["source"].get("fps"))
    breakdown["video_context"] = vctx
    for rec in shot_records:
        probs, evidence, facts = deterministic(rec["features"], rec.get("overlay"), rec.get("text"), rec.get("faces", 0.0), audio, prov,
                                               fps=breakdown["source"].get("fps"), ctx=vctx)
        rec["deterministic"] = {"probs": round_floats(probs), "evidence": evidence, "facts": facts}
        rec["layers"] = overlay_layers(rec.get("overlay"), rec.get("text"), template)
    # ---------------- fuse + plan ----------------------------------------------------
    video_meta = {"aspect_ratio": breakdown["source"]["aspect_ratio"]}
    for rec in shot_records:
        fam = rec["deterministic"]["facts"].get("temporal_family", "dynamic")
        seen = visual_opinion(rec) or {}
        vprobs = _vlm_gate(rec, seen.get("label_probs"), vctx)
        probs = fuse(rec["deterministic"]["probs"], vprobs, fam, majority=_majority(rec))
        # group-first decision only when an image reader voted: the tools' avatar score is a slice of their AI score,
        # so adding the two would outvote live action on tool-only runs (eval/koubo night street 0.51 -> 0.33)
        label, conf = decide(probs) if vprobs else top(probs)
        src = seen.get("image_source")
        img_src = src if src and src != "unknown" else image_source_guess(rec["features"], rec["deterministic"]["facts"])
        # what an image reader says is visible (checkable against the frames) vs what the tools measured
        seen_ev = ([f"[VLM] {e}" for e in (rec.get("vlm") or {}).get("evidence", [])[:6]]
                   + [T("[{by} 看图] {e}", "[{by} review] {e}", by=reviewer_name((rec.get('review') or {}).get('_by', 'agent')), e=e)
                      for e in (rec.get("review") or {}).get("evidence", [])[:6]])
        measured = list(rec["deterministic"]["evidence"])
        split = (rec.get("review") or {}).get("split_suggestion")
        if split and split.get("cuts"):
            by = reviewer_name((rec.get("review") or {}).get("_by", "agent"))
            seq = "→".join(LABEL_ZH.get(x, x) for x in split.get("labels") or [])
            seen_ev.append(T("[{by} 看图] 本镜头疑为多刀合并，建议在 {at} 处拆分", "[{by} review] This shot looks like several cuts merged; suggest splitting at {at}",
                              by=by, at=join(fmt_time(c) for c in split["cuts"][:6]))
                            + (T("（{seq}）", " ({seq})", seq=seq) if seq else "") + (T("：", ": ") + split['note'] if split.get("note") else ""))
        evidence = measured + seen_ev
        decided = "fused" if rec.get("vlm") else ("fused_agent" if rec.get("review") else "deterministic")
        user = rec.get("user") or {}
        if user.get("label") in LABEL_ZH:  # the user said what this shot is: that is the answer
            label, conf, decided = user["label"], 1.0, "user"
            probs = {k: (1.0 if k == label else 0.0) for k in LABEL_ZH}
            measured = [T("[用户纠正] 改为{l}", "[User correction] Changed to {l}", l=LABEL_ZH[label]) + (T("：", ": ") + user['note'] if user.get("note") else "")] + measured
            evidence = measured + seen_ev
        rec["base"] = {"label": label, "label_zh": LABEL_ZH[label], "confidence": round(conf, 3), "probs": round_floats(probs),
                       "image_source": img_src if label in ("static_hold", "still_motion") else None,
                       "generator_guess": seen.get("generator_guess"),
                       "decided_by": decided, "evidence": evidence, "seen": seen_ev, "measured": measured}
        vt = (rec.get("vlm") or {}).get("label_probs")
        dt = top(rec["deterministic"]["probs"])[0]
        rv = (rec.get("review") or {}).get("label_probs")
        reviewed = bool(rv and sum(rv.values()) > 0 and _top_group(rv) == group_of(label))
        if (decided != "user" and not reviewed and vt and sum(vt.values()) > 0
                and (_top_group(vt) == "live_action") != (group_of(dt) == "live_action")):
            # the tools and the VLM disagree on whether the picture was filmed: the VLM is sometimes confidently wrong
            # (it has invented "garbled clock digits" on live footage), so ask for a look at its evidence
            follow = "VLM" if group_of(label) == group_of(_top_group_label(vt)) else T("工具", "the tools")
            rec["base"]["disputed"] = T("工具判{d}、VLM 判{v}，结论跟了{f}：请对照截图核实 VLM 的证据是否真的看得见",
                                        "Tools say {d}, the VLM says {v}; the verdict follows {f}: check the frames to see whether the VLM's evidence is really visible",
                                        d=LABEL_ZH[dt], v=LABEL_ZH[_top_group_label(vt)], f=follow)
        agent_dispute = _agent_review_dispute(dt, vt, rv, reviewed, decided)
        if agent_dispute:
            rec["base"]["disputed"] = agent_dispute
        seen_live = (seen.get("label_probs") or {}).get("live_action", 0.0) / (sum((seen.get("label_probs") or {}).values()) or 1.0)
        # an agent review that looked at the frames and backs the verdict firmly (and no VLM against it) settles the
        # "to confirm" the tools would raise; it only changes the flag, not the verdict
        ra = (rec.get("review") or {}).get("raw_probs") or (rec.get("review") or {}).get("label_probs") or {}
        confirmed = bool(ra) and top(ra)[0] == label and ra[label] / (sum(ra.values()) or 1.0) >= 0.85 \
            and not (vt and group_of(_top_group_label(vt)) != group_of(label))
        doubt = None if decided == "user" or confirmed else _ai_or_live_doubt(label, rec["deterministic"]["facts"], prov, vctx, seen_live,
                                                                               seen=bool(seen.get("label_probs")))
        if not doubt and decided != "user" and label in UNMEASURED and not (rec.get("vlm") and rec.get("review")):
            doubt = (T("{l}只有一方看图判断（工具测不出这一类）：", "{l} rests on a single image reader (the tools cannot measure this class): ", l=LABEL_ZH[label]) +
                     (T("定格动画和 AI 视频、实拍容易混", "stop motion is easily confused with AI video and live action") if label == "stop_motion"
                      else T("影视片段和 AI 短剧、自己拍的实拍容易混", "film / TV footage is easily confused with AI dramas and self-shot footage") if label == "film_footage"
                      else T("2D 动画和代码动效、AI 视频容易混", "2D animation is easily confused with code-driven motion graphics and AI video")) + T("，请再看一眼", ", take another look"))
        if doubt:
            rec["base"]["confidence"] = round(min(conf, DOUBT_CAP), 3)
            rec["base"]["uncertain"] = doubt
        said = (rec.get("vlm") or {}).get("overlay_text")
        said = said if isinstance(said, list) else (rec.get("review") or {}).get("overlay_text")
        rec["layers"], scene_text = drop_scene_text(rec["layers"], label, said)
        if scene_text:
            rec["base"]["scene_text"] = scene_text  # read by OCR but printed on things in the scene, not overlays
        if label in ("code_render", "screen_capture"):
            # text/graphics are the rendered content itself here, not a separate overlay layer
            rec["layers"] = [l for l in rec["layers"] if l["kind"] == "layout_template"]
        if pack:
            extra = shot_layers(pack, rec, label)
            if label in ("code_render", "screen_capture"):
                extra = [l for l in extra if l["kind"] != "huazi"]
            huazi = {t for l in extra if l["kind"] == "huazi" for t in l["texts"]}
            from .classify import _same_words

            # the per-shot OCR track that read the same 花字 is that layer, not a second "label"
            rec["layers"] = [l for l in rec["layers"] if not (l.get("texts") and l["kind"] in ("label", "title")
                                                               and any(_same_words(t, h) for t in l["texts"] for h in huazi))] + extra
        if (rec.get("features") or {}).get("measured_region"):
            note = T("画面统计只在贴纸/动图之外的区域测量（x{:.0%} y{:.0%} 宽{:.0%} 高{:.0%}）",
                     "Picture statistics measured only outside the sticker / GIF region (x{:.0%} y{:.0%} w{:.0%} h{:.0%})").format(*rec["features"]["measured_region"])
            rec["base"]["evidence"].append(note)
            rec["base"]["measured"].append(note)
        if (rec.get("features") or {}).get("picture_box"):
            note = T("画面嵌在黑边里（画面框 x{:.0%} y{:.0%} 宽{:.0%} 高{:.0%}），画面统计只在框内测量",
                     "The picture sits inside black bars (box x{:.0%} y{:.0%} w{:.0%} h{:.0%}); picture statistics measured inside the box only").format(*rec["features"]["picture_box"])
            rec["base"]["evidence"].append(note)
            rec["base"]["measured"].append(note)
        # imported real material: full-frame from the base label, embedded regions only where
        # the frame is a rendered layout (photographic bases would trip the region detector)
        rendered_frame = label in ("code_render", "screen_capture", "cg_3d") or (label in ("static_hold", "still_motion") and img_src in ("graphic", "screenshot"))
        embedded = rec.get("embedded_assets", []) if rendered_frame else []
        if label == "cg_3d":  # fur/foliage in a 3D render looks photographic; only trust screenshot panels there
            embedded = [e for e in embedded if e["kind"] in ("screenshot", "screen_recording")]
        rec["material"] = material_summary(label, img_src if label in ("static_hold", "still_motion", "screen_capture") else None, embedded,
                                           seen or None, moving=fam != "frozen")
        if user.get("real_material") is not None:
            _user_real(rec["material"], bool(user["real_material"]))
        elif label == "live_action" and not seen and rec["base"]["confidence"] < 0.6:
            # pixels alone cannot tell the author's own footage from a cut-in film / drama clip: say so instead of
            # promising "the user's material" (still counted as real material, only the wording changes)
            note = T("（自己拍的还是影视片段，看图确认）", " (own footage or a film / drama clip, confirm by looking)")
            rec["material"]["origin_zh"] += note
            for it in rec["material"]["items"]:
                if it["kind"] == "real_footage" and it["region"] == "full":
                    it["kind_zh"] += note
        rec["verdict"] = verdict_text(label, img_src, rec["layers"])
        rec.pop("ai_edits", None)
        if label in ("live_action", "stop_motion"):
            # filmed, then changed by AI (face swap, lip sync, restyle ...): only image readers can see it; the agent's
            # answer replaces the VLM's when it gave one (an empty list from the agent means "looked, none")
            rv = rec.get("review") or {}
            raw = rv.get("ai_edits") if "ai_edits" in rv else (rec.get("vlm") or {}).get("ai_edits")
            steps = planner.edit_steps(raw)
            if steps:
                rec["ai_edits"] = steps
                rec["verdict"] += semi() + T("拍完后经 AI 加工（{k}）", "AI-processed after filming ({k})", k=join(e["kind_zh"] for e in steps))
        if rec["material"]["has_real_material"]:
            kinds = []
            for it in rec["material"]["items"]:
                if it.get("real_material") and it["kind_zh"] not in kinds:
                    kinds.append(it["kind_zh"])
            rec["verdict"] += semi() + T("引入真实素材（{k}）", "brings in real material ({k})", k=join(kinds))
        rec["replication"] = planner.plan_shot(label, rec, video_meta, engine=engine)

    # ---------------- summary --------------------------------------------------------
    total = sum(r["duration"] for r in shot_records) or 1.0
    mix: dict[str, float] = {}
    for r in shot_records:
        mix[r["base"]["label"]] = mix.get(r["base"]["label"], 0.0) + r["duration"]
    mix_sorted = sorted(mix.items(), key=lambda kv: -kv[1])
    overlay_kinds = sorted({l["kind"] for r in shot_records for l in r["layers"]})
    conf = sum(r["base"]["confidence"] * r["duration"] for r in shot_records) / total
    parts = [f"{LABEL_ZH[k]} {v / total:.0%}" for k, v in mix_sorted]
    verdict = (T("混合制作：", "Mixed production: ") if len(mix) > 1 or overlay_kinds else "") + " + ".join(parts)
    unsure = sum(r["duration"] for r in shot_records if r["base"]["label"] in ("ai_video", "live_action")
                 and r["base"]["confidence"] < 0.65
                 and (r.get("deterministic") or {}).get("facts", {}).get("transcode_degraded"))
    if unsure / total > 0.3 and not any(visual_opinion(r) for r in shot_records):
        verdict += T("（其中 {r:.0%} 时长实拍还是 AI 待确认：平台转码抹掉了噪声证据，需开 VLM 或人工看画面）",
                     " ({r:.0%} of the duration is live action or AI, to confirm: the platform transcode erased the noise evidence, needs a VLM pass or a human look at the frames)",
                     r=unsure / total)
    if (vctx.get("film_hint_share") or 0) > 0.3 and not any(r["base"]["label"] == "film_footage" for r in shot_records):
        verdict += T("（其中 {r:.0%} 时长有影视片段线索（黑边版式），可能是影视解说或混剪，需看图确认）",
                     " ({r:.0%} of the duration carries film / TV hints (letterbox layout), possibly a film recap or compilation, to confirm by looking)",
                     r=vctx["film_hint_share"])
    doubtful = sum(r["duration"] for r in shot_records if r["base"].get("uncertain"))
    if doubtful / total > 0.3 and not (unsure / total > 0.3 and not any(visual_opinion(r) for r in shot_records)):
        verdict += T("（其中 {r:.0%} 时长实拍还是 AI 证据不足，待确认）", " ({r:.0%} of the duration lacks evidence for live action vs AI, to confirm)", r=doubtful / total)
    if overlay_kinds:
        verdict += semi() + T("叠加层：{k}（代码/剪辑软件合成）", "overlays: {k} (composited in code / an editor)", k=join(OVERLAY_KIND_ZH.get(k, k) for k in overlay_kinds))
    real_shots = [r for r in shot_records if r.get("material", {}).get("has_real_material")]
    real_kinds: dict[str, float] = {}
    for r in real_shots:
        for k in {it["kind_zh"] for it in r["material"]["items"] if it.get("real_material")}:
            real_kinds[k] = real_kinds.get(k, 0.0) + r["duration"]
    if real_shots:
        verdict += semi() + T("用到真实素材：", "real material used: ") + join(T("{k}（{v:.1f}s）", "{k} ({v:.1f}s)", k=k, v=v) for k, v in sorted(real_kinds.items(), key=lambda kv: -kv[1]))
    edited: dict[str, int] = {}
    for r in shot_records:
        for e in r.get("ai_edits") or []:
            edited[e["kind_zh"]] = edited.get(e["kind_zh"], 0) + 1
    if edited:
        verdict += semi() + T("实拍经 AI 二次加工：", "live action AI-processed afterwards: ") + join(T("{k} {v} 镜", "{k} ({v} shots)", k=k, v=v) for k, v in edited.items())
    refs: dict[str, list[int]] = {}
    for r in shot_records:
        for k in dict.fromkeys(x["kind_zh"] for x in (r.get("material") or {}).get("references", [])):
            refs.setdefault(k, []).append(r["index"])
    if refs:
        verdict += semi() + T("复刻需准备参考：", "references to prepare for the remake: ") + join(T("{k}（{n} 镜）", "{k} ({n} shots)", k=k, n=len(v)) for k, v in sorted(refs.items(), key=lambda kv: -len(kv[1])))
    if audio.get("beat_synced_edit"):
        verdict += semi() + T("剪辑卡在音乐节拍上", "cuts land on the music beat")
    summary = {
        "duration": breakdown["source"]["duration"], "shots": len(shot_records), "verdict": verdict,
        "production_mix": [{"label": k, "label_zh": LABEL_ZH[k], "seconds": round(v, 2), "ratio": round(v / total, 4)} for k, v in mix_sorted],
        "overlay_kinds": overlay_kinds, "confidence": round(conf, 3),
        "transitions": {t: sum(1 for r in shot_records if r["transition_in"] == t) for t in sorted({r["transition_in"] for r in shot_records})},
        "avg_shot_s": round(total / max(1, len(shot_records)), 2),
        "real_material": {"shots": [r["index"] for r in real_shots], "seconds": round(sum(r["duration"] for r in real_shots), 2),
                          "ratio": round(sum(r["duration"] for r in real_shots) / total, 3),
                          "kinds": {k: round(v, 2) for k, v in real_kinds.items()}},
        "references": refs,
        "vlm": vlm_note(breakdown.get("analysis", {}).get("vlm") or {}, breakdown.get("analysis", {}).get("review")),
    }
    sb_items = []
    import cv2

    for r in shot_records:
        img = read_image(out / r["assets"]["first_frame"])
        if img is not None:
            sb_items.append((img, r["base"]["label"], f"#{r['index']} {LABEL_SHORT.get(r['base']['label'], r['base']['label'])} {r['base']['confidence']:.0%}",
                             r["start"], r["end"]))
    storyboard(sb_items, out / "storyboard.jpg")

    from .aspects.base import PHOTOGRAPHIC
    from .aspects.grade import measure_frames

    for rec in shot_records:  # breakdowns made before the grade aspect existed: measure it from the saved frames
        asp = rec.setdefault("aspects", {})
        if rec["base"]["label"] in PHOTOGRAPHIC and not (asp.get("grade") or {}).get("measured"):
            frames = [read_image(out / rec["assets"][k]) for k in ("first_frame", "last_frame") if rec.get("assets", {}).get(k)]
            m = measure_frames([f for f in frames if f is not None])
            if m:
                asp["grade"] = {"measured": m}
    aspects.finalize(breakdown)
    breakdown["aspects"] = round_floats(breakdown["aspects"])
    summary["aspects"] = aspects.summary_lines(breakdown)
    for rec in shot_records:  # the prompts carry this run's framing (shot size, angle, move): rebuild them now it is known
        rec["replication"] = planner.plan_shot(rec["base"]["label"], rec, video_meta, engine=engine)
    for rec in shot_records:  # filmed shots: rebuild by shooting, with this shot's framing / camera / light
        if rec["base"]["label"] == "live_action":
            res = {k: v.get("result") for k, v in (rec.get("aspects") or {}).items() if v.get("result")}
            rec["replication"]["shoot"] = {"summary": aspects.shot_text(rec), **res}

    from . import narrative

    told = narrative.shot_roles(breakdown)
    for rec in shot_records:  # rewritten on every finalize: a later review replaces the VLM's reading
        rec.pop("narrative", None)
        if rec["index"] in told:
            rec["narrative"] = told[rec["index"]]
    breakdown["narrative"] = narrative.beats(breakdown)

    st_lv = ((breakdown.get("stems") or {}).get("level_db") or {})
    mus = audio.get("music") or {}
    if mus.get("present") and st_lv.get("music") is not None and st_lv["music"] <= MUSIC_STEM_SILENT_DB:
        # the separated accompaniment is near silent: the "beat" was measured on voice and room sound in the mix
        audio["music"] = {**mus, "present": False, "dropped_by_stems": st_lv["music"]}
    fx = Path(out) / "stems" / "effects.wav"
    if fx.is_file():  # effects found on their own separated track replace the onsets picked off the mix
        from .effects import detect as detect_effects

        audio["sfx"] = {"events": detect_effects(fx), "source": "effects_stem"}
    breakdown["audio_plan"] = merge_audio_with_vlm(audio, breakdown.get("whole_video_vlm"))
    if pack:
        from .packaging import finalize_pack

        finalize_pack(breakdown, out)
    if fx.is_file():  # the same sound used again is one effect to find, counted
        from .effects import group as group_effects

        sfx_all = breakdown["audio_plan"].get("sfx_merged", [])
        groups = group_effects(sfx_all, fx)
        out_groups = []
        for g in groups:
            mem = [sfx_all[i] for i in g["members"]]
            for e in mem:
                e["group"] = g["id"]
            # the effects track also carries the picture's own sound (ambience, foley, a generator's audio). An effect
            # added in the edit lands on an edit: a text pop, a sticker, a cut. A sound that never does, inside filmed or
            # generated footage, is the picture's own (eval daihuo: spoon and lid sounds in the Seedance clip)
            cuts = [r["start"] for r in shot_records[1:]]
            in_scene = bool(pack) and not any(_placed_in_edit(e, cuts) for e in mem) and all(_label_at(shot_records, e["t"]) in SCENE_SOUND_LABELS for e in mem)
            for e in mem:
                e["in_scene"] = in_scene
            out_groups.append({"id": g["id"], "rep": g["rep"], "type": sfx_all[g["rep"]].get("type", ""), "count": len(mem),
                               "times": [round(float(e["t"]), 2) for e in mem], "in_scene": in_scene})
        breakdown["audio_plan"]["sfx_groups"] = out_groups
        if pack:  # the sync counts were taken before the picture's own sound was set apart: count the added effects only
            from .packaging import summary_lines as pack_summary

            counts: dict[str, int] = {}
            possible: dict[str, int] = {}
            for e in sfx_all:
                on = e.get("on") or {}
                if on and not e.get("in_scene"):
                    tally = possible if e.get("confidence") == "low" else counts
                    tally[on["type"]] = tally.get(on["type"], 0) + 1
            pack["sfx_alignment"] = {**(pack.get("sfx_alignment") or {}), "sfx_on": counts, "sfx_on_possible": possible}
            pack["summary_zh"] = pack_summary({**pack, "stickers": [st for st in pack.get("stickers", []) if not st.get("in_picture")]},
                                              pack["sfx_alignment"])
    srcs = classify_sound_sources(breakdown)
    breakdown["sound_sources"] = srcs
    for t in breakdown["audio_plan"].get("plan", []):
        if t["track"] == "music" and srcs.get("music"):
            lean = srcs["music"]["leaning"]
            t["source"] = srcs["music"]["source_zh"]
            t["how"] = {"ai_generated": T("原曲倾向 AI 生成：用 Suno 等（capsule-cinema UniversalMusicGenerationTool）按风格/BPM/调性重新生成，MV 类连歌词一起按新内容写",
                                          "The original track leans AI-generated: regenerate with Suno or similar (capsule-cinema UniversalMusicGenerationTool) matching style / BPM / key; for an MV, rewrite the lyrics for the new content too"),
                        "existing_library": T("原曲倾向现成曲库配乐：按 BPM/情绪/调性在曲库检索同类曲，或用 AI 生成相近风格的免版权曲",
                                              "The original track leans stock library music: search a library by BPM / mood / key for a similar track, or generate a royalty-free track in a similar style with AI"),
                        "popular_song": T("原曲倾向现成知名歌曲：直接使用有版权风险，需要授权或换成相近风格的曲库/AI 曲",
                                          "The original track leans a well-known song: using it as-is carries copyright risk; license it or swap in a library / AI track in a similar style")}[lean]
        if t["track"] == "sfx" and srcs.get("sfx"):
            t["source"] = srcs["sfx"]["source_zh"]
            if srcs["sfx"]["leaning"] == "ai_native":
                t["how"] = T("原片音效随 AI 视频片段一起生成：复刻时用支持原生音频的视频模型（Seedance 2.x / Veo 3.1 / Kling）直接出声，或视频生音效（HunyuanVideo-Foley）",
                             "The original sound effects were generated together with the AI video clips: for the remake, use a video model with native audio (Seedance 2.x / Veo 3.1 / Kling), or video-to-SFX (HunyuanVideo-Foley)")
        if t["track"] == "voice" and srcs.get("voice"):
            t["source"] = srcs["voice"]["source_zh"]
    from .visual import audio_timeline

    if audio.get("has_audio"):
        audio_timeline(audio, breakdown["audio_plan"].get("sfx_merged", []), [r["start"] for r in shot_records[1:]],
                       breakdown["source"]["duration"], out / "audio.png")
        breakdown["assets"]["audio_timeline"] = "audio.png"
    a_parts = []
    if audio.get("voice", {}).get("present"):
        a_parts.append(T("人声", "voice"))
    if audio.get("music", {}).get("present"):
        ms = srcs.get("music") or {}
        a_parts.append(T("BGM {bpm}（{src}", "music {bpm} ({src}", bpm=T("无明显节拍", "no clear beat") if audio['music'].get('no_beat') else f"{audio['music'].get('tempo_bpm', '?')}BPM",
                         src=ms.get('source_zh', T('来源待确认', 'source to confirm')))
                       + (T("，倾向{m}", ", leaning {m}", m=MUSIC_ZH[ms['leaning']]) if ms.get("source") == "unknown" else "") + T("）", ")"))
    sfx_all = [e for e in breakdown["audio_plan"].get("sfx_merged", []) if not e.get("in_scene")]  # the picture's own sound is not an effect to add
    n_maybe = sum(1 for e in sfx_all if e.get("confidence") == "low")
    if len(sfx_all) - n_maybe:
        a_parts.append(T("音效 {n} 处", "{n} sound effects", n=len(sfx_all) - n_maybe))
    if n_maybe:
        a_parts.append(T("可能的音效 {n} 处（信号候选，待确认）", "{n} possible sound effects (unconfirmed signal candidates)", n=n_maybe))
    if a_parts:
        summary["verdict"] += semi() + T("声音：", "audio: ") + " + ".join(a_parts)
    if pack:
        cues = [c for c in pack.get("text_cues", []) if not c.get("part_of_picture")]
        p_parts = []
        n_sub = sum(1 for c in cues if c["kind"] == "subtitle")
        if n_sub:
            p_parts.append(T("字幕 {n} 句", "{n} subtitle lines", n=n_sub))
        for k in ("huazi", "title", "label"):
            n = sum(1 for c in cues if c["kind"] == k)
            if n:
                p_parts.append(T("{k} {n} 处", "{k} ×{n}", k=OVERLAY_KIND_ZH[k], n=n))
        n_st = sum(1 for st in pack.get("stickers", []) if not st.get("in_picture") and st.get("confidence") != "low")
        if n_st:
            p_parts.append(T("贴纸/动图 {n} 处", "stickers / GIFs ×{n}", n=n_st))
        al = pack.get("sfx_alignment") or {}
        n_on = sum(v for k, v in al.get("sfx_on", {}).items() if k != "cut")
        if n_on:
            p_parts.append(T("{n} 个音效卡在文字/贴纸出现上", "{n} sound effects land on text / sticker pops", n=n_on))
        n_maybe_on = sum(v for k, v in al.get("sfx_on_possible", {}).items() if k != "cut")
        if n_maybe_on:
            p_parts.append(T("可能有 {n} 个音效卡在文字/贴纸出现上（待确认）", "{n} possible sound effects at text / sticker pops (unconfirmed)", n=n_maybe_on))
        if p_parts:
            summary["verdict"] += semi() + T("剪辑包装：", "packaging: ") + join(p_parts)
        summary["packaging"] = pack.get("summary_zh", [])
    from .production import production_plan

    breakdown["production_plan"] = production_plan(breakdown, out, engine=engine)
    summary["production"] = breakdown["production_plan"]["summary"]
    breakdown["summary"] = summary
    write_json(out / "breakdown.json", breakdown, compact=True)
    from .report import write_reports

    from .stems import cut_sfx

    plan_a = breakdown.get("audio_plan") or {}
    cut_sfx(breakdown["source"].get("path", ""), plan_a.get("sfx_merged", []), out,
            groups=[g for g in plan_a.get("sfx_groups") or [] if not g.get("in_scene")] if plan_a.get("sfx_groups") else None)
    write_reports(breakdown, out)
    return breakdown
