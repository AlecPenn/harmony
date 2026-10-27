"""Explicit silent GPU experiment; does not change the desktop provider or voice."""
import hashlib,json,os,subprocess,sys,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.runtime'/'onnx-directml'))
sys.path.insert(0,str(ROOT/'workers'/'voice'))
from local_assets import verify_assets
assets=verify_assets(ROOT/'data'/'models'/'kokoro-82m')
model=ROOT/'data'/'models'/'kokoro-onnx'/'model_quantized.onnx'
# Full reviewed digest, kept explicit rather than accepting a generated local manifest.
with model.open('rb') as f:
 if hashlib.file_digest(f,'sha256').hexdigest()!='fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478':raise ValueError('Model integrity failed')
gpu=subprocess.run(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5,check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
free=int(gpu.stdout.strip().splitlines()[0])
if free<1536:raise RuntimeError('Insufficient free GPU memory for experiment')
import numpy as np,torch,onnxruntime as rt
from kokoro_onnx import Kokoro
if not Path(rt.__file__).resolve().is_relative_to((ROOT/'.runtime'/'onnx-directml').resolve()):raise RuntimeError('Wrong experiment runtime')
if 'DmlExecutionProvider' not in rt.get_available_providers():raise RuntimeError('DirectML unavailable')
voice=torch.load(assets['bf_emma.pt'],weights_only=True,map_location='cpu').numpy()
archive=model.parent/'emma-directml.npz';np.savez(archive,bf_emma=voice)
report={'runtime':rt.__version__,'requestedProvider':'DmlExecutionProvider','cpuFallbackAllowed':True,'gpuFreeMiBBefore':free,'model':'quantized','voice':'bf_emma','locale':'en-GB','audioPlayed':False,'microphoneUsed':False,'phrases':[]}
watchdog=threading.Timer(120,lambda:os._exit(124));watchdog.daemon=True;watchdog.start()
try:
 options=rt.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1;options.enable_mem_pattern=False;options.execution_mode=rt.ExecutionMode.ORT_SEQUENTIAL;options.log_severity_level=3
 started=time.perf_counter();session=rt.InferenceSession(str(model),sess_options=options,providers=[('DmlExecutionProvider',{'device_id':0}),'CPUExecutionProvider'])
 engine=Kokoro.from_session(session,str(archive),vocab_config=str(assets['config.json']))
 report['sessionProviders']=session.get_providers();report['loadMs']=round((time.perf_counter()-started)*1000,2)
 print(json.dumps({'stage':'loaded','loadMs':report['loadMs'],'providers':report['sessionProviders']}),flush=True)
 for text in ['On it.',"Hi, I'm Harmony.",'One thing at a time. We have got this.']:
  start=time.perf_counter();audio,rate=engine.create(text,voice='bf_emma',lang='en-gb');elapsed=(time.perf_counter()-start)*1000
  if rate!=24000 or not audio.size or audio.size>24000*30 or not np.isfinite(audio).all():raise ValueError('Invalid model output')
  row={'text':text,'audioReadyMs':round(elapsed,2),'audioSeconds':round(audio.size/rate,3)};report['phrases'].append(row);print(json.dumps(row),flush=True)
 report['outcome']='completed'
except Exception as error:
 report['outcome']='failed';report['errorType']=type(error).__name__;print(json.dumps({'outcome':'failed','errorType':type(error).__name__}),flush=True)
finally:
 watchdog.cancel();(ROOT/'docs'/'local-voice-directml-profile.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
