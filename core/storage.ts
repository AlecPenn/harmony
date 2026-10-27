import {WORKLOG_MIGRATION} from './worklog.ts';
import {SPEED_MIGRATION} from './speed-scoreboard.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const migrations = [
  `CREATE TABLE journal (
    id INTEGER PRIMARY KEY,
    time TEXT NOT NULL,
    system TEXT NOT NULL,
    event TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('info','warning','error'))
  );`,
  `CREATE TABLE actions (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    person_id TEXT NOT NULL, turn_id TEXT NOT NULL, intent TEXT NOT NULL,
    tool_id TEXT NOT NULL, tool_version INTEGER NOT NULL,
    risk TEXT NOT NULL, permission TEXT NOT NULL, request_hash TEXT NOT NULL,
    inputs_hash TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL,
    result_hash TEXT, rollback_reference TEXT, undo_result_hash TEXT
  );
  CREATE TABLE action_events (
    action_id TEXT NOT NULL REFERENCES actions(id), revision INTEGER NOT NULL,
    time TEXT NOT NULL, state TEXT NOT NULL,
    PRIMARY KEY(action_id, revision)
  );
  CREATE INDEX actions_updated ON actions(updated_at, id);`,
  `CREATE TABLE reasoning_budgets (
    id TEXT PRIMARY KEY, limit_micros INTEGER NOT NULL CHECK(limit_micros >= 0)
  );
  CREATE TABLE reasoning_reservations (
    id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES reasoning_budgets(id),
    model_id TEXT NOT NULL, estimate_version TEXT NOT NULL,
    ceiling_micros INTEGER NOT NULL CHECK(ceiling_micros >= 0),
    actual_micros INTEGER CHECK(actual_micros >= 0),
    state TEXT NOT NULL CHECK(state IN ('RESERVED','DISPATCHED','UNCERTAIN','SETTLED','RELEASED'))
  );
  CREATE INDEX reasoning_budget_entries ON reasoning_reservations(budget_id, state);`,
  `ALTER TABLE reasoning_reservations ADD COLUMN request_hash TEXT;`,
  `ALTER TABLE reasoning_budgets ADD COLUMN person_id TEXT;`,
  `CREATE TABLE reminders (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('reminder','timer')),
    text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 200), due_at TEXT NOT NULL, created_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PENDING','FIRED','CANCELLED')), fired_at TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1))
  );
  CREATE INDEX reminders_pending ON reminders(state, due_at);`,
  `CREATE TABLE memories (
    id TEXT PRIMARY KEY, text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 200), created_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('voice','typed','screen')), state TEXT NOT NULL CHECK(state IN ('ACTIVE','FORGOTTEN'))
  );
  CREATE INDEX memories_active ON memories(state, created_at);`,
  `CREATE TABLE web_lookups (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('weather','news','search')),
    query TEXT NOT NULL CHECK(length(query) <= 200), sources TEXT NOT NULL CHECK(length(sources) <= 8000)
  );
  CREATE INDEX web_lookups_at ON web_lookups(at);`,
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), description TEXT NOT NULL CHECK(length(description) <= 300),
    goals TEXT NOT NULL CHECK(length(goals) <= 600), status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','DONE')),
    world TEXT NOT NULL, created_at TEXT NOT NULL, last_active_at TEXT NOT NULL
  );
  CREATE TABLE project_notes (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL CHECK(kind IN ('task','decision','blocker','note')),
    text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 240), open INTEGER NOT NULL CHECK(open IN (0,1)), created_at TEXT NOT NULL, closed_at TEXT
  );
  CREATE INDEX project_notes_project ON project_notes(project_id, kind, open, created_at);
  CREATE TABLE project_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `ALTER TABLE memories ADD COLUMN project_id TEXT;
  ALTER TABLE memories ADD COLUMN importance INTEGER NOT NULL DEFAULT 2 CHECK(importance BETWEEN 1 AND 3);
  CREATE TABLE episodes (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, heard TEXT NOT NULL CHECK(length(heard) BETWEEN 1 AND 600),
    reply TEXT NOT NULL CHECK(length(reply) <= 1200), project_id TEXT
  );
  CREATE INDEX episodes_at ON episodes(at);
  CREATE TABLE embeddings (item TEXT NOT NULL, model TEXT NOT NULL, vector BLOB NOT NULL CHECK(length(vector) <= 16384), PRIMARY KEY (item, model));
  CREATE TABLE memory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `CREATE TABLE workspace_snapshots (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, project_id TEXT, label TEXT NOT NULL CHECK(length(label) <= 80), data TEXT NOT NULL CHECK(length(data) <= 20000)
  );
  CREATE INDEX workspace_snapshots_at ON workspace_snapshots(at);
  CREATE TABLE ideas (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 400), project_id TEXT,
    stage TEXT NOT NULL CHECK(stage IN ('NEW','EXPLORE','ATTACK','TEST','BUILD','ARCHIVE'))
  );
  CREATE INDEX ideas_at ON ideas(at);`,
  `CREATE TABLE missions (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('research')),
    objective TEXT NOT NULL CHECK(length(objective) BETWEEN 3 AND 300), project_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','DONE','FAILED','CANCELLED')), stage TEXT NOT NULL CHECK(length(stage) <= 200),
    budget INTEGER NOT NULL CHECK(budget BETWEEN 1 AND 30), used INTEGER NOT NULL DEFAULT 0, deadline TEXT NOT NULL,
    state TEXT NOT NULL CHECK(length(state) <= 40000), report TEXT CHECK(length(report) <= 6000), heard INTEGER NOT NULL DEFAULT 0 CHECK(heard IN (0,1))
  );
  CREATE INDEX missions_status ON missions(status, created_at);`,
  `CREATE TABLE guard_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL CHECK(length(kind) <= 20), detail TEXT NOT NULL CHECK(length(detail) <= 200)
  );`,
  WORKLOG_MIGRATION,
  SPEED_MIGRATION
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    const rows = db.prepare('SELECT version FROM migrations ORDER BY version').all();
    if (rows.length > migrations.length || rows.some((r, i) => r.version !== i + 1)) throw new Error('Unsupported database migration history');
    for (let i = rows.length; i < migrations.length; i++) {
      db.exec(migrations[i]);
      db.prepare('INSERT INTO migrations VALUES (?, ?)').run(i + 1, new Date().toISOString());
    }
    db.exec('COMMIT');
    return db;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    db.close();
    throw error;
  }
}
