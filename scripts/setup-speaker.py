"""Explicit speaker model installation. Runtime never downloads weights."""
from pathlib import Path
import hashlib,json,urllib.request
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'docs/SPEAKER-MODEL.json').read_text(encoding='utf-8-sig'))
models=(root/'data/models').resolve()
destination=(root/manifest['path']).resolve()
if not destination.is_relative_to(models):raise ValueError('Unsafe model destination')
destination.parent.mkdir(parents=True,exist_ok=True)
temporary=destination.with_suffix('.download')
try:
    digest=hashlib.sha256();size=0
    with urllib.request.urlopen(manifest['source'],timeout=90) as source, temporary.open('wb') as target:
        while block:=source.read(1024*1024):
            size+=len(block)
            if size>manifest['bytes']:raise ValueError('Speaker model exceeds expected size')
            digest.update(block);target.write(block)
    if size!=manifest['bytes'] or digest.hexdigest()!=manifest['sha256']:raise ValueError('Speaker model integrity failed')
    temporary.replace(destination)
finally:
    temporary.unlink(missing_ok=True)
print('Pinned speaker model installed. No microphone access or enrollment.')
