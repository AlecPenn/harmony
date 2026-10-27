# Status, Workspace Time Machine, modes and ideas (Phases 27 and 36, Focus, Ghost, Idea)

## "Harmony, status." (Phase 36)
She gives a short spoken rundown, built only from real data. Empty sections are skipped.

| Section | What it covers |
|---|---|
| Time | The date and time now |
| Reminders | Reminders and timers still to come today |
| Project | The current project, its open tasks and any blocker |
| Calendar | Today's events, when Google is connected |
| Email | Unread mail from the last day, when Google is connected |
| Memory | How many things she remembers and how search works |
| Alerts | Google needs reconnecting; computer control is off |

- The Google checks run in parallel with a 5-second limit. If one fails, she says it couldn't be checked; she never invents it.
- It's a read-only lookup, answered in the pass that can't run actions.

## "Save my place." / "Put me back." (Phase 27)
- **Save** records:
  - the open app windows (app and title only), each matched to its Start menu app
  - the current project
  - its open tasks

  It's a journaled write; undo deletes the snapshot. She keeps the latest 60.
- **Put me back**, optionally "to Tuesday night", "yesterday" or "this morning":
  - switches to the saved project
  - reopens only the apps that aren't already open, each as its own journaled, undoable `computer.open_app`
  - names the browser tabs you had open
  - with computer control off, tells you what was open instead
- **Not stored yet:** monitor placement, browser addresses (Windows only gives tab titles), open files and terminal folders. The spec lists these; they need more access than the helper has.

## Modes
- **Focus** ("lock in"):
  - the screen calms down: headings and background fade, and the orb is muted
  - a LOCKED IN chip appears with "Back to normal"
  - the session is timed: "You were locked in for 1 hour 25 minutes."
- **Ghost** ("go ghost"):
  - everything collapses except a small presence, the command bar and STOP
  - voice keeps working
- **Every mode:** reminders and timers you set are still spoken, because you asked for them, and STOP is never hidden.
- **Safety:** switching modes is journaled; undo restores the previous mode.

## Ideas
- "Harmony, idea: …" is saved at once, with no discussion, to the current project if there is one.
- In the Projects panel, ideas move through Explore, Attack, Test, Build and Archive, and can be deleted (two clicks).
- Ideas are included in memory search ("what was that idea about headphones?").

## Storage
Migration 11 adds the `workspace_snapshots` and `ideas` tables. The mode lives in `memory_settings`.

## Model functions
`status_report`, `workspace`, `set_mode`, and `project_note` with kind "idea". With everything enabled, that's 20 functions, the new limit. `npm run local:tools-check` has 7 more requests for these.
