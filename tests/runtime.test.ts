import { test } from 'vitest';
import assert from 'node:assert/strict';
import {emptyAudio} from '../packages/contracts/audio.ts';
import {emptyVoiceOutput} from '../packages/contracts/voice-output.ts';
import { Runtime } from '../core/runtime.ts';
import { StateEngine } from '../core/state.ts';
import { EventBus } from '../core/events.ts';
import { trustedSender, validateNoArguments } from '../core/ipc-policy.ts';
import type { HealthWorker } from '../core/worker.ts';

function worker(): HealthWorker {
  return { state: 'OFF', async check(signal) { signal.throwIfAborted(); this.state = 'READY'; }, async stop() { this.state = 'OFF'; } };
}
test('runtime boots, checks real SQLite and verified worker lifecycle, then resumes after stop', async () => {
  const runtime = new Runtime(':memory:', worker());
  runtime.boot();
  assert.equal(runtime.snapshot().system, 'PASSIVE');
  assert.equal(runtime.snapshot().voice, 'DISABLED');
  await runtime.check();
  assert.equal(runtime.snapshot().lastCheck?.passed, true);
  assert.equal(runtime.snapshot().worker, 'OFF');
  assert.equal(runtime.snapshot().capabilities.find(c => c.id === 'python')?.status, 'AVAILABLE');
  await runtime.stop();
  await assert.rejects(runtime.check(), /not ready/);
  runtime.resume();
  assert.equal(runtime.snapshot().system, 'PASSIVE');
  await runtime.close();
});
test('STOP aborts an active check; cancellation cannot publish late success or accept duplicate work', async () => {
  const controlled: HealthWorker = {
    state: 'OFF',
    check(signal) {
      this.state = 'STARTING';
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    },
    async stop() { this.state = 'OFF'; }
  };
  const runtime = new Runtime(':memory:', controlled);
  runtime.boot();
  const check = runtime.check();
  await assert.rejects(runtime.check(), /not ready/);
  const stopping = runtime.stop();
  assert.throws(() => runtime.resume(), /still stopping/);
  await stopping;
  await check;
  assert.equal(runtime.snapshot().system, 'STOPPED');
  assert.equal(runtime.snapshot().lastCheck, null);
  assert.ok(!runtime.snapshot().events.some(event => event.name === 'health.passed'));
  await runtime.close();
});
test('worker failure is visible and resume allows a subsequent successful check', async () => {
  const controlled = worker();
  controlled.check = async () => { throw new Error('secret output must not appear'); };
  const runtime = new Runtime(':memory:', controlled);
  runtime.boot();
  await runtime.check();
  assert.equal(runtime.snapshot().system, 'ERROR');
  assert.equal(runtime.snapshot().lastCheck?.passed, false);
  assert.ok(!JSON.stringify(runtime.snapshot()).includes('secret output'));
  controlled.check = async () => { controlled.state = 'READY'; };
  runtime.resume();
  await runtime.check();
  assert.equal(runtime.snapshot().lastCheck?.passed, true);
  await runtime.close();
});
test('state machine rejects unsafe jumps', () => {
  const state = new StateEngine();
  assert.throws(() => state.transition('BUSY'));
  state.transition('BOOTING'); state.transition('PASSIVE'); state.transition('STOPPED');
  assert.throws(() => state.transition('BUSY'));
});
test('a failed shutdown can be retried instead of leaving STOP latched around an active worker', async () => {
  const controlled = worker();
  controlled.state = 'READY';
  controlled.stop = async () => { throw new Error('still running'); };
  const runtime = new Runtime(':memory:', controlled);
  runtime.boot();
  await assert.rejects(runtime.stop(), /Shutdown/);
  assert.throws(() => runtime.resume(), /not stopped/);
  controlled.stop = async () => { controlled.state = 'OFF'; };
  await runtime.stop();
  runtime.resume();
  assert.equal(runtime.snapshot().system, 'PASSIVE');
  await runtime.close();
});
test('event observers cannot corrupt another snapshot and unsubscribing works', () => {
  const bus = new EventBus<{ count: number }>();
  const seen: number[] = [];
  bus.subscribe(value => { value.count = 90; throw new Error('observer'); });
  const unsubscribe = bus.subscribe(value => seen.push(value.count));
  bus.publish({ count: 1 }); unsubscribe(); bus.publish({ count: 2 });
  assert.deepEqual(seen, [1]);
});
test('IPC policy rejects foreign contents, subframes, unexpected URLs and payloads', () => {
  const url = 'file:///C:/HARMONY/dist/renderer/index.html';
  assert.equal(trustedSender(1, 1, true, url, url), true);
  assert.equal(trustedSender(2, 1, true, url, url), false);
  assert.equal(trustedSender(1, 1, false, url, url), false);
  assert.equal(trustedSender(1, 1, true, url + '#other', url), false);
  assert.equal(trustedSender(1, 1, true, 'https://example.com', url), false);
  assert.throws(() => validateNoArguments(['unexpected']));
});


