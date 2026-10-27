# Working on HARMONY (instructions for AI agents)

HARMONY is worked on by more than one AI agent — currently Claude and ChatGPT — **one at a time**, with Alec (the
owner) handing over between them. These rules are what keep that from going wrong. Read the whole file before you do
anything else.

## The three files

| File | What it is | When you touch it |
| --- | --- | --- |
| `AGENTS.md` | These rules | Read every session. Change only if Alec asks |
| `docs/ROADMAP.md` | The plan: phases, "Done when" tests, decisions | Read every session. Tick items and record decisions as you go |
| `docs/HANDOFF.md` | The log between agents: newest entry at the top | Read the top entry first. Write a new entry before you stop |

The repo is the single source of truth. Chat history from any agent does not carry over — if it is not in these files
or in a commit, the next agent does not know it.

## Starting a session

1. `git pull origin main`. If it fails or shows changes you did not expect, stop and tell Alec.
2. Read the top entry of `docs/HANDOFF.md`. It says what was just done and what is next.
3. Read `docs/ROADMAP.md`. Work the lowest unfinished item unless the handoff or Alec says otherwise.
4. Run `npm install` if `node_modules` is missing, then `npm run typecheck` and `npm test`. If they already fail
   before you change anything, record that in your handoff entry before you start — you must not be blamed for, or
   build on top of, an existing break without saying so.

## While working

- **Small commits, straight to `main`.** Only one agent works at a time, so branches are not required. Each commit
  does one thing and says why.
- **Never** force-push, rebase published commits, rewrite history, or delete branches.
- **Never commit personal data.** Anything about Alec (home town, résumé, accounts, family, keys) belongs in
  `data/profile.json` or `.env`, both git-ignored. See `docs/PROFILE.md`. The repo is public.
- **Packs never execute code.** Skins, voices, themes and sound packs are declarative files (JSON, GLB, shaders,
  audio) only. No `.js` entry points, no `eval`, no dynamic `import()` of pack content. This is a security boundary.
- **Respect the hardware.** The target PC has a GTX 1650 (4 GB VRAM). Nothing may slow down hearing, thinking or
  speaking. Rendering yields to audio and inference, always.
- **Prefer maintained libraries** over hand-rolled code, and check the current version on GitHub / Hugging Face before
  adding one. Record every new dependency and its licence in `docs/THIRD-PARTY.md`.
- **Keep the manual path working.** `Launch HARMONY.cmd` and the README install must keep working.
- Match the existing code style (compact TypeScript, plain-English doc comments) rather than reformatting files.

## Ask Alec first — do not just do these

- Deleting files or features, or changing the licence
- Anything in Phase 7 (paid work) — it is parked until the gate in the roadmap is met
- Adding a cloud service, account, or anything that costs money
- Major dependency upgrades (Electron, Node, Python major versions)
- Posting anywhere public (issues, releases, Reddit, etc.)
- Anything you are unsure is reversible

## Finishing a session

1. `npm run typecheck` and `npm test` must pass, or the failure must be written up in your handoff entry.
2. Tick what you finished in `docs/ROADMAP.md` and record any decision you made, with the reason.
3. Add a new entry at the **top** of `docs/HANDOFF.md` using the template in that file. Be specific: file names,
   what you verified and how, what is half-done, and the exact next step.
4. Commit and `git push origin main`. Confirm the push succeeded.
5. Tell Alec in one or two lines that the handoff is written and pushed.

If you get blocked, do not guess your way through it. Write the blocker in the handoff, push what is safe, and stop.

## Commit messages

First line under 72 characters, imperative ("Add pack loader checksum check"). Body explains why. End with a line
naming the agent, e.g. `Agent: ChatGPT` or `Agent: Claude`, so the history shows who did what.
