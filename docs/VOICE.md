# HARMONY Australian voice

Alec prioritised a naturally human Australian female voice ahead of the remaining household phase work. This is an interruptible, fixed-script audition, not live AI conversation.

## Optional local audition

Settings now offers **Hear British local test** when the local Kokoro installation is present. It uses a fixed script, needs no account, and requires the microphone to be off. Choose Kokoro Emma or the faster Piper Alba Scottish test voice in **Local test voice**. Neither is an Australian voice; the Australian preference is unchanged. First use warms the model and can take a while. Completed auditions retain the warm worker; Stop local preview, STOP, Escape in either HARMONY window, reload and exit terminate it. Escape is not an operating-system-wide hotkey.

**Prepare local voice silently** loads and warms the local model before an audition, without creating playback or using the microphone. It reports readiness separately from first-audio timing. Preparation is session-only and explicit; it is not automatic startup loading. STOP unloads the prepared worker. First-phrase generation can still take several seconds after preparation.

The real local desktop audition completed with output muted. This verifies generation and playback lifecycle, not subjective voice quality. Ordinary phrase generation is still too slow for the conversational target.

## Optional Australian online audition

1. Create an Azure account and a **Speech** resource using Microsoft's [setup guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/overview#try-the-speech-service-for-free). Review the service's current account, pricing and region requirements before provisioning.
2. In the resource's **Keys and Endpoint** page, copy the region identifier and one Speech key.
3. Open HARMONY, open Settings, and enter those values under **Set up Azure Speech**. Paste the key only into the password field, never into chat or a project file.
4. Start with Natasha and Natural pacing. Save the connection, approve the fixed online preview, then choose **Hear HARMONY**. Saving validates and encrypts the settings locally; it does not verify the account with Microsoft.
5. Compare Freya and Annette by updating the saved connection (re-enter the key). Natural, Relaxed and Brisk affect pacing, not pitch. Every preview needs a fresh usage approval.
6. **Stop voice preview** ends playback; global **STOP** ends work and requires Resume. **Remove saved connection** deletes the local encrypted credential file; revoke the key in Azure if you also want to invalidate it at the provider.

No account has been connected and no live Azure synthesis has been verified. Voice preference is not speaker identity or authorization. The microphone must be off for auditioning.

## Implementation and limits

Supported Azure REST synthesis sends only the three displayed sample sentences, sequentially, to the selected region's fixed Microsoft endpoint. It receives raw 24 kHz mono PCM incrementally. A supervised Python worker feeds bounded chunks to a single chamber-owned Web Audio player. The renderer queues about 0.4 seconds before pulling more; worker pipe backpressure bounds producer buffering. STOP invalidates the session, closes the audio context, destroys the pipe and verifies child exit. Reload and renderer failure also cancel output.

The region, key and selected voice are encrypted using Electron's Windows protected storage in ignored `data/credentials/speech.enc`. No plaintext fallback, command-line key, renderer readback, audio file or provider error-body logging is provided. Windows protection does not isolate secrets from other applications running as the same Windows user.

`tts_first_audio_ms` measures preview start to first validated PCM. `playback_start_ms` measures the main process receiving the renderer's playback report; it is not an acoustic speaker measurement. Credential loading precedes these timings. No end-to-end conversational latency target has been demonstrated.

Tests cover credential schemas and encryption failures, PCM validation/order, backpressure-facing pull rules, cancellation races, synthetic renderer playback, companion STOP, missing-account denial and real Windows encryption round trips. Synthetic PCM is explicitly a fixture; it establishes no accent, naturalness or live-service performance. The setup screenshot uses the actual unconfigured UI; the audition screenshot comes from that synthetic integration fixture.

## Source and provider review

The pinned JARVIS audit found a custom Piper voice, optional Riva and an Edge fallback configured with British Thomas. The demo's exact selected provider cannot be established from configuration alone. HARMONY borrows the concept of interruptible streaming and selectable providers, with original interfaces and stricter fixed-script/permission boundaries; no JARVIS voice model or code was copied here.

An initial Edge TTS experiment produced PCM on October 11, then the unofficial endpoint rejected requests with HTTP 403 on October 12. It is not the active provider or fallback. Its LGPL notice is retained as evaluation provenance; its package is no longer a required dependency. Do not bypass endpoint access controls.

References: [Azure REST speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech), [Australian female voice catalogue](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts), [Electron protected storage](https://www.electronjs.org/docs/latest/api/safe-storage), and [JARVIS audit](JARVIS-REFERENCE-AUDIT.md).

## Remaining voice work

Account-connected listening and preference selection; partial model-text synthesis; complete wake/STT/model/TTS orchestration; interruption and echo handling during live conversation; separate stage profiling and measured real-world latency. Follow `LATENCY.md` for the complete streaming contract.
