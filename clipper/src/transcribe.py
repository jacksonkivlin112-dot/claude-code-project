#!/usr/bin/env python3
"""Transcribe a 16 kHz mono WAV with word timestamps, plus loudness per half second.

    .venv/bin/python src/transcribe.py audio.wav out.json [model]

Writes {"words": [{"w", "s", "e"}], "segments": [{"text", "s", "e"}], "rms": [...], "rmsStep": 0.5}.
"""
import json
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel


def read_wav(path):
    """16-bit mono WAV as float32 samples (we decode it ourselves, so no extra audio library is needed)."""
    with wave.open(path, "rb") as w:
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    return data, rate


def loudness(data, rate, step=0.5):
    """RMS level (dB) for each `step` seconds of audio, used to spot hype moments."""
    n = int(rate * step)
    out = []
    for i in range(0, len(data), n):
        chunk = data[i:i + n]
        rms = float(np.sqrt(np.mean(chunk * chunk))) if len(chunk) else 0.0
        out.append(round(20 * np.log10(rms + 1e-6), 2))
    return out


def main():
    wav, out = sys.argv[1], sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "base.en"
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    audio, rate = read_wav(wav)
    assert rate == 16000, "expected 16 kHz audio"
    segments, info = model.transcribe(audio, word_timestamps=True, vad_filter=True, beam_size=1)
    words, segs = [], []
    for seg in segments:
        segs.append({"text": seg.text.strip(), "s": round(seg.start, 2), "e": round(seg.end, 2)})
        for wd in seg.words or []:
            words.append({"w": wd.word.strip(), "s": round(wd.start, 2), "e": round(wd.end, 2)})
        print(f"\r{seg.end / max(info.duration, 1) * 100:5.1f}%", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)
    with open(out, "w") as f:
        json.dump({"duration": info.duration, "words": words, "segments": segs, "rms": loudness(audio, rate), "rmsStep": 0.5}, f)


if __name__ == "__main__":
    main()
