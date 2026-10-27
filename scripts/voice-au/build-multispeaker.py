"""Build a multi-speaker Australian training set straight from real Common Voice recordings (no voice cloning).

Idea: one Piper model learns the Australian accent from hours of many Australian women, and learns HARMONY's
chosen voice (whose own clips are few) as one speaker among them. At runtime HARMONY asks for that speaker.

Steps (both resumable; stop and rerun any time):
  score   decode and quality-score every clip from women in the dataset (cached in data/voice-au/scores.jsonl)
  build   keep clean clips, cap each speaker so no one dominates, always keep every usable clip of the chosen
          voice, write 22.05 kHz FLAC + Piper metadata (file|speaker|text) to data/voice-au/train/

Usage (HARMONY's Python):
  .venv\\Scripts\\python.exe scripts\\voice-au\\build-multispeaker.py score <dataset>
  .venv\\Scripts\\python.exe scripts\\voice-au\\build-multispeaker.py build <dataset> --voice 2
Speakers are labelled anonymously (au01, au02, ...); the chosen voice is labelled "harmony".
"""
from __future__ import annotations
import argparse, importlib.util, io, json, re, sys, time
from collections import defaultdict
from pathlib import Path
import av, numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('find_speakers', HERE / 'find-speakers.py')
fs = importlib.util.module_from_spec(spec); spec.loader.exec_module(fs)
OUT = fs.OUT
RATE = fs.RATE
TEXT_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ,.'?!;:\-]*$")

def women_rows(src) -> list[dict]:
    rows, seen = [], set()
    for _, text in src.metadata():
        for r in fs.read_rows(text):
            if r['path'] and r['path'] not in seen and r['down'] <= r['up'] and fs.is_female(r['gender']):
                seen.add(r['path']); rows.append(r)
    return rows

def clean_text(s: str) -> str | None:
    s = re.sub(r'\s+', ' ', s.replace('’', "'").replace('‘', "'").replace('“', '').replace('”', '').replace('"', '')).strip()
    if s and s[-1] not in '.?!': s += '.'
    return s if 2 <= len(s.split()) <= 30 and TEXT_OK.match(s) else None

def encode_flac(path: Path, x: np.ndarray):
    peak = float(np.abs(x).max()) if len(x) else 1.0
    pcm = (np.clip(x / max(peak, 1e-6) * 0.89, -1, 1) * 32767).astype('<i2').reshape(1, -1)
    tmp = path.with_suffix('.part')
    with av.open(str(tmp), 'w', format='flac') as c:
        s = c.add_stream('flac', rate=RATE); s.layout = 'mono'
        frame = av.AudioFrame.from_ndarray(pcm, format='s16', layout='mono'); frame.rate = RATE
        for p in s.encode(frame): c.mux(p)
        for p in s.encode(None): c.mux(p)
    tmp.replace(path)

def score(src, out: Path, budget: float) -> int:
    """Quality-score every woman's clip once; results are cached so this can run in short sessions."""
    cache = out / 'scores.jsonl'; done = set()
    if cache.exists():
        for line in cache.read_text('utf-8').splitlines():
            try: done.add(json.loads(line)['path'])
            except Exception: pass
    rows = [r for r in women_rows(src) if r['path'] not in done]
    print(f'{len(done)} clips already scored; {len(rows)} to go.', flush=True)
    if not rows: return 0
    start = time.time(); n = 0
    out.mkdir(parents=True, exist_ok=True)
    with cache.open('a', encoding='utf-8') as f:
        for batch_start in range(0, len(rows), 400):
            batch = rows[batch_start: batch_start + 400]
            audio = src.audio({r['path'] for r in batch})
            for r in batch:
                q = {'ok': False}
                if r['path'] in audio:
                    try: q = fs.quality(fs.trim(fs.decode(audio[r['path']])))
                    except Exception: pass
                f.write(json.dumps({'path': r['path'], 'score': round(fs.score(q), 2), **{k: round(v, 4) for k, v in q.items() if k != 'ok'}}) + '\n')
                n += 1
            f.flush()
            print(f'  scored {len(done) + n} clips', flush=True)
            if budget and time.time() - start > budget: print('Time budget reached; run again to continue.'); return 3
    return 0

