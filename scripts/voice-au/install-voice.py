"""Install a trained Australian voice into HARMONY and pin it by hash.

Usage: python scripts/voice-au/install-voice.py <en_AU-harmony-medium.onnx> [--speaker harmony]
(the matching .onnx.json must sit next to it). Copies both into data/models/piper-harmony-au and writes
docs/VOICE-AU-MODEL.json. HARMONY uses the voice only if the files still match those hashes; otherwise it
falls back to Alba. Delete docs/VOICE-AU-MODEL.json to go back to Alba.
"""
import argparse, hashlib, json, shutil, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('model', type=Path); ap.add_argument('--speaker', default='harmony')
    ap.add_argument('--root', type=Path, default=ROOT)
    a = ap.parse_args(argv)
    config = Path(str(a.model) + '.json')
    if not a.model.is_file() or not config.is_file(): print(f'Need both {a.model.name} and {config.name}.'); return 2
    c = json.loads(config.read_text('utf-8'))
    problems = [p for ok, p in [(c.get('audio', {}).get('sample_rate') == 22050, 'sample rate is not 22050'),
                                (c.get('espeak', {}).get('voice') == 'en-gb-x-rp', 'phoneme voice is not en-gb-x-rp'),
                                (a.speaker in c.get('speaker_id_map', {}), f'speaker "{a.speaker}" is not in this model')] if not ok]
    if problems: print('Not installed: ' + '; '.join(problems) + '.'); return 1
    dest = a.root / 'data' / 'models' / 'piper-harmony-au'; dest.mkdir(parents=True, exist_ok=True)
    name = 'en_AU-harmony-medium.onnx'; files = []
    for src, target in [(a.model, name), (config, name + '.json')]:
        shutil.copyfile(src, dest / target)
        data = (dest / target).read_bytes()
        files.append({'name': target, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {'description': "HARMONY's Australian voice: Piper medium, multi-speaker, trained on Common Voice en-AU (CC0) from the VCTK checkpoint.",
                'model': name, 'speaker': a.speaker, 'speakers': sorted(c['speaker_id_map']), 'files': files}
    (a.root / 'docs' / 'VOICE-AU-MODEL.json').write_text(json.dumps(manifest, indent=1) + '\n', 'utf-8')
    print(f'Installed {name} (speaker "{a.speaker}", {len(c["speaker_id_map"])} voices in the model). HARMONY uses it on its next voice start.')
    return 0

if __name__ == '__main__': sys.exit(main())
