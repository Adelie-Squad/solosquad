"""Evaluate decomposition accuracy against labelled videos (eval/labels.yaml)."""
from __future__ import annotations

import os
from pathlib import Path

import yaml

from .classify import LABELS
from .pipeline import PACKAGING_VERSION, decode_fingerprint, decompose, finalize
from .util import LOG, read_json, round_floats, write_json


def _expand(path: str) -> str:
    from .memory import capsule_root

    root = str(capsule_root())
    p = os.path.expanduser(path.replace("${CAPSULE}", root))
    if not os.path.isabs(p):  # relative paths are relative to the repo root
        p = str(Path(__file__).resolve().parents[1] / p)
    return p


def _accept(label) -> set[str]:
    return set(label) if isinstance(label, list) else {label}


def gt_at(entry: dict, t: float) -> set[str] | None:
    if "segments" in entry:
        for a, b, lab in entry["segments"]:
            if a <= t < b:
                return _accept(lab)
        return None
    if "label" not in entry:  # audio-only entry
        return None
    return _accept(entry["label"])


def real_at(entry: dict, t: float) -> bool | None:
    rm = entry.get("real_material")
    if rm is None:
        return None
    if isinstance(rm, bool):
        return rm
    for a, b, v in rm:
        if a <= t < b:
            return bool(v)
    return None


def audio_check(gt: dict, b: dict) -> dict:
    a = b.get("audio", {})
    out = {}
    if "voice" in gt:
        out["voice"] = bool(a.get("voice", {}).get("present")) == bool(gt["voice"])
    if "music" in gt:
        out["music"] = bool(a.get("music", {}).get("present")) == bool(gt["music"])
    if "sfx" in gt:
        n = len((b.get("audio_plan") or {}).get("sfx_merged", []))
        out["sfx"] = (n >= 3) == bool(gt["sfx"])
    if gt.get("bpm"):
        est = (a.get("music") or {}).get("tempo_bpm")
        cands = [est] + list((a.get("music") or {}).get("tempo_alternatives", [])) if est else []
        out["bpm"] = any(abs(c - gt["bpm"]) / gt["bpm"] < 0.04 for c in cands)
    if gt.get("music_source"):
        ms = (b.get("sound_sources") or {}).get("music") or {}
        out["music_source"] = ms.get("leaning") == gt["music_source"]
    if gt.get("voice_source"):
        vs = (b.get("sound_sources") or {}).get("voice") or {}
        out["voice_source"] = vs.get("leaning") == gt["voice_source"]
    if gt.get("key"):
        k = (a.get("music") or {}).get("key") or {}
        out["key"] = f"{k.get('tonic')} {k.get('mode')}" == gt["key"]
    return out


