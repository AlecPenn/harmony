# H.A.R.M.O.N.Y.
**Highly Advanced Reminder Machine Occasionally Nagging You.**

A personal voice assistant that runs on your own Windows PC. You talk, she answers out loud, and she can set
reminders, look things up, read your screen, run your music, keep a work log, plan overnight research, and show a
live 3D globe of what's happening in the world. Her hearing, brain and voice run on the PC itself; nothing you say is
sent anywhere, and the internet is only used for things that need it (weather, news, searches, live world data).

> “System nominal. Your life choices remain outside warranty.”

Built by Alec Penn as a first real project, with a lot of help from Claude. It's tuned for a modest PC
(GTX 1650 with 4 GB, a 4-thread CPU), so if it runs there, it runs on most gaming PCs from the last several years.

## What she can do

- **Talk naturally.** Say “Harmony” anywhere in a sentence. She knows when you've finished, answers in under a second
  for simple things, and stops when you say “stop” or hold up your palm.
- **Reminders and timers**, by voice, with undo.
- **Remember things you ask her to** (and nothing you didn't), and find them again by meaning.
- **Look things up:** weather, news, web search, Wikipedia, bus arrivals (Madison Metro), and public world feeds:
  earthquakes, severe weather, wildfires, hurricanes, space weather, airport delays, exploited vulnerabilities.
- **God's Eye:** a live 3D globe (flights, ships, satellites, cameras, GPS jamming) she can open, fly around and
  answer questions from.
- **Your PC:** open apps and websites, switch windows, music and volume, read the window you're looking at.
- **Projects and a work log:** “add a task”, “we decided…”, “where was I?”, “new job, unit 214, leaking faucet”.
- **Email and calendar (optional, read-only):** a morning triage of what needs you; she can't send email.
- **Overnight research (Spiral Time):** save questions for Claude to research while you sleep.
- **Security:** voice and face checks for risky actions, a lock when you're away, secrets masked before anything
  leaves the PC, and monthly self-attack drills.
- **Look after herself:** one-click updates with rollback, daily backups, offline mode, Wi-Fi reconnect, speed
  tracking.

How it all fits together: **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**.

## What you need

- Windows 10 or 11 (64-bit). HARMONY is Windows-only today.
- An NVIDIA graphics card with 4 GB or more for the brain (other cards can use the slower Vulkan or CPU engines).
- 16 GB of RAM recommended, about 8 GB of free disk space, a microphone and speakers.
- [Node.js 24.14](https://nodejs.org) and [Python 3.13](https://www.python.org/downloads/windows/) with the "py" launcher.

## Set up

```powershell
git clone https://github.com/AlecPenn/harmony.git HARMONY
cd HARMONY
npm ci
npm run build
```

Then, in the HARMONY folder:

1. **Set up HARMONY.cmd**: Python environments, hearing, wake word, end-of-turn model and voice
   (about 1.5 GB of downloads, all checked against pinned hashes).
2. **Set up local brain.cmd**: llama.cpp and the Qwen3.5 4B model (about 3 GB).
3. Optional: **Set up security.cmd** (voice and face checks), **Set up God's Eye.cmd** (the globe), **Set up memory
   search.cmd** (search memories by meaning).
4. **Launch HARMONY.cmd**, then press **Talk to HARMONY**.

Your settings, memories and models live in the `data` folder, which git ignores. Personal defaults (like the résumé
the job scout uses) go in `data/profile.json`; see `docs/PROFILE.md`.

## Check it

```powershell
npm run typecheck
npm test
npm run build
```

**Check brain.cmd** runs 52 everyday requests through the real brain on your PC and scores the answers. **Check
security.cmd** runs the security drills.

## Licence

MIT, see [LICENSE](LICENSE). HARMONY downloads and runs other people's models and engines (llama.cpp, Qwen, Whisper,
Parakeet, Piper, Vosk, God's Eye View and more), each under its own licence: see
[docs/THIRD-PARTY.md](docs/THIRD-PARTY.md).
