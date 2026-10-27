# HARMONY roadmap — free first

Everything in phases 0–6 ships free and public under MIT. Paid work (phase 7) is parked until the gate below is met.
Work phases in order. A phase is done only when its **Done when** line is true — "mostly works" is not done. Tick items
(`- [x]`) as they finish and record decisions inline with a date.

**Out of scope for this roadmap:** God's Eye integration work, phone authorization, and voice/face recognition for
wake. They are real goals but belong to the wider HARMONY plan; folding them in here would stop this from finishing.

**Hardware ceiling:** GTX 1650, 4 GB VRAM. Every choice below is bounded by it. Whatever runs well here runs well on
most people's PCs, which is the audience.

## The gate for paid work

Revisit paid work only when all three are true:

1. HARMONY has been public on GitHub for 60+ days (published 2026-10-27, so not before 2026-12-26).
2. 100+ people have installed it, and we can point at where they came from.
3. 10+ of them have asked for something plausibly paid (more skins, voices, easier install).

If not met, the fix is distribution, not pricing. These thresholds are first guesses — Alec may change them.

---

## Phase 0 — Repo hygiene

**Done when:** a stranger can clone the repo, read the README, and find nothing personal in it or its history.

- [x] Fresh one-commit history, MIT licence, public repo (2026-10-27)
- [x] Secrets scan of all 537 files: no keys, tokens, emails, user paths or family names (2026-10-27, Claude)
- [x] `.gitignore` covers `.env`, `data/`, `tokens/`, `credentials/`, `voice-samples/`, `embeddings/`, `handoff/`
- [x] Hardcoded "Madison, Wisconsin" default removed; home town now `home` in `data/profile.json` (commit `a2a3cfc`)
- [x] **Verify `a2a3cfc`**: `npm install && npm run typecheck && npm test`. It was pushed without tests running
      (dependencies were not installed in that session). Fix anything it broke.
- [x] Settings UI to set the home town (place + optional lat/lon), saved to `data/profile.json` or the config store.
      Settings saves the private profile and optional coordinates (2026-10-27).
- [ ] First run with no home set: when asked for weather/local info without a place, she asks which town and offers
      to remember it — rather than failing or guessing.
- [x] CI: `.github/workflows/ci.yml` running `npm ci`, `npm run typecheck`, `npm test` on `windows-latest` for pushes
      and PRs to `main`. (An earlier session was blocked from writing `.github/`.)
- [ ] `CHANGELOG.md` started; version in `package.json` follows semver.

Madison still appears in docs and UI copy as an *example* ("Harmony, watch Madison") and `core/metro.ts` is a real
Madison Metro integration. Those are fine — they are not silent defaults. Leave them.

## Phase 1 — Pack format

One format for everything swappable: skins, voices, themes, sound sets.

**Done when:** a second skin, a second voice and a second theme can each be dropped into `data/packs/` and selected in
Settings with no code change and no restart.

```
data/packs/
  orb-default/        ← today's look, shipped as pack #1
    pack.json  model.glb  shader.frag  moods.json  preview.webm
  alba-voice/
    pack.json  voice.onnx  samples/hello.wav
```

`pack.json` fields:

| Field | Notes |
| --- | --- |
| `id`, `name`, `version` | `id` stable, reverse-DNS style (`com.apennco.orb`) |
| `type` | `skin` · `voice` · `theme` · `sounds` — one job per pack |
| `author`, `homepage` | Credit and where to report problems |
| `license`, `attribution` | **Required.** No licence, no load |
| `harmonyVersion` | Minimum core version; older core refuses politely |
| `files` | Path → SHA-256 for every file |
| `capabilities` | What it needs (WebGL2, GPU tier) so the loader can refuse gracefully |

- [ ] JSON Schema for `pack.json` in `docs/pack.schema.json`, plus validation in core
- [ ] Loader: verify every checksum; mismatch → refuse and name the file
- [ ] Loader: declarative only — reject any pack containing executable code (see AGENTS.md)
- [ ] Fail soft: a broken pack logs why and falls back to the default; never crashes the app
- [ ] Dev hot-reload: watch `data/packs/` and reload on change
- [ ] Current orb and Alba voice repackaged as packs #1 and #2
- [ ] Settings picker: name, author, thumbnail, Use button
- [ ] `docs/PACKS.md` written alongside the code, enough for a stranger to make a pack

