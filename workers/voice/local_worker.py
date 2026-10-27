"""Private worker entry point. Parent owns deadlines and verified process termination."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from local_protocol import serve
from kokoro_engine import KokoroEngine
from acknowledgements import CachedSpeech
if __name__=='__main__':
    directory=Path(__file__).resolve().parents[2]/'data'/'models'/'kokoro-82m'
    def load(progress):
        engine=KokoroEngine(directory)
        progress('acknowledgements')
        return CachedSpeech(engine)
    # CachedSpeech just generated these bytes with this freshly loaded engine.
    # Validate readiness through that cache instead of synthesizing a sixth phrase.
    serve(sys.stdin,sys.stdout,load,report_stages=True,warmup_text='On it.')
