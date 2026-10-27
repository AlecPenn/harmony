"""Make a CPU-friendly copy of the installed Parakeet encoder (explicit, one-time; nothing is downloaded).

ONNX Runtime has no fast CPU kernel for ConvInteger, the 8-bit convolution in the int8 Parakeet encoder. This
rewrites each ConvInteger as Cast + (subtract zero point) + an ordinary float Conv over the *same* integer values,
so it computes the same products with fast float kernels. Weights are unchanged, so transcripts are identical.
Measured on Alec's Xeon E5-1607 v2 (AVX, no AVX2): 560 -> 480 ms per second of audio, identical text on real clips.
(MatMulInteger is left as is: converting it too needs ~2.4 GB of RAM for little expected gain.)

Usage (needs the `onnx` package):  python scripts/optimize-parakeet.py
Writes data/models/stt-candidates/parakeet-tdt-0.6b-v2-fastconv and pins it in docs/STT-PARAKEET-FASTCONV.json.
The speech worker uses it only while those hashes match; otherwise the original. Parakeet is CC-BY-4.0 (NVIDIA).
"""
import hashlib, json, shutil, sys
from pathlib import Path
import numpy as np, onnx
from onnx import helper, numpy_helper, TensorProto

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data' / 'models' / 'stt-candidates' / 'parakeet-tdt-0.6b-v2'
DST = ROOT / 'data' / 'models' / 'stt-candidates' / 'parakeet-tdt-0.6b-v2-fastconv'
ENC = 'encoder-model.int8.onnx'

def convert(src: Path, dst: Path, ops=('ConvInteger',)) -> int:
    m = onnx.load(str(src)); g = m.graph
    init = {i.name: i for i in g.initializer}
    nodes, extra, k = [], [], 0
    for n in g.node:
        if n.op_type not in ops or n.input[1] not in init:
            nodes.append(n); continue
        k += 1
        x, w = n.input[0], n.input[1]
        xzp = n.input[2] if len(n.input) > 2 and n.input[2] else None
        wzp = n.input[3] if len(n.input) > 3 and n.input[3] else None
        W = numpy_helper.to_array(init[w]).astype(np.float32)
        if wzp:
            z = numpy_helper.to_array(init[wzp]).astype(np.float32)
            if z.ndim == 1 and z.size > 1:
                W = W - (z.reshape(-1, *([1] * (W.ndim - 1))) if n.op_type == 'ConvInteger' else z.reshape(1, -1))
            else:
                W = W - z.reshape(())
        wn = f'{w}__f32'; extra.append(numpy_helper.from_array(W, wn))
        xf = f'{x}__f{k}'; nodes.append(helper.make_node('Cast', [x], [xf], to=TensorProto.FLOAT))
        if xzp:
            zf, xs = f'{xzp}__f{k}', f'{x}__c{k}'
            nodes += [helper.make_node('Cast', [xzp], [zf], to=TensorProto.FLOAT), helper.make_node('Sub', [xf, zf], [xs])]; xf = xs
        op = 'Conv' if n.op_type == 'ConvInteger' else 'MatMul'
        nodes.append(helper.make_node(op, [xf, wn], list(n.output), name=(n.name or op) + '__f32',
                                      **{a.name: helper.get_attribute_value(a) for a in n.attribute}))
    del g.node[:]; g.node.extend(nodes); g.initializer.extend(extra)
    for vi in list(g.value_info):  # outputs are now float; drop stale int32 annotations
        if vi.type.tensor_type.elem_type == TensorProto.INT32: g.value_info.remove(vi)
    used = {i for nd in g.node for i in nd.input}
    keep = [i for i in g.initializer if i.name in used]; del g.initializer[:]; g.initializer.extend(keep)
    dst.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(dst), save_as_external_data=True, all_tensors_to_one_file=True, location=dst.name + '.data')
    return k

def main() -> int:
    if not (SRC / ENC).exists(): print('Parakeet is not installed (data/models/stt-candidates/parakeet-tdt-0.6b-v2).'); return 1
    DST.mkdir(parents=True, exist_ok=True)
    for name in ('config.json', 'vocab.txt', 'decoder_joint-model.int8.onnx'): shutil.copyfile(SRC / name, DST / name)
    k = convert(SRC / ENC, DST / ENC)
    files = []
    for p in sorted(DST.iterdir()):
        h = hashlib.sha256()
        with p.open('rb') as f:
            while b := f.read(1 << 20): h.update(b)
        files.append({'path': p.relative_to(ROOT).as_posix(), 'bytes': p.stat().st_size, 'sha256': h.hexdigest()})
    (ROOT / 'docs' / 'STT-PARAKEET-FASTCONV.json').write_text(json.dumps({
        'description': 'CPU-optimised copy of Parakeet TDT 0.6B v2 int8 made by scripts/optimize-parakeet.py from the files pinned in STT-PARAKEET.json: ConvInteger rewritten as float Conv over identical integer values.',
        'attribution': 'Parakeet TDT 0.6B v2 by NVIDIA, licensed CC-BY-4.0; ONNX conversion by istupakov; modified by HARMONY (convolution rewrite).',
        'files': files}, indent=1) + '\n')
    print(f'Rewrote {k} integer convolutions. Pinned {len(files)} files in docs/STT-PARAKEET-FASTCONV.json.')
    return 0

if __name__ == '__main__': sys.exit(main())
