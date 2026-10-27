# Self-diagnostics and backups (Parts LX and LXVIII)

## "Harmony, why are you slow?"
She reports the measured timings of her last spoken reply, counted from when you stopped talking:

| Part | What it measures |
|---|---|
| Speech to text | Turning your words into text |
| Lookup or action | Any web lookup or action in the reply |
| Brain | Until the first words |
| Voice | From the first words to the first sound |
| Total | Until she started speaking |

She also gives how long the conversation took to start and how long the brain took to load, then names the slowest part and a plain reason. Only measured numbers are reported. It's the `status_report` function with focus "speed", answered in the pass that can't run actions.

## Backups
- **What's saved:** memory, projects, reminders, ideas, research, workspace snapshots and settings.
- **What's never saved:** credentials. The encrypted sign-ins stay put, and they only work under this Windows account anyway.
- **How:**
  - a consistent SQLite snapshot (`VACUUM INTO`) plus the settings file
  - automatically once a day, 30 seconds after start, newest 7 kept
  - or "Back up now" in Settings
- **Restore:**
  - two clicks in Settings marks a backup for the next start
  - on that start, the current database is kept as `harmony-before-restore.sqlite` and the backup takes its place
  - a pending restore can be cancelled

## Updates (Part LXIX)
These are still manual: you build after each commit. Signed self-updating with self-test and rollback comes after the desktop is stable, and there are no silent updates.
