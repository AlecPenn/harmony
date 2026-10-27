# Local wake detection

Phase 6 adds an opt-in offline “Harmony” wake test using Vosk small English 0.15, pinned by the file hashes in WAKE-MODEL.json. Apache-2.0 notice is retained in licenses/Vosk-Apache-2.0.txt. Source: https://alphacephei.com/vosk/models . No JARVIS code is used.

A full-vocabulary provisional recognizer drives only the visual pulse. A separate word-confidence recognizer requires an exact harmony token at confidence >= 0.8, deduplicates word spans and enforces a two-second cooldown. Neither signal authorizes a person, starts a conversation or executes commands. Whisper remains unloaded in wake mode. PCM and provisional text are not retained on disk.

Automated evidence: 27 TypeScript tests, four Python tests, type checking, build and two Electron regressions passed. One generated speech fixture produced a confirmed match at 2.08 seconds of audio and an earlier visual candidate at 0.928 seconds. Four generated negative sentences produced neither. These are fixture timings, not live microphone latency or room-accuracy guarantees. Household calibration and full latency instrumentation remain pending.

## Hands-free conversation — October 19, 2026

"Hands-free · say “Harmony”" (under the presence) starts a conversation whose speech worker runs in `--conversation --hands-free` mode: Silero VAD, Parakeet (or Whisper) and this same Vosk wake detector in one process.

- **Waiting** (`wake_wait` on): frames go only to the wake detector; the segmenter is off and queued transcription is dropped. Nothing is transcribed and no audio is kept, apart from a rolling 1.5-second in-memory buffer that is zeroed on use or when it rolls over.
- **On "Harmony"** (exact word, confidence ≥ 0.8, two-second cooldown) the worker switches itself to listening and replays the buffered frames that came after the end of the word, so "Harmony, what time is it?" in one breath keeps its request. The core starts loading the local brain at the same moment. A leading "Harmony"/"hey Harmony" is stripped from the transcript; a mid-sentence "harmony" is kept.
- **Follow-ups**: after each reply HARMONY keeps listening for 8 seconds without the wake word. Speech that starts in that window pauses the countdown. Silence, or only the wake word, returns to waiting.
- While HARMONY is thinking or speaking, the wake detector is not fed (no self-wake, no barge-in yet). Announcements (reminders) that interrupt waiting return to waiting.
- STOP, "Turn off hands-free", reload or quit end it and unload every worker. The microphone label shows "MICROPHONE ON · HANDS-FREE".

Still true: the wake word is a hint to listen, never identity or permission. Live wake accuracy in Alec's room, false-wake rate and wake-to-listening latency are not measured yet. Small-model Vosk may miss "Harmony" from across a room or trigger on similar words; the 0.8 threshold may need tuning from real use.
