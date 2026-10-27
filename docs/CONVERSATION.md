# Local voice conversation

## Checkpoint — October 17, 2026

**Talk to HARMONY**, the button under the presence in the chamber, starts a private voice loop that runs entirely on this PC: microphone → Silero VAD + Faster Whisper (existing speech worker) → the local brain (llama.cpp + Qwen3.5-4B) → Piper. Each sentence is spoken as soon as it is written, so speech starts before the full answer exists. No account, cost or network.

### How it works
- `core/conversation.ts` (`ConversationController`): explicit start from the trusted chamber (`harmony:conversation-start`, the same short microphone grant as the speech test). Model and voice warm up in the background while the microphone is already live; state goes STARTING → LISTENING once both are ready. A final, meaningful transcript starts a turn. Partial transcripts only update the "You:" line. Whisper's common silence hallucinations ("you", "thank you"…) are ignored.
- The turn streams model text into `VoicePhrases` (sentence framing, 240-char cap), so phrases reach the voice while the model is still writing. Display text keeps formatting; spoken text has markdown stripped (`speakable`).
- `core/conversation-speech.ts` (`ConversationSpeech`): one resident Piper worker (22.05 kHz) per conversation; per-reply pull session served through the existing `voice-next`/`voice-playback` IPC (routed by session id) with the existing 60-frame lookahead bound. The chamber's `VoicePlayback.attach()` plays it with the same validation and pacing as the auditions.
- **Half-duplex by design.** While HARMONY thinks or speaks, transcripts are ignored and counted. Any speech segment that began during a reply, which is most likely HARMONY's own voice, is never answered, and finals in the first 700 ms after it finishes are dropped. You cannot interrupt by voice yet; End conversation, STOP or Escape cut it off.
- Ending the conversation stops the microphone, cancels any reply, stops Piper (verified exit) and leaves the model to its normal idle unload. Runtime STOP also ends it and Resume waits for it. A failed reply returns to listening with a plain message rather than ending the conversation. Late audio or status from an ended conversation is discarded.
- The runtime is ACTIVE while a conversation runs, so typed requests, previews and owner/allowance work wait. The presence shows listening (blue), thinking (purple/pink) and speaking from the conversation's status. Household voice states and identity were deliberately not used: this is the local desktop user, as with typed requests.

### Latency round 2 (after the first real test)
First real run on Alec's PC: transcription 3.6 s, first model words 0.5 s, voice 1.7 s after the transcript, so roughly 5–6 s from finishing speaking to hearing HARMONY. Changes:
- The speech worker has a `--conversation` mode: no provisional re-transcription while you talk (that was using the CPU continuously), an `endpoint` event the moment the voice detector decides you stopped, a `speech_start` event per segment (keeps echo protection working without partials), `without_timestamps` decoding, and Whisper threads set to half the logical processors (2–4) instead of a fixed 2.
- Turn timings now start at that endpoint, so "voice N ms" is the real gap after the detector's ~320 ms silence window. The UI shows "Got it, one sec…" during transcription.
- The first spoken phrase may end at the first clause break of 20+ characters, or about 90 characters, so speech starts before a long first sentence finishes. Later phrases remain whole sentences.

### Round 3: memory and no self-transcription
Second real run: understood 4,877 ms, first words 5,578 ms, voice 6,702 ms, and HARMONY could not follow up ("what is that?"). Engine log after reverting auto-fit: about 31 tokens/s generation.
- **Conversation memory:** each request now includes the last four exchanges of the current conversation (bounded: 8 messages, 1,500 characters each). Ending the conversation forgets it. Nothing is stored on disk.
- **No self-transcription:** while HARMONY thinks or speaks, the core tells the speech worker to stop segmenting audio and to drop queued transcription jobs (`listen` control message, conversation mode only). Previously its own voice from the speakers was transcribed and queued ahead of the user's next request, and a full queue could even fail the worker. Echo-segment and grace-window protection remain as a second layer.

