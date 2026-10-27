"""Resident local speech protocol. No model downloads, network calls or user-data logging.
The parent must terminate and verify this process on STOP, including during inference.
"""
import base64,json,time
RATE=24000
MAX_LINE=8192
MAX_AUDIO=RATE*2*30

def serve(reader,writer,engine_factory,rate=RATE,report_stages=False,warmup_text='Harmony is ready for a local voice test.'):
    def emit(value):
        writer.write(json.dumps(value,separators=(',',':'))+'\n');writer.flush()
    try:
        if rate not in (22050,24000):raise ValueError('Unsupported PCM rate')
        if not isinstance(warmup_text,str) or not warmup_text.strip() or len(warmup_text)>1000:raise ValueError('Invalid warmup text')
        max_audio=rate*2*30;max_block=(rate//10)*2
        started=time.perf_counter()
        stages=('model','acknowledgements','warmup');last_stage=-1
        def progress(stage):
            nonlocal last_stage
            index=stages.index(stage)
            if index<=last_stage:raise ValueError('Invalid preparation stage')
            last_stage=index
            emit({'type':'preparing','stage':stage,'elapsed_ms':round((time.perf_counter()-started)*1000)})
        if report_stages:progress('model')
        engine=engine_factory(progress) if report_stages else engine_factory()
        if report_stages:progress('warmup')
        # Consume and validate warm-up audio before claiming readiness.
        warm=0
        for block in engine.synthesize(warmup_text):
            if not isinstance(block,bytes) or len(block)%2 or not block or len(block)>max_block:raise ValueError('Invalid PCM')
            warm+=len(block)
            if warm>max_audio:raise ValueError('Warmup limit')
        if not warm:raise ValueError('Empty warmup')
        emit({'type':'ready','rate':rate,'warmup_ms':round((time.perf_counter()-started)*1000)})
        expected=0
        while True:
            line=reader.readline(MAX_LINE+1)
            if not line:return
            if len(line)>MAX_LINE or not line.endswith('\n'):raise ValueError('Invalid framing')
            value=json.loads(line)
            if not isinstance(value,dict) or set(value)!={'id','text'}:raise ValueError('Invalid request')
            if type(value['id']) is not int or value['id']!=expected:raise ValueError('Invalid sequence')
            text=value['text']
            if not isinstance(text,str) or not text.strip() or len(text)>1000 or any(ord(c)<32 and c not in '\n\t' for c in text):raise ValueError('Invalid text')
            seq=0;total=0;started=time.perf_counter()
            for block in engine.synthesize(text):
                if not isinstance(block,bytes) or len(block)%2 or not block or len(block)>max_block:raise ValueError('Invalid PCM')
                total+=len(block)
                if total>max_audio:raise ValueError('Audio limit')
                emit({'type':'pcm','id':expected,'seq':seq,'rate':rate,'pcm':base64.b64encode(block).decode('ascii')});seq+=1
            # Text the voice cannot pronounce (e.g. only symbols) yields no audio: report an empty result instead of
            # failing, so one unspeakable phrase never takes the resident worker down. Warm-up still requires audio.
            emit({'type':'done','id':expected,'chunks':seq,'elapsed_ms':round((time.perf_counter()-started)*1000)})
            expected+=1
    except Exception:
        emit({'type':'error','code':'LOCAL_VOICE_UNAVAILABLE'})
