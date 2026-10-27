import importlib.util
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('speech',Path(__file__).with_name('worker.py'))
speech=importlib.util.module_from_spec(spec);spec.loader.exec_module(speech)

def test_bounded_segments_emit_partial_before_endpoint():
    events=[];engine=speech.Segmenter(lambda audio,final,segment:events.append((len(audio),final,segment)))
    frame=np.ones(512,np.float32)*.1
    for _ in range(40):engine.accept(frame,.9)
    assert events and not events[0][1]
    for _ in range(10):engine.accept(frame,0)
    assert events[-1][1] and events[-1][2]==0
    assert not engine.frames and not engine.active

def test_conversation_mode_skips_partials_and_reports_endpoint_first():
    events=[];engine=speech.Segmenter(lambda audio,final,segment:events.append(('final' if final else 'partial',segment)),partials=False,endpoint=lambda segment:events.append(('endpoint',segment)),started=lambda segment:events.append(('start',segment)))
    frame=np.ones(512,np.float32)*.1
    for _ in range(70):engine.accept(frame,.9)
    assert events==[('start',0)]
    for _ in range(10):engine.accept(frame,0)
    assert events==[('start',0),('endpoint',0),('final',0)]

def test_paused_listening_drops_audio_and_resumes_cleanly():
    events=[];engine=speech.Segmenter(lambda audio,final,segment:events.append((final,segment)),partials=False)
    frame=np.ones(512,np.float32)*.1
    for _ in range(20):engine.accept(frame,.9)
    engine.set_listening(False)
    for _ in range(40):engine.accept(frame,.9)
    for _ in range(10):engine.accept(frame,0)
    assert events==[] and not engine.active and not engine.frames
    engine.set_listening(True)
    for _ in range(20):engine.accept(frame,.9)
    for _ in range(10):engine.accept(frame,0)
    assert events==[(True,0)]

class FakeDetector:
    def __init__(self,wake_at,end_sample):self.calls=0;self.wake_at=wake_at;self.end_sample=end_sample;self.resets=0
    def reset(self):self.resets+=1
    def set_words(self,words):self.words=dict(words)
    def accept(self,pcm):
        self.calls+=1
        hit=self.calls==self.wake_at
        return {'confidence':.95 if hit else None,'candidate':self.calls==self.wake_at-2,'end_sample':self.end_sample,'start_sample':getattr(self,'start_sample',None),'word':'stop' if hit else None}
class FakeTranscriber:
    def __init__(self):self.dropped=0
    def drop_pending(self):self.dropped+=1

def test_wake_word_replays_the_rest_of_the_sentence_into_the_segmenter():
    events=[];emitted=[];segmenter=speech.Segmenter(lambda audio,final,segment:events.append((len(audio),final)),partials=False)
    detector=FakeDetector(wake_at=20,end_sample=15*512);transcriber=FakeTranscriber()
    waiter=speech.WakeWaiter(detector,segmenter,transcriber,emitted.append)
    waiter.wait(True);assert detector.resets==1 and transcriber.dropped==1 and not segmenter.listening
    loud=np.ones(512,np.float32)*.1;raw=b'\x00\x00'*512
    for _ in range(20):waiter.accept(raw,loud,.9)
    assert [e['type'] for e in emitted]==['wake_candidate','wake'] and not waiter.waiting and segmenter.listening
    # Frames 15-19 (after the word ended) were replayed; speech continues and ends with silence.
    for _ in range(10):waiter.accept(raw,loud,.9)
    for _ in range(10):waiter.accept(raw,loud*0,0)
    assert events and events[-1][1] and events[-1][0]==(5+10+10)*512
    assert detector.calls==20

