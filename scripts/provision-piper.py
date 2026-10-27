"""Explicit development-only British Piper asset provisioning. Never called by synthesis."""
import hashlib,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'data'/'models'/'piper-alba'
REV='c10ece1aade47bb51c153c893d14e5bf8e5b7117'
FILES={
 'en_GB-alba-medium.onnx':(63201294,'sha256','401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b'),
 'en_GB-alba-medium.onnx.json':(4888,'git','c0969252c640fd7c2765baa62936a1106ca856d7'),
 'MODEL_CARD':(324,'git','61e578c81ce2f7d59fb6c8840d8290ae29efb45c')}
def verify(path,size,kind,expected):
 if path.is_symlink() or path.stat().st_size!=size:raise ValueError('Piper asset size mismatch')
 h=hashlib.sha256() if kind=='sha256' else hashlib.sha1(b'blob '+str(size).encode()+b'\0')
 with path.open('rb') as f:
  while block:=f.read(1024*1024):h.update(block)
 if h.hexdigest()!=expected:raise ValueError('Piper asset integrity failed')
def main():
 ROOT.mkdir(parents=True,exist_ok=True)
 for name,(size,kind,expected) in FILES.items():
  target=ROOT/name
  if target.exists():verify(target,size,kind,expected);continue
  partial=ROOT/(name+'.part');url=f'https://huggingface.co/rhasspy/piper-voices/resolve/{REV}/en/en_GB/alba/medium/{name}'
  with urllib.request.urlopen(url,timeout=60) as response,partial.open('xb') as out:
   received=0
   while block:=response.read(1024*1024):
    received+=len(block)
    if received>size:raise ValueError('Piper asset exceeds size')
    out.write(block)
  verify(partial,size,kind,expected);partial.replace(target)
 print('Verified British Piper assets; Australian preference unchanged')
if __name__=='__main__':main()
