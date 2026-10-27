# Free local brain

## Checkpoint — October 17, 2026

HARMONY can now answer typed requests with a model running entirely on this PC: no account, no API key, no cost and nothing sent online. It is the default choice in System → "Ask HARMONY · free on this PC". The paid cloud models remain available below it as an optional path with all their existing cost reviews and allowance controls.

### Why this design
Alec's direction: an assistant that does not need money fed into it per request. Consumer Claude, ChatGPT and Gemini subscriptions do not include API access, and using their logins inside a custom app breaks their terms. So the free default must be local.

### Pieces
- `scripts/provision-local-model.py` / `Set up local brain.cmd`: one-time, user-run setup. It downloads a pinned llama.cpp Windows build (`b11715`, CUDA 12.4 by default; `--engine vulkan` or `cpu` also work) and a pinned Qwen3.5-4B GGUF (`--model iq4_xs` default, or `q4_k_m`). It checks every file against its published size and SHA-256 before use, extracts with path-traversal checks and writes `.runtime/local-model/installed.json`. Re-running verifies instead of downloading again; `--check` verifies only. HARMONY never downloads models on its own.
- `core/local-model.ts` — `LocalModelServer` supervises one `llama-server` process: loopback only (`127.0.0.1`), a free port and a fresh random API key for each launch, web UI off, output streams discarded so prompts are not logged. It starts lazily on the first request, waits for `/health`, unloads after 10 idle minutes to free GPU memory and reports real load time. STOP resolves only after the process has actually exited. If exit cannot be verified it reports failure and refuses to start a second server. A crash is reported as failed; the next explicit request restarts it.
- `packages/reasoning/local-chat.ts`: bounded streaming client for the server's OpenAI-compatible chat endpoint. Fixed system instructions, no tools, no history, no files or microphone, thinking mode off for speed. Hidden reasoning and any tool-call fields are ignored, never shown or acted on. Server errors are never forwarded.
- `core/local-reasoning.ts`: typed request controller with a latency trace (`llm_first_token_ms`, `full_turn_ms`; voice stages marked not applicable) and separately reported cold-load time. Cancel keeps the model loaded; STOP unloads it. Runtime STOP, Resume and app quit include it.
- `scripts/benchmark-local-model.ts` (`npm run local:benchmark [-- --gguf candidate.gguf]`): measures cold load, first-words latency and tokens per second on fixed assistant prompts, using the same client. Use it to compare new models as they come out. It does not score quality, so read the answers before switching models.

### Model choice (researched October 17, 2026)
For a GTX 1650 (4 GB), 2–4B models at 4-bit fit on the GPU. Qwen3.5-4B (Apache-2.0) had the strongest small-model tool-calling results in the comparison reviewed (VDF AI, October 6, 2026), which matters for the coming tool and voice work. Gemma 4 E4B was the strongest small model for chat quality and is the first alternative to benchmark. IQ4_XS (~2.5 GB) is the default to leave room for context on 4 GB.

The model hashes and the repository revision were read from the Hugging Face API through a summarizing fetch tool, because this build environment could not reach Hugging Face directly. A transcription error cannot cause a silent bad install: setup refuses any file whose size or SHA-256 differs. If setup reports an integrity failure for the model on a clean download, re-check the pinned values against the repository page. The llama.cpp hashes are GitHub's published asset digests.

### Limits and honest status
- **Not yet run on real hardware.** Tests use fake processes and fake streams. Real load time, first-words latency and speed on the GTX 1650 are unmeasured until setup and the benchmark are run there.
- A 4B model is noticeably weaker than paid frontier models at deep reasoning.
- If HARMONY's main process is killed abruptly, an orphaned `llama-server` may keep running until closed in Task Manager. Normal quit and STOP stop it.
- Voice is not connected to the local model yet. That is the next step: streaming the model's sentences into Piper/Kokoro as they are written.

### Measured on Alec's GTX 1650 — October 18, 2026
`npm run local:benchmark` (5 assistant prompts × 3 runs, HARMONY closed, all layers on GPU):

| Context | Cold load | Median first words | Median speed |
| --- | --- | --- | --- |
| 4096 | 8.8 s | 365 ms | 32.7 tokens/s |
| 2048 | 5.5 s | 353 ms | 32.5 tokens/s |

The smaller context makes no meaningful difference for short requests, so the default stays 4096 (room for conversation history). The engine still warns that the full allocation does not fit in free GPU memory, but forcing all layers measured ~8× faster than llama.cpp's automatic fit (~4 tokens/s). Short-prompt latency is not the voice bottleneck: transcription (~3.5 s) and re-reading uncached conversation history are.
