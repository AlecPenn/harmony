"""Build the reading script for HARMONY's Australian voice: about 1,300 varied sentences.

Most lines are Common Voice sentences (CC0) chosen greedily for sound coverage, so the voice learns every common
English sound combination. HARMONY's own everyday phrases (harmony-lines.txt) are always included, each twice
with different wording around it, so the things she says most sound best.

Usage (HARMONY's Python):
  .venv\\Scripts\\python.exe scripts\\voice-au\\make-script.py "C:\\path\\to\\the-download.tar.gz"
Writes data\\voice-au\\script.txt (one sentence per line).
"""
from __future__ import annotations
import argparse, importlib.util, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('find_speakers', HERE / 'find-speakers.py')
fs = importlib.util.module_from_spec(spec); spec.loader.exec_module(fs)
OUT = fs.OUT
ALLOWED = re.compile(r"^[A-Za-z][A-Za-z ,.'?!\-]*[.?!]$")

def clean(s: str) -> str | None:
    s = re.sub(r'\s+', ' ', s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace('"', '')).strip()
    if s and s[-1] not in '.?!': s += '.'
    words = s.split()
    if not 5 <= len(words) <= 22 or not ALLOWED.match(s): return None   # no digits or symbols: those read inconsistently
    if sum(w.isupper() and len(w) > 1 for w in words) > 1: return None  # acronyms
    return s

def units(s: str) -> set[str]:
    """Letter triples within words, plus word starts and ends: a cheap stand-in for sound coverage."""
    out = set()
    for w in re.findall(r"[a-z']+", s.lower()):
        w = f'^{w}$'
        out.update(w[i:i + 3] for i in range(len(w) - 2))
    return out

def choose(candidates: list[str], count: int, seed: set[str]) -> list[str]:
    """Greedy sound coverage, done lazily: a sentence's gain can only shrink as coverage grows, so only the
    current leader needs re-checking (fast even for 50,000+ sentences)."""
    import heapq
    covered, chosen = set(seed), []
    pool = list(dict.fromkeys(candidates))
    sets = [units(c) for c in pool]; norm = [len(c.split()) ** 0.5 for c in pool]
    heap = [(-len(u - covered) / n, i) for i, (u, n) in enumerate(zip(sets, norm))]; heapq.heapify(heap)
    while heap and len(chosen) < count:
        _, i = heapq.heappop(heap)
        gain = len(sets[i] - covered) / norm[i]
        if heap and gain < -heap[0][0]: heapq.heappush(heap, (-gain, i)); continue
        if gain <= 0:  # coverage saturated: fill with the remaining variety in a stable order
            rest = sorted(j for _, j in heap) + [i]
            chosen.extend(pool[j] for j in sorted(rest)[: count - len(chosen)]); break
        chosen.append(pool[i]); covered |= sets[i]
    return chosen

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dataset', type=Path)
    ap.add_argument('--count', type=int, default=1300)
    ap.add_argument('--out', type=Path, default=OUT)
    a = ap.parse_args(argv)
    if not a.dataset.exists(): print(f'Not found: {a.dataset}'); return 2
    own = [l.strip() for l in (HERE / 'harmony-lines.txt').read_text('utf-8').splitlines() if l.strip()]
    sentences = []
    for _, text in fs.Source(a.dataset).metadata():
        for r in fs.read_rows(text):
            c = clean(r['sentence'])
            if c: sentences.append(c)
    # Only everyday words: every word must appear in at least 5 different sentences, which drops jargon,
    # rare names and foreign terms that the generator would stumble over and that teach the voice nothing.
    from collections import Counter
    unique = sorted(set(sentences))
    freq = Counter(w for c in unique for w in set(re.findall(r"[a-z']+", c.lower())))
    sentences = [c for c in unique if all(freq[w] >= 5 for w in re.findall(r"[a-z']+", c.lower()))]
    seed = set().union(*(units(l) for l in own))
    if len(sentences) < 200: print(f'Only {len(sentences)} usable sentences found; is this the right dataset?'); return 1
    picked = choose(sentences, max(0, a.count - len(own)), seed)
    lines = own + picked
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / 'script.txt').write_text('\n'.join(lines) + '\n', 'utf-8')
    words = sum(len(l.split()) for l in lines)
    print(f'Wrote {len(lines)} lines ({words} words, roughly {words / 150:.0f} minutes of speech) to {a.out / "script.txt"}.')
    return 0

if __name__ == '__main__': sys.exit(main())
