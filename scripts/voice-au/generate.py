"""Read the script in the chosen Australian voice with Chatterbox (MIT), making Piper training data.

Runs in the separate generator environment (scripts\\voice-au\\setup-generator.cmd). Close HARMONY first so the
GPU is free. Resumable: stop any time (Ctrl+C) and run it again to carry on.

Usage:
  .venv-voicegen\\Scripts\\python.exe scripts\\voice-au\\generate.py --candidate 3
Writes data\\voice-au\\reference.wav, data\\voice-au\\dataset\\wavs\\*.wav and data\\voice-au\\dataset\\metadata.csv.
Every file carries Chatterbox's inaudible watermark, which marks it as generated speech.
"""
from __future__ import annotations
import argparse, os, sys, time, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data' / 'voice-au'
REPO, REVISION = 'ResembleAI/chatterbox', '5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18'  # pinned; MIT
FILES = ['ve.safetensors', 't3_cfg.safetensors', 's3gen.safetensors', 'tokenizer.json', 'conds.pt']
RATE = 22050  # Piper's training rate

def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), 'rb') as w:
        x = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32) / 32768
        return x.reshape(-1, w.getnchannels()).mean(1), w.getframerate()

def write_wav(path: Path, x: np.ndarray, rate: int = RATE):
    peak = float(np.abs(x).max()) if len(x) else 1.0
    pcm = (np.clip(x / max(peak, 1e-6) * 0.89, -1, 1) * 32767).astype('<i2')
    tmp = path.with_suffix('.part')
    with wave.open(str(tmp), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm.tobytes())
    os.replace(tmp, path)

def frames_rms(x: np.ndarray, rate: int, ms: int = 20) -> np.ndarray:
    f = int(rate * ms / 1000); n = len(x) // f
    return np.sqrt((x[: n * f].reshape(n, f) ** 2).mean(1) + 1e-12) if n else np.zeros(0)

def trim(x: np.ndarray, rate: int, keep_ms: int = 120) -> np.ndarray:
    r = frames_rms(x, rate)
    if not len(r): return x
    on = np.where(r > r.max() * 0.04)[0]
    if not len(on): return x[:0]
    f = int(rate * 0.02); pad = keep_ms // 20
    return x[max(0, on[0] - pad) * f: min(len(x), (on[-1] + 1 + pad) * f)]

def make_reference(candidate: int, seconds: float = 11.0) -> Path:
    """The first ~11 s of the chosen audition clip, cut at a pause so no word is chopped."""
    src = OUT / 'candidates' / f'candidate-{candidate}.wav'
    if not src.exists(): raise SystemExit(f'{src} not found. Run find-speakers.py first.')
    x, rate = read_wav(src)
    end = min(len(x), int(rate * seconds))
    if end < len(x):
        r = frames_rms(x[: end], rate); quiet = np.where(r < r.max() * 0.03)[0]
        if len(quiet) and quiet[-1] * 20 / 1000 > seconds * 0.6: end = quiet[-1] * int(rate * 0.02)
    ref = OUT / 'reference.wav'; write_wav(ref, x[:end], rate); return ref

def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    import torch, torchaudio.functional as F
    return F.resample(torch.from_numpy(x).unsqueeze(0), src, dst).squeeze(0).numpy()

def plausible(x: np.ndarray, text: str) -> bool:
    """Catches the usual generation failures: cut short, stuck repeating, or long babble."""
    secs, words = len(x) / RATE, max(1, len(text.split()))
    return 0.6 < secs < 20 and 1.0 <= words / secs <= 4.8

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--candidate', type=int, help='Which audition clip to copy (candidate-N.wav). Needed the first time.')
    ap.add_argument('--device', default='auto', choices=['auto', 'cuda', 'cpu'])
    ap.add_argument('--limit', type=int, default=0, help='Stop after this many new lines (0 = all). Try 10 first.')
    a = ap.parse_args(argv)
    script = OUT / 'script.txt'
    if not script.exists(): raise SystemExit('data\\voice-au\\script.txt not found. Run make-script.py first.')
    lines = [l.strip() for l in script.read_text('utf-8').splitlines() if l.strip()]
    ref = OUT / 'reference.wav'
    if a.candidate: ref = make_reference(a.candidate)
    elif not ref.exists(): raise SystemExit('Say which voice to use the first time, e.g. --candidate 3')

    import torch
    from huggingface_hub import hf_hub_download
    from chatterbox.tts import ChatterboxTTS
    device = ('cuda' if torch.cuda.is_available() else 'cpu') if a.device == 'auto' else a.device
    print(f'Loading Chatterbox on {device} (first run downloads about 3 GB)...')
    local = None
    for name in FILES: local = Path(hf_hub_download(REPO, name, revision=REVISION))
    try:
        model = ChatterboxTTS.from_local(local.parent, device)
        model.prepare_conditionals(str(ref), exaggeration=0.5)
    except torch.cuda.OutOfMemoryError:
        raise SystemExit('The GPU ran out of memory. Close HARMONY (and games/browsers using the GPU) and retry, or add --device cpu.')

    wavs = OUT / 'dataset' / 'wavs'; wavs.mkdir(parents=True, exist_ok=True)
    made, failed, started = 0, [], time.time()
    todo = sum(1 for i in range(1, len(lines) + 1) if not (wavs / f'au{i:05d}.wav').exists())
    for i, text in enumerate(lines, 1):
        target = wavs / f'au{i:05d}.wav'
        if target.exists(): continue
        if a.limit and made >= a.limit: break
        ok = False
        for attempt in range(3):
            torch.manual_seed(i * 7 + attempt)
            try:
                out = model.generate(text, exaggeration=0.5, cfg_weight=0.5, temperature=0.7)
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache(); continue
            x = trim(resample(out.squeeze(0).cpu().numpy().astype(np.float32), model.sr, RATE), RATE)
            if plausible(x, text): write_wav(target, x); ok = True; break
        made += 1
        if not ok: failed.append(i)
        rate = (time.time() - started) / made
        left = min(todo, a.limit or todo) - made
        print(f'[{i}/{len(lines)}] {"ok " if ok else "SKIP"} {text[:60]}  (~{rate * left / 60:.0f} min left)', flush=True)
    meta = [f'au{i:05d}|{t}' for i, t in enumerate(lines, 1) if (wavs / f'au{i:05d}.wav').exists()]
    (OUT / 'dataset' / 'metadata.csv').write_text('\n'.join(meta) + '\n', 'utf-8')
    print(f'\n{len(meta)} of {len(lines)} lines recorded ({len(failed)} skipped this run). Next: check-dataset.py')
    return 0

if __name__ == '__main__': sys.exit(main())
