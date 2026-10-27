"""CPU-only speaker evidence adapter. No capture, persistence, or authorization.

Uses sherpa-onnx's public extractor API. Model and package attribution are in
 docs/SPEAKER-MODEL.json and docs/licenses. Construction is lazy: import does
not load the model. The caller must supervise this in a cancellable worker.
"""
from pathlib import Path
import hashlib
import time
import numpy as np

MODEL_NAME = 'wespeaker_en_voxceleb_resnet34_LM.onnx'
MODEL_SHA256 = 'e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012'
MODEL_BYTES = 26530550

class SpeakerExtractor:
    def __init__(self, root: Path):
        model_root = (root / 'data' / 'models').resolve()
        model = (model_root / 'speaker' / MODEL_NAME).resolve()
        if not model.is_relative_to(model_root) or model.stat().st_size != MODEL_BYTES:
            raise ValueError('Speaker model unavailable')
        with model.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != MODEL_SHA256:
                raise ValueError('Speaker model integrity failed')
        import sherpa_onnx
        start = time.perf_counter()
        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(model), num_threads=2, debug=False, provider='cpu')
        if not config.validate():
            raise ValueError('Speaker configuration unavailable')
        self.extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        self.load_ms = (time.perf_counter() - start) * 1000
        if self.extractor.dim != 256:
            raise ValueError('Unexpected speaker dimensions')

    def compute(self, samples: np.ndarray):
        # At most ten seconds; callers must additionally establish VAD quality.
        if not isinstance(samples, np.ndarray) or samples.dtype != np.float32 or samples.ndim != 1 or not 32000 <= samples.size <= 160000:
            raise ValueError('Expected two to ten seconds of mono 16 kHz float32 audio')
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) > 1 or np.sqrt(np.mean(samples.astype(np.float64) ** 2)) < 1e-5:
            raise ValueError('Unusable speaker audio')
        start = time.perf_counter()
        stream = self.extractor.create_stream()
        stream.accept_waveform(sample_rate=16000, waveform=np.ascontiguousarray(samples))
        stream.input_finished()
        if not self.extractor.is_ready(stream):
            raise ValueError('Insufficient speaker features')
        embedding = np.asarray(self.extractor.compute(stream), dtype=np.float32)
        norm = np.linalg.norm(embedding)
        if embedding.shape != (256,) or not np.isfinite(embedding).all() or not np.isfinite(norm) or norm < 1e-12:
            raise ValueError('Invalid speaker evidence')
        return {'embedding': (embedding / norm).tolist(), 'modelId': MODEL_SHA256,
                'speaker_id_ms': (time.perf_counter() - start) * 1000,
                'antiSpoof': 'unavailable', 'quality': 'insufficient'}
