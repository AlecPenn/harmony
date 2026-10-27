"""Per-engine bounded memory cache of generic acknowledgement audio.
This only supplies bytes; the core must decide whether speaking is appropriate.
"""
ACKNOWLEDGEMENTS=('Yeah?','Gotcha.','On it.','One sec.','Mm-hm?')
MAX_BYTES=24000*2*12
class CachedSpeech:
    def __init__(self,engine):
        self.engine=engine;self.cache={};total=0
        for text in ACKNOWLEDGEMENTS:
            blocks=[]
            for block in engine.synthesize(text):
                if not isinstance(block,bytes) or not block or len(block)%2 or len(block)>4800:raise ValueError('Invalid acknowledgement PCM')
                total+=len(block)
                if total>MAX_BYTES:raise ValueError('Acknowledgement cache limit')
                blocks.append(block)
            if not blocks:raise ValueError('Empty acknowledgement')
            self.cache[text]=tuple(blocks)
        self.byte_count=total
    def synthesize(self,text):
        if text in self.cache:yield from self.cache[text]
        else:yield from self.engine.synthesize(text)
