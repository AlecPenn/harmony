"""Compare local speech-to-text engines on this PC: speed (after you stop talking) and accuracy.

Explicit, user-run benchmark. Generates short test sentences with the built-in Windows voice (no recordings
of anyone), then times each engine on CPU with the same thread budget the HARMONY speech worker uses.

Engines:
  whisper   current engine: faster-whisper base.en int8 from data/models/whisper-base.en (already installed)
  parakeet  NVIDIA Parakeet TDT 0.6B v2 (English), int8 ONNX via onnx-asr (MIT); model CC-BY-4.0.
            First run downloads ~650 MB from Hugging Face into data/models/stt-candidates.
  parakeet-ctc  NVIDIA Parakeet CTC 0.6B (English), int8 ONNX via onnx-asr (optional, another download).

Setup once (inside the HARMONY folder):
  .venv\\Scripts\\python -m pip install onnx-asr==0.12.0
Run:
  .venv\\Scripts\\python scripts\\benchmark-stt.py            (whisper and parakeet)
  .venv\\Scripts\\python scripts\\benchmark-stt.py --engines whisper,parakeet,parakeet-ctc
Results print as a table and are saved under data/stt-benchmarks/ (ignored by git).
"""
import argparse, json, os, re, subprocess, sys, tempfile, time, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SENTENCES = [
    'Harmony, what time is it?',
    'Remind me to pick up the kids at four thirty.',
    'What is the weather like tomorrow?',
    'Tell me a quick joke about computers.',
    'Can you turn the volume down a little?',
    'I need to call the plumber about the leak in unit twelve.',
]
THREADS = max(2, min(4, (os.cpu_count() or 4) // 2))  # Diagnostic budget; override with --threads.

def words(text):
    text = text.lower().replace('4:30', 'four thirty').replace('12', 'twelve')
    return re.sub(r"[^a-z0-9' ]+", ' ', text).split()

def wer(reference, hypothesis):
    r, h = words(reference), words(hypothesis)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))

def windows_voice_clips(folder):
    """Synthesize each sentence to 16 kHz mono WAV with System.Speech (built into Windows)."""
    clips = []
    for index, sentence in enumerate(SENTENCES):
        path = Path(folder) / f'clip{index}.wav'
        script = ("Add-Type -AssemblyName System.Speech;"
                  "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
                  "$f=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono);"
                  f"$s.SetOutputToWaveFile('{path}',$f);$s.Speak($env:HARMONY_STT_TEXT);$s.Dispose()")
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], check=True,
                       env={**os.environ, 'HARMONY_STT_TEXT': sentence}, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        clips.append((sentence, read_wav(path)))
    return clips

def read_wav(path):
    with wave.open(str(path), 'rb') as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit(f'{path.name} must be 16 kHz mono 16-bit')
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768

def load_whisper():
    from faster_whisper import WhisperModel
    model = WhisperModel(str(ROOT / 'data' / 'models' / 'whisper-base.en'), device='cpu', compute_type='int8',
                         cpu_threads=THREADS, local_files_only=True)
    def run(audio):
        segments, _ = model.transcribe(audio, language='en', beam_size=1, condition_on_previous_text=False,
                                       vad_filter=False, without_timestamps=True)
        return ''.join(s.text for s in segments).strip()
    return run

def load_onnx_asr(name, folder):
    try:
        import onnx_asr, onnxruntime as rt
    except ImportError:
        raise SystemExit('onnx-asr is not installed. Run: .venv\\Scripts\\python -m pip install onnx-asr==0.12.0')
    options = rt.SessionOptions(); options.intra_op_num_threads = THREADS; options.inter_op_num_threads = 1
    target = ROOT / 'data' / 'models' / 'stt-candidates' / folder
    if not (target / 'vocab.txt').exists():
        from huggingface_hub import snapshot_download
        repo = {'nemo-parakeet-tdt-0.6b-v2': 'istupakov/parakeet-tdt-0.6b-v2-onnx',
                'nemo-parakeet-ctc-0.6b': 'istupakov/parakeet-ctc-0.6b-onnx'}[name]
        print(f'Downloading {repo} (int8 files only, one time)...', flush=True)
        snapshot_download(repo, local_dir=target, allow_patterns=['*.int8.onnx', '*.json', '*.txt', '*.yaml'])
    model = onnx_asr.load_model(name, str(target), quantization='int8', sess_options=options, providers=['CPUExecutionProvider'])
    return lambda audio: str(model.recognize(audio, sample_rate=16000)).strip()

