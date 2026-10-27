import type { DatabaseSync } from 'node:sqlite';

// Only predefined metadata is accepted. No user text, tool payloads or credentials.
const events = {
  'health.started': 'core',
  'health.passed': 'core',
  'health.failed': 'core',
  'runtime.started': 'core',
  'runtime.ready': 'core',
  'runtime.failed': 'core',
  'runtime.stop_requested': 'core',
  'runtime.stopped': 'core',
  'runtime.resumed': 'core'
} as const;
export function record(db: DatabaseSync, event: keyof typeof events, severity: 'info' | 'warning' | 'error' = 'info') {
  if (!Object.hasOwn(events, event)) throw new Error('Unregistered log event');
  const entry = { time: new Date().toISOString(), system: events[event], event, severity };
  db.prepare('INSERT INTO journal(time, system, event, severity) VALUES (?, ?, ?, ?)')
    .run(entry.time, entry.system, entry.event, entry.severity);
  return entry;
}
