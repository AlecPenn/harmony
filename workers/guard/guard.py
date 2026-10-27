"""HARMONY guard: voice and face evidence, entirely on this PC.

Turns a short stretch of microphone audio into a voice print, and a camera frame into a face print plus a
liveness score. Nothing here stores audio, images or prints; it only computes numbers and hands them back.
Matching, storage (encrypted, randomly projected) and every decision live in core/guardian.ts.

Models (pinned in docs/GUARD-MODELS.json, installed by scripts/setup-guard.py, never downloaded at run time):
  voice  WeSpeaker ResNet34-LM (CC-BY-4.0) through sherpa-onnx (Apache-2.0)
  face   OpenCV Zoo YuNet detector (MIT) and SFace recognizer (Apache-2.0) through OpenCV
  live   MiniFASNetV2-SE anti-spoofing, quantized (Apache-2.0, suriAI/face-antispoof-onnx)
"""
from pathlib import Path
import hashlib, json, os

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'docs' / 'GUARD-MODELS.json'
VERIFIED = ROOT / 'data' / 'models' / '.verified-guard.json'
RATE = 16000
MIN_VOICE = int(RATE * .8)     # shorter than this says too little about a voice
MAX_VOICE = RATE * 8           # the last 8 seconds are plenty


def _digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1 << 20):
            h.update(block)
    return h.hexdigest()


def model_path(name, manifest=MANIFEST, root=ROOT, cache=VERIFIED):
    """The verified path of one pinned model, or None if it isn't installed (or doesn't match its pin)."""
    try:
        entry = json.loads(manifest.read_text(encoding='utf-8-sig'))['models'][name]
    except (OSError, KeyError, ValueError):
        return None
    models = (root / 'data' / 'models').resolve()
    path = (root / entry['path']).resolve()
    if not path.is_relative_to(models) or not path.is_file() or path.stat().st_size != entry['bytes']:
        return None
    key = f"{entry['path']}:{path.stat().st_size}:{int(path.stat().st_mtime)}"
    try:
        known = json.loads(cache.read_text())
    except (OSError, ValueError):
        known = {}
    if known.get(key) != entry['sha256']:
        if _digest(path) != entry['sha256']:
            return None
        known[key] = entry['sha256']
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            tmp = cache.with_suffix('.tmp'); tmp.write_text(json.dumps(known)); os.replace(tmp, cache)
        except OSError:
            pass
    return path


class VoicePrint:
    """256 numbers that describe how a voice sounds (not what was said). Loads on first use."""

    def __init__(self, path):
        import sherpa_onnx
        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(path), num_threads=1, debug=False, provider='cpu')
        if not config.validate():
            raise ValueError('Voice model unavailable')
        self.extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        if self.extractor.dim != 256:
            raise ValueError('Unexpected voice model')

    @classmethod
    def load(cls):
        path = model_path('voice')
        return cls(path) if path else None

    def embed(self, samples):
        """samples: mono 16 kHz float32 in [-1, 1]. Returns a unit vector (numpy float32) or None if unusable."""
        import numpy as np
        if samples.size < MIN_VOICE:
            return None
        samples = np.ascontiguousarray(samples[-MAX_VOICE:], dtype=np.float32)
        if not np.isfinite(samples).all():
            return None
        rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
        if rms < 3e-4:          # silence or a dead mic
            return None
        stream = self.extractor.create_stream()
        stream.accept_waveform(sample_rate=RATE, waveform=samples)
        stream.input_finished()
        if not self.extractor.is_ready(stream):
            return None
        v = np.asarray(self.extractor.compute(stream), dtype=np.float32)
        n = float(np.linalg.norm(v))
        if v.shape != (256,) or not np.isfinite(v).all() or n < 1e-9:
            return None
        return v / n


