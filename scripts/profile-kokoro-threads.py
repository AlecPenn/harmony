"""Silent fixed-phrase CPU comparison. No recording, playback, downloads or production setting changes."""
import json,os,statistics,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PHRASE="Hi, I'm Harmony. One thing at a time."
def worker():
    sys.path.insert(0,str(ROOT/'workers'/'voice'))
    from kokoro_engine import KokoroEngine
    started=time.perf_counter();engine=KokoroEngine(ROOT/'data'/'models'/'kokoro-82m')
    import torch
    loading_ms=round((time.perf_counter()-started)*1000,2)
    # Discard one warm-up sample before alternating thread counts.
    for _ in engine.synthesize(PHRASE):pass
    samples=[]
    for threads in (2,3,4,4,3,2,2,3,4):
        torch.set_num_threads(threads)
        started=time.perf_counter();first=None;size=0
        for block in engine.synthesize(PHRASE):
            if not isinstance(block,bytes) or not block or len(block)%2 or len(block)>4800:raise ValueError('Invalid PCM')
            if first is None:first=(time.perf_counter()-started)*1000
            size+=len(block)
            if size>24000*2*30:raise ValueError('Audio limit')
        if first is None:raise ValueError('Missing PCM')
        samples.append({'threads':threads,'first_pcm_ms':round(first,2),'complete_ms':round((time.perf_counter()-started)*1000,2),'audio_seconds':round(size/48000,3)})
    print(json.dumps({'provider':'kokoro','voice':'bf_emma','locale':'en-GB','device':'cpu','loading_ms':loading_ms,'samples':samples,'median_first_pcm_ms':{str(n):round(statistics.median(s['first_pcm_ms'] for s in samples if s['threads']==n),2) for n in (2,3,4)},'microphone_used':False,'audio_played':False,'production_threads_changed':False}))
def main():
    process=subprocess.Popen([str(ROOT/'.venv-kokoro'/'Scripts'/'python.exe'),'-I','-u',str(Path(__file__).resolve()),'--worker'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    try:
        stdout,_=process.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        # Windows virtual-environment redirectors can have a child interpreter.
        # Terminate this benchmark's own process tree before waiting for pipe closure.
        if os.name=='nt' and process.poll() is None:
            subprocess.run([str(Path(os.environ['SystemRoot'])/'System32'/'taskkill.exe'),'/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10,creationflags=subprocess.CREATE_NO_WINDOW)
        elif process.poll() is None:process.kill()
        process.communicate(timeout=5)
        raise RuntimeError('CPU comparison exceeded its deadline') from None
    if process.returncode or len(stdout)>16384:raise RuntimeError('CPU comparison failed')
    report=json.loads(stdout)
    (ROOT/'docs'/'local-voice-kokoro-threads-profile.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
if __name__=='__main__':
    if sys.argv[1:]==['--worker']:worker()
    elif not sys.argv[1:]:main()
    else:raise SystemExit('No arguments supported')