ENGINES = {
    'whisper': ('Whisper base.en (current)', load_whisper),
    'parakeet': ('Parakeet TDT 0.6B v2 int8', lambda: load_onnx_asr('nemo-parakeet-tdt-0.6b-v2', 'parakeet-tdt-0.6b-v2')),
    'parakeet-ctc': ('Parakeet CTC 0.6B int8', lambda: load_onnx_asr('nemo-parakeet-ctc-0.6b', 'parakeet-ctc-0.6b')),
}

def main():
    parser = argparse.ArgumentParser(description='Benchmark local speech-to-text engines.')
    parser.add_argument('--engines', default='whisper,parakeet')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--threads', type=int, help='CPU threads per engine (conversation mode uses all but one).')
    parser.add_argument('--wav-dir', help='Use your own 16 kHz mono WAV files instead (name.wav + name.txt with the words).')
    args = parser.parse_args()
    global THREADS
    if args.threads is not None:
        if not 1 <= args.threads <= 16: raise SystemExit('--threads must be 1-16')
        THREADS = args.threads
    names = [n.strip() for n in args.engines.split(',') if n.strip()]
    if not names or any(n not in ENGINES for n in names) or not 1 <= args.runs <= 10:
        raise SystemExit(f'Choose engines from {", ".join(ENGINES)} and 1-10 runs.')
    if args.wav_dir:
        folder = Path(args.wav_dir)
        clips = [(p.with_suffix('.txt').read_text(encoding='utf-8').strip(), read_wav(p)) for p in sorted(folder.glob('*.wav'))]
    else:
        with tempfile.TemporaryDirectory() as folder:
            print('Creating test sentences with the Windows voice...', flush=True)
            clips = windows_voice_clips(folder)
    if not clips: raise SystemExit('No test clips.')
    print(f'{len(clips)} clips, {sum(len(a) for _, a in clips) / 16000:.1f} s of speech, {THREADS} CPU threads\n', flush=True)
    results = []
    for name in names:
        label, loader = ENGINES[name]
        started = time.perf_counter(); run = loader(); load_ms = (time.perf_counter() - started) * 1000
        run(clips[0][1])  # Warm-up, excluded from timing.
        times, errors, samples = [], [], []
        for _ in range(args.runs):
            for reference, audio in clips:
                t = time.perf_counter(); text = run(audio); ms = (time.perf_counter() - t) * 1000
                times.append(ms); errors.append(wer(reference, text)); samples.append((reference, text))
        times.sort()
        row = {'engine': name, 'label': label, 'load_ms': round(load_ms), 'median_ms': round(times[len(times) // 2]),
               'worst_ms': round(times[-1]), 'word_error_rate': round(sum(errors) / len(errors), 3),
               'examples': [{'said': r, 'heard': h} for r, h in samples[:len(clips)]]}
        results.append(row)
        print(f"{label}: median {row['median_ms']} ms · worst {row['worst_ms']} ms · word errors {row['word_error_rate']:.0%} · load {row['load_ms']} ms", flush=True)
        for example in row['examples'][:3]: print(f"   said: {example['said']}\n   heard: {example['heard']}")
    out = ROOT / 'data' / 'stt-benchmarks'; out.mkdir(parents=True, exist_ok=True)
    file = out / f'stt-{int(time.time())}.json'
    file.write_text(json.dumps({'threads': THREADS, 'clips': len(clips), 'runs': args.runs, 'results': results,
                                'note': 'Windows synthetic voice; real voices and microphones will differ.'}, indent=1), encoding='utf-8')
    print(f'\nSaved {file}')

if __name__ == '__main__':
    main()
