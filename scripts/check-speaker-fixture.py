"""Offline generated-fixture check. Does not enroll a person or print embeddings."""
from pathlib import Path
import json, runpy, sys
import numpy as np
from faster_whisper.audio import decode_audio
root = Path(__file__).resolve().parents[1]
module = runpy.run_path(str(root / 'workers/identity/embedding.py'))
extractor = module['SpeakerExtractor'](root)
samples = decode_audio(sys.argv[1], sampling_rate=16000)[:160000]
a = extractor.compute(samples)
b = extractor.compute(samples)
similarity = float(np.dot(a['embedding'], b['embedding']))
assert similarity > .999 and a['antiSpoof'] == 'unavailable'
print(json.dumps({'dimensions':len(a['embedding']), 'load_ms':round(extractor.load_ms,2),
 'first_compute_ms':round(a['speaker_id_ms'],2),'warm_compute_ms':round(b['speaker_id_ms'],2),
 'repeat_similarity':round(similarity,6),'authorization':'disabled'},indent=2))
