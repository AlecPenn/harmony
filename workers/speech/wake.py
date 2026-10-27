"""Local streaming keyword gate; wake is a hint, never identity or permission."""
import json
class WakeGate:
    def __init__(self,words=None):
        # Accepted words and their minimum confidence. Default: the wake word only.
        self.words=dict(words or {'harmony':.8});self.last_trigger_sample=-32000;self.seen=set();self.last_end=None;self.last_start=None;self.last_word=None
    def consider(self,words,samples):
        for item in words:
            threshold=self.words.get(item.get('word'))
            if threshold is None or not isinstance(item.get('conf'),(int,float)) or item['conf']<threshold:continue
            key=(item.get('start'),item.get('end'))
            if key in self.seen or samples-self.last_trigger_sample<32000:continue
            self.seen.add(key);self.last_trigger_sample=samples
            # When the word ended (seconds since the recognizer last reset), so audio after it can be replayed.
            self.last_end=float(item['end']) if isinstance(item.get('end'),(int,float)) else None;self.last_word=item['word']
            self.last_start=float(item['start']) if isinstance(item.get('start'),(int,float)) else None
            return float(item['conf'])
        return None
    def reset_utterance(self):self.seen.clear()
class WakeDetector:
    def __init__(self,path):
        import vosk
        vosk.SetLogLevel(-1)
        self.model=vosk.Model(str(path))
        self.recognizer=vosk.KaldiRecognizer(self.model,16000)
        self.recognizer.SetWords(True);self.recognizer.SetPartialWords(True)
        self.preview=vosk.KaldiRecognizer(self.model,16000)
        self.gate=WakeGate();self.samples=0;self.since_reset=0;self.reset_base=0;self.candidate_frames=0;self.candidate_sent=False
    def accept(self,pcm):
        self.samples+=len(pcm)//2;self.since_reset+=len(pcm)//2
        final=self.recognizer.AcceptWaveform(pcm)
        data=json.loads(self.recognizer.Result() if final else self.recognizer.PartialResult())
        result=self.gate.consider(data.get('result' if final else 'partial_result',[]),self.samples)
        # A stable provisional word may animate the core, but is not a confirmed wake.
        preview_final=self.preview.AcceptWaveform(pcm)
        preview=json.loads(self.preview.Result() if preview_final else self.preview.PartialResult())
        words=preview.get('text' if preview_final else 'partial','').split()
        self.candidate_frames=self.candidate_frames+1 if words and words[0]=='harmony' else 0
        candidate=self.candidate_frames>=2 and not self.candidate_sent
        if candidate:self.candidate_sent=True
        end_sample=start_sample=None
        if result is not None and self.gate.last_end is not None:end_sample=self.reset_base+int(self.gate.last_end*16000)
        if result is not None and self.gate.last_start is not None:start_sample=self.reset_base+int(self.gate.last_start*16000)
        if final or self.since_reset>=160000:self.reset()
        return {'confidence':result,'candidate':candidate,'end_sample':end_sample,'start_sample':start_sample,'word':self.gate.last_word if result is not None else None}
    def set_words(self,words):
        self.gate.words=dict(words)
    def reset(self):
        self.recognizer.Reset();self.preview.Reset();self.gate.reset_utterance();self.since_reset=0;self.reset_base=self.samples;self.candidate_frames=0;self.candidate_sent=False

