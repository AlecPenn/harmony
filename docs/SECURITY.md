# Desktop boundaries

- Renderer sandbox and context isolation are enabled; Node integration and webviews are disabled.
- Each IPC call must come from an owned window's exact main-frame document URL. Control calls accept zero arguments; audio frames have a bounded typed schema and a session token. No arbitrary channel, command, file path or worker payload is exposed.
- Renderer-created windows, navigation and network requests are denied. The main process can create one fixed companion window. Content Security Policy permits bundled scripts/styles and denies connections, media, forms and objects.
- The camera is denied except for a moment the guardian asks for (face checks, which are off until you turn them on) or face setup: the main window's exact document, video only, for 8 seconds. The microphone is off by default and can be armed briefly only by explicit local test startup in the chamber; the companion cannot start or push audio. Voice preference is descriptive configuration, not a permission grant.
- Fixed health and offline speech workers are supervised. Speech models load only on demand. These children are not OS sandboxes; untrusted generated code must never be run through them. Audio is not written to disk.
- STOP cancels the current operation, ends the worker and requires explicit resume. The UI reports shutdown verification failure if it cannot establish that the worker exited.
- Runtime logging accepts only predefined metadata events. Private data, process stderr and arbitrary messages are not copied into logs.
- SQLite and the desktop profile are unencrypted development storage. Speech credentials alone use Windows protected storage in a separate encrypted file; there is no plaintext fallback. Other development storage must not contain secrets. General action authorization is not implemented.

Reviewed against [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security/) and [context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation).

These are implemented boundaries for the skeleton, not a production security certification. Do not add consequential tools until permissions, action journaling and verification ship with them.

- Voice audition requires chamber ownership, microphone off, a saved connection and explicit per-preview usage approval. Only fixed sentences and allowlisted voices reach a region-derived Microsoft endpoint. Redirects are refused; credentials travel over a private worker pipe and TLS, never command arguments or status snapshots. DPAPI does not protect against applications running as the same Windows user.

## The guardian: only you, only here

HARMONY's guardian decides who is talking, who is at the PC, and whether an action may happen. It runs entirely on this PC
and costs nothing. Code: `core/guardian.ts` (decisions), `core/guard-worker.ts` + `workers/guard/` (voice and face prints),
`core/companion.ts` (signed phone approvals), `apps/desktop/src/SecurityPanel.tsx` and `GuardLayer.tsx` (screens).

### Setting it up

1. Double-click **Set up security.cmd** in the HARMONY folder. It installs OpenCV (pinned hash) and four pinned models
   (about 110 MB in total; each is checked against its exact size and SHA-256 before use). It never runs again on its own.
2. In HARMONY: **Settings → Security → Teach HARMONY my voice**. Read five short sentences in your normal voice.
3. Optional: **Teach HARMONY my face** (three looks), then turn on **Use the camera to confirm it's me**.
4. Pair your phone (**Settings → Phone companion**) and keep the HARMONY page open on it (add it to your home screen).
   From then on, approvals go to the phone.
5. Optional: set a **duress phrase**.

### What it does

