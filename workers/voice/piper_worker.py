"""Private fixed Piper worker. Owner verifies STOP by terminating this process."""
import time
STARTED=time.time();T0=time.perf_counter()
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'.runtime'/'piper'))
from local_protocol import serve
import piper_engine
from piper_engine import preferred_engine

def timed(progress):
    """Loads the voice and saves how long each part took (.runtime/voice-startup.json, for launch-speed tuning)."""
    engine=preferred_engine()
    marks={k:round((v-T0)*1000) for k,v in piper_engine.TIMES.items()}
    try:
        (ROOT/'.runtime').mkdir(exist_ok=True)
        (ROOT/'.runtime'/'voice-startup.json').write_text(json.dumps({'python started':STARTED,'ms':marks,'engine ready at':time.time()}))
    except Exception:
        pass
    return engine

# A short warm-up phrase: it only has to run the model once before the first real reply.
if __name__=='__main__':serve(sys.stdin,sys.stdout,timed,rate=22050,report_stages=True,warmup_text='Ready.')
