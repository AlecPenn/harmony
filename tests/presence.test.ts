import { test } from 'vitest';
import assert from 'node:assert/strict';
import { presenceMode, presenceProfiles, processingVisualBudget } from '../apps/desktop/src/presence-model.ts';
import type { RuntimeState } from '../packages/contracts/index.ts';
const idle: RuntimeState = {system:'PASSIVE',voice:'DISABLED',identity:'UNKNOWN',conversation:'NONE',focus:'NORMAL'};
test('presence follows runtime facts with STOP and error taking precedence over success and speech',()=>{
  assert.equal(presenceMode(null),'offline');
  assert.equal(presenceMode(idle),'idle');
  assert.equal(presenceMode({...idle,system:'BUSY'}),'thinking');
  assert.equal(presenceMode({...idle,voice:'LISTENING'}),'listening');
  assert.equal(presenceMode({...idle,voice:'SPEAKING'}),'speaking');
  assert.equal(presenceMode({...idle,conversation:'WAKE'}),'wake');
  assert.equal(presenceMode(idle,true),'success');
  assert.equal(presenceMode({...idle,system:'ERROR'},true),'warning');
  assert.equal(presenceMode({...idle,system:'STOPPED',voice:'SPEAKING'},true),'stopped');
  assert.equal(presenceProfiles.stopped.speed,0);
  assert.ok(presenceProfiles.idle.energy < presenceProfiles.speaking.energy);
});

test('renderer snapshot mirror rejects older IPC replies without owning runtime state', async()=>{
  const { useChamber }=await import('../apps/desktop/src/chamber-store.ts');
  const { Runtime }=await import('../core/runtime.ts');
  const runtime=new Runtime(':memory:',{state:'OFF',async check(){},async stop(){}});
  runtime.boot(); const old=runtime.snapshot(); await runtime.stop();const latest=runtime.snapshot();
  useChamber.getState().ingest(latest);useChamber.getState().ingest(old);
  assert.equal(useChamber.getState().snapshot?.system,'STOPPED');
  useChamber.getState().setPanel('settings');
  assert.equal(runtime.snapshot().system,'STOPPED');
  await runtime.close();
});


test('processing visuals prioritize active voice and tool work and restore after completion',()=>{
 assert.equal(processingVisualBudget(null),false);assert.equal(processingVisualBudget(idle),false);
 for(const state of ['PREPARING','STARTING','STREAMING','PLAYING'])assert.equal(processingVisualBudget({...idle,speechOutput:{state}}),true);
 for(const state of ['STARTING','READY','CAPTURING','STOPPING'])assert.equal(processingVisualBudget({...idle,audio:{state}}),true);
 assert.equal(processingVisualBudget({...idle,system:'BUSY'}),true);
 for(const state of ['FINISHED','ERROR','CANCELLED','IDLE'])assert.equal(processingVisualBudget({...idle,speechOutput:{state},audio:{state:'OFF'}}),false);
});