| Situation | What happens |
|---|---|
| You say "Harmony, …" | Your voice print is checked against the request's audio, at the same time as transcription (no added wait). |
| A voice that isn't yours | **Guest mode**: general questions only. No memory, history, mail, calendar, screen, files or actions, and nothing from the exchange is kept. Or, if you choose, she ignores them completely. |
| Too short to tell ("unsure") | Personal things are refused with "say it again a little longer, or type it". Public lookups (weather, news, web) still work. |
| She's about to touch the desktop (open an app or site, switch windows, press keys) | Your phone shows the request with three numbers. HARMONY says and shows one; tap that one. Each request works once, for 60 seconds. Optionally "trust this for 10 minutes". |
| No phone paired, and she's talking with you when an approval comes up | She also says three random words ("To approve, say: harbor, maple, tiger"), shown on screen too. Saying them approves, but only in your voice. A recording of you can't contain words picked a second ago, and someone else saying them doesn't match your voice print (that's logged). "No" or "cancel" in your voice refuses. Clicking Approve on the screen still works. |
| Requests keep being refused or missed (3 in 10 minutes) | Approvals pause for 10 minutes and your phone is alerted: someone may be trying to wear you down. |
| Windows locks, or you're away (default 15 minutes, no face seen) | She **locks**: private panels are blurred, only public questions are answered. She unlocks when she sees your live face, hears your voice (when face checks are off), or your phone unlocks her. |
| "Harmony, lock down", the phone's LOCK button, or the screen's Lock now | **Locked down**: only your paired phone (signed) can unlock. With no phone paired, the screen can unlock, after Windows Hello if it's set up. |
| Three unknown voices within two minutes | She locks and alerts your phone. |
| Someone holds up a photo or a screen showing your face | The liveness model rejects it; she locks down and alerts your phone. |
| Someone else is looking at the screen | **Privacy veil**: private panels are blurred while they're there. |
| Your duress phrase | She says only "Okay.", locks everything down and alerts your phone. |
| Changing security itself (settings, new voice or face, duress phrase, erasing) | Never while locked. With a phone paired, it must approve. This stops someone at an unlocked PC from enrolling their own voice or turning checks off. |

### How the protection works

- **Prints, not recordings.** The voice model turns about a second or more of speech into 256 numbers that describe how
  a voice sounds, not what was said. The face model turns a face into 128 numbers. Audio and images are used once in
  memory and zeroed. The camera opens for about a second at a time (on the wake word, now and then while you work, and when
  you come back), then closes.
- **Cancelable prints.** Before storage, every print is multiplied by a secret random rotation made from a 256-bit key.
  Similarity between prints is unchanged, but the stored numbers are not your real print. A stolen copy is useless without
  the key, and **Erase everything** makes a new key, so every old copy becomes worthless.
- **Sealed vault.** Prints, the rotation key and the duress phrase (stored only as an HMAC) are encrypted with Windows
  encryption (DPAPI), tied to your Windows account. Without it, nothing is enrolled and checks stay off.
- **Learning only when confirmed.** HARMONY keeps learning your voice from conversations, but only from requests where the
  camera also confirmed it was you live, so nobody can teach her their voice by talking to her.
- **Calibrated matching.** Your own clips set your match line: the average similarity between them, minus a margin,
  clamped to a safe range. Below the line minus a band is a stranger; in between is "unsure".
- **Liveness.** MiniFASNetV2-SE scores each face as real or spoof (photo, screen). Only a live match counts. A match that
  looks like a spoof is treated as an attack.
- **Phone approvals that can't be replayed or forged.** At pairing, the phone gets a 256-bit secret, which HARMONY stores
  sealed. After that, every request is signed (HMAC-SHA256 over method, path, time, a random nonce and the body hash), so
  the secret never crosses the Wi-Fi again. Requests more than a minute old, reused nonces and changed bodies are refused.
  Approving and unlocking require a signature; a bare token from an older pairing can't approve anything (pair again).
  **Number matching** stops blind "approve" taps and push-fatigue attacks.
- **Least privilege by default.** Only weather, news, web search, reading a web page and the skills list are public.
  Everything else needs the owner: a recognised voice, a click in HARMONY, or your phone.
- **A record.** Settings → Security → *What happened* lists locks, unlocks, unknown voices, spoof attempts and approvals
  (times and short descriptions only, never prints). It keeps the newest 500.

### Models (pinned in `docs/GUARD-MODELS.json`)

| Use | Model | Licence |
|---|---|---|
| Voice | WeSpeaker ResNet34-LM (VoxCeleb), via sherpa-onnx 1.13.8 | CC-BY-4.0 (model), Apache-2.0 (runtime) |
| Face detection | YuNet 2023mar, OpenCV Zoo | MIT |
| Face recognition | SFace 2021dec, OpenCV Zoo | Apache-2.0 |
| Liveness | MiniFASNetV2-SE quantized, suriAI/face-antispoof-onnx @ 2f8dd93 (98.2% on CelebA-Spoof) | Apache-2.0 |

