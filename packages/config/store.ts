import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, validateConfig, type Config } from './index.ts';

export class ConfigStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  load(): Config {
    if (!existsSync(this.path)) { this.save(defaults); return structuredClone(defaults); }
    if (statSync(this.path).size > 65536) throw new Error('Configuration exceeds size limit');
    let envelope: unknown;
    try { envelope = JSON.parse(readFileSync(this.path, 'utf8')); }
    catch { throw new Error('Configuration is not valid JSON'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Invalid configuration envelope');
    const record = envelope as Record<string, unknown>;
    if (record.schemaVersion !== 1 || Object.keys(record).some(key => !['schemaVersion', 'config'].includes(key))) throw new Error('Unsupported configuration format');
    return validateConfig(record.config);
  }
  save(value: unknown): Config {
    const config = validateConfig(value);
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, config }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.path);
    return structuredClone(config);
  }
}
