# Projects and "Where was I?" (Phases 25–26)

HARMONY keeps track of what you're working on, so you can pick a project back up without explaining it again.

## What you can say
- "Switch to Artist's Studio." Part of a name works too, such as "switch to studio" or "music".
- "Start a new project called Moonlight Sessions." This creates the project and makes it the current one.
- "Add a task to upload the October catalog."
- "We decided to use CC0 for everything." This records a decision.
- "I'm stuck on Suno export limits." This logs a blocker.
- "I finished the catalog upload." This closes the open task that matches best.
- "Where was I?" or "Where did I leave off on Writing?"

Notes always go to the current project. If no project is current, HARMONY asks which one.

## How it answers "Where was I?"
The answer comes only from what has been stored:
- when you last worked on the project
- the open tasks, newest first
- unresolved blockers
- the latest decision
- recent notes

The model gets these as a lookup report, labelled as data and not instructions. It answers in a second pass, and nothing it asks for in that pass is run. She doesn't invent progress, and she says so when nothing has been recorded.

## Safety
These are the same rules used for reminders and memory:

| Action | Risk | Undo |
|---|---|---|
| Start a project | LOW_RISK_WRITE, journaled | Removes the new project and returns to the one you were on |
| Switch project | LOW_RISK_WRITE, journaled | Switches back |
| Add a note | LOW_RISK_WRITE, journaled | Removes the note |
| Mark done | LOW_RISK_WRITE, journaled | Reopens the task |
| The summary | SAFE (read-only) | — |

Deleting a project is only possible from the Projects panel, and it takes two clicks. Voice can't delete one.

## Storage and the panel
Migration 9 adds three tables: `projects`, `project_notes` and `project_state`, which holds the current project. Everything is local SQLite.

On first run, the store adds starter projects, one per atmosphere (rename them or add your own by voice):

| Project | Atmosphere |
|---|---|
| HARMONY | default |
| Writing | prismatic |
| God's Eye | war-room |
| Music | broadcast |
| Artist's Studio | gallery |
| Business | executive |

The Projects panel in Settings lets you switch, start, add notes, mark notes done, mark projects done, change a project's atmosphere and delete projects. The current project's atmosphere changes the app's accent colors. The 3D orb keeps its own colors for now.

## Checks
- `tests/projects.test.ts`
- `npm run local:tools-check`, which includes six project requests sent to the real local model
