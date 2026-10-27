# Reminders and timers

## Checkpoint — October 19, 2026

HARMONY can set, list and cancel reminders and timers when you ask by voice ("Talk to HARMONY") or in the typed "Ask HARMONY · free on this PC" box. Everything is stored and run on this PC.

### How a request becomes an action
1. The local model (Qwen3.5-4B) is offered four functions in the exact format of its own chat template: `set_reminder`, `set_timer`, `list_reminders` and `cancel_reminder` (`core/assistant-actions.ts`, `reminderModelTools`). Functions are only offered on the cache-exact `/completion` route.
2. `ToolCallFilter` watches the streamed reply. Function-call markup is held back even when split across chunks, so it never reaches the screen or the voice. Text before the call is shown and spoken as usual.
3. `parseToolCalls` reads at most two calls (Qwen's XML style, or the older JSON style), with bounded names and values. A request grants nothing.
4. `AssistantActions` validates the request in plain code. Text is cleaned and capped at 160 characters; times come from "minutes from now", or a clock time with an optional date ("today", "tomorrow", a weekday, or YYYY-MM-DD) in the PC's local time zone; a clock time without a date that has passed means tomorrow; everything is limited to one year ahead (timers to one day) and 100 pending items. Problems are explained in a plain sentence ("That time has already passed.").
5. The action runs through the existing `ToolDispatcher` and `ActionJournal`, under a `PermissionPolicy` that allows only `reminders.set` and `reminders.cancel` as low-risk writes, for the local desktop person.
6. HARMONY speaks and shows a **fixed confirmation** describing what actually happened ("Got it. At 4:30 PM, I'll remind you: pick up the kids."). The model's own words are never taken as proof.
7. The conversation history keeps the model's raw call, the function result (as a `tool` turn rendered as `<tool_response>`) and the confirmation, so follow-ups like "cancel that" work.

### Low-risk writes in the dispatcher (security change)
Before this, the dispatcher ran only SAFE read tools. It now also runs `LOW_RISK_WRITE` tools, but only when all of these hold:
- the policy explicitly allow-lists the tool id (`lowRiskWriteTools`);
- the tool provides `rollbackReference(result)` and `undo(reference)`;
- the reference is a valid journal identifier, recorded with SUCCEEDED.

If anything fails after the effect (verification, permission, cancellation), the effect is undone before the failure is reported. A tool that returns an unusable reference is never recorded as a success. `ToolDispatcher.undo()` reverses a recorded write (SUCCEEDED → ROLLING_BACK → UNDONE or UNDO_FAILED). CONFIRM and RESTRICTED tools remain disabled. The read-only orchestrator and task planner still accept SAFE tools only.

### Firing
`ReminderScheduler` wakes for the next due item and at least every 30 s, so a sleeping PC or a clock change catches up on wake. Each reminder fires exactly once (atomic PENDING → FIRED). On firing, HARMONY:
- shows a Windows notification and flashes the taskbar if the window is not focused;
- shows a pink banner in the chamber until you press Dismiss;
- **speaks** it ("Reminder: pick up the kids." / "Time's up. Your timer for 10 minutes is done.") if HARMONY is running (not STOPPED) and the item is less than 15 minutes overdue.

During a conversation the announcement waits for the current reply, pauses listening, speaks, then resumes. Without a conversation, HARMONY warms the Piper voice, speaks, and unloads it again. Announcements queue; STOP or ending a conversation cancels them. Cold Piper start on this PC can take several seconds, so a spoken reminder may lag its notification.

### On screen
`ReminderTray` above the command bar: banners for fired reminders, plus "Coming up" with Cancel buttons. On-screen Cancel goes through the same journaled dispatcher path.

### Limits
- HARMONY must be open for reminders to fire. Reminders that came due while it was closed fire (shown, not spoken) the next time it starts.
- Whether the small local model reliably asks for the right function is not yet measured on the real PC: run `npm run local:tools-check` (a dry run that stores nothing).
- No recurring reminders yet.
