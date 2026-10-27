# Skill registry (Phase 34)

Every capability is a skill with a fixed manifest in `core/skills.ts`:
- id, name, version and author
- permissions
- the model functions it provides
- dependencies
- the test file that covers it
- a hash of the manifest

## What you can do
- **"What skills do you have?"** She lists what's on, what's off, and what isn't set up or connected.
- **"Disable computer control" / "Enable research."** Names and aliases both work ("browser control", "web search", "focus mode").
  - It's journaled, and undo restores the previous state.
  - Settings shows the same list with switches.

## Rules
- A skill that's off is invisible to the brain: its functions aren't offered. If one is somehow requested anyway, it's refused with "… is turned off".
- Dependencies apply. For example, Research needs Web lookups, and Recall needs Memory.
- Core skills (Status, Skill registry) can't be turned off.
- Turning a skill on never grants anything beyond the permissions in its manifest.
- Calendar, Gmail, Screen, Computer and Workspace show as not available until they're connected or set up.

## Not yet
Self-building skills (Phase 33). That needs a sandbox and the owner-approval step, and comes later.
