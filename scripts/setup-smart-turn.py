"""Explicit setup only: downloads the Smart Turn end-of-turn model pinned in docs/SMART-TURN.json and checks its hash.
Without it HARMONY ends turns on silence alone, as before."""
from pathlib import Path
import hashlib, json, urllib.request
ROOT = Path(__file__).resolve().parents[1]

def main():
    manifest = json.loads((ROOT / 'docs' / 'SMART-TURN.json').read_text())
    for item in manifest['files']:
        path = ROOT / item['path']
        if path.is_file() and path.stat().st_size == item['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']:
            print('Already set up:', item['path']); continue
        request = urllib.request.Request(item['source'], headers={'User-Agent': 'HARMONY-build'})
        with urllib.request.urlopen(request, timeout=180) as response:
            data = response.read(item['bytes'] + 1)
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Smart Turn model did not match its pinned hash; nothing was saved')
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix('.partial'); temp.write_bytes(data); temp.replace(path)
        print('Set up:', item['path'])

if __name__ == '__main__':
    main()
