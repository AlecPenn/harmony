import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ConfigStore } from '../packages/config/store.ts';
import { openDatabase } from '../core/storage.ts';
import { record } from '../packages/logging/index.ts';

console.log('\nH.A.R.M.O.N.Y. — Highly Advanced Reminder Machine Occasionally Nagging You\n');
let failed = false;
try {
  new ConfigStore(fileURLToPath(new URL('../data/config/settings.json', import.meta.url))).load();
  console.log('Config        OK — validated local settings');
} catch {
  console.log('Config        FAILED');
  failed = true;
}
try {
  const db = openDatabase(fileURLToPath(new URL('../data/database/harmony.sqlite', import.meta.url)));
  try {
    record(db, 'health.started');
    const result = db.prepare('PRAGMA quick_check').get();
    if (result?.quick_check !== 'ok') throw new Error('Integrity check failed');
    record(db, failed ? 'health.failed' : 'health.passed', failed ? 'error' : 'info');
    console.log('Database      OK — migration, integrity and journal write verified');
  } finally { db.close(); }
} catch {
  console.log('Database      FAILED — could not initialize or verify local storage');
  failed = true;
}
const python = spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
console.log(`Python        ${python.status === 0 ? 'AVAILABLE — ' + python.stdout.trim() : 'UNCHECKED — probe failed or was blocked; optional at this phase'}`);
console.log(`Core          ${failed ? 'FAILED' : 'OK — foundation checks only'}`);
console.log('OpenAI        DISCONNECTED — adapter not implemented');
console.log('Voice Worker  UNAVAILABLE — not implemented');
const desktopBuilt = existsSync(new URL('../dist/electron/main.cjs', import.meta.url)) && existsSync(new URL('../dist/renderer/index.html', import.meta.url));
console.log(`Desktop       ${desktopBuilt ? 'BUILT — run npm start; launch not tested by this command' : 'NOT BUILT — run npm run build'}`);
console.log('\nNo microphone, camera, cloud request or computer control was activated.\n');
process.exitCode = failed ? 1 : 0;
