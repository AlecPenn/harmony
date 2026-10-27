"""Fixed-script, silent local synthesis smoke check. Does not record or play audio."""
import base64,json,subprocess,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 started=time.perf_counter();process=subprocess.Popen([str(ROOT/'.venv-kokoro'/'Scripts'/'python.exe'),'-I','-u',str(ROOT/'workers'/'voice'/'local_worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 timer=threading.Timer(120,process.kill);timer.start()
 def frame():
  line=process.stdout.readline(8193)
  if not line or len(line)>8192:raise RuntimeError('Worker frame missing')
  value=json.loads(line)
  if value.get('type')=='error':raise RuntimeError('Local synthesis unavailable')
  return value
 try:
  ready=frame();preparation=[]
  while ready.get('type')=='preparing':
   if len(preparation)>=3:raise RuntimeError('Preparation frame limit')
   preparation.append(ready);ready=frame()
  if ready.get('type')!='ready':raise RuntimeError('Warmup failed')
  startup=(time.perf_counter()-started)*1000;results=[]
  for request,text in enumerate(["Hi, I'm Harmony. This is a British voice for local testing.","One thing at a time. We have got this.","On it."]):
   begin=time.perf_counter();process.stdin.write(json.dumps({'id':request,'text':text})+'\n');process.stdin.flush()
   first=None;size=0;seq=0
   while True:
    value=frame()
    if value.get('id')!=request:raise RuntimeError('Wrong request')
    if value['type']=='done':
     if value['chunks']!=seq or not seq:raise RuntimeError('Invalid completion')
     break
    if value['type']!='pcm' or value['seq']!=seq or value['rate']!=24000:raise RuntimeError('Invalid audio frame')
    data=base64.b64decode(value['pcm'],validate=True)
    if not data or len(data)%2 or len(data)>4800:raise RuntimeError('Invalid PCM')
    if first is None:first=(time.perf_counter()-begin)*1000
    seq+=1;size+=len(data)
   results.append({'request':request,'first_audio_ms':round(first,2),'complete_ms':round((time.perf_counter()-begin)*1000,2),'audio_seconds':round(size/48000,3),'chunks':seq})
  report={'provider':'kokoro-0.9.4','voice':'bf_emma','locale':'en-GB','device':'cpu','threads':2,'startup_ms':round(startup,2),'worker_warmup_ms':ready['warmup_ms'],'preparation_stages':preparation,'phrases':results,'audio_played':False,'microphone_used':False,'generic_acknowledgements_cached':True}
  (ROOT/'docs'/'local-voice-cached-profile.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,indent=2))
 finally:
  process.kill();process.wait(timeout=5);timer.cancel()
if __name__=='__main__':main()
