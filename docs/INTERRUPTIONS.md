# Interruption engine and active observation (Phases 30 and 29)

Every proactive event is scored before anything happens.

## The decision
Each event has importance, urgency, confidence, relevance, an expiry and a repeat key. The score is importance × 0.5 + urgency × 0.35 + relevance × 0.15.

| Situation | Decision |
|---|---|
| Expired | IGNORE |
| A reminder or timer you set | CRITICAL: always said, in any mode, at any hour. You asked for it. |
| The same thing already raised in the last 30 minutes | STORE (not repeated) |
| Confidence under 0.5 | STORE |
| Ghost mode | Shown only |
| Quiet hours (10 PM to 7 AM) | Shown, unless the score is at least 0.9 |
| Focus mode | Said when free if the score is at least 0.8; otherwise shown |
| Normal | Interrupts at 0.85 or more when HARMONY isn't busy; said when free at 0.6 or more; shown at 0.35 or more; otherwise stored |

"Said" goes through the announcement queue, which already waits for a reply in progress and pauses listening. Shown notices appear in a tray above the reminders and can be dismissed. Up to 30 are kept in memory only.

## Sources
- **Reminders and timers:** now go through the engine. A reminder over 15 minutes late, for example after the PC slept, is no longer said.
- **Calendar heads-up:** when Calendar is connected, every 5 minutes she checks the next 15 minutes. About 10 minutes before a timed event she raises "Heads up: Unit 12 walkthrough at Building C starts in 10 minutes." Normally that's said when free; in focus mode or at night it's shown. Each event is raised once.
- **Active observation (Phase 29):** opt-in, under "Look at my screen" → "Also watch for new errors every 2 minutes". Every 2 minutes she reads the window in use (Windows OCR, nothing kept except the last error lines per window).
  - The first look at a window only learns what's already there.
  - A new error line raises "New on screen in Visual Studio Code: TypeError: …", which is normally shown, not spoken.
  - A banner shows while watching is on.
  - It pauses after STOP.
