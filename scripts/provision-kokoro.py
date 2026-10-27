"""Explicit developer provisioning of optional British Emma test assets.
No synthesis request may invoke this script. Fixed official revision and integrity pins.
"""
import hashlib,json,urllib.request
from pathlib import Path
REVISION='f3ff3571791e39611d31c381e3a41a3af07b4987'
FILES={
 'config.json':('config.json',2351,'git','14a726edd3718279eac426630879ff743955b16a'),
 'kokoro-v1_0.pth':('kokoro-v1_0.pth',327212226,'sha256','496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4'),
 'bf_emma.pt':('voices/bf_emma.pt',523420,'sha256','d0a423deabf4a52b4f49318c51742c54e21bb89bbbe9a12141e7758ddb5da701')}
def matches(path,size,kind,expected):
 if not path.is_file() or path.is_symlink() or path.stat().st_size!=size:return False
 h=hashlib.sha1() if kind=='git' else hashlib.sha256()
 if kind=='git':h.update(('blob '+str(size)+'\0').encode())
 with path.open('rb') as f:
  while block:=f.read(1024*1024):h.update(block)
 return h.hexdigest()==expected

def main():
 root=Path(__file__).resolve().parents[1]/'data'/'models'/'kokoro-82m';root.mkdir(parents=True,exist_ok=True)
 manifest={'version':1,'files':{}}
 for name,(remote,size,kind,expected) in FILES.items():
  path=root/name
  if path.exists() and not matches(path,size,kind,expected):raise ValueError('Existing asset differs; inspect before replacement')
  if not path.exists():
   partial=root/(name+'.part')
   with urllib.request.urlopen('https://huggingface.co/hexgrad/Kokoro-82M/resolve/'+REVISION+'/'+remote,timeout=60) as response,partial.open('xb') as out:
    count=0
    while block:=response.read(1024*1024):
     count+=len(block)
     if count>size:raise ValueError('Download exceeds pinned size')
     out.write(block)
   if not matches(partial,size,kind,expected):raise ValueError('Downloaded asset failed integrity check')
   partial.replace(path)
  h=hashlib.sha256()
  with path.open('rb') as f:
   while block:=f.read(1024*1024):h.update(block)
  manifest['files'][name]=h.hexdigest();print('Verified '+name,flush=True)
 target=root/'manifest.json'
 if target.exists() and json.loads(target.read_text(encoding='utf-8'))!=manifest:raise ValueError('Existing manifest differs')
 target.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