### Voice consistency (October 18)
Alec heard the voice change pitch, pace and tone between phrases, and a Scottish accent. Piper Alba is in fact a Scottish speaker; labels now say "Scottish-accented test voice". Phrase-to-phrase variation came from Piper's default synthesis noise (0.667 / 0.8) applied independently to each phrase, made worse by short early fragments. Synthesis now uses noise_scale 0.33 and noise_w_scale 0.4, and an early first phrase must be at least 40 characters. Subjective result not yet confirmed by Alec.

### Faster speech recognition: Parakeet (October 18)
`scripts/benchmark-stt.py` on Alec's PC (6 Windows-voice sentences, 17.6 s total, 2 threads): Whisper base.en median 3,209 ms, worst 3,375 ms, 3% word errors; **Parakeet TDT 0.6B v2 int8 median 1,137 ms, worst 1,500 ms, 3% word errors**. The CPU has 4 logical processors.
- Conversation mode now uses Parakeet (via onnx-asr) when its files are present and match `docs/STT-PARAKEET.json`; otherwise Whisper. The diagnostic speech test still uses Whisper.
- Thread count measured on this 4-thread CPU: Parakeet median 1,137 ms with 2 threads versus 1,792 ms with 4, so transcription uses half the logical processors (2 here). `HARMONY_STT_THREADS` overrides. First live use: understood 1,167–1,939 ms; voice 2,901–3,100 ms after the endpoint (was 6.7–7.3 s).
- The worker warms Parakeet up once at start, reports the engine in its ready message, and gets 60 s to start in conversation mode. The panel shows "Hearing with Parakeet/Whisper".
- Notice: docs/third-party/speech/PARAKEET-NOTICE.md (CC-BY-4.0 attribution).

### Cache-exact prompts (October 18)
Engine log after Parakeet: each turn re-read 67–125 tokens (~0.85–1.15 s at ~100 tokens/s) because the Qwen3.5 chat template renders earlier assistant turns without the empty `<think>` block that its own generation prompt adds, so the cached prefix broke at the previous reply. Conversation requests to a Qwen3 model now go to llama-server's `/completion` with HARMONY's own ChatML (`qwenChatPrompt`), matching the template embedded in the GGUF but keeping that block in history, and replies are stored exactly as generated. Each new prompt therefore extends the previous one and only the new request should need reading. Untrusted text has chat control markers neutralised (`inertText`), so it cannot open roles or hidden blocks. If the completion route fails before any words, the client falls back to the standard chat route for the rest of the session. Typed one-off requests and non-Qwen models are unchanged. Not yet measured on the real PC.

### Unpronounceable phrases (October 18)
Live run: the cache fix worked (understood 1,259 ms, first words 1,725 ms, voice 2,223 ms), but two turns failed. A reply ending "… reflexes. ⚡" made the emoji its own phrase, Piper produced no audio, the protocol treated that as fatal and the worker died; the next turn then hit a cold restart. Now `speakable` strips emoji and pictographs and skips phrases with no letters or digits, the voice protocol reports an empty result for unpronounceable text instead of failing (warm-up still requires audio), `LocalVoice` accepts a zero-chunk result only when no audio was sent, and the instructions ask for no emoji, markdown or lists.

### Knowing the time (October 18)
Each request now starts with a short line such as "(Current local time: Sunday, October 18, 2026 at 9:53 PM, America/Chicago)", taken from Windows' clock and time zone at the moment of the request. It goes into the new message, never the fixed instructions, and conversation history stores exactly what was sent, so the cached prompt stays valid. The instructions tell the model to use it for dates and times and not to repeat it unless asked. Typed requests get the same line. The model still cannot set reminders or act; that comes next, with confirmation.

### Timing shown
Per turn, measured from the voice detector's endpoint (about 320 ms after you actually stop): understood (transcript ready), first model words, and voice (playback start reported by the chamber, not an acoustic measurement). Without an endpoint, timings fall back to transcript arrival.

