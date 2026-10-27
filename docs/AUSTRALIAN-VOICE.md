# HARMONY's own Australian voice

Goal: a natural Australian female voice that runs as fast as the Scottish Piper voice (Alba), free and offline.

## Why this route (October 19, 2026)
- No free, open, local Australian female voice exists ready-made. Piper and Kokoro have none. MeloTTS has an "EN-AU" speaker, but its gender is unknown, it is lower quality, and its install is heavy (Japanese and Chinese language packs, a BERT model run on every sentence, a pinned 2023 library stack).
- Fish Audio Drama 3 needs 20–24 GB of graphics memory, and its license forbids training other models on its output (see ROADMAP).
- Text-described voice design (Qwen3-TTS VoiceDesign) can't reliably produce an Australian accent; it needs real accented reference audio.
- Alec chose **free volunteer recordings**: Mozilla Common Voice's official Australian-accent subset. It is CC0 (public domain).

## Current approach (October 20): real recordings, one multi-speaker model
Alec asked for something more efficient than generating 80 minutes of cloned speech. Instead:
- Train **one** Piper model on real Common Voice recordings of **16 Australian women** (1,390 clean clips, about 1.7 hours). Each woman is her own speaker. The chosen voice (candidate 2) is speaker **"harmony"** (id 0, 36 clips).
- The accent is learned from everyone; her timbre is learned from her own clips. No Chatterbox, no 4 GB install, no overnight run, and no clone-of-a-clone quality loss. Other women in the model can be swapped in without retraining.
- Training starts from Piper's VCTK *medium* checkpoint (109 English speakers, MIT-licensed checkpoint, CC BY 4.0 data) using `--model.warmstart_ckpt`. That copies every part whose shape matches, and the speaker table starts fresh.

**Steps**
1. `build-multispeaker.py score <dataset>` scores every clip from the women in the dataset (9,704). It is resumable and caches results to `data/voice-au/scores.jsonl`.
2. `build-multispeaker.py build <dataset> --voice 2 --min-score 25` caps each speaker at 300 clips, drops speakers under 40 clips, and always keeps her clips. It writes 22.05 kHz FLAC plus `file|speaker|text` metadata to `data/voice-au/train/`. That folder is zipped as `harmony-voice-train.zip` (170 MB).
3. Train on Google Colab's free T4 GPU with `scripts/voice-au/train-harmony-voice.ipynb` (also in Alec's Drive under `harmony-voice`). Checkpoints go to Drive and resume after disconnects. The notebook has cells to listen and to export.
4. `train_piper.py` wraps piper1-gpl at commit `619f513` and fixes two problems found in testing:
   - The trainer crashes after epoch 1 when its quality predictor ("val_mos") can't be downloaded. Checkpoints are kept by mel loss only.
   - Recent PyTorch's default ONNX export fails on Piper's spline flow. The wrapper uses the classic exporter.

**Verified in the cloud workspace (CPU)**
- Training on 24 real clips from 3 speakers.
- Warmstart into a different speaker count: 803 parameters copied, the speaker table fresh.
- ONNX export, and runtime synthesis as speaker "harmony".
- The notebook's own cells, run end to end against a simulated Drive.

**Not yet verified:** the GPU run, warmstart from the real VCTK checkpoint (Hugging Face is blocked here), and voice quality.

**HARMONY side (done, October 20):**
- `piper_engine.py` loads the Australian voice when `docs/VOICE-AU-MODEL.json` exists and the files in `data/models/piper-harmony-au` match its hashes. It speaks as speaker "harmony"; otherwise it falls back to Alba.
- `scripts/voice-au/install-voice.py <model.onnx>` installs a trained model and pins it.
- Tested with a real trained (smoke) model through HARMONY's engine, a tampered-file fallback test, and a manifest validation test.
- To go back to Alba, delete `docs/VOICE-AU-MODEL.json`.

