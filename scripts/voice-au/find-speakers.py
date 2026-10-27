"""Find the cleanest-sounding Australian women in the Common Voice en-AU subset and save a short audition clip of each.

Local only. Nothing is uploaded or re-shared, and speakers are never identified: candidates are labelled
"candidate-1", "candidate-2" and so on by sound quality alone. The dataset (CC0) stays where you put it.

Usage (from the HARMONY folder, after downloading the 1.92 GB en-AU subset):
  .venv\\Scripts\\python.exe scripts\\voice-au\\find-speakers.py "C:\\path\\to\\the-download.tar.gz"
  (an extracted folder works too)
Writes data\\voice-au\\candidates\\candidate-N.wav plus data\\voice-au\\candidates.json.
"""
from __future__ import annotations
import argparse, csv, io, json, statistics, sys, tarfile, wave
from collections import defaultdict
from pathlib import Path
import av, numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data' / 'voice-au'
RATE = 22050
MIN_CLIPS, MAX_SCORED_PER_SPEAKER, CANDIDATES, AUDITION_SECONDS = 15, 40, 8, 25.0

def col(header: list[str], *names: str) -> int | None:
    low = [h.strip().lower() for h in header]
    for n in names:
        if n in low: return low.index(n)
    return None

def is_female(value: str) -> bool:
    v = value.strip().lower()
    return v.startswith('female') or v in ('f', 'woman')

def read_rows(text: str) -> list[dict]:
    """Common Voice metadata may be CSV or TSV; columns are found by name."""
    sample = text[:4096]
    delim = '\t' if sample.count('\t') > sample.count(',') else ','
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    header = next(reader, None)
    if not header: return []
    c = {k: col(header, *names) for k, names in {
        'client': ('client_id', 'speaker_id', 'client'), 'path': ('path', 'file', 'filename', 'audio'),
        'sentence': ('sentence', 'text', 'transcript'), 'gender': ('gender', 'sex'),
        'up': ('up_votes',), 'down': ('down_votes',)}.items()}
    if c['client'] is None or c['path'] is None or c['gender'] is None: return []
    rows = []
    for r in reader:
        if len(r) < len(header): continue
        get = lambda k: r[c[k]] if c[k] is not None else ''
        rows.append({'client': get('client'), 'path': Path(get('path')).name, 'sentence': get('sentence'), 'gender': get('gender'),
                     'up': int(get('up') or 0) if (get('up') or '0').isdigit() else 0,
                     'down': int(get('down') or 0) if (get('down') or '0').isdigit() else 0})
    return rows

class Source:
    """Reads either an extracted folder or the .tar.gz directly (two streaming passes, nothing extracted to disk)."""
    def __init__(self, path: Path):
        self.path = path; self.archive = path.is_file()
    def metadata(self) -> list[tuple[str, str]]:
        found = []
        if self.archive:
            with tarfile.open(self.path, 'r|*') as tar:
                for m in tar:
                    if m.isfile() and m.name.lower().endswith(('.csv', '.tsv')) and m.size < 500_000_000:
                        found.append((m.name, tar.extractfile(m).read().decode('utf-8', 'replace')))
        else:
            for p in sorted(self.path.rglob('*')):
                if p.suffix.lower() in ('.csv', '.tsv') and p.is_file(): found.append((str(p), p.read_text('utf-8', 'replace')))
        return found
    def audio(self, wanted: set[str]) -> dict[str, bytes]:
        out = {}
        if self.archive:
            with tarfile.open(self.path, 'r|*') as tar:
                for m in tar:
                    name = Path(m.name).name
                    if m.isfile() and name in wanted and m.size < 5_000_000: out[name] = tar.extractfile(m).read()
        else:
            for p in self.path.rglob('*.mp3'):
                if p.name in wanted: out[p.name] = p.read_bytes()
        return out

def decode(data: bytes) -> np.ndarray:
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format='flt', layout='mono', rate=RATE)
        chunks = []
        for frame in container.decode(audio=0):
            for f in resampler.resample(frame): chunks.append(f.to_ndarray().reshape(-1))
        for f in resampler.resample(None): chunks.append(f.to_ndarray().reshape(-1))
    return np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)

def trim(x: np.ndarray) -> np.ndarray:
    """Cut leading/trailing silence (and the mic click Common Voice clips often start with)."""
    if not len(x): return x
    frame = int(RATE * 0.02); n = len(x) // frame
    if n < 3: return x
    rms = np.sqrt((x[:n * frame].reshape(n, frame) ** 2).mean(1) + 1e-12)
    on = np.where(rms > max(rms.max() * 0.06, 1e-4))[0]
    if not len(on): return x[:0]
    a = max(0, on[0] - 3) * frame; b = min(len(x), (on[-1] + 4) * frame)
    return x[a:b]

