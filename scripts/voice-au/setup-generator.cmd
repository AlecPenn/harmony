@echo off
rem One-time setup for the Australian voice generator (Chatterbox, MIT). Separate from HARMONY's own Python so
rem nothing HARMONY uses at runtime changes. About 4 GB download (mostly PyTorch for your NVIDIA GPU).
setlocal
cd /d "%~dp0\..\.."
if not exist .venv\Scripts\python.exe (
  echo HARMONY's Python environment was not found. Run HARMONY's normal setup first.
  exit /b 1
)
echo Installing the uv package manager into HARMONY's Python...
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -q uv==0.13.1 || exit /b 1
echo Creating a separate Python 3.11 environment in .venv-voicegen ...
.venv\Scripts\python.exe -m uv venv .venv-voicegen --python 3.11 || exit /b 1
echo Installing PyTorch 2.6.0 with CUDA 12.4 (large download)...
.venv\Scripts\python.exe -m uv pip install --python .venv-voicegen\Scripts\python.exe torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124 || exit /b 1
echo Installing Chatterbox 0.1.7...
.venv\Scripts\python.exe -m uv pip install --python .venv-voicegen\Scripts\python.exe chatterbox-tts==0.1.7 || exit /b 1
.venv-voicegen\Scripts\python.exe -c "import torch,chatterbox; ok=torch.cuda.is_available(); print('Generator ready.', 'GPU: '+torch.cuda.get_device_name(0) if ok else 'No GPU found: generation will run on the CPU (much slower).')" || exit /b 1
