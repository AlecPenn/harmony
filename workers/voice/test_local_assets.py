import hashlib,json,tempfile,unittest
from pathlib import Path
from local_assets import verify_assets,FILES
class AssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='harmony-model-fixture-');self.root=Path(self.temp.name)
        self.manifest={'version':1,'files':{}}
        for name in FILES:
            data=('fixture '+name).encode();(self.root/name).write_bytes(data);self.manifest['files'][name]=hashlib.sha256(data).hexdigest()
        self.save()
    def tearDown(self):self.temp.cleanup()
    def save(self):(self.root/'manifest.json').write_text(json.dumps(self.manifest),encoding='utf-8')
    def test_valid_fixed_assets(self):self.assertEqual(set(verify_assets(self.root)),set(FILES))
    def test_tampered_and_missing_assets(self):
        (self.root/'bf_emma.pt').write_bytes(b'tampered')
        with self.assertRaises(ValueError):verify_assets(self.root)
        (self.root/'bf_emma.pt').unlink()
        with self.assertRaises(ValueError):verify_assets(self.root)
    def test_manifest_cannot_select_arbitrary_paths(self):
        self.manifest['files']['../outside']='0'*64;self.save()
        with self.assertRaises(ValueError):verify_assets(self.root)
    def test_invalid_manifest_types(self):
        self.manifest['version']=True;self.save()
        with self.assertRaises(ValueError):verify_assets(self.root)
    def test_empty_assets(self):
        (self.root/'config.json').write_bytes(b'')
        with self.assertRaises(ValueError):verify_assets(self.root)
if __name__=='__main__':unittest.main()
