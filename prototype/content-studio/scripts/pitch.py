"""음성 파일의 '끝 억양' 수치 — 말 끝 0.4초 평균 F0 / 그 앞 0.6초 평균 F0 (1 보다 크면 끝이 올라감).

gen-assets.mjs 가 endPitch: "up" 인 문장(연결형)의 녹음 중 끝이 덜 내려간 것을 고를 때 부른다.
자기상관 F0 추정이라 정밀하진 않지만 녹음끼리 비교하기엔 충분하다. numpy 만 쓴다(OpenMontage venv).
"""

import subprocess
import sys

import numpy as np

pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True).stdout
x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
sr, win, hop = 16000, 640, 160
f0 = []
for i in range(0, len(x) - win, hop):
    w = x[i : i + win]
    if np.sqrt((w**2).mean()) < 0.02:
        f0.append(np.nan)
        continue
    w = w - w.mean()
    ac = np.correlate(w, w, "full")[win - 1 :]
    lo, hi = sr // 400, sr // 120
    k = lo + int(np.argmax(ac[lo:hi]))
    f0.append(sr / k if ac[k] > 0.3 * ac[0] else np.nan)
f0 = np.array(f0)
t = np.arange(len(f0)) * hop / sr
voiced = np.where(~np.isnan(f0))[0]
end = t[voiced[-1]] if len(voiced) else 0.0


def mean(a, b):
    s = f0[(t >= a) & (t < b)]
    return float(np.nanmean(s)) if np.any(~np.isnan(s)) else float("nan")


print(f"{mean(end - 0.4, end + 0.01) / mean(end - 1.0, end - 0.4):.3f}")