def packaging_check(truth_path: str | Path, pack: dict, sfx: list[dict] | None = None, sfx_truth: list | None = None) -> dict:
    """Packaging layer vs a ground-truth overlay schedule (eval/*_text.json, exported from the maker's overlay code).
    Subtitles: a predicted subtitle cue matches a truth line when the words agree (similarity >= 0.6) and the
    times overlap; timing error is measured on matched pairs. Other text (title / chapter cards / object labels /
    decorative stickers): found = any predicted non-subtitle cue with similar words overlapping in time; kind_ok =
    it got the expected kind. Image stickers: the truth files list none, so every predicted one is a false alarm."""
    from .packaging import _norm, _similar

    gt = read_json(Path(_expand(str(truth_path))))
    cues = pack.get("text_cues", [])
    subs = [c for c in cues if c["kind"] == "subtitle"]

    def overlap(a0, a1, b0, b1):
        return max(0.0, min(a1, b1) - max(a0, b0))

    matched_pred: set[int] = set()
    d0, d1, sims, hits = [], [], [], 0
    for g in gt["subtitles"]:
        gtext = g["text"].replace("/", "")
        best, best_s = None, 0.0
        for i, c in enumerate(subs):
            if overlap(g["t0"], g["t1"], c["t0"], c["t1"]) <= 0:
                continue
            sim = _similar(gtext, c["text"])
            if sim > best_s:
                best, best_s = i, sim
        if best is not None and best_s >= 0.6:
            hits += 1
            matched_pred.add(best)
            c = subs[best]
            d0.append(abs(c["t0"] - g["t0"]))
            d1.append(abs(c["t1"] - g["t1"]))
            sims.append(best_s)
    # a prediction that is a fragment of a truth line (OCR split a line) is not a false alarm
    for i, c in enumerate(subs):
        if i in matched_pred:
            continue
        if any(overlap(g["t0"], g["t1"], c["t0"], c["t1"]) > 0 and _norm(c["text"]) and _norm(c["text"]) in _norm(g["text"])
               for g in gt["subtitles"]):
            matched_pred.add(i)
    n_gt = len(gt["subtitles"])
    out: dict = {"subtitles": {"truth": n_gt, "pred": len(subs), "recall": round(hits / n_gt, 3) if n_gt else None,
                               "precision": round(len(matched_pred) / len(subs), 3) if subs else None,
                               "start_err_median_s": round(float(sorted(d0)[len(d0) // 2]), 3) if d0 else None,
                               "end_err_median_s": round(float(sorted(d1)[len(d1) // 2]), 3) if d1 else None,
                               "within_0.25s": round(sum(1 for a, b in zip(d0, d1) if a <= 0.25 and b <= 0.25) / len(d0), 3) if d0 else None,
                               "text_similarity": round(sum(sims) / len(sims), 3) if sims else None}}
    st = {}
    for c in subs:
        for k in ("fill_name", "stroke_name"):
            v = (c.get("style") or {}).get(k)
            if v:
                st.setdefault(k, []).append(v)
    want = (gt["subtitles"][0].get("style") or {}) if gt["subtitles"] else {}
    if want and st:
        fills = st.get("fill_name", [])
        name = {"white": "白", "dark": ("黑", "棕", "灰")}
        wf = name.get(want.get("fill"), want.get("fill"))
        out["subtitles"]["fill_ok"] = round(sum(1 for f in fills if f in (wf if isinstance(wf, tuple) else (wf,))) / max(1, len(subs)), 3)
        strokes = st.get("stroke_name", [])
        if want.get("stroke"):
            out["subtitles"]["stroke_found"] = round(len(strokes) / max(1, len(subs)), 3)
        else:
            out["subtitles"]["stroke_false"] = round(len(strokes) / max(1, len(subs)), 3)
    if any(g.get("highlight") for g in gt["subtitles"]):
        with_kw = [g for g in gt["subtitles"] if g.get("highlight")]
        found = 0
        for g in with_kw:
            c = next((c for c in subs if overlap(g["t0"], g["t1"], c["t0"], c["t1"]) > 0.5 * (g["t1"] - g["t0"])), None)
            found += bool(c and (c.get("style") or {}).get("multicolor"))
        out["subtitles"]["keyword_highlight_found"] = round(found / len(with_kw), 3)
    expect = {"titles": "title", "cards": "label", "labels": "label", "stickers": "huazi"}
    others = [c for c in cues if c["kind"] != "subtitle"]
    for key, kind in expect.items():
        items = gt.get(key) or []
        if not items:
            continue
        found = kind_ok = 0
        for g in items:
            cand = [c for c in others if overlap(g["t0"], g["t1"], c["t0"], c["t1"]) > 0 and _similar(g["text"], c["text"]) >= 0.5]
            if cand:
                found += 1
                kind_ok += any(c["kind"] == kind or (kind == "label" and c["kind"] == "counter") for c in cand)
        out[key] = {"truth": len(items), "found": found, "kind_ok": kind_ok}
    out["image_stickers_false"] = sum(1 for st in pack.get("stickers", []) if not st.get("in_picture"))
    if sfx is not None and sfx_truth is not None:
        tt = sorted(float(x[0]) for x in sfx_truth)
        anch = [e for e in sfx if e.get("source") == "deterministic_anchored"]
        ok = sum(1 for e in anch if any(abs(e["t"] - t) <= 0.1 for t in tt))
        out["sfx_anchored"] = {"pred": len(anch), "correct": ok, "precision": round(ok / len(anch), 3) if anch else None}
    return out


def boundary_f1(pred: list[float], gt: list[float], tol: float = 0.1, ignore: list[float] | None = None,
                spans: list[tuple[float, float] | None] | None = None) -> dict:
    """Cut precision / recall. `ignore`: boundaries the labeller could not decide; a predicted cut there is
    neither right nor wrong. `spans`: for each predicted boundary, the (start, end) of its transition when it is
    more than a cut; a labelled cut anywhere inside that transition is the same boundary (a labeller marks one
    frame of a half-second wipe, the detector another)."""
    used = set()
    tp = fp = 0
    for k, p in enumerate(pred):
        a, z = (spans[k] if spans and spans[k] else (p, p))
        a, z = min(a, p) - tol, max(z, p) + tol
        near = [i for i, g in enumerate(gt) if i not in used and a <= g <= z]
        hit = min(near, key=lambda i: abs(p - gt[i])) if near else None  # the closest true cut, not the first in range
        if hit is not None:
            used.add(hit)
            tp += 1
        elif not any(a <= u <= z for u in ignore or []):
            fp += 1
    prec = tp / (tp + fp) if tp + fp else 1.0
    rec = tp / len(gt) if gt else 1.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3), "tp": tp, "fp": fp, "fn": len(gt) - tp}


def resolution_bucket(src: dict) -> str:
    """Short side of the picture as shown, rounded to the usual tiers."""
    w, h = src.get("width") or 0, src.get("height") or 0
    side = min(w, h) if w and h else (w or h)
    if not side:
        return "unknown"
    return "<=480p" if side <= 540 else "720p" if side <= 800 else "1080p" if side <= 1200 else ">1080p"


def _slice_table(slices: dict) -> dict:
    """{bucket: {seconds, accuracy, errors: {"gt->pred": seconds}}}, buckets with most footage first."""
    out = {}
    for k, v in sorted(slices.items(), key=lambda kv: -kv[1]["tot"]):
        errs = {e: round(t, 1) for e, t in sorted(v["errors"].items(), key=lambda kv: -kv[1]) if t >= 0.05}
        out[k] = {"seconds": round(v["tot"], 1), "accuracy": round(v["ok"] / v["tot"], 3) if v["tot"] else None,
                  "shots": v["shots"], "wrong_shots": v["wrong"], **({"errors": errs} if errs else {})}
    return out


def _add_slice(slices: dict, key: str, dur: float, hit: bool, gt: str, pred: str) -> None:
    v = slices.setdefault(key, {"tot": 0.0, "ok": 0.0, "shots": 0, "wrong": 0, "errors": {}})
    v["tot"] += dur
    v["shots"] += 1
    if hit:
        v["ok"] += dur
    else:
        v["wrong"] += 1
        v["errors"][f"{gt}->{pred}"] = v["errors"].get(f"{gt}->{pred}", 0.0) + dur


def evaluate(labels_path: Path, out: Path, use_vlm: bool = False, ocr: bool = True, reuse: bool = True, only: set[str] | None = None,
             stems: bool = False) -> dict:
    spec = yaml.safe_load(labels_path.read_text(encoding="utf-8"))
    rows, confusion = [], {g: {p: 0.0 for p in LABELS} for g in LABELS}
    tot_dur = ok_dur = 0.0
    real_tot = real_ok = 0.0
    audio_hits: dict[str, list[bool]] = {}
    aspect_hits: dict[str, list[bool]] = {}
    missing: list[str] = []
    by_res: dict = {}
    by_cam: dict = {}
    for entry in spec["videos"]:
        path = _expand(entry["path"])
        if not Path(path).is_file():  # the listed location is gone: a copy kept under eval/media/<id>.<ext> stands in
            kept = Path(__file__).resolve().parents[1] / "eval" / "media" / f"{entry['id']}{Path(path).suffix}"
            path = str(kept) if kept.is_file() else path
        if not Path(path).is_file():
            LOG.warning("skip %s: missing %s", entry["id"], path)
            missing.append(entry["id"])
            continue
        vout = out / entry["id"]
        bfile = vout / "breakdown.json"
        stored = read_json(bfile) if reuse and bfile.is_file() and (not only or entry["id"] not in only) else None
        if stored and stored.get("analysis", {}).get("decode_fp") != decode_fingerprint():
            LOG.info("%s: the measuring code changed since this breakdown was stored, decoding again", entry["id"])
            stored = None
        if stored and (not use_vlm or stored["analysis"]["vlm"].get("used")):
            b = stored
            from .media import video_info
            from .probe import provenance

            b["provenance"] = {k: v for k, v in provenance(video_info(path)).items() if k != "tags"}  # signatures evolve
            if not use_vlm:  # tool-only score: drop answers a previous --vlm / review / correct run left in this dir
                for sh in b["shots"]:
                    for k in ("vlm", "review", "user"):
                        sh.pop(k, None)
                b.pop("whole_video_vlm", None)
                b.setdefault("analysis", {})["vlm"] = {"requested": False, "used": False}
                b["analysis"].pop("review", None)
            if b["source"].get("has_audio"):  # audio analysis is cheap: always redo with current code
                from .audio import analyze_audio

                marks = [t for s in b["shots"] for t in s.get("beats", [])]
                b["audio"] = round_floats(analyze_audio(path, [s["start"] for s in b["shots"][1:]], marks))
                from .sound_source import per_clip_audio

                b["per_clip_audio"] = per_clip_audio(path, [s["start"] for s in b["shots"][1:]], b["source"]["duration"])
                if stems and entry.get("audio"):
                    from .audio import refine_with_stems
                    from .stems import extract_stems

                    voc = vout / "stems" / "vocals.wav"
                    if not voc.is_file():
                        b["stems"] = extract_stems(path, vout)
                    if voc.is_file():
                        refine_with_stems(b["audio"], str(voc))
            if entry.get("packaging_truth") and (b.get("packaging") or {}).get("version") != PACKAGING_VERSION:
                from .media import video_info
                from .packaging import analyze as analyze_packaging, anchored_sfx, visual_events

                info = video_info(path)
                pk = analyze_packaging(path, info, [s["start"] for s in b["shots"][1:]], vout, ocr=ocr)
                if b["source"].get("has_audio"):
                    ev = [e for e in visual_events(pk["text_cues"], pk["stickers"], []) if e["type"] != "subtitle_in"]
                    pk["sfx_anchored"] = anchored_sfx(path, ev, (b["audio"].get("sfx") or {}).get("events", []))
                pk["version"] = PACKAGING_VERSION
                b["packaging"] = round_floats(pk)
            b = finalize(b, vout)  # re-classify with the current rules
        else:
            b = decompose(path, vout, use_vlm=use_vlm, ocr=ocr, whole_vlm=False, stems=stems and bool(entry.get("audio")), memory=False, asr=False)
        v_tot = v_ok = 0.0
        m_tot = m_ok = 0.0
        shots = []
        for s in b["shots"]:
            mid = (s["start"] + s["end"]) / 2
            acc = gt_at(entry, mid)
            if acc is None:
                continue
            pred = s["base"]["label"]
            hit = pred in acc
            v_tot += s["duration"]
            v_ok += s["duration"] if hit else 0.0
            primary = sorted(acc)[0] if len(acc) > 1 else next(iter(acc))
            confusion[primary if not hit else pred][pred] += s["duration"]
            # where the misjudgements sit: by picture size and by camera move
            res, cam = resolution_bucket(b["source"]), (s.get("features") or {}).get("camera", "unknown")
            _add_slice(by_res, res, s["duration"], hit, primary, pred)
            _add_slice(by_cam, cam, s["duration"], hit, primary, pred)
            shots.append({"shot": s["index"], "t": [s["start"], s["end"]], "pred": pred, "conf": s["base"]["confidence"], "camera": cam,
                          "gt": sorted(acc), "ok": hit})
            gt_real = real_at(entry, mid)
            if gt_real is not None:
                pred_real = bool((s.get("material") or {}).get("has_real_material"))
                m_tot += s["duration"]
                m_ok += s["duration"] if pred_real == gt_real else 0.0
                shots[-1]["real"] = {"gt": gt_real, "pred": pred_real}
        row = {"id": entry["id"], "resolution": resolution_bucket(b["source"]), "accuracy": round(v_ok / v_tot, 3) if v_tot else None, "seconds": round(v_tot, 2),
               "verdict": b["summary"]["verdict"], "shots": shots}
        if m_tot:
            row["real_material_accuracy"] = round(m_ok / m_tot, 3)
            real_tot += m_tot
            real_ok += m_ok
        if entry.get("audio"):
            row["audio"] = audio_check(entry["audio"], b)
            for k, v in row["audio"].items():
                audio_hits.setdefault(k, []).append(v)
        if entry.get("aspects"):
            from .aspects import check as aspect_check

            row["aspects"] = aspect_check(entry["aspects"], b)
            for k, v in row["aspects"].items():
                aspect_hits.setdefault(k, []).append(v)
        if entry.get("packaging_truth") and b.get("packaging"):
            sfx_truth = read_json(Path(_expand(entry["sfx_truth"]))) if entry.get("sfx_truth") else None
            row["packaging"] = packaging_check(entry["packaging_truth"], b["packaging"], (b.get("audio_plan") or {}).get("sfx_merged", []), sfx_truth)
        if "cuts" in entry:
            row["cut_f1"] = boundary_f1([s["start"] for s in b["shots"][1:]], entry["cuts"], tol=float(entry.get("cut_tolerance", 0.1)),
                                         ignore=entry.get("cuts_uncertain"),
                                         spans=[(s["transition"]["start"], s["transition"]["end"]) if s.get("transition") else None
                                                for s in b["shots"][1:]])
        if entry.get("image_source"):
            srcs = {s["base"].get("image_source") for s in b["shots"]}
            row["image_source_ok"] = entry["image_source"] in srcs
        rows.append(row)
        tot_dur += v_tot
        ok_dur += v_ok
        LOG.info("%-28s acc=%s  %s", entry["id"], row["accuracy"], b["summary"]["verdict"][:80])
    # a score over part of the set is not the set's score: say how much of it was there
    summary = {"videos": len(rows), "videos_listed": len(spec["videos"]), **({"missing": missing} if missing else {}), "duration_weighted_accuracy": round(ok_dur / tot_dur, 3) if tot_dur else None,
               "video_accuracy_mean": round(sum(r["accuracy"] for r in rows if r["accuracy"] is not None) / max(1, sum(r["accuracy"] is not None for r in rows)), 3),
               "per_video": {r["id"]: r["accuracy"] for r in rows if r["accuracy"] is not None}, "vlm": use_vlm}
    if by_res:
        summary["by_resolution"] = _slice_table(by_res)
        summary["by_camera"] = _slice_table(by_cam)
    if real_tot:
        summary["real_material_accuracy"] = round(real_ok / real_tot, 3)
        summary["real_material_per_video"] = {r["id"]: r["real_material_accuracy"] for r in rows if "real_material_accuracy" in r}
    if audio_hits:
        summary["audio"] = {k: f"{sum(v)}/{len(v)}" for k, v in audio_hits.items()}
    if aspect_hits:
        summary["aspects"] = {k: f"{sum(v)}/{len(v)}" for k, v in aspect_hits.items()}
    packs = [r["packaging"] for r in rows if r.get("packaging")]
    if packs:
        subs = [p_["subtitles"] for p_ in packs]
        tot = sum(x["truth"] for x in subs)
        summary["packaging"] = {
            "videos": len(packs), "subtitle_lines": tot,
            "subtitle_recall": round(sum((x["recall"] or 0) * x["truth"] for x in subs) / tot, 3) if tot else None,
            "subtitle_precision_mean": (round(sum(x["precision"] for x in precs) / len(precs), 3)
                                        if (precs := [x for x in subs if x["precision"] is not None]) else None),
            "start_err_median_s": {r["id"]: r["packaging"]["subtitles"]["start_err_median_s"] for r in rows if r.get("packaging")},
            "end_err_median_s": {r["id"]: r["packaging"]["subtitles"]["end_err_median_s"] for r in rows if r.get("packaging")},
            "other_text_found": f"{sum(p_[k]['found'] for p_ in packs for k in ('titles', 'cards', 'labels', 'stickers') if k in p_)}/"
                                f"{sum(p_[k]['truth'] for p_ in packs for k in ('titles', 'cards', 'labels', 'stickers') if k in p_)}",
            "other_text_kind_ok": f"{sum(p_[k]['kind_ok'] for p_ in packs for k in ('titles', 'cards', 'labels', 'stickers') if k in p_)}/"
                                  f"{sum(p_[k]['truth'] for p_ in packs for k in ('titles', 'cards', 'labels', 'stickers') if k in p_)}",
            "image_sticker_false_alarms": sum(p_["image_stickers_false"] for p_ in packs),
        }
    cuts = [r["cut_f1"]["f1"] for r in rows if "cut_f1" in r]
    if cuts:
        summary["cut_f1_mean"] = round(sum(cuts) / len(cuts), 3)
        tp, fp, fn = (sum(r["cut_f1"][k] for r in rows if "cut_f1" in r) for k in ("tp", "fp", "fn"))
        summary["cuts"] = {"truth": tp + fn, "found": tp, "false": fp,
                           "recall": round(tp / (tp + fn), 3) if tp + fn else None,
                           "precision": round(tp / (tp + fp), 3) if tp + fp else None}
    result = {"summary": summary, "rows": rows,
              "confusion_seconds": {g: {p: round(v, 1) for p, v in ps.items() if v} for g, ps in confusion.items() if any(ps.values())}}
    write_json(out / "eval_result.json", result)
    return result
