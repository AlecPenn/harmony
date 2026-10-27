import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { WorkerState } from '../packages/contracts/index.ts';

export interface HealthWorker {
  state: WorkerState;
  check(signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}

export class PythonWorker implements HealthWorker {
  state: WorkerState = 'OFF';
  #child: ChildProcessWithoutNullStreams | null = null;
  #stopPromise: Promise<void> | null = null;
  #path: string;
  #onState: () => void;
  constructor(path: string, onState: () => void = () => {}) { this.#path = path; this.#onState = onState; }
  #set(state: WorkerState) { this.state = state; this.#onState(); }

  async check(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.#child || this.#stopPromise) throw new Error('Worker already active');
    this.#set('STARTING');
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let ready = false;
      let buffer = '';
      let child: ChildProcessWithoutNullStreams;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) { this.#set('FAILED'); reject(error); }
        else { this.#set('READY'); resolve(); }
      };
      const abort = () => finish(new Error('Worker check cancelled'));
      const timer = setTimeout(() => finish(new Error('Worker response timed out')), 5000);
      signal.addEventListener('abort', abort, { once: true });
      try {
        child = spawn('python', ['-I', '-u', this.#path], { windowsHide: true, stdio: 'pipe' });
        this.#child = child;
      } catch {
        finish(new Error('Python could not start'));
        return;
      }
      child.on('error', () => finish(new Error('Python could not start')));
      child.stdin.on('error', () => finish(new Error('Worker input failed')));
      child.stderr.on('data', () => { /* Do not expose subprocess output to logs. */ });
      child.on('close', () => {
        if (this.#child === child) this.#child = null;
        if (!settled) finish(new Error('Worker exited before verification'));
        if (this.state !== 'STOPPING' && this.state !== 'OFF') this.#set('FAILED');
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString('utf8');
        if (buffer.length > 4096) return finish(new Error('Invalid worker response'));
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.protocol !== 1) throw new Error();
            if (message.type === 'ready' && !ready) {
              ready = true;
              child.stdin.write(JSON.stringify({ type: 'ping' }) + '\n');
            } else if (message.type === 'pong' && ready) finish();
            else throw new Error();
          } catch { finish(new Error('Invalid worker response')); }
        }
      });
    });
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    const child = this.#child;
    if (!child) { this.#set('OFF'); return Promise.resolve(); }
    this.#set('STOPPING');
    this.#stopPromise = new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => child.kill(), 300);
      const deadline = setTimeout(() => {
        clearTimeout(force);
        this.#set('FAILED');
        reject(new Error('Worker exit could not be verified'));
      }, 3000);
      child.once('close', () => {
        clearTimeout(force); clearTimeout(deadline);
        this.#set('OFF'); resolve();
      });
      if (child.stdin.writable) child.stdin.end(JSON.stringify({ type: 'stop' }) + '\n');
      else child.kill();
    }).finally(() => { this.#stopPromise = null; });
    return this.#stopPromise;
  }
}