def build(src, out: Path, voice: int, min_score: float, per_speaker: int, min_clips: int, hours: float) -> int:
    cache = out / 'scores.jsonl'
    if not cache.exists(): print('Run "score" first.'); return 1
    scores = {}
    for line in cache.read_text('utf-8').splitlines():
        try: d = json.loads(line); scores[d['path']] = d
        except Exception: pass
    target = None
    cand = out / 'candidates.json'
    if cand.exists():
        target = next((c['speaker_key'] for c in json.loads(cand.read_text()) if c['candidate'] == voice), None)
    if not target: print(f'Candidate {voice} not found in candidates.json. Run find-speakers.py first.'); return 1
    by = defaultdict(list)
    for r in women_rows(src):
        s, t = scores.get(r['path']), clean_text(r['sentence'])
        if not s or not t or 'seconds' not in s: continue
        good = s['score'] >= min_score and 1.0 <= s['seconds'] <= 12
        if good or (r['client'] == target and s['score'] >= min_score - 8 and 1.0 <= s['seconds'] <= 12):
            by[r['client']].append((s['score'], r['path'], t, s['seconds']))
    if len(by.get(target, [])) < 10: print(f'Only {len(by.get(target, []))} usable clips for the chosen voice.'); return 1
    # Best clips first per speaker; cap so a few prolific speakers can't drown the rest out.
    speakers = {k: sorted(v, reverse=True)[:per_speaker] for k, v in by.items() if k == target or len(v) >= min_clips}
    order = [target] + sorted((k for k in speakers if k != target), key=lambda k: -np.mean([c[0] for c in speakers[k]]))
    budget, chosen, total = hours * 3600, [], 0.0
    for k in order:
        secs = sum(c[3] for c in speakers[k])
        if k != target and total + secs > budget: continue
        chosen.append(k); total += secs
    labels = {k: ('harmony' if k == target else f'au{i:02d}') for i, k in enumerate(chosen)}
    wanted = {c[1]: (labels[k], c[2]) for k in chosen for c in speakers[k]}
    wavs = out / 'train' / 'wavs'; wavs.mkdir(parents=True, exist_ok=True)
    rows, todo = [], [p for p in wanted if not (wavs / (Path(p).stem + '.flac')).exists()]
    print(f'{len(chosen)} speakers, {len(wanted)} clips, about {total / 3600:.1f} hours. Writing {len(todo)} new files...', flush=True)
    for i in range(0, len(todo), 500):
        audio = src.audio(set(todo[i:i + 500]))
        for p, data in audio.items():
            try: encode_flac(wavs / (Path(p).stem + '.flac'), fs.trim(fs.decode(data)))
            except Exception: pass
        print(f'  {min(i + 500, len(todo))}/{len(todo)}', flush=True)
    for p, (label, text) in sorted(wanted.items(), key=lambda kv: (kv[1][0] != 'harmony', kv[1][0], kv[0])):
        name = Path(p).stem + '.flac'
        if (wavs / name).exists(): rows.append(f'{name}|{label}|{text}')
    (out / 'train' / 'metadata.csv').write_text('\n'.join(rows) + '\n', 'utf-8')
    counts = defaultdict(int)
    for r in rows: counts[r.split('|')[1]] += 1
    (out / 'train' / 'speakers.json').write_text(json.dumps({'voice': 'harmony', 'speakers': dict(counts)}, indent=2) + '\n')
    print(f'Wrote {len(rows)} clips for {len(counts)} speakers ("harmony" has {counts["harmony"]}) to {out / "train"}.')
    return 0

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('step', choices=['score', 'build'])
    ap.add_argument('dataset', type=Path)
    ap.add_argument('--voice', type=int, default=2, help='Candidate number of the chosen voice')
    ap.add_argument('--out', type=Path, default=OUT)
    ap.add_argument('--budget', type=float, default=0, help='score: stop after this many seconds (0 = no limit)')
    ap.add_argument('--min-score', type=float, default=28)
    ap.add_argument('--per-speaker', type=int, default=300)
    ap.add_argument('--min-clips', type=int, default=40)
    ap.add_argument('--hours', type=float, default=6)
    a = ap.parse_args(argv)
    if not a.dataset.exists(): print(f'Not found: {a.dataset}'); return 2
    src = fs.Source(a.dataset)
    if a.step == 'score': return score(src, a.out, a.budget)
    return build(src, a.out, a.voice, a.min_score, a.per_speaker, a.min_clips, a.hours)

if __name__ == '__main__': sys.exit(main())