def test_interrupt_watch_cuts_in_and_keeps_the_new_request():
    events=[];emitted=[];segmenter=speech.Segmenter(lambda audio,final,segment:events.append((len(audio),final)),partials=False)
    detector=FakeDetector(wake_at=10,end_sample=8*512);waiter=speech.WakeWaiter(detector,segmenter,FakeTranscriber(),emitted.append)
    segmenter.set_listening(False)
    waiter.watch_interrupt(True,['stop']);assert waiter.mode=='interrupt' and detector.words=={'harmony':.8}
    waiter.watch_interrupt(True,[]);assert detector.words=={'harmony':.8,'stop':.9} and detector.resets==1
    loud=np.ones(512,np.float32)*.1;raw=b'\x00\x00'*512
    for _ in range(10):waiter.accept(raw,loud,.9)
    assert [e['type'] for e in emitted]==['interrupt'] and emitted[0]['word']=='stop' and segmenter.listening and waiter.mode is None
    for _ in range(10):waiter.accept(raw,loud*0,0)
    assert events and events[-1]==((2+10)*512,True)
    # Ignoring every word turns watching off; the hands-free wait is never replaced by an interrupt watch.
    waiter.watch_interrupt(True,['stop','harmony']);assert waiter.mode is None
    waiter.wait(True);waiter.watch_interrupt(True,[]);assert waiter.mode=='wake'
    waiter.watch_interrupt(False,[]);assert waiter.mode=='wake'

def test_while_waiting_nothing_is_transcribed():
    events=[];segmenter=speech.Segmenter(lambda audio,final,segment:events.append(final),partials=False)
    waiter=speech.WakeWaiter(FakeDetector(wake_at=10**9,end_sample=None),segmenter,FakeTranscriber(),lambda e:None)
    waiter.wait(True);loud=np.ones(512,np.float32)*.1
    for _ in range(100):waiter.accept(b'\x00\x00'*512,loud,.9)
    for _ in range(20):waiter.accept(b'\x00\x00'*512,loud*0,0)
    assert events==[] and len(waiter.recent)==120 and waiter.recent.maxlen==250

def test_silence_does_not_transcribe_and_long_speech_is_bounded():
    events=[];engine=speech.Segmenter(lambda audio,final,segment:events.append((len(audio),final,segment)))
    frame=np.zeros(512,np.float32)
    for _ in range(400):engine.accept(frame,0)
    assert not events and len(engine.preroll)==6
    for _ in range(1000):engine.accept(frame,.9)
    assert max(size for size,_,_ in events)<=312*512
    assert len(engine.frames)<312
    assert sum(final for _,final,_ in events)>=3

def test_real_silero_silence():
    speech.verify_models()
    vad=speech.Silero(speech.ROOT/'data'/'models'/'silero_vad.onnx')
    scores=[vad.probability(np.zeros(512,np.float32)) for _ in range(20)]
    assert all(0<=score<.6 for score in scores)

def test_wake_gate_requires_exact_confident_word_and_debounces():
    import runpy
    gate=runpy.run_path(str(Path(__file__).with_name('wake.py')))['WakeGate']()
    assert gate.consider([{'word':'disharmony','conf':1,'start':0,'end':1}],16000) is None
    assert gate.consider([{'word':'harmony','conf':.4,'start':0,'end':1}],16000) is None
    assert gate.consider([{'word':'harmony','conf':.9,'start':0,'end':1}],16000)==.9
    assert gate.consider([{'word':'harmony','conf':.9,'start':0,'end':1}],48000) is None
    gate.reset_utterance()
    assert gate.consider([{'word':'harmony','conf':.95,'start':0,'end':1}],50000)==.95

import threading,time
def _speculative(recognize):
    emitted=[];t=speech.Transcriber(recognize,emitted.append)
    seg=speech.Segmenter(t.submit,partials=False,speculate=t.speculate,promote=t.promote)
    return emitted,t,seg
def _wait(cond,timeout=3):
    end=time.monotonic()+timeout
    while not cond() and time.monotonic()<end:time.sleep(.005)
    return cond()

def test_speculation_is_used_when_the_speaker_stops():
    calls=[];emitted,t,seg=_speculative(lambda audio:(calls.append(len(audio)),'what time is it')[1])
    frame=np.ones(512,np.float32)*.1
    for _ in range(40):seg.accept(frame,.9)
    for _ in range(speech.SPECULATE_FRAMES):seg.accept(frame,0)
    assert _wait(lambda:len(calls)==1)          # started 160 ms into the silence, before the endpoint
    for _ in range(10-speech.SPECULATE_FRAMES):seg.accept(frame,0)
    assert _wait(lambda:emitted)
    assert emitted==[{**emitted[0],'type':'transcript','text':'what time is it','final':True,'segment':0,'speculative':True}]
    time.sleep(.05);assert len(calls)==1             # the final did not transcribe the audio a second time
    t.close()