test('STOP reaches every worker even when speech throws synchronously, and failed verification requires retry', async () => {
  const calls:string[]=[];const health=worker();
  health.stop=async()=>{calls.push('health');health.state='OFF';};
  const audio={snapshot:()=>({...emptyAudio}),async stop(){calls.push('audio');}};
  let fail=true;
  const output={active:false,snapshot:()=>({...emptyVoiceOutput}),trace:()=>null,stop(){calls.push('output');if(fail)throw new Error('private failure');return Promise.resolve();}};
  const runtime=new Runtime(':memory:',health,undefined,audio,output);runtime.boot();
  await assert.rejects(runtime.stop(),/Shutdown/);
  assert.deepEqual(calls.sort(),['audio','health','output']);
  assert.equal(runtime.snapshot().shutdownFailed,true);
  assert.ok(!runtime.snapshot().events.some(e=>e.type==='WORK_STOPPED'));
  assert.throws(()=>runtime.resume(),/not stopped/);
  assert.throws(()=>runtime.boot(),/retry STOP/);
  assert.ok(!JSON.stringify(runtime.snapshot()).includes('private failure'));
  fail=false;await runtime.stop();assert.equal(runtime.snapshot().shutdownFailed,false);
  runtime.resume();await runtime.close();
});

test('microphone shutdown begins without waiting for slow speech shutdown', async () => {
  let release!:()=>void;let audioStopped=false;let healthStopped=false;
  const health=worker();health.stop=async()=>{healthStopped=true;health.state='OFF';};
  const audio={snapshot:()=>({...emptyAudio}),async stop(){audioStopped=true;}};
  const output={active:true,snapshot:()=>({...emptyVoiceOutput}),trace:()=>null,stop:()=>new Promise<void>(resolve=>{release=()=>{output.active=false;resolve();};})};
  const runtime=new Runtime(':memory:',health,undefined,audio,output);runtime.boot();
  const stopping=runtime.stop();assert.equal(runtime.stop(),stopping);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(audioStopped,true);assert.equal(healthStopped,true);assert.equal(runtime.snapshot().stopping,true);
  assert.throws(()=>runtime.resume(),/still stopping/);
  release();await stopping;await runtime.close();
});

test('successful stop promises do not authorize Resume while microphone still reports active', async () => {
  let active=true;
  const audio={snapshot:()=>({...emptyAudio,state:active?'CAPTURING' as const:'OFF' as const}),async stop(){}};
  const runtime=new Runtime(':memory:',worker(),undefined,audio);runtime.boot();
  await assert.rejects(runtime.stop(),/Shutdown/);
  assert.throws(()=>runtime.resume(),/not stopped/);
  assert.ok(!runtime.snapshot().events.some(e=>e.type==='WORK_STOPPED'));
  active=false;await runtime.stop();runtime.resume();await runtime.close();
});


test('owner verification is serialized and STOP waits for its cancellation',async()=>{
 let active=false,release!:()=>void;const lifecycle={get active(){return active;},async stop(){active=false;release?.();}};
 const runtime=new Runtime(':memory:',worker(),undefined,undefined,undefined,undefined,lifecycle);runtime.boot();
 const operation=runtime.runOwnerAction(async signal=>{active=true;await new Promise<void>(resolve=>{release=resolve;});signal.throwIfAborted();});
 const rejected=assert.rejects(operation);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(runtime.snapshot().system,'BUSY');await assert.rejects(runtime.check());
 await runtime.stop();await rejected;assert.equal(active,false);runtime.resume();await runtime.close();
});
test('owner worker still active blocks false STOP success and Resume',async()=>{
 let active=true;const runtime=new Runtime(':memory:',worker(),undefined,undefined,undefined,undefined,{get active(){return active;},async stop(){}});runtime.boot();
 await assert.rejects(runtime.stop(),/Shutdown/);assert.throws(()=>runtime.resume());active=false;await runtime.stop();runtime.resume();await runtime.close();
});
