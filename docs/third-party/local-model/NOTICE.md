# Local model third-party notices

HARMONY does not bundle these files. `scripts/provision-local-model.py` downloads them on the user's explicit request into the ignored `.runtime/local-model/` directory and verifies each against a pinned SHA-256.

| Component | Source | Version | License |
| --- | --- | --- | --- |
| llama.cpp (`llama-server` and libraries) | https://github.com/ggml-org/llama.cpp | release `b11715` | MIT, Copyright (c) 2023-2026 The ggml authors |
| NVIDIA CUDA runtime DLLs (CUDA engine only) | llama.cpp release asset `cudart-llama-bin-win-cuda-12.4-x64.zip` | 12.4 | NVIDIA CUDA Toolkit EULA (redistributable runtime components) |
| Qwen3.5-4B GGUF quantizations | https://huggingface.co/unsloth/Qwen3.5-4B-GGUF at `e87f176479d0855a907a41277aca2f8ee7a09523` | IQ4_XS / Q4_K_M | Apache-2.0 (Qwen team; quantized by Unsloth) |

The license texts ship inside the downloaded llama.cpp archive and on the model repository page. Keep them with the files if the runtime directory is copied elsewhere.
