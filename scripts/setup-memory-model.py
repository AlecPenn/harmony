"""Explicit setup only: downloads HARMONY's memory-search model (about 200 MB, once) and pins it.

IBM Granite Embedding Small English R2 (Apache-2.0), ONNX export by onnx-community. The first run records the exact
repository revision and every file's SHA-256 in docs/MEMORY-MODEL.json; each download is checked against the hash
Hugging Face publishes for that revision (LFS SHA-256, or the git blob hash for small files). Later runs must match the
pinned manifest exactly or stop for review. The runtime worker never downloads anything.
"""
from pathlib import Path
import hashlib, json, sys, urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = 'onnx-community/granite-embedding-small-english-r2-ONNX'
DIRECTORY = 'data/models/memory/granite-embedding-small-english-r2'
FILES = ['onnx/model.onnx', 'onnx/model.onnx_data', 'tokenizer.json', 'config.json']
MANIFEST = ROOT / 'docs' / 'MEMORY-MODEL.json'
LIMIT = 400_000_000


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'HARMONY-setup'}), timeout=90) as r:
        return r.read()


def published(revision):
    """{path: ('sha256', hex) or ('blob', git-sha1)} for the pinned revision, from Hugging Face's own tree listing."""
    out = {}
    for folder in ['', 'onnx']:
        for entry in json.loads(fetch(f'https://huggingface.co/api/models/{REPO}/tree/{revision}' + (f'/{folder}' if folder else ''))):
            if entry.get('type') != 'file': continue
            lfs = entry.get('lfs')
            out[entry['path']] = ('sha256', lfs['oid']) if lfs else ('blob', entry['oid'])
    return out


def download(revision, name, expected, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.partial')
    sha, blob, total = hashlib.sha256(), None, 0
    url = f'https://huggingface.co/{REPO}/resolve/{revision}/{name}'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'HARMONY-setup'}), timeout=120) as r, partial.open('wb') as out:
        while block := r.read(1 << 20):
            total += len(block)
            if total > LIMIT: raise ValueError('Download is larger than expected')
            sha.update(block); out.write(block)
            print(f'\r  {name}: {total / 1e6:.0f} MB', end='', flush=True)
    print()
    kind, value = expected
    if kind == 'sha256' and sha.hexdigest() != value: raise ValueError(f'{name} does not match the published hash')
    if kind == 'blob':
        data = partial.read_bytes()
        if hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest() != value: raise ValueError(f'{name} does not match the published hash')
    partial.replace(target)
    return {'path': f'{DIRECTORY}/{name}', 'bytes': total, 'sha256': sha.hexdigest()}


def matches(item):
    path = ROOT / item['path']
    if not path.is_file() or path.stat().st_size != item['bytes']: return False
    h = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1 << 20): h.update(block)
    return h.hexdigest() == item['sha256']


def main():
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else None
    if previous and all(matches(item) for item in previous['files']):
        print('Memory search model already installed and verified.'); return 0
    revision = previous['revision'] if previous else json.loads(fetch(f'https://huggingface.co/api/models/{REPO}'))['sha']
    print(f'Downloading the memory search model (about 200 MB) from {REPO} @ {revision[:10]}')
    hashes = published(revision)
    missing = [f for f in FILES if f not in hashes]
    if missing: raise ValueError('The model repository no longer has: ' + ', '.join(missing))
    records = [download(revision, name, hashes[name], ROOT / DIRECTORY / name) for name in FILES]
    if previous and records != previous['files']: raise ValueError('Pinned model content changed; review required')
    manifest = {
        'description': 'IBM Granite Embedding Small English R2 (47M parameters, 384 dimensions, CLS pooling), ONNX export by '
                       'onnx-community. Used only on this PC for meaning-based memory search.',
        'license': 'Apache-2.0', 'attribution': 'Granite Embedding Small English R2 by IBM, Apache-2.0; ONNX conversion by onnx-community.',
        'id': 'granite-embedding-small-english-r2', 'repository': REPO, 'revision': revision,
        'directory': DIRECTORY, 'model': 'onnx/model.onnx', 'tokenizer': 'tokenizer.json', 'files': records}
    MANIFEST.write_text(json.dumps(manifest, indent=1) + '\n')
    notice = ROOT / 'docs' / 'licenses' / 'Granite-Embedding-Apache-2.0.txt'; notice.parent.mkdir(exist_ok=True)
    notice.write_text('Granite Embedding Small English R2 — Copyright IBM Corp. Licensed under the Apache License, Version 2.0.\n'
                      'https://www.apache.org/licenses/LICENSE-2.0\nhttps://huggingface.co/ibm-granite/granite-embedding-small-english-r2\n'
                      f'ONNX conversion: https://huggingface.co/{REPO} (revision {revision})\n')
    print('Memory search model installed and verified:', len(records), 'files.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('Memory search setup stopped:', error); sys.exit(1)
