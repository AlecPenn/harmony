"""Optional British female Kokoro test adapter; never presented as Australian.
Dependencies and assets must be provisioned separately. No implicit download path.
"""
import contextlib,os
from pathlib import Path
from local_assets import verify_assets
class KokoroEngine:
    def __init__(self,directory):
        assets=verify_assets(directory)
        os.environ['HF_HUB_OFFLINE']='1'
        os.environ['TRANSFORMERS_OFFLINE']='1'
        os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
        # Missing spaCy resources must fail before upstream G2P can call its downloader.
        import spacy
        if not spacy.util.is_package('en_core_web_sm'):raise ValueError('Local language resources missing')
        import torch
        from loguru import logger
        logger.remove()
        torch.set_num_threads(2)
        from misaki import espeak
        # Fail before upstream can fall back to an additional model download.
        espeak.EspeakFallback(british=True)
        from kokoro import KModel,KPipeline
        with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
            model=KModel(repo_id='hexgrad/Kokoro-82M',config=str(assets['config.json']),model=str(assets['kokoro-v1_0.pth'])).to('cpu').eval()
            self.pipeline=KPipeline(lang_code='b',repo_id='hexgrad/Kokoro-82M',model=model,device='cpu')
            self.voice=self.pipeline.load_single_voice(str(assets['bf_emma.pt']))
    def synthesize(self,text):
        import numpy as np
        with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
            for result in self.pipeline(text,voice=self.voice,speed=1):
                audio=result.audio
                if audio is None:raise ValueError('Missing audio')
                values=audio.detach().cpu().numpy()
                if values.ndim!=1 or values.size>24000*30 or not np.isfinite(values).all():raise ValueError('Invalid model audio')
                pcm=(np.clip(values,-1,1)*32767).astype('<i2').tobytes()
                for offset in range(0,len(pcm),4800):yield pcm[offset:offset+4800]
