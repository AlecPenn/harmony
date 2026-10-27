"""Local Piper voices; explicit installed assets only, no downloads.

Two voices:
- 'alba': the British (Scottish) fallback, pinned below.
- 'harmony-au': HARMONY's own Australian voice, a multi-speaker model trained from Common Voice en-AU. It is
  pinned by docs/VOICE-AU-MODEL.json (sizes, SHA-256 and the speaker to use), written when the trained model is installed.
"""
import hashlib,json,logging
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FILES={
 'en_GB-alba-medium.onnx':(63201294,'sha256','401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b'),
 'en_GB-alba-medium.onnx.json':(4888,'git','c0969252c640fd7c2765baa62936a1106ca856d7')}
AU_MANIFEST=ROOT/'docs'/'VOICE-AU-MODEL.json'
AU_DIR=ROOT/'data'/'models'/'piper-harmony-au'

VERIFIED=ROOT/'data'/'models'/'.verified-voice.json'
TIMES={}  # launch-speed marks (seconds since the worker started), written to .runtime/voice-startup.json

def _verified():
 try:
  v=json.loads(VERIFIED.read_text(encoding='utf-8'));return v if isinstance(v,dict) else {}
 except Exception:
  return {}

def verify_assets(directory,files=None):
 """Checks each voice file's size and hash. A file whose full hash already matched is remembered with its size and
 modification time (like the speech models), so later starts skip re-reading it; any change means a full re-hash, and a
 mismatch always fails closed."""
 files=FILES if files is None else files
 directory=Path(directory)
 if directory.is_symlink():raise ValueError('Invalid model directory')
 seen=_verified();changed=False
 for name,(size,kind,expected) in files.items():
  path=directory/name
  if path.is_symlink() or path.stat().st_size!=size:raise ValueError('Piper asset size mismatch')
  st=path.stat();key=str(path.resolve().relative_to(ROOT.resolve())) if path.resolve().is_relative_to(ROOT.resolve()) else None
  if key and seen.get(key)==[st.st_size,st.st_mtime_ns,expected]:continue
  h=hashlib.sha256() if kind=='sha256' else hashlib.sha1(b'blob '+str(size).encode()+b'\0')
  with path.open('rb') as f:
   while block:=f.read(1024*1024):h.update(block)
  if h.hexdigest()!=expected:
   if key and key in seen:seen.pop(key,None);changed=True
   _save_verified(seen,changed)
   raise ValueError('Piper asset integrity failed')
  if key:seen[key]=[st.st_size,st.st_mtime_ns,expected];changed=True
 _save_verified(seen,changed)
 return directory

def _save_verified(seen,changed):
 if not changed:return
 try:
  tmp=VERIFIED.with_suffix('.tmp');tmp.write_text(json.dumps(seen),encoding='utf-8');import os;os.replace(tmp,VERIFIED)
 except Exception:
  pass

def au_manifest(path=None):
 """Pinned Australian voice: {'model':..., 'speaker':..., 'files':{name:(size,'sha256',hash)}}, or None if not installed."""
 path=Path(path or AU_MANIFEST)
 if not path.exists():return None
 m=json.loads(path.read_text(encoding='utf-8'))
 files={f['name']:(int(f['bytes']),'sha256',str(f['sha256'])) for f in m['files']}
 model=str(m['model'])
 if model not in files or model+'.json' not in files or not isinstance(m.get('speaker'),str):raise ValueError('Invalid voice manifest')
 return {'model':model,'speaker':m['speaker'],'files':files}

class PiperEngine:
 def __init__(self,directory,manifest=None):
  """directory: the voice folder. manifest: None for Alba, or au_manifest() for the Australian voice."""
  files=manifest['files'] if manifest else FILES
  model=manifest['model'] if manifest else 'en_GB-alba-medium.onnx'
  import time;t=time.perf_counter
  directory=verify_assets(directory,files);TIMES['verified']=t()
  import numpy as np,onnxruntime as rt
  from piper import PiperVoice
  from piper.config import PiperConfig,SynthesisConfig
  TIMES['imported']=t()
  logging.disable(logging.CRITICAL)
  config=PiperConfig.from_dict(json.loads((directory/(model+'.json')).read_text(encoding='utf-8')))
  if config.sample_rate!=22050 or config.espeak_voice!='en-gb-x-rp':raise ValueError('Unexpected Piper voice')
  speaker=None
  if manifest:
   if config.num_speakers<2 or manifest['speaker'] not in config.speaker_id_map:raise ValueError('Voice speaker missing')
   speaker=config.speaker_id_map[manifest['speaker']]
  options=rt.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1;options.log_severity_level=3
  # Lower generator/duration noise than the voice defaults (0.667/0.8): each phrase is synthesised separately,
  # and high noise made pitch, pace and tone vary audibly from one phrase to the next.
  self.syn_config=SynthesisConfig(speaker_id=speaker,noise_scale=0.33,noise_w_scale=0.4,length_scale=1.0)
  self.voice=PiperVoice(session=rt.InferenceSession(str(directory/model),sess_options=options,providers=['CPUExecutionProvider']),config=config,use_tashkeel=False)
  TIMES['model loaded']=t()
  self.name='harmony-au' if manifest else 'alba'
 def synthesize(self,text):
  import numpy as np
  for chunk in self.voice.synthesize(text,syn_config=self.syn_config):
   audio=chunk.audio_float_array
   if chunk.sample_rate!=22050 or chunk.sample_channels!=1 or audio.ndim!=1 or not audio.size or audio.size>22050*30 or not np.isfinite(audio).all():raise ValueError('Invalid Piper audio')
   pcm=(np.clip(audio,-1,1)*32767).astype('<i2').tobytes()
   for offset in range(0,len(pcm),4410):yield pcm[offset:offset+4410]

def preferred_engine():
 """HARMONY's Australian voice when it is installed and verifies; otherwise the Alba fallback."""
 try:
  manifest=au_manifest()
  if manifest:return PiperEngine(AU_DIR,manifest)
 except Exception:
  pass
 return PiperEngine(ROOT/'data'/'models'/'piper-alba')