def test_promotion_waits_for_a_still_running_speculation():
    gate=threading.Event();emitted,t,seg=_speculative(lambda audio:(gate.wait(2),'remind me')[1])
    frame=np.ones(512,np.float32)*.1
    for _ in range(30):seg.accept(frame,.9)
    for _ in range(10):seg.accept(frame,0)
    time.sleep(.05);assert emitted==[]
    gate.set();assert _wait(lambda:emitted)
    assert emitted[0]['text']=='remind me' and emitted[0]['final'] and emitted[0]['speculative']
    t.close()

def test_speech_after_a_pause_discards_the_guess_and_transcribes_everything():
    seen=[];emitted,t,seg=_speculative(lambda audio:(seen.append(len(audio)),f'{len(audio)} samples')[1])
    frame=np.ones(512,np.float32)*.1
    for _ in range(30):seg.accept(frame,.9)
    for _ in range(speech.SPECULATE_FRAMES):seg.accept(frame,0)   # short mid-sentence pause: a guess starts
    assert _wait(lambda:len(seen)==1)
    for _ in range(20):seg.accept(frame,.9)                      # ...and the speaker carries on
    for _ in range(10):seg.accept(frame,0)
    assert _wait(lambda:emitted)
    assert len(emitted)==1 and emitted[0]['final']
    assert emitted[0]['text']==f'{seen[-1]} samples' and seen[-1]>seen[0]   # the final covers all the speech
    t.close()

def test_pausing_listening_cancels_a_pending_guess():
    gate=threading.Event();emitted,t,seg=_speculative(lambda audio:(gate.wait(2),'old')[1])
    frame=np.ones(512,np.float32)*.1
    for _ in range(30):seg.accept(frame,.9)
    for _ in range(speech.SPECULATE_FRAMES):seg.accept(frame,0)
    seg.set_listening(False);t.drop_pending();gate.set();time.sleep(.1)
    assert emitted==[] and t.spec is None
    t.close()

def test_a_failed_guess_falls_back_to_a_normal_transcription():
    n=[0]
    def recognize(audio):
        n[0]+=1
        if n[0]==1:raise RuntimeError('boom')
        return 'second try'
    emitted,t,seg=_speculative(recognize)
    frame=np.ones(512,np.float32)*.1
    for _ in range(30):seg.accept(frame,.9)
    for _ in range(speech.SPECULATE_FRAMES):seg.accept(frame,0)
    assert _wait(lambda:n[0]==1);time.sleep(.05)
    for _ in range(10-speech.SPECULATE_FRAMES):seg.accept(frame,0)
    assert _wait(lambda:emitted)
    assert emitted[0]['text']=='second try' and emitted[0]['final'] and 'speculative' not in emitted[0]
    t.close()

def test_verified_models_are_not_rehashed_until_they_change(tmp_path,monkeypatch):
    import hashlib,json,os
    (tmp_path/'docs').mkdir();(tmp_path/'data'/'models').mkdir(parents=True)
    model=tmp_path/'data'/'models'/'m.bin';model.write_bytes(b'weights'*1000)
    digest=hashlib.sha256(model.read_bytes()).hexdigest()
    (tmp_path/'docs'/'M.json').write_text(json.dumps({'files':[{'path':'data/models/m.bin','bytes':model.stat().st_size,'sha256':digest}]}))
    monkeypatch.setattr(speech,'ROOT',tmp_path);monkeypatch.setattr(speech,'VERIFIED_CACHE',tmp_path/'data'/'models'/'.verified.json')
    reads=[]
    real=speech.hashlib.file_digest
    monkeypatch.setattr(speech.hashlib,'file_digest',lambda f,n:(reads.append(1),real(f,n))[1])
    speech.verify_models('M.json');speech.verify_models('M.json');speech.verify_models('M.json')
    assert len(reads)==1                                   # hashed once, then trusted while unchanged
    data=bytearray(model.read_bytes());data[0]^=1;model.write_bytes(bytes(data))   # same size, new content and time
    os.utime(model,ns=(model.stat().st_atime_ns,model.stat().st_mtime_ns+10_000_000))
    import pytest
    with pytest.raises(ValueError):speech.verify_models('M.json')
    assert len(reads)==2

