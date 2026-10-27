# Third-party software, models and data

HARMONY's own code is MIT licensed (see `LICENSE`). It runs alongside other people's work, listed here with their
licences. **None of the models or engines below are stored in this repository**: the setup scripts download them on
request, check each file against a pinned SHA-256 (the `docs/*.json` files), and keep them in the ignored `data/` and
`.runtime/` folders. If you redistribute those files, their licences travel with them.

## App libraries (installed by npm)

Electron, React, Three.js, @react-three/fiber, Framer Motion, Zustand, Vite, esbuild, TypeScript, Vitest and
Playwright, all MIT (Apache-2.0 for TypeScript and Playwright). Full texts are in `node_modules` after `npm ci`.

## Pack manifest validation

@cfworker/json-schema (JSON Schema validation), MIT: https://github.com/cfworker/cfworker. Version 4.1.1 was
checked on GitHub on 2026-10-27. This interpreter does not generate or evaluate code at runtime.

jsonc-parser (strict JSON parsing), MIT: https://github.com/microsoft/node-jsonc-parser. Version 3.3.1 was checked
on GitHub on 2026-10-27. HARMONY rejects comments and duplicate keys when reading pack manifests.

## Brain

| Component | Licence |
|---|---|
| llama.cpp (`llama-server`) | MIT |
| Qwen3.5 4B, GGUF quantisation by Unsloth | Apache-2.0 |
| NVIDIA CUDA runtime DLLs (shipped with llama.cpp's CUDA build) | NVIDIA CUDA EULA (redistributable components) |

## Hearing

| Component | Licence |
|---|---|
| Silero VAD | MIT |
| OpenAI Whisper base.en (faster-whisper / CTranslate2 conversion by Systran) | MIT |
| NVIDIA Parakeet TDT 0.6B v2 (ONNX export by istupakov, via onnx-asr) | CC-BY-4.0 (model), MIT (onnx-asr) |
| Smart Turn v3.2 (pipecat-ai / Daily) | BSD-2-Clause |
| Vosk small English model | Apache-2.0 |
| ONNX Runtime | MIT |

## Voice

| Component | Licence |
|---|---|
| Piper 1.8.0 (OHF-Voice/piper1-gpl) | GPL-3.0-or-later. Installed as a separate Python package and run in its own process; no Piper code is copied into HARMONY |
| Piper voice en_GB-alba-medium | CC BY 4.0 dataset (Alba speech corpus, University of Edinburgh) |
| Kokoro 82M (optional) | Apache-2.0 |
| Edge TTS (optional audition only) | LGPL-3.0 |

## Guard (voice, face and hand checks)

| Component | Licence |
|---|---|
| WeSpeaker ResNet34 speaker model (sherpa-onnx conversion) | CC-BY-4.0 (model), Apache-2.0 (sherpa-onnx) |
| OpenCV Zoo YuNet face detector | MIT |
| OpenCV Zoo SFace face recogniser | Apache-2.0 |
| MiniFASNetV2-SE liveness (suriAI/face-antispoof-onnx) | Apache-2.0 |
| MediaPipe palm and hand-landmark models (OpenCV Zoo conversions) | Apache-2.0 |

## God's Eye

God's Eye View (bilawalsidhu/gods-eye-view), MIT, Copyright (c) 2026 Bilawal Sidhu, installed from a pinned version.
HARMONY's changes are in `overlays/gods-eye`, with credit to the community forks they came from
(`overlays/gods-eye/README.md`). Map imagery, terrain and live data come from the providers that project uses, under
their own terms.

## Public data

Weather, news, search and world feeds are fetched on request from their providers (see `docs/FREE-APIS.md` and
`docs/HOW-IT-WORKS.md`); their data stays under their terms. Madison Metro data is used under Metro Transit's
Developer License Agreement.

Licence texts that HARMONY keeps a copy of are in `docs/licenses` and `docs/third-party`.
