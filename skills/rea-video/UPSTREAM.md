# rea-video — vendored upstream record

| | |
|---|---|
| Upstream | https://github.com/JuneYaooo/rea-video |
| Commit | `6b6b3df9f6592d51040e0faf74b666332bb7c404` (2026-11-13, "Add Bengali speech recognition (#41)") |
| Package version | 0.1.0 (`vendor/pyproject.toml`) |
| License | Apache-2.0, Copyright 2026 JuneYaooo — `vendor/LICENSE`, `vendor/NOTICE` (kept unchanged) |
| Vendored | 2026-11-14, for the `creative` agent (user decision: "rea video 설치") |

Upgrading: read the whole diff from this commit, re-run the review below, re-apply the local
changes, update this table. Never replace `vendor/` with an unreviewed checkout.

## What is here

- `vendor/rea_video/` — the Python package (CLI `rea-video`), minus `integrations/`.
- `vendor/pyproject.toml`, `vendor/LICENSE`, `vendor/NOTICE` — unchanged.
- `references/*.md` — upstream `skills/rea-video/references/`, edited (below).
- `references/upstream-skill.md` — upstream `skills/rea-video/SKILL.md`, edited (below). The
  SoloSquad entry point is `SKILL.md` next to this file.

Not vendored: `docs/` (~75 MB of media), `tests/`, `eval/`, `i18n/` (README translations),
`README.md`, `AGENTS.md`/`CLAUDE.md`, `.claude-plugin/`, `.github/`, `scripts/` (installer,
benchmarks, flow-diagram renderer).

## Review (2026-11-14, read-only, every code file and every skill text)

- No telemetry, analytics or update check. All HTTP goes through `util.fetch` (urllib).
- Model downloads on first use, each pinned by SHA-256 before an atomic rename, cached in
  `$REA_VIDEO_MODELS`: UVR MDX-Net ~67 MB (github.com/TRvlvr/model_repo) and BandIt v2 ~149 MB
  (github.com/xuankhanh/MediaDownloader — an unofficial mirror, pinned by hash) by default;
  YuNet face model (opencv_zoo, pinned commit); SenseVoice / pyannote / 3D-Speaker only with the
  optional `sherpa-onnx`; a Japanese OCR model (modelscope.cn) only with `--ocr-lang ja`. ONNX
  models are data run by onnxruntime, not code. A cached archive is not re-hashed.
- VLM is opt-in (`--vlm`, needs `REA_VLM_*`): per shot it sends 3 JPEGs and a ≤12 s 480p clip
  without audio; the whole-video pass sends the **entire video at 480p with audio** unless
  `--no-whole`.
- Subprocesses: ffmpeg / ffprobe with list argv (no `shell=True`), headless Chrome for `pdf`.
- No access to `~/.ssh`, browser data, keychains or tokens other than its own `REA_VLM_*`.
- Writes outside the output dir: `$REA_VIDEO_MODELS` (default `~/.cache/rea-video/models`) and
  `$REA_VIDEO_HOME` (default `~/.rea-video`: prefs, corrections).
- `yaml.safe_load` only; no eval/exec/pickle in the package.

## Local changes

Code (each marked `SoloSquad vendored copy` in the source):

1. `rea_video/integrations/` removed; `cli.py` `capsule` / `remake-plan` / `remake-run` /
   `capsule-draft` now exit with a message. They imported another checkout's code, ran an
   interpreter chosen by env / `.env` (`CAPSULE_CINEMA_PYTHON`) and drive paid generation.
2. `util.load_env_files` never sets `REA_CHROME` or `CAPSULE_CINEMA_*` from a `.env` file
   (both name a program to execute).
3. `report.py` renders only local images; a remote image URL (which OCR or VLM text can carry)
   stays a plain link instead of an `<img>` that fetches when the report is opened or printed.

Skill text:

4. `references/remake-tools.md` removed (a sponsor's referral link the agent was told to append to
   replies); ChatCut and capsule-cinema routes removed from `upstream-skill.md`, `remake.md`,
   `taxonomy.md`, `output-template.md`. Code-rendered shots point to HyperFrames instead of
   Remotion.
5. `setup.md`: the `pip install … @ git+https://github.com/…` and `install_skill.sh` steps are
   replaced by the pinned local install in `SKILL.md`.
6. `memory.md`: no free-text `prefs --note` (replayed to the agent on every run); corrections live
   under `$REA_VIDEO_HOME`.

`audio.md` still cites capsule-cinema samples as evidence and as example TTS tools; left as is.