def test_prefer_cache_tries_each_copy_then_keeps_the_faster():
    assert speech.prefer_cache({'optimised':[],'original':[]}) is True        # try the optimised copy first
    assert speech.prefer_cache({'optimised':[43000],'original':[]}) is False  # then the original once
    assert speech.prefer_cache({'optimised':[43000],'original':[38000]}) is False
    assert speech.prefer_cache({'optimised':[20000,21000],'original':[38000]}) is True
    # every eighth start re-tries the slower copy
    assert speech.prefer_cache({'optimised':[20000]*4,'original':[38000]*4}) is False

def test_quick_recognizer_starts_on_whisper_and_swaps(monkeypatch):
    sent=[]
    monkeypatch.setattr(speech,'parakeet_directory',lambda:Path('x'))
    monkeypatch.setattr(speech,'load_whisper',lambda threads,warm=True:(lambda audio:'whisper'))
    monkeypatch.setattr(speech,'load_parakeet',lambda folder,threads:(lambda audio:'parakeet'))
    monkeypatch.setattr(speech,'write_startup',lambda:None)
    engine,recognize,background=speech.quick_recognizer(True,sent.append)
    assert engine=='whisper' and recognize(None)=='whisper'
    background()
    import time;time.sleep(.05);assert sent==[] and recognize(None)=='whisper'  # waits for HARMONY's go-ahead
    speech.UPGRADE.set();speech.WARMED.set()
    for _ in range(100):
        if sent:break
        import time;time.sleep(.01)
    assert sent==[{'type':'engine','engine':'parakeet'}] and recognize(None)=='parakeet'
    speech.UPGRADE.clear();speech.WARMED.clear()

def test_quick_recognizer_can_be_switched_off(monkeypatch):
    monkeypatch.setenv('HARMONY_STT_QUICKSTART','0')
    monkeypatch.setattr(speech,'parakeet_directory',lambda:Path('x'))
    monkeypatch.setattr(speech,'load_parakeet',lambda folder,threads:(lambda audio:'parakeet'))
    engine,recognize,_=speech.quick_recognizer(True,lambda m:None)
    assert engine=='parakeet' and recognize(None)=='parakeet'

def test_late_waiter_passes_audio_through_until_the_spotter_loads():
    seen=[];made=[]
    class Seg:
        def accept(self,frame,p):seen.append('segmenter')
    class Real:
        def __init__(self,d):made.append(d);self.watch=None;self.waiting=False
        def watch_interrupt(self,enabled,ignore=()):self.watch=(enabled,list(ignore))
        def accept(self,raw,frame,p):seen.append('waiter')
    spotter={};w=speech.LateWaiter(spotter,Seg(),Real)
    w.accept(b'xx',None,0);assert seen==['segmenter'] and not made
    w.watch_interrupt(True,['stop'])                       # remembered while loading
    spotter['d']='vosk'
    w.accept(b'xx',None,0);assert seen==['segmenter','waiter'] and made==['vosk']
    assert w.real.watch==(True,['stop'])
    w.watch_interrupt(False);assert w.real.watch==(False,[])

def test_lazy_av_loads_the_real_module_only_when_used(monkeypatch):
    import sys,types
    monkeypatch.delitem(sys.modules,'av',raising=False)
    loaded=[]
    real=types.ModuleType('av');real.open=lambda *a:'opened'
    import importlib
    monkeypatch.setattr(importlib,'import_module',lambda name:(loaded.append(name),real)[1])
    speech.lazy_av();stub=sys.modules['av']
    assert loaded==[]                      # nothing loaded yet
    assert stub.open()=='opened' and loaded==['av']
    assert stub.open()=='opened' and loaded==['av']   # loaded once
    monkeypatch.delitem(sys.modules,'av',raising=False)

# Smart Turn (end-of-turn model)
_st_spec=importlib.util.spec_from_file_location('smart_turn',Path(__file__).with_name('smart_turn.py'))
smart_turn=importlib.util.module_from_spec(_st_spec);_st_spec.loader.exec_module(smart_turn)

class FakeJudge:
    """Answers instantly with a fixed probability (or never, for p=None)."""
    def __init__(self,p):self.p=p;self.asks=[];self.counts={};self.saved=0
    def ask(self,audio):self.asks.append(len(audio));return len(self.asks)
    def verdict(self,number):return self.p
    def count(self,what):self.counts[what]=self.counts.get(what,0)+1
    def save(self):self.saved+=1

