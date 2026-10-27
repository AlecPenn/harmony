import base64, hashlib, io, json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import embed_worker as w


def tiny_model(directory):
    """A stand-in with the real export's interface: input_ids/attention_mask -> last_hidden_state (batch, seq, 8)."""
    import numpy as np, onnx
    from onnx import helper, TensorProto, numpy_helper
    table = np.random.default_rng(0).normal(size=(50, 8)).astype(np.float32)
    # Each position = its token vector + the sum over real (unpadded) tokens, so the first ([CLS]) position depends on
    # the whole text like a real encoder's, and padding changes nothing.
    nodes = [helper.make_node('Gather', ['table', 'input_ids'], ['g']),
             helper.make_node('Cast', ['attention_mask'], ['mf'], to=TensorProto.FLOAT),
             helper.make_node('Unsqueeze', ['mf', 'axis2'], ['m3']),
             helper.make_node('Mul', ['g', 'm3'], ['gm']),
             helper.make_node('ReduceSum', ['gm', 'axis1'], ['total'], keepdims=1),
             helper.make_node('Add', ['g', 'total'], ['last_hidden_state'])]
    graph = helper.make_graph(nodes, 'tiny', [
        helper.make_tensor_value_info('input_ids', TensorProto.INT64, ['b', 's']),
        helper.make_tensor_value_info('attention_mask', TensorProto.INT64, ['b', 's'])],
        [helper.make_tensor_value_info('last_hidden_state', TensorProto.FLOAT, ['b', 's', 8])],
        [numpy_helper.from_array(table, 'table'), numpy_helper.from_array(np.array([2], dtype=np.int64), 'axis2'),
         numpy_helper.from_array(np.array([1], dtype=np.int64), 'axis1')])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)]); model.ir_version = 8
    onnx.save(model, str(directory / 'model.onnx'))
    from tokenizers import Tokenizer, models, pre_tokenizers, processors
    vocab = {'[PAD]': 0, '[UNK]': 1, '[CLS]': 2, '[SEP]': 3, **{f'w{i}': i + 4 for i in range(40)}, 'plumber': 44, 'dave': 45, 'soccer': 46}
    tok = Tokenizer(models.WordLevel(vocab, unk_token='[UNK]')); tok.pre_tokenizer = pre_tokenizers.Whitespace()
    tok.post_processor = processors.TemplateProcessing(single='[CLS] $A [SEP]', special_tokens=[('[CLS]', 2), ('[SEP]', 3)])
    tok.save(str(directory / 'tokenizer.json'))


class EmbedWorkerTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()); tiny_model(self.dir)

    def test_vectors_are_normalised_cls_vectors_and_padding_does_not_change_them(self):
        e = w.Embedder(self.dir / 'model.onnx', self.dir / 'tokenizer.json', threads=1)
        self.assertEqual(e.dim, 8)
        alone = e.embed(['dave'])[0]; batch = e.embed(['dave', 'plumber dave soccer w1 w2'])
        self.assertAlmostEqual(float((alone ** 2).sum()), 1.0, places=5)
        self.assertTrue(((alone - batch[0]) ** 2).sum() < 1e-10)
        self.assertEqual(e.embed([''])[0].shape, (8,))

    def test_protocol_answers_valid_requests_and_rejects_junk(self):
        e = w.Embedder(self.dir / 'model.onnx', self.dir / 'tokenizer.json', threads=1)
        requests = [{'type': 'embed', 'id': 1, 'texts': ['plumber', 'soccer']}, 'nonsense',
                    {'type': 'embed', 'id': 2, 'texts': []}, {'type': 'embed', 'id': 3, 'texts': ['x' * 2001]},
                    {'type': 'embed', 'id': -1, 'texts': ['a']}, {'type': 'stop'}, {'type': 'embed', 'id': 9, 'texts': ['late']}]
        stdin = io.StringIO('\n'.join(r if isinstance(r, str) else json.dumps(r) for r in requests) + '\n')
        out = io.StringIO(); w.serve(e, 'tiny', stdin, out)
        lines = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual(lines[0], {'type': 'ready', 'version': 1, 'dim': 8, 'model': 'tiny'})
        self.assertEqual(lines[1]['id'], 1); self.assertEqual(len(base64.b64decode(lines[1]['data'])), 2 * 8 * 4)
        self.assertEqual([l['type'] for l in lines[2:]], ['error'] * 4)

    def test_integrity_is_checked_and_remembered(self):
        root = self.dir / 'root'; models = root / 'data' / 'models' / 'memory'; models.mkdir(parents=True)
        data = b'abc' * 10; (models / 'f.bin').write_bytes(data)
        manifest = root / 'm.json'; cache = root / 'data' / 'models' / '.v.json'
        item = {'path': 'data/models/memory/f.bin', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        manifest.write_text(json.dumps({'files': [item]}))
        w.verify(manifest, root, cache); self.assertIn(item['path'], json.loads(cache.read_text()))
        (models / 'f.bin').write_bytes(b'xyz' * 10)
        with self.assertRaises(ValueError): w.verify(manifest, root, cache)
        manifest.write_text(json.dumps({'files': [{**item, 'path': '../outside.bin'}]}))
        with self.assertRaises(ValueError): w.verify(manifest, root, cache)


if __name__ == '__main__':
    unittest.main()
