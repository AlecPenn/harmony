"""Installs HARMONY's security models (voice and face checks). Explicit, one time; runtime never downloads anything.

Each model is fetched from its pinned source, checked against its exact size and SHA-256 from docs/GUARD-MODELS.json,
and only then moved into data/models. OpenCV (for the face models) is installed with a pinned hash.
"""
from pathlib import Path
import hashlib, json, subprocess, sys, urllib.request

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs' / 'GUARD-MODELS.json').read_text(encoding='utf-8-sig'))
models = (root / 'data' / 'models').resolve()


def have(entry):
    path = (root / entry['path']).resolve()
    if not path.is_file() or path.stat().st_size != entry['bytes']:
        return False
    h = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1 << 20):
            h.update(block)
    return h.hexdigest() == entry['sha256']


def fetch(name, entry):
    destination = (root / entry['path']).resolve()
    if not destination.is_relative_to(models):
        raise ValueError('Unsafe model destination')
    if have(entry):
        print(f'  {name}: already installed')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.download')
    try:
        digest, size = hashlib.sha256(), 0
        with urllib.request.urlopen(entry['source'], timeout=120) as source, temporary.open('wb') as target:
            while block := source.read(1 << 20):
                size += len(block)
                if size > entry['bytes']:
                    raise ValueError(f'{name} is larger than expected')
                digest.update(block); target.write(block)
        if size != entry['bytes'] or digest.hexdigest() != entry['sha256']:
            raise ValueError(f'{name} failed its integrity check')
        temporary.replace(destination)
        print(f'  {name}: installed ({size / 1e6:.1f} MB)')
    finally:
        temporary.unlink(missing_ok=True)


print('Installing OpenCV for face checks (pinned)...')
subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', '--require-hashes', '-r',
                str(root / 'workers' / 'guard' / 'requirements.lock.txt')], check=True)
print('Installing security models...')
for name, entry in manifest['models'].items():
    fetch(name, entry)
print('Checking they load...')
check = subprocess.run([sys.executable, '-I', '-c',
    'import runpy,sys;g=runpy.run_path(sys.argv[1]);v=g["VoicePrint"].load();f=g["FaceEngine"].load();h=g["HandEngine"].load();print("voice", "ok" if v else "missing");print("face", "ok" if f else "missing");print("hand signs", "ok" if h else "missing");sys.exit(0 if v and f and h else 1)',
    str(root / 'workers' / 'guard' / 'guard.py')])
if check.returncode:
    sys.exit('Something did not load. Run this again; if it keeps failing, run "Set up local brain" first.')
print('Security is ready. In HARMONY: Settings > Security > Teach HARMONY my voice. Nothing leaves this PC.')
