"""Explicit, user-run setup for HARMONY's free local brain. Never called automatically by the app.

Downloads a pinned llama.cpp Windows build and a pinned GGUF model, verifies every file against its
published SHA-256 and size, extracts the engine safely and writes .runtime/local-model/installed.json.
Re-running verifies existing files instead of downloading again. Standard library only.

Usage:  py -3 scripts/provision-local-model.py [--engine cuda|vulkan|cpu] [--model iq4_xs|q4_k_m] [--check]
"""
import argparse, hashlib, http.client, json, os, shutil, sys, time, urllib.error, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / '.runtime' / 'local-model'
BUILD = 'b11715'  # llama.cpp release, 2026-10-17. Hashes are GitHub's published asset digests.
RELEASE = f'https://github.com/ggml-org/llama.cpp/releases/download/{BUILD}/'
ENGINES = {
    # GTX 1650 (Turing, sm_75) is supported by the CUDA 12.4 build; needs a reasonably recent NVIDIA driver.
    'cuda': ('cuda-12.4', [
        (f'llama-{BUILD}-bin-win-cuda-12.4-x64.zip', 267472336, 'c96ae547b46096e810b19cd81139a63cf6536db2e55415d1794b019a5b68a4a0'),
        ('cudart-llama-bin-win-cuda-12.4-x64.zip', 391443627, '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'),
    ]),
    # Smaller download, works on most GPU drivers; usually somewhat slower than CUDA on NVIDIA cards.
    'vulkan': ('vulkan', [(f'llama-{BUILD}-bin-win-vulkan-x64.zip', 32307196, '940f0e8a9eef6cd8911779ccb78d7c69c48c77dfa88fabd528f97e19a918ae43')]),
    'cpu': ('cpu', [(f'llama-{BUILD}-bin-win-cpu-x64.zip', 19662498, 'd50ea1fc9283c3dc9d9aba160b88f722628d42eede09556447663e8833a43327')]),
}
MODEL_REPO = 'unsloth/Qwen3.5-4B-GGUF'
MODEL_REV = 'e87f176479d0855a907a41277aca2f8ee7a09523'
MODELS = {
    # ~2.5 GB: leaves headroom on a 4 GB card for context and the runtime. Default.
    'iq4_xs': ('qwen3.5-4b-iq4_xs', 'Qwen3.5 4B (IQ4_XS)', 'Qwen3.5-4B-IQ4_XS.gguf', 2477053088, '658a9e7e406deb06d0179755e3c14f6a82915a4be4962a2f92a64d948d2e572f'),
    # ~2.7 GB: slightly higher quality, tighter fit on 4 GB.
    'q4_k_m': ('qwen3.5-4b-q4_k_m', 'Qwen3.5 4B (Q4_K_M)', 'Qwen3.5-4B-Q4_K_M.gguf', 2740937888, '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'),
}

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        while block := handle.read(4 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()

def verify(path: Path, size: int, expected: str) -> None:
    if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
        raise SystemExit(f'Size check failed for {path.name}. Delete it and run setup again.')
    if sha256(path) != expected:
        raise SystemExit(f'Integrity check failed for {path.name}. Delete it and run setup again.')

def adopt_browser_download(target: Path, size: int) -> None:
    """If the user downloaded the file in their browser, move it into place (it is still verified)."""
    candidate = Path.home() / 'Downloads' / target.name
    if not target.exists() and candidate.is_file() and candidate.stat().st_size == size:
        print(f'Found {target.name} in your Downloads folder; moving it into place.')
        shutil.move(str(candidate), str(target))

def download(url: str, target: Path, size: int, expected: str) -> None:
    adopt_browser_download(target, size)
    if target.exists():
        print(f'Verifying {target.name}...'); verify(target, size, expected); return
    # Keep partial data between attempts and runs; resume with an HTTP Range request.
    partial = target.with_name(target.name + '.part')
    print(f'Downloading {target.name} ({size / 1e9:.2f} GB). You can close this and rerun later; it resumes.')
    attempts = 0
    while True:
        have = partial.stat().st_size if partial.exists() else 0
        if have > size: partial.unlink(); have = 0
        if have == size: break
        headers = {'User-Agent': 'HARMONY-local-setup'}
        if have: headers['Range'] = f'bytes={have}-'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as response:
                if have and response.status != 206: have = 0  # Server ignored the resume; start over.
                with partial.open('ab' if have else 'wb') as out:
                    received = have
                    while block := response.read(256 * 1024):
                        received += len(block)
                        if received > size: raise SystemExit(f'{target.name} is larger than expected; refusing it.')
                        out.write(block)
                        print(f'\r  {received * 100 // size:3d}%  ({received / 1e9:.2f} of {size / 1e9:.2f} GB)', end='', flush=True)
            attempts = 0
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, OSError) as error:
            attempts += 1
            if attempts > 12: raise SystemExit(f'\nDownload keeps failing ({type(error).__name__}). Run setup again later; it will resume.')
            wait = min(60, 2 ** attempts)
            print(f'\n  Connection problem ({type(error).__name__}); retrying in {wait}s (attempt {attempts} of 12)...')
            time.sleep(wait)
    print()
    verify(partial, size, expected); partial.replace(target)

