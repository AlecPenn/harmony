"""Explicit setup only. Runtime speech workers never download or send audio."""
from pathlib import Path
import hashlib, json, urllib.request
ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'data' / 'models'
NOTICES = ROOT / 'docs' / 'licenses'

def fetch(url):
    request=urllib.request.Request(url,headers={'User-Agent':'HARMONY-build'})
    with urllib.request.urlopen(request,timeout=90) as response:
        return response.read()

def download(url,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.partial')
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'HARMONY-build'}),timeout=120) as response, temp.open('wb') as target:
        total=0
        while block:=response.read(1024*1024):
            total+=len(block)
            if total>500_000_000: raise ValueError('Model exceeds setup size limit')
            target.write(block)
    temp.replace(path)
    return {'path':str(path.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'source':url}

def main():
    manifest_path=ROOT/'docs'/'SPEECH-MODELS.json'
    previous=json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    vad_revision=previous['silero_revision'] if previous else json.loads(fetch('https://api.github.com/repos/snakers4/silero-vad/commits/master'))['sha']
    whisper_revision=previous['whisper_revision'] if previous else json.loads(fetch('https://huggingface.co/api/models/Systran/faster-whisper-base.en'))['sha']
    records=[]
    records.append(download(f'https://raw.githubusercontent.com/snakers4/silero-vad/{vad_revision}/src/silero_vad/data/silero_vad.onnx',MODELS/'silero_vad.onnx'))
    for name in ['config.json','model.bin','tokenizer.json','vocabulary.txt']:
        records.append(download(f'https://huggingface.co/Systran/faster-whisper-base.en/resolve/{whisper_revision}/{name}',MODELS/'whisper-base.en'/name))
    NOTICES.mkdir(exist_ok=True)
    (NOTICES/'Silero-VAD-MIT.txt').write_bytes(fetch(f'https://raw.githubusercontent.com/snakers4/silero-vad/{vad_revision}/LICENSE'))
    (NOTICES/'OpenAI-Whisper-MIT.txt').write_bytes(fetch('https://raw.githubusercontent.com/openai/whisper/main/LICENSE'))
    manifest={'silero_revision':vad_revision,'whisper_revision':whisper_revision,'files':records}
    if previous and records!=previous['files']: raise ValueError('Pinned model content changed; review required')
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    print('Local model setup verified:',len(records),'files; no audio accessed.')
if __name__=='__main__': main()

