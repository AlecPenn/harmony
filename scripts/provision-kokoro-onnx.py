"""Explicit optional quantized ONNX comparison model, never an inference-time download."""
import hashlib,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'data'/'models'/'kokoro-onnx'
SHA='fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'
SIZE=92361116
URL='https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model_quantized.onnx'
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while block:=f.read(1024*1024):h.update(block)
 return h.hexdigest()
def main():
 ROOT.mkdir(parents=True,exist_ok=True);target=ROOT/'model_quantized.onnx'
 if target.exists():
  if target.stat().st_size!=SIZE or digest(target)!=SHA:raise ValueError('Existing model differs')
  return
 partial=ROOT/'model_quantized.onnx.part'
 with urllib.request.urlopen(URL,timeout=60) as response,partial.open('xb') as out:
  size=0
  while block:=response.read(1024*1024):
   size+=len(block)
   if size>SIZE:raise ValueError('Model too large')
   out.write(block)
 if partial.stat().st_size!=SIZE or digest(partial)!=SHA:raise ValueError('Model integrity mismatch')
 partial.replace(target);print('Verified quantized ONNX model')
if __name__=='__main__':main()
