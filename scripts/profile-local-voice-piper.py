"""Silent fixed-text fallback evaluation; not connected to HARMONY playback."""
import json,logging,os,runpy,sys,threading,time
from pathlib import Path
started=time.perf_counter();ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.runtime'/'piper'))
assets=runpy.run_path(str(ROOT/'scripts'/'provision-piper.py'))
for name,(size,kind,digest) in assets['FILES'].items():assets['verify'](assets['ROOT']/name,size,kind,digest)
import numpy as np,onnxruntime as rt
from piper import PiperVoice
from piper.config import PiperConfig
logging.disable(logging.CRITICAL)
if 'onnx-directml' in str(rt.__file__):raise RuntimeError('Unexpected GPU experiment runtime')
options=rt.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1;options.log_severity_level=3
root=assets['ROOT'];config=PiperConfig.from_dict(json.loads((root/'en_GB-alba-medium.onnx.json').read_text(encoding='utf-8')))
if config.sample_rate!=22050 or config.espeak_voice!='en-gb-x-rp':raise ValueError('Unexpected voice configuration')
watchdog=threading.Timer(120,lambda:os._exit(124));watchdog.daemon=True;watchdog.start()
try:
 voice=PiperVoice(session=rt.InferenceSession(str(root/'en_GB-alba-medium.onnx'),sess_options=options,providers=['CPUExecutionProvider']),config=config,use_tashkeel=False)
 def measure(text):
  begin=time.perf_counter();first=None;samples=0;chunks=0
  for chunk in voice.synthesize(text):
   audio=chunk.audio_float_array
   if chunk.sample_rate!=22050 or chunk.sample_channels!=1 or audio.ndim!=1 or not audio.size or audio.size>22050*30 or not np.isfinite(audio).all():raise ValueError('Invalid Piper audio')
   if first is None:first=(time.perf_counter()-begin)*1000
   samples+=audio.size;chunks+=1
  if first is None:raise ValueError('No audio generated')
  return {'text':text,'firstAudioMs':round(first,2),'completeMs':round((time.perf_counter()-begin)*1000,2),'audioSeconds':round(samples/22050,3),'chunks':chunks}
 measure('This is a local warm-up test.')
 report={'provider':'piper-tts-1.8.0','voice':'en_GB-alba-medium','locale':'en-GB','sampleRate':22050,'device':'cpu','threads':2,'startupAndWarmupMs':round((time.perf_counter()-started)*1000,2),'audioPlayed':False,'microphoneUsed':False,'phrases':[]}
 for text in ['On it.',"Hi, I'm Harmony.","Hi, I'm Harmony. This is a British female voice for local testing.",'One thing at a time. We have got this.']:
  row=measure(text);report['phrases'].append(row);print(json.dumps(row),flush=True)
 (ROOT/'docs'/'local-voice-piper-profile.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
finally:watchdog.cancel()