class FaceEngine:
    """Finds faces in a frame, describes the main one (128 numbers), and scores whether it is a live face
    rather than a photo or a screen. Also reports how many faces are looking (for the privacy veil)."""

    def __init__(self, detector, recognizer, liveness):
        import cv2
        import onnxruntime as ort
        self.cv2 = cv2
        self.detector = cv2.FaceDetectorYN.create(str(detector), '', (320, 320), 0.8, 0.3, 20)
        self.recognizer = cv2.FaceRecognizerSF.create(str(recognizer), '')
        options = ort.SessionOptions(); options.intra_op_num_threads = 1; options.inter_op_num_threads = 1
        self.live = ort.InferenceSession(str(liveness), options, providers=['CPUExecutionProvider'])
        self.live_input = self.live.get_inputs()[0].name

    @classmethod
    def load(cls):
        paths = [model_path(n) for n in ('face_detector', 'face_recognizer', 'face_liveness')]
        return cls(*paths) if all(paths) else None

    def _liveness(self, rgb, box):
        """MiniFASNet: square crop 1.5x the face box, letterboxed to 128, RGB in [0, 1]. Returns real minus spoof logit."""
        import numpy as np
        cv2 = self.cv2
        h_img, w_img = rgb.shape[:2]
        x, y, w, h = box
        side = max(w, h); cx, cy = x + w / 2, y + h / 2
        size = int(side * 1.5); x0 = int(cx - size / 2); y0 = int(cy - size / 2)
        crop = rgb[max(0, y0):min(h_img, y0 + size), max(0, x0):min(w_img, x0 + size)]
        if crop.size == 0:
            return None
        crop = cv2.copyMakeBorder(crop, max(0, -y0), max(0, y0 + size - h_img), max(0, -x0), max(0, x0 + size - w_img), cv2.BORDER_REFLECT_101)
        ratio = 128 / max(crop.shape[:2])
        scaled = (int(crop.shape[0] * ratio), int(crop.shape[1] * ratio))
        crop = cv2.resize(crop, (scaled[1], scaled[0]), interpolation=cv2.INTER_LANCZOS4 if ratio > 1 else cv2.INTER_AREA)
        dh, dw = 128 - scaled[0], 128 - scaled[1]
        crop = cv2.copyMakeBorder(crop, dh // 2, dh - dh // 2, dw // 2, dw - dw // 2, cv2.BORDER_REFLECT_101)
        x = (crop.transpose(2, 0, 1).astype(np.float32) / 255.0)[None]
        logits = self.live.run(None, {self.live_input: x})[0][0]
        return float(logits[0] - logits[1])

    def describe(self, image):
        """image: BGR frame. Returns a dict; 'embedding' is a unit vector (numpy) or None when no usable face."""
        import numpy as np
        cv2 = self.cv2
        h, w = image.shape[:2]
        if not (64 <= w <= 4096 and 64 <= h <= 4096):
            return {'faces': 0, 'embedding': None, 'reason': 'bad frame'}
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(image)
        faces = [] if faces is None else [f for f in faces if f[14] >= 0.8]
        out = {'faces': len(faces), 'embedding': None, 'live': None, 'yaw': None, 'size': 0.0,
               'brightness': round(float(image.mean()) / 255, 3)}
        if not faces:
            out['reason'] = 'no face'
            return out
        face = max(faces, key=lambda f: f[2] * f[3])
        x, y, fw, fh = (float(v) for v in face[:4])
        out['size'] = round(fw / w, 3)
        out['box'] = [round(x / w, 3), round(y / h, 3), round(fw / w, 3), round(fh / h, 3)]
        # Landmarks: right eye, left eye, nose tip, right and left mouth corners. Nose offset from the eye midpoint,
        # in eye distances, says which way the head is turned (a flat photo can't turn).
        re, le, nose = face[4:6], face[6:8], face[8:10]
        eyes = float(np.hypot(*(le - re)))
        out['yaw'] = round(float((nose[0] - (re[0] + le[0]) / 2) / eyes), 3) if eyes > 1 else None
        if fw < 60 or fh < 60:
            out['reason'] = 'too far'
            return out
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        out['live'] = self._liveness(rgb, (x, y, fw, fh))
        aligned = self.recognizer.alignCrop(image, face)
        sharp = float(cv2.Laplacian(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
        out['sharpness'] = round(sharp, 1)
        if sharp < 15:
            out['reason'] = 'blurry'
            return out
        v = np.asarray(self.recognizer.feature(aligned), dtype=np.float32).reshape(-1)
        n = float(np.linalg.norm(v))
        if v.shape != (128,) or not np.isfinite(v).all() or n < 1e-9:
            out['reason'] = 'unusable'
            return out
        out['embedding'] = v / n
        return out


def palm_anchors():
    """MediaPipe palm-detector SSD anchors for a 192x192 input: 24x24 cells x2, then 12x12 cells x6 (2016 in all)."""
    import numpy as np
    out = []
    for cells, per in ((24, 2), (12, 6)):
        for y in range(cells):
            for x in range(cells):
                out += [((x + .5) / cells, (y + .5) / cells)] * per
    return np.array(out, dtype=np.float32)


class HandEngine:
    """Finds a hand and its 21 joints, for hand signs (an open palm, a wave, thumbs up or down).

    A port of OpenCV Zoo's MediaPipe palm detector and hand pose demos (Apache-2.0), run with onnxruntime. Returns
    joint positions as fractions of the frame; nothing about the image is kept."""
    PALM_IN, HAND_IN = 192, 224

    def __init__(self, palm, hand):
        import cv2
        import onnxruntime as ort
        self.cv2 = cv2
        options = ort.SessionOptions(); options.intra_op_num_threads = 1; options.inter_op_num_threads = 1
        self.palm = ort.InferenceSession(str(palm), options, providers=['CPUExecutionProvider'])
        self.hand = ort.InferenceSession(str(hand), options, providers=['CPUExecutionProvider'])
        self.anchors = palm_anchors()

    @classmethod
    def load(cls):
        paths = [model_path(n) for n in ('hand_palm', 'hand_pose')]
        return cls(*paths) if all(paths) else None

    def _palms(self, image, threshold=.6):
        import numpy as np
        cv2, n = self.cv2, self.PALM_IN
        h, w = image.shape[:2]
        ratio = min(n / h, n / w)
        rh, rw = int(h * ratio), int(w * ratio)
        left, top = (n - rw) // 2, (n - rh) // 2
        x = cv2.copyMakeBorder(cv2.resize(image, (rw, rh)), top, n - rh - top, left, n - rw - left, cv2.BORDER_CONSTANT, None, (0, 0, 0))
        x = cv2.cvtColor(x, cv2.COLOR_BGR2RGB).astype(np.float32)[None] / 255.0
        deltas, scores = self.palm.run(None, {'input_1': x})
        score = 1 / (1 + np.exp(-scores[0, :, 0].astype(np.float64)))
        keep = np.nonzero(score >= threshold)[0]
        if keep.size == 0:
            return []
        scale, bias = max(w, h), np.array([left, top]) / ratio
        d = deltas[0, keep]
        centre = d[:, :2] / n + self.anchors[keep]
        size = d[:, 2:4] / n
        boxes = np.c_[(centre - size / 2) * scale - bias, (centre + size / 2) * scale - bias]
        marks = (d[:, 4:].reshape(-1, 7, 2) / n + self.anchors[keep][:, None, :]) * scale - bias
        picked = cv2.dnn.NMSBoxes([[float(a), float(b), float(c - a), float(e - b)] for a, b, c, e in boxes], score[keep].tolist(), threshold, .3)
        return [(boxes[i], marks[i], float(score[keep][i])) for i in np.array(picked).reshape(-1)][:2]

    def _crop(self, image, box, shift, enlarge, rotation_pad):
        import numpy as np
        cv2 = self.cv2
        wh = box[1] - box[0]
        box = box + np.array(shift) * wh
        centre, half = box.sum(0) / 2, (box[1] - box[0]) * enlarge / 2
        box = np.array([centre - half, centre + half]).astype(np.int32)
        box[:, 0] = np.clip(box[:, 0], 0, image.shape[1]); box[:, 1] = np.clip(box[:, 1], 0, image.shape[0])
        crop = image[box[0][1]:box[1][1], box[0][0]:box[1][0]]
        side = int(np.linalg.norm(crop.shape[:2]) if rotation_pad else max(crop.shape[:2]))
        ph, pw = side - crop.shape[0], side - crop.shape[1]
        crop = cv2.copyMakeBorder(crop, ph // 2, ph - ph // 2, pw // 2, pw - pw // 2, cv2.BORDER_CONSTANT, None, (0, 0, 0))
        return crop, box, box[0] - [pw // 2, ph // 2]

    def _pose(self, image, box, marks, min_conf=.7):
        import numpy as np
        cv2, n = self.cv2, self.HAND_IN
        crop, wide, bias = self._crop(image, box.reshape(2, 2), [0, 0], 4, True)
        if crop.size == 0:
            return None
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        marks = marks - bias
        p1, p2 = marks[0], marks[2]
        radians = np.pi / 2 - np.arctan2(-(p2[1] - p1[1]), p2[0] - p1[0])
        radians -= 2 * np.pi * np.floor((radians + np.pi) / (2 * np.pi))
        angle = float(np.rad2deg(radians))
        centre = (wide - bias).sum(0) / 2
        matrix = cv2.getRotationMatrix2D((float(centre[0]), float(centre[1])), angle, 1.0)
        rotated = cv2.warpAffine(crop, matrix, (crop.shape[1], crop.shape[0]))
        turned = np.c_[marks, np.ones(len(marks))] @ matrix.T
        hand_crop, hand_box, _ = self._crop(rotated, np.array([turned.min(0), turned.max(0)]), [0, -.4], 3, False)
        if hand_crop.size == 0:
            return None
        x = cv2.resize(hand_crop, (n, n), interpolation=cv2.INTER_AREA).astype(np.float32)[None] / 255.0
        joints, conf, handed, _ = self.hand.run(None, {'input_1': x})
        conf = float(conf[0][0])
        if conf < min_conf:
            return None
        joints = joints[0].reshape(21, 3)[:, :2]
        span = hand_box[1] - hand_box[0]
        joints = (joints - n / 2) * (max(span) / n)
        back = cv2.getRotationMatrix2D((0, 0), angle, 1.0)
        joints = joints @ back[:, :2]
        r, t = matrix[:, :2].T, matrix[:, 2]
        centre = np.append(hand_box.sum(0) / 2, 1) @ np.c_[r, -r @ t].T
        return joints + centre + bias, float(handed[0][0]), conf

    def describe(self, image):
        """image: BGR frame. Up to two hands: 21 joints each as [x, y] fractions of the frame, which hand, confidence."""
        h, w = image.shape[:2]
        if not (64 <= w <= 4096 and 64 <= h <= 4096):
            return {'hands': [], 'reason': 'bad frame'}
        hands = []
        for box, marks, _ in self._palms(image):
            got = self._pose(image, box, marks)
            if got is None:
                continue
            joints, handed, conf = got
            hands.append({'joints': [[round(float(x) / w, 4), round(float(y) / h, 4)] for x, y in joints],
                          'right': handed > .5, 'conf': round(conf, 3)})
        return {'hands': hands, 'aspect': round(w / h, 4)}
