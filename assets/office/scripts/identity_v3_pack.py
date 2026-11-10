"""Pack identity_v3_renders.py output for git: stills -> WebP, motion frames -> animated WebP.

    python3 assets/office/scripts/identity_v3_pack.py identity/_build/v3 identity/_drafts/penguin-v3

Plain Python 3 (no Blender), needs `cwebp` and `img2webp` (libwebp) on PATH.
  <raw>/**/name.png             -> <dst>/**/name.webp           (lossy q86)
  <raw>/motion/<clip>/NNN.png   -> <dst>/motion/<clip>.webp     (animated, looping, q62, 30 fps)
"""
import shutil
import subprocess
import sys
from pathlib import Path

FRAME_MS = 33  # 30 fps: every frame of the 30 fps clip


def need(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        sys.exit(f'{tool} not found (brew install webp)')
    return path


def main(raw: Path, dst: Path) -> None:
    cwebp, img2webp = need('cwebp'), need('img2webp')
    motion = raw / 'motion'
    for png in sorted(raw.rglob('*.png')):
        if motion in png.parents and png.parent != motion:
            continue                     # clip frames: packed below
        out = (dst / png.relative_to(raw)).with_suffix('.webp')
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([cwebp, '-quiet', '-q', '86', '-m', '6', str(png), '-o', str(out)], check=True)
        print(out)
    if motion.is_dir():
        for clip in sorted(p for p in motion.iterdir() if p.is_dir()):
            frames = sorted(clip.glob('*.png'))
            out = dst / 'motion' / f'{clip.name}.webp'
            out.parent.mkdir(parents=True, exist_ok=True)
            cmd = [img2webp, '-loop', '0', '-lossy', '-q', '62', '-m', '4', '-d', str(FRAME_MS)]
            subprocess.run([*cmd, *map(str, frames), '-o', str(out)], check=True, capture_output=True)
            print(out)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
