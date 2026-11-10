"""Pack identity_renders.py output for git: stills -> WebP, clip frames -> animated WebP.

    python3 assets/office/scripts/identity_pack.py identity/_build identity

Plain Python 3 (no Blender), needs `cwebp` and `img2webp` (libwebp) on PATH. Mirrors the raw tree:
  <raw>/**/name.png                       -> <dst>/**/name.webp            (lossy q88, alpha kept)
  <raw>/motion/clips/<clip>/<view>/*.png  -> <dst>/motion/clips/<clip>/<clip>-<view>.webp
                                             (animated, looping, lossy q60, 15 fps = every 2nd 30 fps frame)
  <raw>/motion/clips/<clip>/keys/         -> skipped (already laid out in <clip>-keys.png)
"""
import shutil
import subprocess
import sys
from pathlib import Path

FRAME_MS = 67  # identity_renders.FRAME_STEP (2) / 30 fps
VIEWS = ('front', 'three-quarter')


def need(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        sys.exit(f'{tool} not found (brew install webp)')
    return path


def main(raw: Path, dst: Path) -> None:
    cwebp, img2webp = need('cwebp'), need('img2webp')
    clips = raw / 'motion' / 'clips'
    for png in sorted(raw.rglob('*.png')):
        rel = png.relative_to(raw)
        if png.parent.name in (*VIEWS, 'keys') and clips in png.parents:
            continue
        out = (dst / rel).with_suffix('.webp')
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([cwebp, '-quiet', '-q', '88', '-alpha_q', '100', '-m', '6', str(png), '-o', str(out)], check=True)
        print(out)
    if clips.is_dir():
        for clip in sorted(p for p in clips.iterdir() if p.is_dir()):
            for view in VIEWS:
                frames = sorted((clip / view).glob('*.png'))
                if not frames:
                    continue
                out = dst / 'motion' / 'clips' / clip.name / f'{clip.name}-{view}.webp'
                out.parent.mkdir(parents=True, exist_ok=True)
                cmd = [img2webp, '-loop', '0', '-lossy', '-q', '60', '-m', '4', '-d', str(FRAME_MS)]
                subprocess.run([*cmd, *map(str, frames), '-o', str(out)], check=True, capture_output=True)
                print(out)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