def _turn(judge,quiet,speech_after=None):
    """10 speech frames, then `quiet` silent frames (optionally speech again after `speech_after` of them).
    Returns the index of the frame (counting from the first silent one) where the turn ended, or None."""
    ended=[];seg=speech.Segmenter(lambda audio,final,segment:ended.append(final) if final else None,partials=False)
    seg.judge=judge;frame=np.zeros(512,np.float32)
    for _ in range(10):seg.accept(frame,.9)
    for i in range(quiet):
        if speech_after is not None and i==speech_after:
            for _ in range(3):seg.accept(frame,.9)
        seg.accept(frame,.0)
        if ended:return i+1
    return None

def test_without_the_model_a_turn_ends_after_ten_quiet_frames():
    assert _turn(None,40)==10

def test_a_finished_sentence_ends_at_the_usual_time():
    j=FakeJudge(.9);assert _turn(j,40)==10
    assert j.asks==[13*512] and j.counts=={'complete':1} and j.saved==1  # asked after 3 quiet frames, with all the audio

def test_an_unfinished_sentence_is_held_open_then_ends():
    j=FakeJudge(.1);assert _turn(j,40)==speech.TURN_HOLD_FRAMES
    assert j.counts=={'held':1,'held_to_end':1}

def test_speaking_again_during_a_hold_continues_the_same_turn():
    j=FakeJudge(.1);assert _turn(j,60,speech_after=20)==20+speech.TURN_HOLD_FRAMES  # resumes, pauses, is held again, then ends
    assert j.counts['resumed']==1 and len(j.asks)==2

def test_a_late_answer_is_not_waited_for_forever():
    j=FakeJudge(None);assert _turn(j,40)==speech.TURN_LATE_FRAMES and j.counts=={'late':1}

def test_features_have_the_model_shape_and_pad_at_the_start():
    f=smart_turn.features(np.zeros(16000,np.float32));assert f.shape==(1,80,800) and f.dtype==np.float32
    a=smart_turn.last_seconds(np.ones(100,np.float32));assert a.size==128000 and a[:-100].sum()==0 and a[-100:].sum()==100
    long=np.arange(200000,dtype=np.float32);assert smart_turn.last_seconds(long)[0]==200000-128000

def test_judge_runs_off_thread_and_wipes_the_audio():
    class Model:
        last_ms=1.0
        def probability(self,audio):self.seen=audio;return .8
    m=Model();j=smart_turn.TurnJudge(m);audio=np.ones(10,np.float32);n=j.ask(audio)
    for _ in range(200):
        if j.verdict(n) is not None:break
        time.sleep(.01)
    assert j.verdict(n)==.8 and not audio.any() and j.summary()['judged']==1

def test_name_at_the_end_keeps_the_whole_sentence():
    # "What's the weather, Harmony?": 20 frames of speech, then the name (frames 20-27), then quiet.
    events=[];emitted=[];segmenter=speech.Segmenter(lambda audio,final,segment:events.append((len(audio),final)),partials=False)
    detector=FakeDetector(wake_at=40,end_sample=28*512);detector.start_sample=20*512
    waiter=speech.WakeWaiter(detector,segmenter,FakeTranscriber(),emitted.append);waiter.wait(True)
    loud=np.ones(512,np.float32)*.1;quiet=loud*0;raw=b'\x00\x00'*512
    for _ in range(10):waiter.accept(raw,quiet,0)        # earlier quiet: not part of the sentence
    for _ in range(18):waiter.accept(raw,loud,.9)        # frames 10-27: the question and the name
    for _ in range(12):waiter.accept(raw,quiet,0)        # frames 28-39: she hears the name at frame 39
    assert emitted[-1]['type']=='wake' and events and events[-1][1]
    # Replayed from the start of speech (frame 10): all 18 spoken frames, plus the quiet that ended the turn.
    assert events[-1][0]==(18+10)*512

def test_name_first_still_replays_only_what_follows():
    assert speech.sentence_start([(i*512,None,.0) for i in range(10)],5*512) is None
    recent=[(i*512,None,.9 if 3<=i<20 else 0) for i in range(30)]
    assert speech.sentence_start(recent,20*512)==3*512 and speech.sentence_start(recent,5*512) is None