## Earlier pipeline (superseded)
1. **Download (Alec):** "Common Voice v24 English – en-AU subset" (1.92 GB, CC0) from Mozilla Data Collective, dataset `cmko7havo02f5nw07rbwwhowe`. A free account is needed. Its terms say never try to identify speakers and never re-host or re-share the dataset. It stays on this PC, outside Git (`data/` is ignored).
2. **Find candidates:**
   `.venv\Scripts\python.exe scripts\voice-au\find-speakers.py <download.tar.gz>`
   It reads the archive directly. It keeps women with at least 15 well-voted clips and scores clips by signal-to-noise, clipping and phone-band audio. It saves `data\voice-au\candidates\candidate-N.wav` (about 25 s each, best first). Candidates are numbered by sound quality only. The local `candidates.json` keeps the dataset's anonymous speaker key only so the choice can be rebuilt.
3. **Choose:** Alec listens and picks a number.
4. **Write the script:**
   `.venv\Scripts\python.exe scripts\voice-au\make-script.py <download.tar.gz>`
   This gives about 1,300 lines. HARMONY's everyday phrases (`harmony-lines.txt`) come first. The rest are Common Voice sentences (CC0), picked greedily for sound coverage. Lines with digits, symbols or acronyms are left out because they read inconsistently.
5. **Set up the generator (once):** `scripts\voice-au\setup-generator.cmd`. This creates a separate `.venv-voicegen` (Python 3.11) with PyTorch 2.6.0 for CUDA 12.4 and Chatterbox 0.1.7 (MIT). It's about a 4 GB download. HARMONY's own environments are untouched.
6. **Generate (close HARMONY first):**
   `.venv-voicegen\Scripts\python.exe scripts\voice-au\generate.py --candidate N --limit 10`
   Listen to the first 10 in `data\voice-au\dataset\wavs`. If they sound right, run it again without `--limit`; it carries on where it stopped.
   - It builds an 11 s reference from the chosen clip and loads Chatterbox at a pinned revision (`5bb1f6e…`).
   - Each line is read with a fixed seed and resampled to 22.05 kHz. Takes that are cut short or babbling are retried, up to 3 attempts.
   - Every file carries Chatterbox's inaudible watermark marking it as generated speech.
7. **Check:** `.venv\Scripts\python.exe scripts\voice-au\check-dataset.py`. HARMONY's Parakeet transcribes every line. Lines whose word error rate is over 15% are rejected and listed in `rejected.csv`. What's kept goes to `metadata.clean.csv` in Piper/LJSpeech format. The target is at least 45 minutes of speech.
8. **Train (next step, not built yet):** fine-tune a *medium* Piper checkpoint with `piper.train` (OHF-Voice/piper1-gpl).
   - The trainer is Linux-only and is reported to need about 8 GB of graphics memory; the GTX 1650 has 4 GB.
   - Plan: a free Google Colab GPU (T4, 16 GB) with checkpoints saved to Alec's Drive, or WSL2 on the PC with a small batch size.
   - Export to ONNX. Then pin the files' hashes in the repo and teach `piper_engine.py` to load the new voice, falling back to Alba.

## Honest limits
- The speaker is a real, anonymous volunteer who released her recordings into the public domain. She did not specifically agree to be an assistant's voice. Alec made that choice knowingly.
- Common Voice clips are often home microphones. The finder picks the cleanest, but quality is capped by the source.
- The voice is a copy of a copy (Common Voice → Chatterbox → Piper). Expect it to be clearly Australian and pleasant, but less rich than a studio recording.

## Status
October 19:
- Steps 2–4 have been run on Alec's PC. From 74 eligible women he chose candidate 2.
- The script is 1,300 lines (about 81 minutes) of everyday words only; the sentence filter now drops rare words.
- The reference clip is 10.7 s.
- Steps 5–6 run from `Make Australian Voice.cmd` in the HARMONY folder. The first run sets up the generator and makes a 10-line test; the second run makes the full set.

Steps 2, 4, 6 and 7 are written and tested offline with synthetic audio (`scripts/voice-au/test_find_speakers.py`, 6 tests). They have not yet been run on the real dataset or on the GPU.
