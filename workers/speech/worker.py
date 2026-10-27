"""Local speech worker. Fixed 16 kHz mono PCM frames; no network or audio files.
Silero tensor interface adapted from snakers4/silero-vad utils_vad.py.
See docs/licenses/Silero-VAD-MIT.txt and docs/SPEECH.md.
"""
from pathlib import Path
from collections import deque
import base64, hashlib, json, os, queue, sys, threading, time
PY_START=time.time()  # wall clock, for launch-speed timing
os.environ['HF_HUB_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
FRAME=512
RATE=16000

class Silero:
    def __init__(self,path):
        import onnxruntime as ort
        options=ort.SessionOptions();options.inter_op_num_threads=1;options.intra_op_num_threads=1
        options.add_session_config_entry('session.intra_op.allow_spinning','0')
        self.session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
        self.state=np.zeros((2,1,128),np.float32);self.context=np.zeros((1,64),np.float32)
    def probability(self,frame):
        samples=np.concatenate((self.context,frame.reshape(1,-1)),axis=1)
        result,self.state=self.session.run(None,{'input':samples,'state':self.state,'sr':np.array(RATE,dtype=np.int64)})
        self.context=samples[:,-64:].copy()
        return float(result[0][0])

# Speculative transcription: after this many quiet frames (5 x 32 ms = 160 ms) the words so far are transcribed in
# the background. If the endpoint (10 quiet frames) follows with no new speech, that result is used, so the
# transcript is ready about 0.16 s + transcription time earlier. Measured on 150 real Common Voice clips with
# Parakeet's cost on Alec's CPU: median 0.24 s faster; 5 of 150 slightly slower (a mid-sentence pause guessed wrong).
SPECULATE_FRAMES=5
# Smart Turn (end-of-turn model): asked after 3 quiet frames (96 ms); "not finished" holds the turn open up to 1.0 s of
# quiet; an answer later than 0.5 s of quiet is not waited for.
TURN_ASK_FRAMES=3;TURN_HOLD_FRAMES=31;TURN_LATE_FRAMES=16;TURN_COMPLETE=.5

class Segmenter:
    def __init__(self,submit,partials=True,endpoint=None,started=None,speculate=None,promote=None):
        # Conversation mode disables provisional re-transcription so the CPU is free the moment speech ends.
        # speculate(audio,segment) and promote(audio,segment) come from Transcriber; both or neither.
        self.submit=submit;self.partials=partials;self.endpoint=endpoint;self.started=started
        self.speculate=speculate;self.promote=promote
        self.preroll=deque(maxlen=6);self.frames=[];self.silence=0;self.segment=0;self.active=False;self.listening=True
        self.judge=None;self.asked=None;self.held=False  # Smart Turn, attached once it has loaded (conversations only)
    def set_listening(self,enabled):
        # While the assistant is thinking or speaking, audio is not segmented or transcribed at all,
        # so its own voice never queues work ahead of the user's next request.
        self.listening=enabled
        if not enabled:
            for frame in self.frames:frame.fill(0)
            self.frames=[];self.preroll.clear();self.active=False;self.silence=0;self.asked=None;self.held=False
    def accept(self,frame,probability):
        if not self.listening:return
        if not self.active:
            self.preroll.append(frame.copy())
            if probability<.6:return
            self.active=True;self.frames=list(self.preroll);self.preroll.clear();self.silence=0
            if self.started:self.started(self.segment)
        else:self.frames.append(frame.copy())
        if probability<.35:self.silence+=1
        else:
            if self.held and self.judge:self.judge.count('resumed')  # a pause she would once have cut off
            self.silence=0;self.asked=None;self.held=False
        final=self.ended() or len(self.frames)>=312
        if self.speculate and not final and self.silence==SPECULATE_FRAMES:
            self.speculate(np.concatenate(self.frames),self.segment)
        if final and self.endpoint:self.endpoint(self.segment)
        if final and self.promote and self.silence>=10:
            # Only quiet followed the speculative snapshot, so its result is this segment's transcript.
            self.promote(np.concatenate(self.frames),self.segment)
        elif final or (self.partials and len(self.frames)>=32 and len(self.frames)%32==0):
            self.submit(np.concatenate(self.frames),final,self.segment)
        if final:
            if self.held and self.judge:self.judge.count('held_to_end')
            if self.judge:self.judge.save()
            self.frames=[];self.active=False;self.silence=0;self.segment+=1;self.asked=None;self.held=False
    def ended(self):
        """Has the speaker finished? Without Smart Turn: 0.32 s of quiet. With it, the model is asked early in the pause
        (on its own thread); "finished" ends the turn at the usual 0.32 s, "not finished" (a mid-sentence pause) waits
        up to TURN_HOLD_FRAMES of quiet. If its answer is late, the turn ends at TURN_LATE_FRAMES as a fallback."""
        judge=self.judge
        if judge is None:return self.silence>=10
        if self.silence==TURN_ASK_FRAMES:self.asked=judge.ask(np.concatenate(self.frames))
        if self.silence<10:return False
        if self.asked is None:return True
        p=judge.verdict(self.asked)
        if p is None:
            if self.silence>=TURN_LATE_FRAMES:judge.count('late');return True
            return False
        if p>=TURN_COMPLETE:judge.count('complete');return True
        if not self.held:self.held=True;judge.count('held')
        return self.silence>=TURN_HOLD_FRAMES

class Transcriber:
    def __init__(self,recognize,emit):
        # recognize(audio)->text: any local engine (Whisper or Parakeet); the queue and safety rules are shared.
        self.recognize=recognize;self.emit=emit;self.jobs=queue.Queue(maxsize=2);self.closed=threading.Event()
        self.lock=threading.Lock();self.spec=None  # the one live speculative job, if any
        self.thread=threading.Thread(target=self.run,daemon=True);self.thread.start()
    def submit(self,audio,final,segment):
        try:self.jobs.put_nowait((audio,final,segment,time.monotonic(),None))
        except queue.Full:
            if final:raise RuntimeError('Transcription backlog exceeded')
            # Intermediate hypotheses are optional; final boundaries must never disappear.
    def speculate(self,audio,segment):
        """Transcribe the words so far in the background, in case the speaker has finished."""
        token=object();now=time.monotonic()
        with self.lock:
            self.spec={'token':token,'segment':segment,'done':False,'failed':False,'promoted':None,'text':'','stt_ms':0}
            # A newer snapshot makes any queued (not yet started) one pointless.
            kept=[]
            while True:
                try:job=self.jobs.get_nowait()
                except queue.Empty:break
                if job[4] is None:kept.append(job)
                else:job[0].fill(0)
            for job in kept:self.jobs.put_nowait(job)
            try:self.jobs.put_nowait((audio,False,segment,now,token))
            except queue.Full:self.spec=None;audio.fill(0)
    def promote(self,audio,segment):
        """The speaker stopped right after the last snapshot: use its transcript (now or when it finishes)."""
        with self.lock:
            spec=self.spec
            if spec and spec['segment']==segment and not spec['failed']:
                audio.fill(0)
                if spec['done']:
                    self.spec=None;self._emit_final(spec,0.0);return
                spec['promoted']=time.monotonic();return
        self.submit(audio,True,segment)
    def _emit_final(self,spec,waited_ms):
        if not self.closed.is_set():
            self.emit({'type':'transcript','text':spec['text'],'final':True,'segment':spec['segment'],'stt_ms':spec['stt_ms'],'queue_ms':0,'speculative':True,'waited_ms':round(waited_ms,2)})
    def run(self):
        while not self.closed.is_set():
            try:audio,final,segment,queued,token=self.jobs.get(timeout=.1)
            except queue.Empty:continue
            started=time.monotonic()
            try:
                text=self.recognize(audio).strip()[:4096]
                if token is not None:
                    with self.lock:
                        spec=self.spec
                        if spec is None or spec['token'] is not token:continue  # stale: the speaker kept talking
                        spec.update(text=text,done=True,stt_ms=round((time.monotonic()-started)*1000,2))
                        if spec['promoted'] is not None:
                            self.spec=None;self._emit_final(spec,(time.monotonic()-spec['promoted'])*1000)
                    continue
                if not self.closed.is_set():self.emit({'type':'transcript','text':text,'final':final,'segment':segment,'stt_ms':round((time.monotonic()-started)*1000,2),'queue_ms':round((started-queued)*1000,2)})
            except Exception:
                if token is not None:
                    with self.lock:
                        spec=self.spec
                        if spec is None or spec['token'] is not token:continue
                        spec['failed']=True
                        if spec['promoted'] is None:continue
                        self.spec=None
                if not self.closed.is_set():self.emit({'type':'error','reason':'Local transcription failed'})
            finally:audio.fill(0)
    def drop_pending(self):
        with self.lock:self.spec=None
        while True:
            try:self.jobs.get_nowait()[0].fill(0)
            except queue.Empty:break
    def close(self):
        self.closed.set()
        with self.lock:self.spec=None
        while True:
            try:self.jobs.get_nowait()[0].fill(0)
            except queue.Empty:break

class VoiceTap:
    """Optional (HARMONY_VOICEPRINT=1): a voice print of each finished request, computed on its own thread so it
    never delays transcription. Emits {"type":"voice","segment":n,"embedding":"<base64 float32>"|null}. Says how a
    voice sounds, not what was said; the audio copy is zeroed after use. Matching happens in core/guardian.ts."""
    def __init__(self,emit):
        import runpy
        self.emit=emit;self.jobs=queue.Queue(maxsize=2);self.closed=threading.Event()
        self.guard=runpy.run_path(str(ROOT/'workers'/'guard'/'guard.py'));self.model=None
        threading.Thread(target=self.run,daemon=True).start()
    def take(self,audio,segment):
        try:self.jobs.put_nowait((np.array(audio,dtype=np.float32,copy=True),segment))
        except queue.Full:pass
    def run(self):
        while not self.closed.is_set():
            try:audio,segment=self.jobs.get(timeout=.2)
            except queue.Empty:continue
            value=None
            try:
                if self.model is None:self.model=self.guard['VoicePrint'].load() or False
                if self.model:
                    v=self.model.embed(audio)
                    if v is not None:value=base64.b64encode(v.astype('<f4').tobytes()).decode()
            except Exception:value=None
            finally:audio.fill(0)
            if not self.closed.is_set():self.emit({'type':'voice','segment':segment,'embedding':value})
    def close(self):self.closed.set()

WAKE_WORDS={'harmony':.8}
# Said while HARMONY is talking. "stop" needs higher confidence: a false cut-off is worse than a missed one.
INTERRUPT_WORDS={'harmony':.8,'stop':.9}

def sentence_start(recent,keyword_start,gap_frames=16,min_voiced=8):
    """Where the sentence holding the wake word began, if speech came before the word: walk back from the word until
    0.5 s of quiet. None when the word opened the sentence (then only what follows it is replayed, as before)."""
    if keyword_start is None:return None
    before=[(start,p) for start,_,p in recent if start<keyword_start]
    quiet=0;begin=None;voiced=0
    for start,p in reversed(before):
        if p<.35:
            quiet+=1
            if quiet>=gap_frames:break
        else:
            quiet=0;begin=start
            if p>=.6:voiced+=1
    return begin if begin is not None and voiced>=min_voiced else None

class WakeWaiter:
    """Keyword watching for the conversation worker. Two modes, both only while the segmenter is off:
    wake (hands-free waiting for "Harmony") and interrupt (HARMONY is thinking or talking; "Harmony" or "stop").
    On a match the recent audio after the word is replayed into the segmenter, so "Harmony, what time is it?" or
    "Stop, what's the weather instead?" in one breath keeps its request. Waiting for "Harmony", the name can also come
    last or in the middle: "What's the weather, Harmony?" replays the whole sentence from where it began (up to 8 s
    back, kept in memory only and wiped after). Words HARMONY is saying itself can be ignored. A keyword is a hint
    to listen, never identity or permission."""
    def __init__(self,detector,segmenter,transcriber,emit,keep_frames=250):
        self.detector=detector;self.segmenter=segmenter;self.transcriber=transcriber;self.emit=emit
        self.mode=None;self.recent=deque(maxlen=keep_frames);self.samples=0
    @property
    def waiting(self):return self.mode=='wake'
    def wait(self,enabled):
        self.recent.clear()
        if enabled:
            self.mode='wake';self.detector.set_words(WAKE_WORDS)
            self.segmenter.set_listening(False);self.transcriber.drop_pending();self.detector.reset()
        elif self.mode=='wake':self.mode=None
    def watch_interrupt(self,enabled,ignore=()):
        if not enabled:
            if self.mode=='interrupt':self.mode=None;self.recent.clear()
            return
        words={w:t for w,t in INTERRUPT_WORDS.items() if w not in set(ignore)}
        if self.mode!='interrupt':
            if self.mode=='wake':return
            self.mode='interrupt';self.recent.clear();self.detector.reset()
        self.detector.set_words(words)
        if not words:self.mode=None
    def accept(self,raw,frame,probability):
        self.samples+=len(raw)//2
        if self.mode is None:
            self.segmenter.accept(frame,probability);return
        self.recent.append((self.samples-len(raw)//2,frame.copy(),probability))
        started=time.monotonic();wake=self.detector.accept(raw)
        if wake['candidate'] and self.mode=='wake':self.emit({'type':'wake_candidate'})
        if wake['confidence'] is None:return
        kind='wake' if self.mode=='wake' else 'interrupt'
        self.mode=None;self.segmenter.set_listening(True)
        self.emit({'type':kind,'confidence':wake['confidence'],'word':wake.get('word') or 'harmony','detector_ms':round((time.monotonic()-started)*1000,3)})
        end=wake.get('end_sample');begin=sentence_start(list(self.recent),wake.get('start_sample')) if kind=='wake' else None
        for start,old,p in list(self.recent):
            if (begin is not None and start>=begin) or (begin is None and end is not None and start>=end):self.segmenter.accept(old,p)
        for _,old,_ in self.recent:old.fill(0)
        self.recent.clear()

class LateWaiter:
    """Launch speed (October 26): in a Talk conversation (not hands-free) the keyword spotter is only for interrupting
    ("stop"/"Harmony"), so the worker says it's ready without waiting for it (it took up to 15 s on Alec's PC while the
    brain loaded). Until the spotter has loaded, audio goes straight to the segmenter and an interrupt-watch request is
    remembered; once loaded, a WakeWaiter takes over (created here, on the audio thread, so nothing races)."""
    def __init__(self,spotter,segmenter,make):
        self.spotter=spotter;self.segmenter=segmenter;self.make=make;self.real=None;self.pending=None
    def _ready(self):
        if self.real is None and 'd' in self.spotter:
            self.real=self.make(self.spotter['d'])
            if self.pending:self.real.watch_interrupt(*self.pending)
            self.pending=None
        return self.real
    @property
    def waiting(self):
        r=self._ready();return bool(r and r.waiting)
    def wait(self,enabled):
        r=self._ready()
        if r:r.wait(enabled)
    def watch_interrupt(self,enabled,ignore=()):
        r=self._ready()
        if r:r.watch_interrupt(enabled,ignore)
        else:self.pending=(True,list(ignore)) if enabled else None
    def accept(self,raw,frame,probability):
        r=self._ready()
        if r:r.accept(raw,frame,probability)
        else:self.segmenter.accept(frame,probability)

VERIFIED_CACHE=ROOT/'data'/'models'/'.verified.json'

def _verified_cache():
    try:
        value=json.loads(VERIFIED_CACHE.read_text())
        return value if isinstance(value,dict) else {}
    except Exception:
        return {}

def verify_models(name='SPEECH-MODELS.json',vad_only=False):
    """Checks every pinned model file against its manifest (size and SHA-256).
    A file whose full hash already matched is remembered with its size and modification time, so later starts skip
    re-reading gigabytes (that took ~30 s per microphone start on Alec's PC). Any change in size or time means a
    full re-hash; a mismatch always fails closed."""
    manifest=json.loads((ROOT/'docs'/name).read_text())
    models=(ROOT/'data'/'models').resolve()
    cache=_verified_cache();changed=False
    for item in manifest['files']:
        if vad_only and not item['path'].endswith('/silero_vad.onnx'):continue
        path=(ROOT/item['path']).resolve()
        if not path.is_relative_to(models):raise ValueError('Invalid model path')
        if not path.is_file():raise ValueError('Missing local model')
        stat=path.stat()
        if stat.st_size!=item['bytes']:raise ValueError('Missing local model')
        key=item['path'];seen=cache.get(key)
        if isinstance(seen,list) and seen==[stat.st_size,stat.st_mtime_ns,item['sha256']]:continue
        with path.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
        if digest!=item['sha256']:
            cache.pop(key,None);changed=True
            raise ValueError('Local model integrity check failed')
        cache[key]=[stat.st_size,stat.st_mtime_ns,item['sha256']];changed=True
    if changed:
        try:
            tmp=VERIFIED_CACHE.with_suffix('.tmp');tmp.write_text(json.dumps(cache));os.replace(tmp,VERIFIED_CACHE)
        except Exception:
            pass

def stt_threads(conversation_mode):
    override=os.environ.get('HARMONY_STT_THREADS','')
    if override.isdigit() and 1<=int(override)<=16:return int(override)
    # Half the logical processors (roughly the physical cores), 2 to 4. Measured on a 4-thread CPU: Parakeet took
    # 1,137 ms with 2 threads but 1,792 ms with 4, because hyper-threads contend for the same cores.
    return max(2,min(4,(os.cpu_count() or 4)//2))

def parakeet_directory():
    """The Parakeet copy to use, or None. Prefers the CPU-optimised copy (scripts/optimize-parakeet.py: same weights,
    integer convolutions rewritten as float convolutions over the same values, identical transcripts, ~15% faster on
    Alec's AVX-only CPU); only checks the original when that copy is missing or fails."""
    try:
        import onnx_asr  # noqa: F401
    except Exception:
        return None
    base=ROOT/'data'/'models'/'stt-candidates'
    for manifest,folder in (('STT-PARAKEET-FASTCONV.json','parakeet-tdt-0.6b-v2-fastconv'),('STT-PARAKEET.json','parakeet-tdt-0.6b-v2')):
        try:
            if (ROOT/'docs'/manifest).exists():
                verify_models(manifest);return base/folder
        except Exception:
            continue
    return None

def parakeet_available():
    return parakeet_directory() is not None

LOAD={'t0':time.perf_counter()}
PARAKEET_FILES=('encoder-model.int8.onnx','decoder_joint-model.int8.onnx')

def _cache_dir(folder):
    return ROOT/'data'/'models'/'stt-cache'/folder.name

def _cache_stamp(folder):
    import onnxruntime as ort
    return {'ort':ort.__version__,'files':{n:[(folder/n).stat().st_size,(folder/n).stat().st_mtime_ns] for n in PARAKEET_FILES}}

def optimized_cache(folder):
    """The optimised copy of this Parakeet folder, if it was made for these exact files and this ONNX Runtime."""
    cache=_cache_dir(folder)
    try:
        if json.loads((cache/'stamp.json').read_text())==_cache_stamp(folder) and all((cache/n).exists() for n in PARAKEET_FILES):
            return cache
    except Exception:
        pass
    return None

def build_optimized_cache(folder,threads=1):
    """Saves ONNX Runtime's optimised graphs of the Parakeet sessions (weights in a side file), once, at low priority,
    after the worker is ready. The next start loads them with optimisation switched off. Any failure leaves no cache."""
    import onnxruntime as ort, shutil
    cache=_cache_dir(folder);tmp=cache.with_name(cache.name+'.building')
    try:
        shutil.rmtree(tmp,ignore_errors=True);tmp.mkdir(parents=True,exist_ok=True)
        for n in PARAKEET_FILES:
            o=ort.SessionOptions();o.intra_op_num_threads=threads;o.inter_op_num_threads=1;o.log_severity_level=3
            o.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
            o.optimized_model_filepath=str(tmp/n)
            o.add_session_config_entry('session.optimized_model_external_initializers_file_name',n+'.data')
            o.add_session_config_entry('session.optimized_model_external_initializers_min_size_in_bytes','1024')
            ort.InferenceSession(str(folder/n),o,providers=['CPUExecutionProvider'])
        for f in folder.iterdir():
            if f.is_file() and not f.name.endswith('.onnx') and not f.name.endswith('.onnx.data'):shutil.copy2(f,tmp/f.name)
        (tmp/'stamp.json').write_text(json.dumps(_cache_stamp(folder)))
        cache.parent.mkdir(parents=True,exist_ok=True)
        shutil.rmtree(cache,ignore_errors=True)
        os.replace(tmp,cache)
        return True
    except Exception:
        return False

LOAD_TIMES='load-times.json'

def _load_times():
    try:
        v=json.loads((ROOT/'data'/'models'/'stt-cache'/LOAD_TIMES).read_text())
        return {k:[int(x) for x in v.get(k,[])][-5:] for k in ('optimised','original')}
    except Exception:
        return {'optimised':[],'original':[]}

def _note_load_time(copy,ms):
    """Remembers how long each Parakeet copy took (load and first run), so later starts use the faster one."""
    try:
        times=_load_times();times[copy]=(times[copy]+[int(ms)])[-5:]
        d=ROOT/'data'/'models'/'stt-cache';d.mkdir(parents=True,exist_ok=True);(d/LOAD_TIMES).write_text(json.dumps(times))
    except Exception:
        pass

def prefer_cache(times):
    """Whether to load the optimised copy. Measured on Alec's PC, it loaded faster but its first run was slower (its
    weights are read lazily from disk), so neither is assumed: each is tried, then the faster median wins, and the
    slower one is re-tried every eighth start in case things changed (a new disk, a new ONNX Runtime)."""
    o,r=times.get('optimised',[]),times.get('original',[])
    if not o:return True
    if not r:return False
    med=lambda xs:sorted(xs)[len(xs)//2]
    best=med(o)<=med(r);runs=len(o)+len(r)
    return (not best) if runs%8==0 else best

def load_parakeet(folder,threads):
    """Parakeet, loaded and run once. Uses the optimised copy or the original, whichever has been faster."""
    import onnx_asr,onnxruntime as ort
    begin=time.perf_counter()
    def opts(level=None):
        o=ort.SessionOptions();o.intra_op_num_threads=threads;o.inter_op_num_threads=1;o.log_severity_level=3
        # Idle worker threads sleep instead of spinning: on a 4-thread CPU, spinning starved the audio loop.
        o.add_session_config_entry('session.intra_op.allow_spinning','0')
        if level is not None:o.graph_optimization_level=level
        return o
    model=None;copy='original';cached=optimized_cache(folder)
    if cached and prefer_cache(_load_times()):
        try:
            # A copy ONNX Runtime already optimised (made once, in the background) loads without redoing that work.
            model=onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v2',str(cached),quantization='int8',sess_options=opts(ort.GraphOptimizationLevel.ORT_DISABLE_ALL),providers=['CPUExecutionProvider'])
            copy='optimised'
        except Exception:
            model=None
    if model is None:
        model=onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v2',str(folder),quantization='int8',sess_options=opts(),providers=['CPUExecutionProvider'])
        if not cached:LOAD['build cache']=str(folder)
    LOAD['parakeet copy']=copy;LOAD['model loaded']=round((time.perf_counter()-LOAD['t0'])*1000)
    # Warm up once so the first real request is not a cold start.
    model.recognize(np.zeros(RATE//2,np.float32),sample_rate=RATE)
    LOAD['warmed']=round((time.perf_counter()-LOAD['t0'])*1000)
    _note_load_time(copy,(time.perf_counter()-begin)*1000)
    return lambda audio:str(model.recognize(audio,sample_rate=RATE))

def lazy_av():
    """faster-whisper imports PyAV (FFmpeg) at import time, but HARMONY only ever hands it raw samples, never a file to
    decode. A stand-in module loads the real PyAV on first use, so launch skips loading FFmpeg (about a third of the
    import, on a CPU that is busy loading everything else)."""
    if 'av' in sys.modules:return
    import types,importlib
    class LazyAV(types.ModuleType):
        def __getattr__(self,name):
            real=self.__dict__.get('_real')
            if real is None:
                if sys.modules.get('av') is self:del sys.modules['av']
                real=importlib.import_module('av');self.__dict__['_real']=real
            return getattr(real,name)
    sys.modules['av']=LazyAV('av')

def load_whisper(threads,warm=True):
    verify_models()  # Whisper files are only checked when Whisper is actually used
    LOAD['whisper verified']=round((time.perf_counter()-LOAD['t0'])*1000)
    lazy_av()
    from faster_whisper import WhisperModel
    LOAD['whisper imported']=round((time.perf_counter()-LOAD['t0'])*1000)
    model=WhisperModel(str(ROOT/'data'/'models'/'whisper-base.en'),device='cpu',compute_type='int8',cpu_threads=threads,local_files_only=True)
    def recognize(audio):
        segments,_=model.transcribe(audio,language='en',beam_size=1,condition_on_previous_text=False,vad_filter=False,without_timestamps=True)
        return ''.join(item.text for item in segments)
    LOAD['whisper loaded']=round((time.perf_counter()-LOAD['t0'])*1000)
    if warm:recognize(np.zeros(RATE//2,np.float32))
    return recognize

def load_recognizer(conversation_mode):
    threads=stt_threads(conversation_mode)
    folder=parakeet_directory() if conversation_mode else None
    if folder:return 'parakeet',load_parakeet(folder,threads)
    return 'whisper',load_whisper(threads)

UPGRADE=threading.Event()  # set by HARMONY ({"type":"upgrade"}) once the voice and the brain have loaded
UPGRADE_FALLBACK_S=60
WARMED=threading.Event()  # set once Whisper's background warm-up has run

def background_priority(low):
    """Windows background mode (on): low CPU, disk and memory priority for this process, or back to normal (off).
    On Alec's PC the disk is the bottleneck, so a lower CPU priority alone didn't stop the Parakeet read slowing the
    voice and the brain. Does nothing elsewhere or on failure."""
    if os.name!='nt':return
    try:
        import ctypes;k=ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(),0x00100000 if low else 0x00200000)
        LOAD['background mode']=bool(low) or LOAD.get('background mode',False)
    except Exception:
        pass

def quick_recognizer(conversation_mode,emit_later):
    """Launch speed (October 25): Parakeet takes 30-45 s to read from disk on Alec's PC, so conversations start on
    Whisper base (a few seconds) and switch to Parakeet in the background once it's loaded and warmed. Returns
    (engine, recognize, start_background). HARMONY_STT_QUICKSTART=0 turns this off."""
    folder=parakeet_directory() if conversation_mode else None
    if not folder or os.environ.get('HARMONY_STT_QUICKSTART','1')=='0':
        engine,recognize=load_recognizer(conversation_mode);WARMED.set();return engine,recognize,lambda:None
    threads=stt_threads(conversation_mode)
    try:
        # Whisper always runs a 30-second window, so its warm-up run took 6-8 s on Alec's PC: it runs in the background
        # after "ready", under the same lock as real requests (a request that arrives first just waits for it).
        whisper=load_whisper(threads,warm=False);wlock=threading.Lock();used=[]
        def locked(audio):
            with wlock:
                used.append(1);return whisper(audio)
        def warm():
            # Waits until the voice and the brain have loaded (HARMONY's "upgrade"): run earlier, the warm-up slowed
            # both down. A request that comes first warms Whisper itself, so the warm-up is skipped.
            try:
                UPGRADE.wait(UPGRADE_FALLBACK_S)
                with wlock:
                    if not used:whisper(np.zeros(RATE//2,np.float32))
                LOAD['whisper warmed']=round((time.perf_counter()-LOAD['t0'])*1000)
            finally:
                WARMED.set()
        threading.Thread(target=warm,daemon=True).start()
        current={'f':locked};LOAD['whisper ready']=round((time.perf_counter()-LOAD['t0'])*1000)
    except Exception:
        engine,recognize=load_recognizer(conversation_mode);WARMED.set();return engine,recognize,lambda:None
    def swap():
        # Waits until HARMONY says the voice and the brain are loaded (or a minute passes), then loads in background mode.
        UPGRADE.wait(UPGRADE_FALLBACK_S)
        # ...and until Whisper's own warm-up (which also waits for that) has run, so the two don't slow each other down (measured: the warm-up then
        # took 13 s instead of 6, and a first request would have waited for it).
        WARMED.wait(UPGRADE_FALLBACK_S);LOAD['upgrade at']=round((time.perf_counter()-LOAD['t0'])*1000)
        background_priority(True)
        try:
            current['f']=load_parakeet(folder,threads)
            emit_later({'type':'engine','engine':'parakeet'})
        except Exception:
            LOAD['parakeet failed']=True  # stays on Whisper for this worker
        try:
            write_startup()
            if LOAD.get('build cache'):build_optimized_cache(Path(LOAD['build cache']),1)
        finally:
            background_priority(False)
    return 'whisper',(lambda audio:current['f'](audio)),lambda:threading.Thread(target=swap,daemon=True).start()

STARTUP={}
def write_startup():
    try:  # how long each part took to load, for tuning talk-start speed
        (ROOT/'.runtime').mkdir(exist_ok=True)
        (ROOT/'.runtime'/'speech-startup.json').write_text(json.dumps({**STARTUP,'parakeet':{k:v for k,v in LOAD.items() if k!='t0'},'written':time.time()}))
    except Exception:
        pass

def main():
    lock=threading.Lock()
    def emit(value):
        with lock:print(json.dumps(value),flush=True)
    transcriber=None;tap=None
    try:
        wake_mode=sys.argv[1:]==['--wake'];hands_free=sys.argv[1:]==['--conversation','--hands-free'];conversation_mode=sys.argv[1:]==['--conversation'] or hands_free;waiter=None
        t0=time.perf_counter();marks={};LOAD['t0']=t0
        verify_models(vad_only=True)  # the voice detector; each engine checks its own files when it loads
        vad=Silero(ROOT/'data'/'models'/'silero_vad.onnx');marks['voice detector']=round((time.perf_counter()-t0)*1000)
        if wake_mode:
            verify_models('WAKE-MODEL.json')
            import runpy
            detector=runpy.run_path(str(Path(__file__).with_name('wake.py')))['WakeDetector'](ROOT/'data'/'models'/'vosk-model-small-en-us-0.15')
        else:
            # Talk-start speed: the keyword spotter (Vosk) loads on its own thread while the speech model loads.
            spotter={}
            def load_spotter():
                try:
                    verify_models('WAKE-MODEL.json')
                    import runpy
                    spotter['d']=runpy.run_path(str(Path(__file__).with_name('wake.py')))['WakeDetector'](ROOT/'data'/'models'/'vosk-model-small-en-us-0.15')
                except Exception as e:
                    spotter['e']=e
                spotter['ms']=round((time.perf_counter()-t0)*1000);LOAD['keyword spotter']=spotter['ms']
            # Hands-free needs the spotter before it can wait for "Harmony"; a Talk conversation only uses it for
            # interrupting, so it loads after Whisper's warm-up instead of competing with launch for the CPU.
            def later():
                WARMED.wait(UPGRADE_FALLBACK_S);load_spotter()
            spot_thread=threading.Thread(target=load_spotter if hands_free else later,daemon=True)
            if conversation_mode:spot_thread.start()
            engine,recognize,background=quick_recognizer(conversation_mode,emit)
            marks['speech model']=round((time.perf_counter()-t0)*1000)
            transcriber=Transcriber(recognize,emit)
            submit,promote=transcriber.submit,transcriber.promote
            if conversation_mode and os.environ.get('HARMONY_VOICEPRINT')=='1':
                tap=VoiceTap(emit)
                # Both hand over the finished request's audio (promote zeroes it, so the tap copies first).
                submit=lambda audio,final,segment:(tap.take(audio,segment) if final else None,transcriber.submit(audio,final,segment))[1]
                promote=lambda audio,segment:(tap.take(audio,segment),transcriber.promote(audio,segment))[1]
            segmenter=Segmenter(submit,speculate=transcriber.speculate if conversation_mode else None,promote=promote if conversation_mode else None,partials=not conversation_mode,endpoint=(lambda segment:emit({'type':'endpoint','segment':segment})) if conversation_mode else None,started=(lambda segment:emit({'type':'speech_start','segment':segment})) if conversation_mode else None)
            if conversation_mode:
                # Conversations load the keyword spotter for interrupting ("Harmony"/"stop"). Hands-free waits on it (it
                # listens for "Harmony"); a Talk conversation doesn't (LateWaiter attaches it when it's loaded).
                if hands_free:
                    spot_thread.join()
                    if 'e' in spotter:raise spotter['e']
                    marks['keyword spotter']=spotter['ms']
                    waiter=WakeWaiter(spotter['d'],segmenter,transcriber,emit)
                else:
                    waiter=LateWaiter(spotter,segmenter,lambda d,s=segmenter,t=transcriber:WakeWaiter(d,s,t,emit))
        marks['ready']=round((time.perf_counter()-t0)*1000)
        STARTUP.update({'args':sys.argv[1:],'ms':marks,'python started':PY_START,'ready at':time.time()})
        write_startup()
        emit({'type':'ready','version':1,'rate':RATE,'frame':FRAME,'engine':'vad' if wake_mode else engine})
        if not wake_mode:background()
        if conversation_mode and os.environ.get('HARMONY_SMART_TURN','1')!='0':
            # End-of-turn model: loaded after the speech model's warm-up, so it never slows launch.
            def load_turn():
                WARMED.wait(UPGRADE_FALLBACK_S)
                try:
                    t=time.perf_counter();verify_models('SMART-TURN.json')
                    # Loaded by path: the worker runs isolated (python -I), so its own folder isn't on sys.path.
                    import importlib.util
                    spec=importlib.util.spec_from_file_location('smart_turn',Path(__file__).with_name('smart_turn.py'))
                    smart_turn=importlib.util.module_from_spec(spec);spec.loader.exec_module(smart_turn)
                    threads=int(os.environ.get('HARMONY_TURN_THREADS','2'))
                    model=smart_turn.SmartTurn(ROOT/json.loads((ROOT/'docs'/'SMART-TURN.json').read_text())['files'][0]['path'],threads=max(1,min(4,threads)))
                    segmenter.judge=smart_turn.TurnJudge(model,ROOT/'.runtime'/'turn-stats.json')
                    LOAD['smart turn']=round((time.perf_counter()-t)*1000);write_startup()
                except Exception as e:
                    LOAD['smart turn']=f'off: {type(e).__name__}';write_startup()
            threading.Thread(target=load_turn,daemon=True).start()
        if LOAD.get('build cache') and engine=='parakeet':
            # Made once, in the background, after she's ready (one thread, so it doesn't slow the conversation).
            threading.Thread(target=build_optimized_cache,args=(Path(LOAD['build cache']),1),daemon=True).start()
        expected=0
        while True:
            line=sys.stdin.buffer.readline(8193)
            if not line:break
            if len(line)>8192:raise ValueError('Frame too large')
            message=json.loads(line)
            if message=={'type':'stop'}:break
            if message=={'type':'upgrade'}:UPGRADE.set();continue
            if conversation_mode and isinstance(message,dict) and set(message)=={'type','enabled'} and message['type']=='listen' and type(message['enabled']) is bool:
                segmenter.set_listening(message['enabled'])
                if not message['enabled']:transcriber.drop_pending()
                continue
            if waiter and hands_free and isinstance(message,dict) and set(message)=={'type','enabled'} and message['type']=='wake_wait' and type(message['enabled']) is bool:
                waiter.wait(message['enabled']);continue
            if waiter and isinstance(message,dict) and set(message)=={'type','enabled','ignore'} and message['type']=='interrupt_watch' and type(message['enabled']) is bool \
               and isinstance(message['ignore'],list) and len(message['ignore'])<=4 and all(isinstance(w,str) and len(w)<=20 for w in message['ignore']):
                waiter.watch_interrupt(message['enabled'],message['ignore']);continue
            if set(message)!={'type','seq','pcm'} or message['type']!='frame' or type(message['seq']) is not int or message['seq']!=expected:raise ValueError('Invalid frame sequence')
            raw=base64.b64decode(message['pcm'],validate=True)
            if len(raw)!=FRAME*2:raise ValueError('Invalid frame size')
            frame=np.frombuffer(raw,dtype='<i2').astype(np.float32)/32768
            started=time.monotonic();probability=vad.probability(frame)
            vad_ms=round((time.monotonic()-started)*1000,3)
            if wake_mode:
                wake_start=time.monotonic();wake=detector.accept(raw)
                if wake['candidate']:emit({'type':'wake_candidate'})
                if wake['confidence'] is not None:emit({'type':'wake','confidence':wake['confidence'],'detector_ms':round((time.monotonic()-wake_start)*1000,3)})
            elif waiter:waiter.accept(raw,frame,probability)
            else:segmenter.accept(frame,probability)
            emit({'type':'ack','seq':expected,'speech':probability>=.6,'vad_ms':vad_ms})
            frame.fill(0);expected+=1
    except Exception:emit({'type':'error','reason':'Local speech worker could not complete'})
    finally:
        if transcriber:transcriber.close()
        if tap:tap.close()
        # Exiting the worker releases VAD state, speech buffers and model weights.
if __name__=='__main__':main()