def extract(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            name = member.filename.replace('\\', '/')
            target = (destination / name).resolve()
            if name.startswith('/') or '..' in Path(name).parts or not str(target).startswith(str(destination.resolve()) + os.sep):
                raise SystemExit('Engine archive contains an unsafe path; refusing it.')
            if member.is_dir(): target.mkdir(parents=True, exist_ok=True); continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(member) as source, target.open('wb') as out: shutil.copyfileobj(source, out)

def keep_awake() -> None:
    """Ask Windows not to sleep while setup runs (the display may still turn off). Released when setup exits."""
    if os.name != 'nt': return
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        if ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED):
            print('Keeping this PC awake until setup finishes. You can walk away.')
    except Exception:
        print('Could not stop sleep automatically; set Sleep to "Never" while this runs.')

def main() -> None:
    parser = argparse.ArgumentParser(description='Set up HARMONY\'s free local brain.')
    parser.add_argument('--engine', choices=sorted(ENGINES), default='cuda')
    parser.add_argument('--model', choices=sorted(MODELS), default='iq4_xs')
    parser.add_argument('--check', action='store_true', help='Only verify an existing installation.')
    args = parser.parse_args()
    variant, archives = ENGINES[args.engine]
    model_id, model_name, model_file, model_size, model_hash = MODELS[args.model]
    downloads, models = ROOT / 'downloads', ROOT / 'models'
    engine_dir = ROOT / f'engine-{BUILD}-{variant}'
    if args.check:
        manifest = json.loads((ROOT / 'installed.json').read_text(encoding='utf-8'))
        verify(ROOT / manifest['model']['file'], manifest['model']['bytes'], manifest['model']['sha256'])
        if not (ROOT / manifest['engine']['server']).is_file(): raise SystemExit('Engine missing; run setup again.')
        print(f"Local brain verified: {manifest['model']['name']} on llama.cpp {manifest['engine']['build']} ({manifest['engine']['variant']})."); return
    keep_awake()
    downloads.mkdir(parents=True, exist_ok=True); models.mkdir(parents=True, exist_ok=True)
    for name, size, digest in archives: download(RELEASE + name, downloads / name, size, digest)
    download(f'https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REV}/{model_file}', models / model_file, model_size, model_hash)
    staging = engine_dir.with_name(engine_dir.name + '.staging')
    if staging.exists(): shutil.rmtree(staging)
    staging.mkdir(parents=True)
    for name, _, _ in archives: extract(downloads / name, staging)
    servers = [p for p in staging.rglob('llama-server.exe')]
    if len(servers) != 1: raise SystemExit('Could not find exactly one llama-server.exe in the engine archive.')
    if engine_dir.exists(): shutil.rmtree(engine_dir)
    staging.replace(engine_dir)
    server = engine_dir / servers[0].relative_to(staging)
    manifest = {'version': 1,
        'engine': {'build': BUILD, 'variant': variant, 'server': server.relative_to(ROOT).as_posix()},
        'model': {'id': model_id, 'name': model_name, 'file': f'models/{model_file}', 'sha256': model_hash, 'bytes': model_size, 'license': 'apache-2.0'}}
    temporary = ROOT / 'installed.json.tmp'
    temporary.write_text(json.dumps(manifest, indent=1), encoding='utf-8'); temporary.replace(ROOT / 'installed.json')
    print(f'Local brain ready: {model_name} on llama.cpp {BUILD} ({variant}). Open HARMONY > System > Ask HARMONY.')
    print('Archives in .runtime/local-model/downloads can be deleted to save space.')

if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: sys.exit('Setup cancelled. Run it again to resume.')
