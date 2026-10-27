"""Listen back to every generated line with HARMONY's own speech recognition (Parakeet) and drop the bad ones.

A line is kept only if what Parakeet hears closely matches the script, which catches mumbled, skipped or
hallucinated words before they can teach the voice bad habits. Nothing is deleted: rejects are listed.

Usage (HARMONY's Python, after generate.py):
  .venv\\Scripts\\python.exe scripts\\voice-au\\check-dataset.py
Writes data\\voice-au\\dataset\\metadata.clean.csv (Piper/LJSpeech format) and rejected.csv.
"""
from __future__ import annotations
import argparse, re, sys, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data' / 'voice-au' / 'dataset'

def words(s: str) -> list[str]:
    s = s.lower().replace("'", '').replace('-', ' ')
    return re.findall(r'[a-z0-9]+', s)

def wer(ref: list[str], hyp: list[str]) -> float:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[len(hyp)] / max(1, len(ref))

def to16k(path: Path) -> np.ndarray:
    with wave.open(str(path), 'rb') as w:
        rate = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32) / 32768
    n = int(len(x) * 16000 / rate)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)

def parakeet():
    import onnx_asr, onnxruntime as ort
    opts = ort.SessionOptions(); opts.log_severity_level = 3
    model = onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v2', str(ROOT / 'data' / 'models' / 'stt-candidates' / 'parakeet-tdt-0.6b-v2'),
                                quantization='int8', sess_options=opts, providers=['CPUExecutionProvider'])
    return lambda audio: str(model.recognize(audio, sample_rate=16000))

def main(argv=None, recognize=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--max-wer', type=float, default=0.15)
    ap.add_argument('--data', type=Path, default=DATA)
    a = ap.parse_args(argv)
    meta = a.data / 'metadata.csv'
    if not meta.exists(): print('No generated lines yet. Run generate.py first.'); return 1
    recognize = recognize or parakeet()
    kept, rejected = [], []
    rows = [l.split('|', 1) for l in meta.read_text('utf-8').splitlines() if '|' in l]
    for n, (key, text) in enumerate(rows, 1):
        heard = recognize(to16k(a.data / 'wavs' / f'{key}.wav'))
        score = wer(words(text), words(heard))
        (kept if score <= a.max_wer else rejected).append((key, text, heard, score))
        if n % 50 == 0: print(f'{n}/{len(rows)} checked, {len(rejected)} rejected so far', flush=True)
    (a.data / 'metadata.clean.csv').write_text(''.join(f'{k}|{t}\n' for k, t, *_ in kept), 'utf-8')
    (a.data / 'rejected.csv').write_text('id|script|heard|word_error_rate\n' + ''.join(f'{k}|{t}|{h}|{s:.2f}\n' for k, t, h, s in rejected), 'utf-8')
    seconds = 0.0
    for k, *_ in kept:
        with wave.open(str(a.data / 'wavs' / f'{k}.wav'), 'rb') as w: seconds += w.getnframes() / w.getframerate()
    print(f'Kept {len(kept)} of {len(rows)} lines ({seconds / 60:.0f} minutes of speech). Rejected {len(rejected)}: see rejected.csv.')
    if seconds < 45 * 60: print('Under 45 minutes kept: consider generating more lines before training.')
    return 0

if __name__ == '__main__': sys.exit(main())
