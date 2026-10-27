import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, validateConfig } from '../packages/config/index.ts';
import { openDatabase } from '../core/storage.ts';
import { record } from '../packages/logging/index.ts';

test('config rejects malformed and unknown settings and returns an independent copy', () => {
  const config = validateConfig(defaults);
  config.permissions.writesEnabled = true;
  assert.equal(defaults.permissions.writesEnabled, false);
  for (const value of [null, {}, { ...defaults, secret: 'oops' }, { ...defaults, budget: { monthlyLimitUsd: -1 } }, { ...defaults, voice: { enabled: 'yes', retainAudio: false } }]) {
    assert.throws(() => validateConfig(value));
  }
});
test('migration and journal survive reopen without duplicating migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harmony-test-'));
  try {
    const path = join(dir, 'test.sqlite');
    let db = openDatabase(path);
    record(db, 'health.started');
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM migrations').get()?.n, 15);
    assert.equal(db.prepare('SELECT event FROM journal').get()?.event, 'health.started');
    assert.throws(() => record(db, 'sk-secret-value' as any));
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('newer schema fails closed instead of being overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harmony-test-'));
  try {
    const path = join(dir, 'test.sqlite');
    const db = openDatabase(path);
    db.prepare('INSERT INTO migrations VALUES (?, ?)').run(16, new Date().toISOString());
    db.close();
    assert.throws(() => openDatabase(path), /Unsupported/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
