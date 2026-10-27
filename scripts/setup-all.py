"""Set up HARMONY on a new PC (Windows): the Python environments, hearing, wake word, end-of-turn model and voice.
Run by "Set up HARMONY.cmd" (or: py -3 scripts/setup-all.py). Safe to run again: finished steps are skipped or checked.
Every model download is checked against a hash pinned in docs/. The brain is separate: "Set up local brain.cmd".
Needs Python 3.13 from python.org, installed with the "py" launcher (3.12 is used for the voice if present)."""
import os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WIN = os.name == 'nt'
def venv_python(name): return ROOT / name / ('Scripts/python.exe' if WIN else 'bin/python')

def run(args, what):
    print(f'\n== {what}', flush=True)
    result = subprocess.run([str(a) for a in args], cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f'\nStopped: {what} failed (exit {result.returncode}). Fix the message above, then run this again.')

def python_for(version):
    """The interpreter for a Python version, through the py launcher on Windows."""
    try:
        out = subprocess.run(['py', f'-{version}', '-c', 'import sys;print(sys.executable)'], capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip(): return out.stdout.strip()
    except FileNotFoundError:
        pass
    return None

def make_venv(name, versions, packages_args, what):
    """versions: acceptable Python versions, preferred first (the voice's Piper engine runs on 3.12 or 3.13)."""
    py = venv_python(name)
    if not py.exists():
        found = next(((v, b) for v in versions if (b := python_for(v))), None)
        if not found:
            raise SystemExit(f'\nStopped: Python {" or ".join(versions)} is needed for {what}. Install it from '
                             'https://www.python.org/downloads/windows/ (tick "py launcher"), then run this again.')
        version, base = found
        run([base, '-m', 'venv', ROOT / name], f'Creating the {what} environment (Python {version})')
    run([py, '-m', 'pip', 'install', '--disable-pip-version-check', '-q', *packages_args], f'Installing the {what} packages')
    return py

def main():
    print('Setting up HARMONY. This downloads about 1.5 GB the first time.')
    hearing = make_venv('.venv', ['3.13'], ['-r', ROOT / 'workers/speech/requirements.lock.txt'], 'hearing')
    run([hearing, '-I', ROOT / 'scripts/setup-speech.py'], 'Hearing models: voice detector and Whisper')
    if not (ROOT / 'data/models/vosk-model-small-en-us-0.15').exists():
        run([hearing, '-I', ROOT / 'scripts/setup-wake.py'], 'Wake word and "stop" listener (Vosk)')
    run([hearing, '-I', ROOT / 'scripts/setup-smart-turn.py'], 'End-of-turn model (Smart Turn)')
    voice = make_venv('.venv-kokoro', ['3.12', '3.13'], ['numpy==2.5.4', 'onnxruntime==1.22.1'], 'voice')
    if not (ROOT / '.runtime/piper/piper/__init__.py').exists():
        run([voice, '-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--no-deps', '--require-hashes',
             '--target', ROOT / '.runtime/piper', '-r', ROOT / 'workers/voice/piper.lock.txt'], 'Voice engine (Piper)')
    run([hearing, '-I', ROOT / 'scripts/provision-piper.py'], 'Voice (Piper "Alba")')
    print('\nDone. Next: "Set up local brain.cmd" (about 3 GB), then "Launch HARMONY.cmd".'
          '\nOptional: "Set up security.cmd", "Set up God\'s Eye.cmd", "Set up memory search.cmd".')

if __name__ == '__main__':
    main()