## Phase 2 — Voice

Add Kokoro beside Piper, then a voice selector. Keep Piper and Alba — Alec chose Alba.

**Done when:** switching voices takes under a second with no restart, and time-to-first-word is no worse than Piper's.

- Kokoro-82M: Apache-2.0 weights, 54 voices, 8 languages. Real homes: `github.com/hexgrad/kokoro` and
  `huggingface.co/hexgrad/Kokoro-82M`. (`captivus/Kokoro-82M` is a fork — do not cite it.)
- Ship the fp16 ONNX export from `github.com/thewh1teagle/kokoro-onnx` releases (~164 MB, near-identical to fp32).
  int8 (~114 MB) is the low-end fallback. Voices are in a separate `voices-v1.0.bin`.
- The repo already has Kokoro profiling scripts (`scripts/profile-kokoro-*.py`) and results in `docs/` — read them
  first; some of this may already be partly built.

- [ ] Engine becomes a per-voice-pack property; core loads the runtime a pack declares
- [ ] Kokoro voices exposed as voice packs
- [ ] Live switching without restart
- [ ] Selector UI: grid of cards (name, accent, one-line description, Play sample), speed and pitch sliders with
      Reset, filters by accent and engine
- [ ] Licence check: does misaki (Kokoro's G2P) fall back to GPL espeak-ng for English? Record the answer here
- [ ] Licence check on every bundled Piper voice's training data; record in `docs/THIRD-PARTY.md`
- No voice cloning in this phase. If ever added, only from the user's own recordings.

## Phase 3 — Skins

A skin replaces her visible body: model, shader, and behaviour across the nine fixed moods (idle, wake, listening,
thinking, speaking, success, warning, stopped, offline). Skins cannot add moods.

**Done when:** three skins hold 60 fps on the GTX 1650 while listening and speaking, and none slows her answers.

- Pipeline: Blender → glTF binary `.glb` → compress with glTF-Transform → three.js `GLTFLoader`. Under 10 MB per skin.
- Shaders: pack-supplied `.frag` with a strict allowlist of core-provided uniforms.
- Render loop capped, drops frames rather than queuing, pauses when the window is hidden. Never blocks audio/inference.
- Every skin ships a 2D light-mode fallback (no WebGL) — mandatory in the spec.
- Original designs only. No film/game character look-alikes.

- [ ] **Terminal** skin first (retro green CRT + waveform) — cheapest, proves the pipeline end to end
- [ ] Second skin — Alec to choose: Crystal, Nebula, Hologram, Origami or Pocket
- [ ] Third skin
- [ ] Gallery with 5-second preview loops

## Phase 4 — Design tokens and themes

Do this before the launcher: every later screen inherits from it.

**Done when:** every colour, size and radius in the app comes from a token, the light/dark toggle changes all of them,
and a theme pack can override any of them without code.

- Three layers: primitives (`--pink-500`) → semantic roles (`--surface`, `--text-primary`, `--accent`,
  `--mood-thinking`) → components, which only ever read semantic roles.
- Default theme is HARMONY's identity: dark, blue-cast near-black surface, neon pink accent (signature), electric
  blue secondary, purple. Pink is for glow and accents, not body text (fails contrast).
- Light mode is a different treatment, not an inversion: solid colour and crisp edges where dark uses glow and bloom.
- Three-way toggle: System / Light / Dark, defaulting to `prefers-color-scheme`, choice remembered.
- `prefers-reduced-motion` calms the orb's idle animation, not just transitions.
- Body text meets WCAG AA (4.5:1).
- Theme packs are a JSON file of semantic overrides — no code, no images.

- [ ] Audit current CSS; list every hard-coded colour/size
- [ ] Token file + dark default + light theme
- [ ] Toggle in Settings
- [ ] Skins read mood colours from tokens where possible
- [ ] Theme pack type wired into the Phase 1 loader
- [ ] `docs/THEMES.md`

## Phase 5 — Free installer

The one-click installer is free. It is the biggest reason a stranger either uses HARMONY or leaves.

**Done when:** a fresh Windows PC goes from download to HARMONY speaking without opening a terminal or a README.

| Step | Requirement |
| --- | --- |
| Hardware check | GPU, VRAM, RAM, CPU |
| Runtimes | Bundles its own Node (and Python only if still needed) |
| Downloads | Progress bar, resumable, checksum-verified |
| Sizing | Picks brain, voice precision and context for this PC |
| First run | Mic permission, wake-word test, a "say hello" moment, asks for home town |
| Repair | Re-verify, re-download broken files, reset config |
| Update | Verify, apply, roll back if the new build won't start (repo already has `dist-next/`/`dist-old/` rollback logic) |

Brain sizing at 4-bit: ≤2 GB → Gemma 3 1B (~0.8 GB); 4 GB → Qwen3 4B or Phi-4-mini (~2.5 GB); 4 GB long context →
Qwen3 1.7B (~1.4 GB); 6 GB+ → Qwen3 8B. Qwen3 is Apache-2.0; Gemma's terms are restricted. Test with realistic
context — it eats VRAM. These are community figures; re-measure.

- Build with `electron-builder` (NSIS + portable zip) and `electron-updater`.
- Signing: apply to the SignPath Foundation (free signing for open source). Unsigned downloads hit SmartScreen.

## Phase 6 — Release properly

Repo is public; this is the half that gets it used.

**Done when:** someone Alec has never met installs HARMONY from a link, gets her talking, and opens an issue.

- [ ] README opens with a short clip of her working
- [ ] Troubleshooting page: no mic permission, GPU not detected, download fails, wake word never fires, SmartScreen
- [ ] Issue/PR templates, `CONTRIBUTING.md` (what will and won't be accepted), `SECURITY.md`
- [ ] Screenshots in both themes
- [ ] Known-broken list in the README
- [ ] Distribution plan — **Alec decides and posts**, agents only draft: demo video, r/LocalLLaMA, r/selfhosted,
      Hacker News, Home Assistant community

## Phase 7 — Paid (parked)

Do not start until the gate is met. If it opens: curated skin/voice packs are the most defensible thing to sell; a
store only once there are packs to browse; no cloud sync (contradicts "runs on your PC"). Earlier price guesses
($19–29 launcher, $3–5 packs) were not research.

## Model watch

Quarterly, not weekly. Keep 20 representative prompts in the repo (`npm run local:benchmark` exists — extend it).
A candidate replaces the default only if it beats the incumbent's pass rate **and** doesn't lose on time-to-first-token
(<1 s), tokens/sec, or peak VRAM at realistic context (<3.5 GB). Spiral Time (small local model + heavy work handed to
Claude) is the right architecture for this hardware; model-watching should make the local half snappier, not replace it.

## Toolbox

| Need | Tool | Licence |
| --- | --- | --- |
| Voice | hexgrad/kokoro, thewh1teagle/kokoro-onnx, onnx-community/Kokoro-82M-v1.0-ONNX | Apache-2.0 / MIT |
| Voice | rhasspy/piper (keep Alba) | MIT code; per-voice data licences |
| G2P | hexgrad/misaki | Apache-2.0 |
| Wake word | dscripka/openWakeWord; evaluate livekit/livekit-wakeword | Apache-2.0 |
| Wake training | kinder85/openwakeword-train (local), alfiedennen/openwakeword-colab-2026 | — |
| Brain | Qwen3 (QwenLM), Phi-4-mini (Microsoft), via Ollama or llama.cpp | Apache-2.0 / MIT |
| Installer | electron-builder, electron-updater | MIT |
| 3D | three.js, glTF-Transform, Blender | MIT / GPL app |
| Signing | SignPath Foundation | free for OSS |
| What's new | HF TTS Arena (Pendrokar/TTS-Spaces-Arena), msb-msb/awesome-local-ai | — |

Re-verify a tool on GitHub/Hugging Face before using it — this table was checked 2026-10-27.

## Open questions for Alec

- [ ] Second and third skins after Terminal?
- [ ] Full light-mode design pass now, or ship dark-only until someone asks?
- [ ] Default brain: Qwen3 4B, Phi-4-mini, or let the tune-up choose?
- [ ] Model skins himself in Blender, or have an agent draft Terminal first?
- [ ] First distribution push: where?
- [ ] Keep the paid gate at 60 days / 100 installs / 10 requests?