All were checked on GitHub and Hugging Face on October 21, 2026. CAM++ and ERes2NetV2 voice models were considered; the
ResNet34-LM model was kept because HARMONY already pinned it, it's strong on English, and it's small enough for the CPU
while the GPU runs the brain. OpenCV 5.0.0.93 runs YuNet and SFace.

### Limits, honestly

- The phone page must be open (it checks every 2 seconds). Real push notifications need HTTPS, which is still to come.
- The phone page is served over your home Wi-Fi without HTTPS. Signing protects the secret and the approvals from anyone
  watching, but someone who controls your network could tamper with the page itself. HTTPS for the companion would close
  that.
- Challenge words beat replayed recordings, not a live voice clone that can say anything. A real-time clone fast enough
  to say fresh words in your voice would still need to fool the voice print, which is why the phone stays the stronger
  check and challenge words are offered only when no phone is paired.
- Voice prints can be fooled by a very good voice clone. That's why desktop actions still need the phone, and why face
  checks add liveness.
- Face checks need decent light. In the dark she falls back to voice and phone.
- Thresholds are first estimates. After a week of use, *What happened* shows whether to adjust them.

### Checking it

`npx vitest run tests/guardian.test.ts tests/companion.test.ts tests/conversation.test.ts tests/guard-worker.test.ts`
and `pytest workers/guard`. `HARMONY_TEST_PYTHON=<venv python>` runs the worker against the real models.

## Security drills (October 22, 2026)

Once a month (when Alec has been away for 10 minutes; at the latest after 35 days), on "run a security drill", or from
Settings, HARMONY attacks herself and reports what held. There are ten drills:

1. **Phone approvals:** a replayed one, a five-minute-old one, one with a changed body, and one that's only a bare token.
2. **A stranger's voice** asking for memory.
3. **A photo of Alec's face** held to the camera.
4. **The duress phrase.**
5. **Hostile web text** containing function-call markup and a fake system message.
6. **An email** trying to steer a drafted reply.
7. **Forged Spiral Time results.**
8. **A lookalike window, frame or page** calling private functions.
9. **A certificate chain through eMudhra.** This drill also checks HARMONY's live trust store.
10. **A tampered or wrongly-keyed off-PC backup.**

Every drill runs on a sandbox: an in-memory database, throwaway keys and a temporary folder. None can lock the real
HARMONY, approve anything or touch real data. The result goes in Security → What happened, and any drill that doesn't
hold raises an alert. The newest report is kept in Settings → Security drills.

## The learning wake word (October 22, 2026)

- The offline detector still hears "Harmony". A learner then judges the word's sound (13 MFCCs, compared with Alec's
  examples by subsequence DTW, scored by a small logistic model) and can send a wake back to waiting.
- It learns from use. A request after a wake (in a voice that isn't a stranger's) makes it a good example. Nothing
  following, or "never mind" / "that wasn't me", makes it a false wake. A rejected "Harmony" followed within 8 seconds by
  an accepted one and a request counts as a miss, and is learned as Alec. The threshold is re-chosen after every lesson
  to keep misses under 5%, and it is loosened when misses are caught.
- It never blocks a wake until it has 8 examples of Alec and 3 of other sounds.
- The examples are compact sound fingerprints of the word (about 1 KB each, at most 40 good and 40 false), sealed with
  Windows encryption in credentials/wake-profile.enc. No recordings are kept. Teaching and resetting it are security
  changes (phone approval when paired).
- It decides when HARMONY *listens*, never what she will *do*: requests are still checked against the voice print and
  the guardian.

## Email triage (October 22, 2026)

- Google access stays **read-only** (calendar.readonly and gmail.readonly). HARMONY can't send, delete or change email.
  "Open in Gmail" opens Gmail's own compose window, filled in, for Alec to check and send himself.
- Sorting runs on this PC with plain rules (labels, who it's to, questions, deadlines, money, automated senders), and
  each email shows why it was sorted that way. Nothing is sent to any AI service.
- Drafts come from the **local** brain. Only the newest message's text is read (quoted history is dropped, up to 4,000
  characters). The prompt marks the email as data to ignore instructions in, no functions are offered while drafting,
  and tool markup is stripped from the result.
