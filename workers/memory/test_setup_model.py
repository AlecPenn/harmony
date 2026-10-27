"""The memory model setup, with Hugging Face replaced by an in-memory fake: pins, verifies and refuses tampering."""
import hashlib, importlib.util, io, json, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'setup-memory-model.py'


def load(root):
    spec = importlib.util.spec_from_file_location('setup_memory_model', SCRIPT); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.ROOT = root; m.MANIFEST = root / 'docs' / 'MEMORY-MODEL.json'
    return m


class FakeHub:
    def __init__(self):
        self.files = {'onnx/model.onnx': b'graph' * 10, 'onnx/model.onnx_data': b'w' * 5000, 'tokenizer.json': b'{"tok":1}', 'config.json': b'{"cfg":1}'}
        self.lfs = {'onnx/model.onnx', 'onnx/model.onnx_data'}; self.served = dict(self.files)

    def tree(self, folder):
        out = []
        for path, data in self.files.items():
            if (path.rsplit('/', 1)[0] if '/' in path else '') != folder: continue
            entry = {'type': 'file', 'path': path}
            if path in self.lfs: entry['lfs'] = {'oid': hashlib.sha256(data).hexdigest()}
            else: entry['oid'] = hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()
            out.append(entry)
        return json.dumps(out).encode()

    def urlopen(self, request, timeout=None):
        url = request.full_url
        if url.endswith('-ONNX'): body = json.dumps({'sha': 'abc123'}).encode()
        elif '/tree/abc123' in url: body = self.tree('onnx' if url.endswith('/onnx') else '')
        else: body = self.served[url.split('/resolve/abc123/')[1]]
        class R(io.BytesIO):
            def __enter__(s): return s
            def __exit__(s, *a): return False
        return R(body)


class SetupTest(unittest.TestCase):
    def run_setup(self, root, hub):
        m = load(root); m.urllib.request.urlopen = hub.urlopen
        return m.main()

    def test_installs_pins_and_then_verifies_without_downloading(self):
        root = Path(tempfile.mkdtemp()); (root / 'docs').mkdir(); hub = FakeHub()
        self.assertEqual(self.run_setup(root, hub), 0)
        manifest = json.loads((root / 'docs' / 'MEMORY-MODEL.json').read_text())
        self.assertEqual(manifest['revision'], 'abc123'); self.assertEqual(len(manifest['files']), 4)
        self.assertEqual((root / manifest['directory'] / 'onnx' / 'model.onnx_data').read_bytes(), b'w' * 5000)
        hub.served = {}  # nothing may be downloaded on a verified re-run
        self.assertEqual(self.run_setup(root, hub), 0)

    def test_a_download_that_does_not_match_the_published_hash_is_refused(self):
        for name in ['onnx/model.onnx_data', 'tokenizer.json']:
            root = Path(tempfile.mkdtemp()); (root / 'docs').mkdir(); hub = FakeHub(); hub.served[name] = b'evil'
            with self.assertRaises(ValueError): self.run_setup(root, hub)
            self.assertFalse((root / 'docs' / 'MEMORY-MODEL.json').exists())


if __name__ == '__main__':
    unittest.main()
