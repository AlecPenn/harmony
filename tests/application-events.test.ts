import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ApplicationEventBus } from '../core/application-events.ts';
import { Runtime } from '../core/runtime.ts';
import type { ApplicationEvent } from '../packages/contracts/events.ts';
import type { HealthWorker } from '../core/worker.ts';

test('nested events preserve ordering, payload isolation and unsubscribe boundaries', () => {
  const bus = new ApplicationEventBus();
  const seen: ApplicationEvent[] = [];
  bus.subscribe(event => {
    if (event.type === 'TRANSCRIPT_READY') {
      event.payload.text = 'mutated'; bus.emit('AI_STARTED', { routeId: 'local' });
    }
  });
  const unsubscribe = bus.subscribe(event => seen.push(event));
  bus.emit('TRANSCRIPT_READY', { text: 'private', final: false, segment: 0 });
  unsubscribe(); bus.emit('APP_READY', undefined);
  assert.deepEqual(seen.map(e => e.type), ['TRANSCRIPT_READY', 'AI_STARTED']);
  assert.equal(seen[0].type === 'TRANSCRIPT_READY' && seen[0].payload.text, 'private');
  assert.ok(seen[1].sequence > seen[0].sequence);
  assert.ok(seen[1].monotonicMs >= seen[0].monotonicMs);
});

test('STOP invalidates queued and late turn events, including after a new turn begins', () => {
  const bus = new ApplicationEventBus(); const turn = bus.beginTurn(); const seen: string[] = [];
  bus.subscribe(event => {
    if (event.type === 'AI_STARTED') {
      bus.emit('AI_TOKEN', { text: 'late', segment: 0 }, turn);
      bus.cancelAll(); bus.emit('STOP_REQUESTED', undefined);
    }
  });
  bus.subscribe(event => seen.push(event.type));
  bus.emit('AI_STARTED', { routeId: 'local' }, turn);
  assert.deepEqual(seen, ['STOP_REQUESTED']);
  const next = bus.beginTurn();
  assert.equal(bus.emit('REPLY_STARTED', undefined, turn), false);
  assert.equal(bus.emit('REPLY_STARTED', undefined, { ...next }), false);
  assert.equal(bus.emit('REPLY_STARTED', undefined, next), true);
  bus.endTurn(next);
  assert.equal(bus.emit('REPLY_FINISHED', undefined, next), false);
});

test('failing observers remain isolated and visible without leaking exception contents', async () => {
  const bus = new ApplicationEventBus(); let delivered = 0;
  bus.subscribe(() => { throw new Error('secret'); });
  bus.subscribe(async () => { throw new Error('secret'); });
  bus.subscribe(() => { delivered++; });
  bus.emit('APP_READY', undefined); await Promise.resolve();
  assert.equal(delivered, 1);
  assert.deepEqual(bus.diagnostics, { observerFailures: 2, droppedEvents: 0 });
  assert.throws(() => bus.emit('UNREGISTERED' as any, undefined), /Unknown/);
});

test('feedback loops are bounded and diagnosed', () => {
  const bus = new ApplicationEventBus();
  bus.subscribe(() => bus.emit('APP_READY', undefined));
  bus.emit('APP_READY', undefined);
  assert.ok(bus.diagnostics.droppedEvents > 0);
});

test('runtime lifecycle events correlate health work and project safe metadata to the UI', async () => {
  const worker: HealthWorker = { state: 'OFF', async check() { this.state = 'READY'; }, async stop() { this.state = 'OFF'; } };
  const runtime = new Runtime(':memory:', worker); const seen: ApplicationEvent[] = [];
  runtime.subscribeEvents(event => seen.push(event));
  runtime.boot(); await runtime.check();
  const started = seen.find(e => e.type === 'HEALTH_STARTED')!;
  const passed = seen.find(e => e.type === 'HEALTH_PASSED')!;
  assert.ok(started.turnId); assert.equal(started.turnId, passed.turnId);
  assert.ok(seen.some(e => e.type === 'STATE_CHANGED' && e.payload.system === 'BUSY'));
  assert.ok(runtime.snapshot().events.some(e => e.type === 'HEALTH_PASSED' && e.turnId === started.turnId));
  assert.ok(runtime.snapshot().events.every(e => !Object.hasOwn(e, 'payload')));
  await runtime.stop();
  assert.ok(seen.find(e => e.type === 'STOP_REQUESTED')!.generation > started.generation);
  await runtime.close();
});

test('STOP from an immediate state observer prevents work from starting and cannot recurse', async () => {
  let checks = 0;
  const worker: HealthWorker = { state: 'OFF', async check() { checks++; }, async stop() {} };
  const runtime = new Runtime(':memory:', worker);
  let stopping: Promise<void> | undefined;
  runtime.subscribeEvents(event => {
    if (event.type === 'STATE_CHANGED' && event.payload.system === 'BUSY') stopping = runtime.stop();
    if (event.type === 'STOP_REQUESTED') void runtime.stop();
  });
  runtime.boot(); await runtime.check(); await stopping;
  assert.equal(checks, 0); assert.equal(runtime.snapshot().system, 'STOPPED');
  assert.equal(runtime.snapshot().lastCheck, null);
  await runtime.close();
});