### Limits
- The voice is Piper Alba, a British test voice, labelled as such. The Australian female voice remains a separate, open task.
- No barge-in (voice interruption) yet. Memory lasts only for the current conversation.
- Whisper and Piper both run on the CPU next to the GPU model; real CPU contention on this PC is unmeasured.
- Acoustic echo cancellation is requested from Chromium but its effectiveness with Web Audio playback is not verified, which is why the loop is half-duplex.

### Cutting in by voice (October 19)
While HARMONY is thinking or talking (a reply or a reminder announcement), the speech worker feeds audio to the offline Vosk keyword spotter, which is now loaded for every conversation, not only hands-free. Saying **"stop"** (confidence ≥ 0.9) or **"Harmony"** (≥ 0.8) cuts in. The reply is cancelled, queued audio in the chamber is silenced, and HARMONY switches straight to listening. The worker replays the audio after the word, so "Stop, what's the weather instead?" in one breath becomes the next request.

Self-interruption guard: before each phrase is synthesized, HARMONY checks it for "stop" or "harmony" and tells the worker to ignore those words for the rest of that reply, because it knows exactly what it is about to say. Watching ends before normal listening resumes. A general "talk over HARMONY" (any speech) is not used, because echo cancellation of Web Audio playback is unverified on this PC.

Limits: a cut-off reply is not added to the conversation memory. A little of HARMONY's own audio (about 0.1–0.5 s, until the renderer stops playback) can land in the start of the next request. Real-room accuracy, false cut-offs and cut-in latency are not measured yet; thresholds may need tuning.

### Faster understanding (October 20)
Measured on Alec's CPU (Xeon E5-1607 v2: AVX, no AVX2) with the installed Parakeet: about 0.4 s fixed plus about 0.44–0.56 s per second of speech, and the encoder is about 90% of that.
- **Speculative transcription.** 160 ms into a silence (`SPECULATE_FRAMES=5`), the words so far are transcribed in the background. If the endpoint follows (320 ms of silence, unchanged) with no new speech, that result becomes the final transcript (marked `speculative` in the worker event). If speech resumes, the guess is discarded and a queued older guess is dropped; a guess that fails falls back to a normal transcription.
  - Simulated on 150 real Common Voice clips with the measured cost: median 0.24 s sooner. 5 of 150 were slightly slower (a mid-sentence pause guessed wrong while a stale guess was still running).
  - Earlier thresholds save a little more but misfire more often (96 ms: 0.30 s saved, 11/150 slower).
- **CPU-optimised Parakeet.** ONNX Runtime has no fast CPU kernel for `ConvInteger`. `scripts/optimize-parakeet.py` rewrites the encoder's 77 integer convolutions as float convolutions over the same integer values. Transcripts are identical on real clips; speed went from 560 to 480 ms per audio second.
  - Output: `parakeet-tdt-0.6b-v2-fastconv`, pinned in `STT-PARAKEET-FASTCONV.json`. The worker uses it only while its hashes match, otherwise the original.
  - The 217 `MatMulInteger` ops were left as is: converting them needs about 2.4 GB of RAM for little expected gain.
- Tried and rejected: transcribing chunks split at short pauses during speech. Word errors rose from 0% to about 15–20% on real clips and it saved almost no time. Streaming models (NVIDIA Nemotron 0.6B) were not adopted: they are about 1 point less accurate, need a new download, and are unproven on this CPU.

Expected on the PC: transcript ready roughly 0.35–0.45 s sooner after you stop talking. Not yet measured live.

## Exact short commands (October 21, 2026)
On Alec's PC, `npm run local:tools-check` scored 46 of 47 with 22 functions offered. The only miss was "Harmony, status.", which got a normal answer. Exact short commands now go straight to their function without the brain having to pick it. They use the same call markup, so history and the cache are unchanged, and the answer still comes from the action-free pass:
- "status"
- "why are you slow"
- "where was I"
- "save my place"
- "put me back"
- "lock in"
- "go ghost"
- "back to normal"
- "what skills do you have"

A shortcut only applies when that function is offered (skill on, helper available). Anything longer or different still goes to the brain.
