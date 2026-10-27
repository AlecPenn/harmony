from pathlib import Path
import runpy,numpy as np,time,sys
from faster_whisper.audio import decode_audio
root=Path.cwd()
Wake=runpy.run_path(str(root/'workers/speech/wake.py'))['WakeDetector']
detector=Wake(root/'data/models/vosk-model-small-en-us-0.15')
audio=decode_audio(sys.argv[1],sampling_rate=16000)
audio=np.concatenate((audio,np.zeros(16000,np.float32)))
hits=[];candidates=[];started=time.monotonic()
for index in range(0,len(audio)-512,512):
 pcm=(np.clip(audio[index:index+512],-1,1)*32767).astype('<i2').tobytes()
 result=detector.accept(pcm)
 if result['candidate']:candidates.append(round((index+512)/16000,3))
 confidence=result['confidence']
 if confidence is not None:hits.append({'audio_seconds':round((index+512)/16000,3),'confidence':confidence})
print({'wake_matches':hits,'provisional_visual_at_seconds':candidates,'processing_ms':round((time.monotonic()-started)*1000,1)})
assert bool(hits)==('--negative' not in sys.argv),'Unexpected wake result'
