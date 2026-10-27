"""HARMONY memory search: turns short texts into meaning vectors, entirely on this PC.

Model: IBM Granite Embedding Small English R2 (Apache-2.0), ONNX export by onnx-community, pinned in
docs/MEMORY-MODEL.json by scripts/setup-memory-model.py. Runs on the CPU with two threads so speech keeps its share.
Never downloads anything and never sees audio.

Protocol (JSON lines, stdout/stdin):
  -> {"type":"ready","version":1,"dim":384,"model":"<id>"}
  <- {"type":"embed","id":7,"texts":["..."]}      (1-32 texts, each at most 2000 characters)
  -> {"type":"vectors","id":7,"dim":384,"data":"<base64 little-endian float32, len(texts)*dim>"}
  <- {"type":"stop"}
"""
import base64, hashlib, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'docs' / 'MEMORY-MODEL.json'
VERIFIED_CACHE = ROOT / 'data' / 'models' / '.verified-memory.json'
MAX_TEXTS, MAX_CHARS, MAX_TOKENS = 32, 2000, 256


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(1 << 20):
            h.update(block)
    return h.hexdigest()


def verify(manifest_path=MANIFEST, root=ROOT, cache_path=VERIFIED_CACHE):
    """Every pinned file must match its size and SHA-256. A full hash is remembered by size and modification time,
    so later starts don't re-read 190 MB; any change means a fresh hash, and a mismatch always fails closed."""
    manifest = json.loads(Path(manifest_path).read_text())
    models = (Path(root) / 'data' / 'models').resolve()
    try:
        cache = json.loads(Path(cache_path).read_text())
        cache = cache if isinstance(cache, dict) else {}
    except Exception:
        cache = {}
    changed = False
    for item in manifest['files']:
        path = (Path(root) / item['path']).resolve()
        if not path.is_relative_to(models): raise ValueError('Invalid model path')
        if not path.is_file() or path.stat().st_size != item['bytes']: raise ValueError('Missing memory model')
        stat = path.stat(); key = item['path']
        if cache.get(key) == [stat.st_size, stat.st_mtime_ns, item['sha256']]: continue
        if digest(path) != item['sha256']:
            cache.pop(key, None)
            raise ValueError('Memory model integrity check failed')
        cache[key] = [stat.st_size, stat.st_mtime_ns, item['sha256']]; changed = True
    if changed:
        try:
            Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
            tmp = Path(cache_path).with_suffix('.tmp'); tmp.write_text(json.dumps(cache)); os.replace(tmp, cache_path)
        except Exception:
            pass
    return manifest


class Embedder:
    def __init__(self, model_path, tokenizer_path, threads=2):
        import numpy as np, onnxruntime as ort
        from tokenizers import Tokenizer
        self.np = np
        self.tokenizer = Tokenizer.from_file(str(tokenizer_path))
        self.tokenizer.enable_truncation(MAX_TOKENS)
        pad = self.tokenizer.token_to_id('[PAD]')
        self.tokenizer.enable_padding(pad_id=pad if pad is not None else 0, pad_token='[PAD]')
        options = ort.SessionOptions(); options.intra_op_num_threads = threads; options.inter_op_num_threads = 1
        options.log_severity_level = 3
        options.add_session_config_entry('session.intra_op.allow_spinning', '0')
        self.session = ort.InferenceSession(str(model_path), options, providers=['CPUExecutionProvider'])
        self.inputs = {i.name for i in self.session.get_inputs()}
        outputs = [o.name for o in self.session.get_outputs()]
        # Some exports include the pooled sentence vector; otherwise Granite R2 pools with the first ([CLS]) token.
        self.pooled = 'sentence_embedding' if 'sentence_embedding' in outputs else None
        self.hidden = 'last_hidden_state' if 'last_hidden_state' in outputs else outputs[0]
        self.dim = int(self.embed(['ready'])[0].shape[0])

    def embed(self, texts):
        np = self.np
        encoded = self.tokenizer.encode_batch([t if t.strip() else '.' for t in texts])
        feed = {'input_ids': np.array([e.ids for e in encoded], dtype=np.int64),
                'attention_mask': np.array([e.attention_mask for e in encoded], dtype=np.int64)}
        if 'token_type_ids' in self.inputs: feed['token_type_ids'] = np.zeros_like(feed['input_ids'])
        feed = {k: v for k, v in feed.items() if k in self.inputs}
        if self.pooled:
            vectors = self.session.run([self.pooled], feed)[0]
        else:
            vectors = self.session.run([self.hidden], feed)[0][:, 0, :]
        vectors = vectors.astype(np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True); norms[norms == 0] = 1
        return vectors / norms


def valid_request(message):
    texts = message.get('texts') if isinstance(message, dict) else None
    return (message.get('type') == 'embed' and isinstance(message.get('id'), int) and 0 <= message['id'] < 2**31
            and isinstance(texts, list) and 1 <= len(texts) <= MAX_TEXTS
            and all(isinstance(t, str) and len(t) <= MAX_CHARS for t in texts))


def serve(embedder, model_id, stdin=sys.stdin, stdout=sys.stdout):
    def send(value): stdout.write(json.dumps(value) + '\n'); stdout.flush()
    send({'type': 'ready', 'version': 1, 'dim': embedder.dim, 'model': model_id})
    for line in stdin:
        if len(line) > 80_000: send({'type': 'error'}); continue
        try:
            message = json.loads(line)
        except ValueError:
            send({'type': 'error'}); continue
        if isinstance(message, dict) and message.get('type') == 'stop': break
        if not valid_request(message): send({'type': 'error'}); continue
        vectors = embedder.embed(message['texts'])
        send({'type': 'vectors', 'id': message['id'], 'dim': embedder.dim,
              'data': base64.b64encode(vectors.astype('<f4').tobytes()).decode('ascii')})


def main():
    try:
        manifest = verify()
        base = ROOT / manifest['directory']
        embedder = Embedder(base / manifest['model'], base / manifest['tokenizer'])
    except Exception:
        sys.stdout.write(json.dumps({'type': 'error', 'reason': 'unavailable'}) + '\n'); sys.stdout.flush()
        return 1
    serve(embedder, manifest['id'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