- The Inbox panel and the voice brief are hidden while HARMONY is locked. Unknown voices are refused (guest mode).

## Off-PC backups (October 22, 2026)

The daily backup (database and settings) is also copied, encrypted, to places off this disk: the OneDrive folder
(OneDrive syncs it to the cloud), another drive, or a USB stick (Settings → Backups → Off-PC copies).
- **AES-256-GCM** with a random 256-bit **recovery key**, shown once as 13 groups of 4 characters. Alec saves it, then
  proves it by typing the last group. No copies are made until he does. The file header (format, key fingerprint, nonce)
  is authenticated, so a changed byte anywhere is detected.
- The key is not tied to Windows, so the copies open on a new PC. On this PC HARMONY keeps it sealed with Windows
  encryption so the daily copies are automatic.
- **Not included:** voice and face prints, passwords, tokens and API keys. They stay sealed to this Windows account.
  Prints can be re-taught in a minute; keys can be re-imported.
- Turning it on or off, and restoring, are security changes (your phone approves when one is paired). A restore happens
  on the next start, and the current database is kept beside it.
- The newest 14 copies are kept in each place. The daily self-check warns if copies are off, or more than 3 days old.

## Incident response: October 22, 2026

Two breaches in the news, and what they mean for HARMONY.

**1. eMudhra certificate authority key compromise (reported October 21).** Anyone holding a stolen CA key can make
HTTPS certificates that browsers and Node trust, so they could impersonate any site on a network they control.
- HARMONY now **distrusts eMudhra/emSign** (`docs/DISTRUSTED-CAS.json`). Their roots are removed from Node's trust
  store (her lookups, world feeds, Google sign-in, OpenAI, downloads), and Chromium refuses any chain that includes
  them, in every window, including God's Eye. Cross-signed intermediates are caught because each certificate in the
  chain is checked. Refusals are recorded in Security → What happened.
- Model, OpenCV, God's Eye and package downloads were already pinned by SHA-256 or lockfile integrity hashes, so a
  forged site couldn't swap them.
- Limit: Node checks the root of a chain, not every intermediate, so an eMudhra intermediate cross-signed by another
  trusted root would still pass in Node. Chromium catches that case. Windows itself and your normal browser are outside
  HARMONY. Chrome and Edge get CA distrusts through their own updates, so keep them updated.
- Adding a CA after a future incident is one line in `docs/DISTRUSTED-CAS.json`.

**2. GhostAction: hijacked GitHub accounts and secret theft (spiking October 8–9).** Attackers took over developer
accounts, added GitHub Actions workflows that sent out repository secrets (npm, PyPI and cloud tokens, AI API keys), and
can then publish poisoned packages.
- **The owner's GitHub, checked October 22:** every repository and branch. The only workflows use the built-in token
  and send nothing out. No keys or tokens are in any branch's files.
- **God's Eye View now installs with `--ignore-scripts`:** no package can run code at install time, which is the usual
  way a poisoned package gets in. It runs normally without them (checked). Its Puppeteer test browser isn't downloaded.
- **Pins wait before moving.** A new God's Eye View commit, model or package version is adopted only after it's at
  least 7 days old and its diff has been looked at, so hijacks are usually caught upstream first. The current pin
  (e84e74c) was taken the day it was released, before this rule. Its source was reviewed while integrating it.
- **Check security.cmd** does a read-only check for leaked secrets in tracked files (names and lines only), GitHub
  workflows, private files tracked by git, npm registry signatures, God's Eye install scripts, the distrust list, and
  keys left in plain text in v9's server.py.
- **For Alec to do:**
  1. Turn on a passkey or authenticator two-factor login for GitHub, if it isn't on already.
  2. On GitHub, under Settings → Applications and Settings → Developer settings → tokens, remove anything you don't recognise.
  3. Move your keys out of v9's `server.py` once they're imported.
  4. Consider pinning `actions/checkout` and the `pip install` versions in the two `sync-songs.yml` workflows. Those workflows can push to your sites, so a hijacked package there could change them.
