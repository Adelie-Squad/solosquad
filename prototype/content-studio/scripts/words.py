"""내레이션 mp3 → 단어 목록 JSON [{"w": 단어, "s": 시작초, "e": 끝초}] (faster-whisper, 한국어).

gen-assets.mjs 가 컷 경계를 문장 첫 단어에 맞추려고 부른다. 실행 환경은 OpenMontage 의 venv
(WHISPER_PYTHON, 기본 ~/Dev/OpenMontage/.venv/bin/python) — 없으면 gen-assets 는 무음 기반 DP 로 대신한다.
"""

import json
import sys

from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], language="ko", word_timestamps=True, vad_filter=False)
words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for seg in segments for w in seg.words]
print(json.dumps(words, ensure_ascii=False))
