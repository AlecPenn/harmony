import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../packages/config/store.ts';

test('configuration persists locally and rejects corruption without replacing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harmony-config-'));
  try {
    const path = join(dir, 'settings.json');
    const store = new ConfigStore(path);
    const config = store.load();
    assert.equal(config.voice.locale, 'en-AU');
    config.visuals.reducedMotion = true;
    store.save(config);
    assert.equal(new ConfigStore(path).load().visuals.reducedMotion, true);
    assert.throws(() => store.save({ ...config, apiKey: 'not-allowed' }));
    assert.equal(new ConfigStore(path).load().visuals.reducedMotion, true);
    writeFileSync(path, '{bad-json');
    assert.throws(() => store.load(), /valid JSON/);
    assert.equal(readFileSync(path, 'utf8'), '{bad-json');
    writeFileSync(path, JSON.stringify({ schemaVersion: 2, config }));
    assert.throws(() => store.load(), /Unsupported/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
