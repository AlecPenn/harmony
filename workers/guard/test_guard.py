import base64, json, runpy, subprocess, sys
from pathlib import Path
import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
guard = runpy.run_path(str(HERE / 'guard.py'))
speech = runpy.run_path(str(ROOT / 'workers' / 'speech' / 'worker.py'))
FACE = ROOT / 'data' / 'models' / 'guard'


def test_model_path_rejects_unpinned(tmp_path):
    (tmp_path / 'docs').mkdir(); (tmp_path / 'data' / 'models').mkdir(parents=True)
    model = tmp_path / 'data' / 'models' / 'm.onnx'; model.write_bytes(b'abc')
    manifest = tmp_path / 'docs' / 'G.json'
    manifest.write_text(json.dumps({'models': {'x': {'path': 'data/models/m.onnx', 'bytes': 3, 'sha256': '0' * 64}}}))
    assert guard['model_path']('x', manifest, tmp_path, tmp_path / 'c.json') is None
    import hashlib
    manifest.write_text(json.dumps({'models': {'x': {'path': 'data/models/m.onnx', 'bytes': 3, 'sha256': hashlib.sha256(b'abc').hexdigest()}}}))
    assert guard['model_path']('x', manifest, tmp_path, tmp_path / 'c.json') == model.resolve()
    # Outside the models folder is never accepted.
    manifest.write_text(json.dumps({'models': {'x': {'path': 'docs/G.json', 'bytes': 3, 'sha256': '0' * 64}}}))
    assert guard['model_path']('x', manifest, tmp_path, tmp_path / 'c.json') is None
    assert guard['model_path']('missing', manifest, tmp_path, tmp_path / 'c.json') is None


def test_voice_tap_copies_audio_and_reports_per_segment():
    out = []
    tap = speech['VoiceTap'](out.append)
    class Fake:
        def embed(self, a):
            assert a.size == 16000 and float(a[0]) == .5
            v = np.ones(256, dtype=np.float32); return v / np.linalg.norm(v)
    tap.model = Fake()
    audio = np.full(16000, .5, dtype=np.float32)
    tap.take(audio, 4); audio.fill(0)  # the caller zeroing its buffer must not affect the tap's copy
    import time
    for _ in range(50):
        if out: break
        time.sleep(.02)
    tap.close()
    assert out and out[0]['segment'] == 4 and len(base64.b64decode(out[0]['embedding'])) == 1024


def _worker():
    return subprocess.Popen([sys.executable, '-I', str(HERE / 'worker.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)


def _ask(p, m):
    p.stdin.write((json.dumps(m) + '\n').encode()); p.stdin.flush()
    return json.loads(p.stdout.readline())


def test_worker_rejects_bad_requests():
    p = _worker()
    try:
        ready = json.loads(p.stdout.readline()); assert ready['type'] == 'ready'
        assert _ask(p, {'type': 'voice', 'id': 1, 'pcm': base64.b64encode(b'\0' * 100).decode()})['embedding'] is None
        assert _ask(p, {'type': 'nope', 'id': 2})['type'] == 'error'
        assert _ask(p, {'type': 'face', 'id': -1, 'jpeg': ''})['type'] == 'error'
    finally:
        p.stdin.write(b'{"type":"stop"}\n'); p.stdin.flush(); p.wait(10)


@pytest.mark.skipif(not (FACE / 'face_recognition_sface_2021dec.onnx').exists(), reason='face models not installed')
def test_face_engine_same_face_matches_and_is_live():
    import cv2
    engine = guard['FaceEngine'].load()
    assert engine is not None
    # A synthetic face isn't detected; the engine must say so rather than invent a print.
    blank = np.full((480, 640, 3), 127, dtype=np.uint8)
    assert engine.describe(blank)['embedding'] is None
    sample = ROOT / 'data' / 'models' / 'guard' / 'test-face.jpg'
    if not sample.exists():
        pytest.skip('no sample face image')
    img = cv2.imread(str(sample))
    a, b = engine.describe(img), engine.describe(cv2.convertScaleAbs(img, alpha=1.1, beta=10))
    assert a['faces'] == 1 and a['embedding'] is not None and a['live'] > 0
    assert float(a['embedding'] @ b['embedding']) > .8


def test_palm_anchors_match_mediapipe():
    a = guard['palm_anchors']()
    assert a.shape == (2016, 2)
    assert np.allclose(a[0], [1 / 48, 1 / 48]) and np.allclose(a[1], a[0]) and np.allclose(a[2], [3 / 48, 1 / 48])
    assert np.allclose(a[1152], [1 / 24, 1 / 24]) and np.allclose(a[-1], [23 / 24, 23 / 24])


@pytest.mark.skipif(not (guard['model_path']('hand_palm') and guard['model_path']('hand_pose')), reason='hand models not installed')
def test_hands_worker_reads_frames_and_finds_nothing_in_an_empty_one():
    import cv2
    ok, jpeg = cv2.imencode('.jpg', np.full((360, 480, 3), 90, np.uint8))
    child = subprocess.run([sys.executable, '-I', str(HERE / 'worker.py')], input=(json.dumps({'type': 'hands', 'id': 1, 'jpeg': base64.b64encode(jpeg.tobytes()).decode()}) + '\n' + json.dumps({'type': 'hands', 'id': 2, 'jpeg': 'bm90IGFuIGltYWdl'}) + '\n{"type":"stop"}\n').encode(), capture_output=True, timeout=60)
    lines = [json.loads(l) for l in child.stdout.decode().splitlines()]
    assert lines[0]['type'] == 'ready' and lines[0]['hands'] is True
    assert lines[1] == {'type': 'hands', 'id': 1, 'hands': [], 'aspect': 1.3333}
    assert lines[2]['hands'] == [] and lines[2]['reason'] == 'Unreadable image'
