"""Silent fixed-text CPU sweep; no microphone and no playback."""
import json,os,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'workers'/'voice'))
from kokoro_engine import KokoroEngine
engine=KokoroEngine(ROOT/'data'/'models'/'kokoro-82m')
import torch
rows=[]
for threads in [2,4,8]:
 if threads>(os.cpu_count() or 1):continue
 torch.set_num_threads(threads)
 for text in ['On it.','One thing at a time. We have got this.']:
  started=time.perf_counter();first=None;size=0
  for block in engine.synthesize(text):
   if first is None:first=(time.perf_counter()-started)*1000
   size+=len(block)
  row={'threads':threads,'text':text,'first_audio_ms':round(first,2),'complete_ms':round((time.perf_counter()-started)*1000,2),'audio_seconds':round(size/48000,3)}
  rows.append(row);print(json.dumps(row),flush=True)
(ROOT/'docs'/'local-voice-cpu-profile.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