def quality(x: np.ndarray) -> dict:
    """Rough clip quality: signal-to-noise, clipping, and whether it sounds like a phone (little energy above 4 kHz)."""
    frame = int(RATE * 0.02); n = len(x) // frame
    if n < 10: return {'ok': False}
    rms = np.sqrt((x[:n * frame].reshape(n, frame) ** 2).mean(1) + 1e-12)
    noise, speech = np.percentile(rms, 10), np.percentile(rms, 90)
    spec = np.abs(np.fft.rfft(x[: min(len(x), RATE * 6)])) ** 2
    freqs = np.fft.rfftfreq(min(len(x), RATE * 6), 1 / RATE)
    high = float(spec[freqs > 4000].sum() / (spec[freqs > 100].sum() + 1e-12))
    return {'ok': True, 'snr_db': float(20 * np.log10(speech / max(noise, 1e-6))), 'clipped': float((np.abs(x) > 0.98).mean()),
            'high_band': high, 'seconds': len(x) / RATE}

def score(q: dict) -> float:
    if not q.get('ok'): return -1e9
    s = min(q['snr_db'], 45)                       # beyond ~45 dB more doesn't matter
    s -= 400 * q['clipped']                         # clipping is badly audible
    s -= 30 * max(0.0, 0.02 - q['high_band']) / 0.02  # muffled / phone-band audio
    if not 1.5 <= q['seconds'] <= 12: s -= 10
    return s

def write_wav(path: Path, x: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = float(np.abs(x).max()) if len(x) else 1.0
    pcm = (np.clip(x / max(peak, 1e-6) * 0.89, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dataset', type=Path, help='The downloaded en-AU subset (.tar.gz) or the folder it was extracted to')
    ap.add_argument('--out', type=Path, default=OUT)
    a = ap.parse_args(argv)
    if not a.dataset.exists(): print(f'Not found: {a.dataset}'); return 2
    src = Source(a.dataset)
    print('Reading the dataset list (a minute for the 1.9 GB archive)...')
    rows, seen = [], set()
    for name, text in src.metadata():
        for r in read_rows(text):
            if r['path'] and r['path'] not in seen and r['down'] <= r['up']: seen.add(r['path']); rows.append(r)
    women = defaultdict(list)
    for r in rows:
        if is_female(r['gender']): women[r['client']].append(r)
    eligible = {k: v for k, v in women.items() if len(v) >= MIN_CLIPS}
    print(f'{len(rows)} usable clips; {len(women)} women; {len(eligible)} with at least {MIN_CLIPS} clips.')
    if not eligible: print('No speaker has enough clips. Check that this is the en-AU subset with gender information.'); return 1
    # Score up to 40 well-voted clips per speaker, from the speakers with the most clips first.
    ranked = sorted(eligible.items(), key=lambda kv: -len(kv[1]))[:60]
    picks = {k: sorted(v, key=lambda r: -(r['up'] - r['down']))[:MAX_SCORED_PER_SPEAKER] for k, v in ranked}
    print(f'Listening to {sum(map(len, picks.values()))} clips from {len(picks)} speakers...')
    audio = src.audio({r['path'] for v in picks.values() for r in v})
    results = []
    for client, clips in picks.items():
        scored = []
        for r in clips:
            data = audio.get(r['path'])
            if not data: continue
            try: x = trim(decode(data))
            except Exception: continue
            q = quality(x)
            if q.get('ok'): scored.append((score(q), q, r, x))
        if len(scored) < 8: continue
        scored.sort(key=lambda t: -t[0])
        top = scored[: max(8, len(scored) // 2)]
        # A speaker's score is her typical good clip, and how consistent she is (same mic, same room).
        speaker = statistics.median(s for s, *_ in top) - 0.3 * statistics.pstdev([q['snr_db'] for _, q, *_ in top])
        results.append((speaker, client, len(eligible[client]), top))
    results.sort(key=lambda t: -t[0])
    chosen = results[:CANDIDATES]
    a.out.mkdir(parents=True, exist_ok=True)
    report = []
    gap = np.zeros(int(RATE * 0.45), np.float32)
    for i, (speaker, client, total, top) in enumerate(chosen, 1):
        parts, used, secs = [], [], 0.0
        for _, q, r, x in top:
            if secs >= AUDITION_SECONDS: break
            parts += [x, gap]; secs += len(x) / RATE; used.append(r['path'])
        write_wav(a.out / 'candidates' / f'candidate-{i}.wav', np.concatenate(parts))
        report.append({'candidate': i, 'score': round(speaker, 1), 'clips_available': total,
                       'median_snr_db': round(statistics.median(q['snr_db'] for _, q, *_ in top), 1),
                       'audition_clips': used,
                       # Kept only on this PC so the chosen voice can be rebuilt; never shown, shared or looked up.
                       'speaker_key': client})
    (a.out / 'candidates.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'\nSaved {len(chosen)} audition clips to {a.out / "candidates"} (best sounding first):')
    for r in report: print(f'  candidate-{r["candidate"]}.wav  quality {r["score"]}  ({r["clips_available"]} clips available)')
    print('\nListen, then tell Claude which candidate should become HARMONY\'s voice.')
    return 0

if __name__ == '__main__': sys.exit(main())
