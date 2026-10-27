import hashlib,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import piper_engine
class PiperAssetsTests(unittest.TestCase):
 def test_pinned_bytes_are_required_before_engine_import(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);data=b'test model';(root/'model').write_bytes(data)
   with patch.object(piper_engine,'FILES',{'model':(len(data),'sha256',hashlib.sha256(data).hexdigest())}):
    self.assertEqual(piper_engine.verify_assets(root),root)
    (root/'model').write_bytes(b'wrong size')
    with self.assertRaises(ValueError):piper_engine.verify_assets(root)
    (root/'model').write_bytes(b'wrong hash')
    with self.assertRaises(ValueError):piper_engine.verify_assets(root)
 def test_missing_assets_fail_closed(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.assertRaises(FileNotFoundError):piper_engine.PiperEngine(folder)
class AustralianVoiceTests(unittest.TestCase):
 def manifest(self,root,files,speaker='harmony',model='v.onnx'):
  m={'model':model,'speaker':speaker,'files':[{'name':n,'bytes':len(d),'sha256':hashlib.sha256(d).hexdigest()} for n,d in files.items()]}
  (root/'m.json').write_text(__import__('json').dumps(m));return root/'m.json'
 def test_manifest_requires_model_config_and_speaker(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   self.assertIsNone(piper_engine.au_manifest(root/'missing.json'))
   m=piper_engine.au_manifest(self.manifest(root,{'v.onnx':b'a','v.onnx.json':b'b'}))
   self.assertEqual((m['model'],m['speaker']),('v.onnx','harmony'))
   with self.assertRaises(ValueError):piper_engine.au_manifest(self.manifest(root,{'v.onnx':b'a'}))
 def test_tampered_australian_voice_falls_back_to_alba(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'v.onnx').write_bytes(b'tampered');(root/'v.onnx.json').write_bytes(b'b')
   path=self.manifest(root,{'v.onnx':b'original','v.onnx.json':b'b'})
   made=[]
   class Fake:
    def __init__(self,directory,manifest=None):
     made.append(manifest is not None)
     if manifest:piper_engine.verify_assets(directory,manifest['files'])
   with patch.object(piper_engine,'AU_MANIFEST',path),patch.object(piper_engine,'AU_DIR',root),patch.object(piper_engine,'PiperEngine',Fake):
    piper_engine.preferred_engine()
   self.assertEqual(made,[True,False])
 def test_trained_multispeaker_voice_speaks_as_harmony(self):
  import os
  model=os.environ.get('HARMONY_TEST_AU_ONNX')
  if not model:self.skipTest('Set HARMONY_TEST_AU_ONNX to a trained en_AU voice to run this')
  model=Path(model);files={p.name:p.read_bytes() for p in (model,Path(str(model)+'.json'))}
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   for n,d in files.items():(root/n).write_bytes(d)
   m=piper_engine.au_manifest(self.manifest(root,files,model=model.name))
   engine=piper_engine.PiperEngine(root,m)
   self.assertEqual(engine.name,'harmony-au');self.assertEqual(engine.syn_config.speaker_id,0)
   self.assertGreater(sum(len(b) for b in engine.synthesize("G'day, I'm Harmony.")),22050)
   with self.assertRaises(ValueError):piper_engine.PiperEngine(root,{**m,'speaker':'nobody'})
if __name__=='__main__':unittest.main()

def test_verified_voice_files_are_not_rehashed_until_they_change(tmp_path,monkeypatch):
    import hashlib,piper_engine as pe
    monkeypatch.setattr(pe,'ROOT',tmp_path);monkeypatch.setattr(pe,'VERIFIED',tmp_path/'verified.json')
    d=tmp_path/'voice';d.mkdir();(d/'a.onnx').write_bytes(b'abc')
    files={'a.onnx':(3,'sha256',hashlib.sha256(b'abc').hexdigest())}
    pe.verify_assets(d,files)
    reads=[]
    real=pe.hashlib.sha256
    monkeypatch.setattr(pe.hashlib,'sha256',lambda *a:(reads.append(1),real(*a))[1])
    pe.verify_assets(d,files);assert reads==[]          # remembered: no re-read
    import os;os.utime(d/'a.onnx',ns=(1,1))
    pe.verify_assets(d,files);assert reads==[1]         # touched: hashed again
    (d/'a.onnx').write_bytes(b'abd');os.utime(d/'a.onnx',ns=(2,2))
    import pytest
    with pytest.raises(ValueError):pe.verify_assets(d,files)
