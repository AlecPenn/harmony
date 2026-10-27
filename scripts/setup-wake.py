"""Explicit, bounded download of the local wake model; no runtime downloads."""
from pathlib import Path
import hashlib,json,urllib.request,zipfile,shutil
ROOT=Path(__file__).resolve().parents[1]
NAME='vosk-model-small-en-us-0.15'
URL=f'https://alphacephei.com/vosk/models/{NAME}.zip'
def main():
    destination=(ROOT/'data'/'models').resolve();destination.mkdir(parents=True,exist_ok=True)
    archive=destination/(NAME+'.zip')
    with urllib.request.urlopen(URL,timeout=90) as source,archive.open('wb') as target:
        size=0
        while block:=source.read(1024*1024):
            size+=len(block)
            if size>100_000_000:raise ValueError('Wake archive exceeds limit')
            target.write(block)
    manifest_path=ROOT/'docs'/'WAKE-MODEL.json'
    archive_hash=hashlib.sha256(archive.read_bytes()).hexdigest()
    if manifest_path.exists() and json.loads(manifest_path.read_text())['archive_sha256']!=archive_hash:raise ValueError('Wake archive differs from reviewed model')
    files=[]
    with zipfile.ZipFile(archive) as bundle:
        if sum(member.file_size for member in bundle.infolist())>250_000_000:raise ValueError('Wake model exceeds extraction limit')
        for member in bundle.infolist():
            path=(destination/member.filename).resolve()
            if not path.is_relative_to(destination/NAME) or ((member.external_attr>>16)&0o170000)==0o120000:raise ValueError('Unsafe archive member')
            if member.is_dir():path.mkdir(parents=True,exist_ok=True);continue
            path.parent.mkdir(parents=True,exist_ok=True)
            with bundle.open(member) as source,path.open('wb') as target:shutil.copyfileobj(source,target)
            with path.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
            files.append({'path':str(path.relative_to(ROOT)).replace('\\','/'),'bytes':path.stat().st_size,'sha256':digest})
    manifest_path.write_text(json.dumps({'model':NAME,'source':URL,'archive_sha256':archive_hash,'license':'Apache-2.0','files':files},indent=2)+'\n')
    with urllib.request.urlopen('https://raw.githubusercontent.com/alphacep/vosk-api/master/COPYING',timeout=30) as source:(ROOT/'docs'/'licenses'/'Vosk-Apache-2.0.txt').write_bytes(source.read())
    print('Wake model installed with',len(files),'file hashes; no audio accessed.')
if __name__=='__main__':main()
