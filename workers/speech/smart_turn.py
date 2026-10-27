"""End-of-turn detection with Smart Turn v3 (pipecat-ai/smart-turn, BSD-2-Clause, Copyright (c) 2024-2025 Daily; see
docs/licenses/Smart-Turn-BSD-2.txt). A small Whisper-Tiny-based classifier hears how a phrase ended (pitch, pace,
grammar) and says whether the speaker has finished. HARMONY asks it only during a pause, so a mid-sentence "um..." no
longer ends the turn, and a clearly finished question is answered without waiting out the full silence.

The features match the reference inference.py exactly (Whisper's 80-bin log-mel of the last 8 s, zero-padded at the
start, waveform normalised), computed here with numpy alone so no extra libraries are needed.
"""
import time
import numpy as np

RATE = 16000
SECONDS = 8
SAMPLES = RATE * SECONDS
N_FFT, HOP, MELS = 400, 160, 80


def mel_filters(sr=RATE, n_fft=N_FFT, n_mels=MELS):
    """Slaney-style mel filter bank (the same one Whisper and librosa use)."""
    fftfreqs = np.fft.rfftfreq(n=n_fft, d=1.0 / sr)
    mels = np.linspace(0.0, 45.245640471924965, n_mels + 2)
    f_sp = 200.0 / 3
    freqs = f_sp * mels
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    log_t = mels >= min_log_mel
    freqs[log_t] = min_log_hz * np.exp(logstep * (mels[log_t] - min_log_mel))
    fdiff = np.diff(freqs)
    ramps = freqs.reshape(-1, 1) - fftfreqs.reshape(1, -1)
    lower = -ramps[:-2] / fdiff[:-1, None]
    upper = ramps[2:] / fdiff[1:, None]
    weights = np.maximum(0.0, np.minimum(lower, upper))
    weights *= (2.0 / (freqs[2:n_mels + 2] - freqs[:n_mels]))[:, None]
    return weights.astype(np.float32)


_FILTERS = mel_filters()
_WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)  # periodic Hann


def last_seconds(audio):
    """The last 8 s of audio, zero-padded at the start when shorter (as in the reference)."""
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    if audio.size >= SAMPLES:
        return audio[-SAMPLES:]
    return np.concatenate([np.zeros(SAMPLES - audio.size, np.float32), audio])


def features(audio):
    """(1, 80, 800) float32 input for the model."""
    x = last_seconds(audio).astype(np.float64)
    x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)
    padded = np.pad(x, N_FFT // 2, mode='reflect')
    count = 1 + (padded.size - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(count)[:, None]
    spec = np.abs(np.fft.rfft(padded[idx] * _WINDOW, axis=1)) ** 2
    mel = _FILTERS.astype(np.float64) @ spec.T
    log = np.log10(np.maximum(mel, 1e-10))[:, :-1]
    log = np.maximum(log, log.max() - 8.0)
    log = (log + 4.0) / 4.0
    return log[None].astype(np.float32)


class SmartTurn:
    """Loads the model once on the CPU and answers probability(audio) -> 0..1 that the turn is complete. On Alec's PC
    (4 threads) the full-precision file is faster than the 8-bit one: 136 ms vs 182 ms with 2 threads."""

    def __init__(self, path, threads=2):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        so.inter_op_num_threads = 1
        so.intra_op_num_threads = threads
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.log_severity_level = 3
        self.session = ort.InferenceSession(str(path), sess_options=so, providers=['CPUExecutionProvider'])
        self.input = self.session.get_inputs()[0].name
        self.last_ms = None

    def probability(self, audio):
        t0 = time.perf_counter()
        out = self.session.run(None, {self.input: features(audio)})
        self.last_ms = round((time.perf_counter() - t0) * 1000, 1)
        return float(np.asarray(out[0]).reshape(-1)[0])


class TurnJudge:
    """Asks the model on its own thread, so the audio loop never waits. ask() hands over a snapshot of the turn so far
    (a newer one replaces any not yet started) and returns its number; verdict(number) is the probability once it's
    ready, else None."""

    def __init__(self, model, stats_path=None):
        import queue, threading
        self.model = model
        self.stats_path = stats_path
        self.saved_at = 0.0
        self.jobs = queue.Queue(maxsize=1)
        self.lock = threading.Lock()
        self.asked = 0
        self.results = {}
        self.stats = {'judged': 0, 'complete': 0, 'held': 0, 'resumed': 0, 'held_to_end': 0, 'late': 0, 'ms': []}
        threading.Thread(target=self._run, daemon=True).start()

    def ask(self, audio):
        import queue
        with self.lock:
            self.asked += 1
            number = self.asked
        try:
            old = self.jobs.get_nowait()
            old[1].fill(0)
        except queue.Empty:
            pass
        try:
            self.jobs.put_nowait((number, audio))
        except queue.Full:
            audio.fill(0)
        return number

    def verdict(self, number):
        with self.lock:
            return self.results.get(number)

    def _run(self):
        while True:
            number, audio = self.jobs.get()
            try:
                p = self.model.probability(audio)
            except Exception:
                p = 1.0  # if the model fails, behave exactly as before (end on silence)
            finally:
                audio.fill(0)
            with self.lock:
                self.results = {k: v for k, v in self.results.items() if k > number - 4}
                self.results[number] = p
                self.stats['judged'] += 1
                if self.model.last_ms is not None:
                    self.stats['ms'] = (self.stats['ms'] + [self.model.last_ms])[-50:]

    def count(self, what):
        with self.lock:
            self.stats[what] = self.stats.get(what, 0) + 1

    def save(self):
        """Counts for the speed scoreboard (.runtime/turn-stats.json), at most every 5 s. Numbers only, never audio."""
        if not self.stats_path or time.monotonic() - self.saved_at < 5:
            return
        self.saved_at = time.monotonic()
        try:
            import json, os
            tmp = str(self.stats_path) + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({**self.summary(), 'at': time.strftime('%Y-%m-%d %H:%M:%S')}, f)
            os.replace(tmp, self.stats_path)
        except Exception:
            pass

    def summary(self):
        with self.lock:
            ms = sorted(self.stats['ms'])
            out = {k: v for k, v in self.stats.items() if k != 'ms'}
            out['median_ms'] = ms[len(ms) // 2] if ms else None
            return out
