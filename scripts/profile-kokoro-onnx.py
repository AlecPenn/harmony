"""Silent, fixed-text quantized CPU comparison. No app or voice preference changes."""
import hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'workers'/'voice'))
from local_assets import verify_assets
assets=verify_assets(ROOT/'data'/'models'/'kokoro-82m')
model=ROOT/'data'/'models'/'kokoro-onnx'/'model_quantized.onnx'
with model.open('rb') as f:
 h=hashlib.file_digest(f,'sha256').hexdigest()
if h!='fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478':raise ValueError('Model hash mismatch')
import numpy as np,torch,onnxruntime as rt
from kokoro_onnx import Kokoro
voice=torch.load(assets['bf_emma.pt'],weights_only=True,map_location='cpu').numpy()
archive=model.parent/'emma.npz';np.savez(archive,bf_emma=voice)
rows=[]
for threads in [1,2,4]:
 options=rt.SessionOptions();options.intra_op_num_threads=threads;options.inter_op_num_threads=1;options.log_severity_level=3
 started=time.perf_counter();session=rt.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider'])
 engine=Kokoro.from_session(session,str(archive),vocab_config=str(assets['config.json']))
 engine.create('This is the warm-up phrase.',voice='bf_emma',lang='en-gb')
 startup=(time.perf_counter()-started)*1000
 for text in ['On it.','One thing at a time. We have got this.']:
  start=time.perf_counter();audio,rate=engine.create(text,voice='bf_emma',lang='en-gb')
  elapsed=(time.perf_counter()-start)*1000
  if rate!=24000 or not np.isfinite(audio).all() or not audio.size:raise ValueError('Invalid audio')
  row={'threads':threads,'text':text,'audio_ready_ms':round(elapsed,2),'audio_seconds':round(audio.size/rate,3),'model_and_warmup_ms':round(startup,2)};rows.append(row);print(json.dumps(row),flush=True)
 del engine,session
(ROOT/'docs'/'local-voice-onnx-profile.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
