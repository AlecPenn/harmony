import {test,expect,afterEach} from 'vitest';
import {ReadOnlyOrchestrator,type VerifiedPlanOutput} from '../core/read-only-orchestrator.ts';
import {ToolDispatcher} from '../core/tool-dispatcher.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {ApplicationEventBus} from '../core/application-events.ts';
import {openDatabase} from '../core/storage.ts';
import {ToolRegistry,type ToolDefinition} from '../packages/tools/registry.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function fixture(overrides:Partial<ToolDefinition>={},changed:()=>void=()=>{},handoff:(outputs:readonly VerifiedPlanOutput[])=>void=()=>{}){
 const db=openDatabase(':memory:');dbs.push(db);const journal=new ActionJournal(db),bus=new ApplicationEventBus(),turn=bus.beginTurn(),registry=new ToolRegistry();
 let allowed=true,identified=true;const calls:number[]=[];
 const tool:ToolDefinition={id:'fixture.read',version:1,risk:'SAFE',permissions:['read'],name:'Read',description:'Fixture',available:()=>true,
  inputSchema:{type:'object',properties:{value:{type:'number'}},required:['value']},outputSchema:{type:'number'},
  execute:async inputs=>{const value=(inputs as {value:number}).value;calls.push(value);return value;},verify:async(inputs,result)=>result===(inputs as {value:number}).value,...overrides};registry.register(tool);
 const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(person:string)=>identified&&person==='person'};
 const dispatcher=new ToolDispatcher(registry,()=>new PermissionPolicy(registry.policies(),[{id:'person',permissions:allowed?['read']:[]}],{denyTools:[],lowRiskWriteTools:[]}),journal,authority);
 const runner=new ReadOnlyOrchestrator(registry,dispatcher,journal,authority,changed,handoff);
 const steps=[{id:'first',toolId:tool.id,inputs:{value:1}},{id:'second',toolId:tool.id,inputs:{value:2}}];
 const run=(value:unknown=steps,signal=new AbortController().signal)=>runner.run(value,turn,'person',signal);
 return {db,journal,bus,turn,registry,runner,steps,run,calls,deny:()=>{allowed=false;},forget:()=>{identified=false;}};
}
test('bounded plan executes sequentially and reflects against verified journal evidence',async()=>{
 const f=fixture(),result=await f.run();expect(result.state).toBe('SUCCEEDED');expect(f.calls).toEqual([1,2]);
 expect(result.steps.every(step=>step.state==='SUCCEEDED'&&step.actionId)).toBe(true);
 for(const step of result.steps)expect(f.journal.get(step.actionId!)?.state).toBe('SUCCEEDED');
 expect(JSON.stringify(result)).not.toContain('inputs');expect(JSON.stringify(result)).not.toContain('result_hash');expect(f.runner.active).toBe(false);
 expect(result.trace).toMatchObject({state:'completed',metrics:{tool_complete_ms:{state:'completed'},tool_start_ms:{state:'unavailable'},llm_first_token_ms:{state:'not_applicable'}}});expect(result.trace?.spans).toHaveLength(2);
});
test('invalid later steps prevent all execution, including unknown tools and schema injection',()=>{
 for(const invalid of [{id:'second',toolId:'unknown',inputs:{}},{id:'first',toolId:'fixture.read',inputs:{value:2}},{id:'second',toolId:'fixture.read',inputs:{value:2,command:'injected'}}]){
  const f=fixture();expect(()=>f.run([f.steps[0],invalid])).toThrow();expect(f.calls).toEqual([]);expect(f.journal.recent()).toEqual([]);
 }
});
test('non-read-only plans, oversized plans, metadata grants and accessors are rejected',()=>{
 const write=fixture({risk:'LOW_RISK_WRITE'});expect(()=>write.run()).toThrow();
 const f=fixture();for(const value of [[],Array.from({length:17},(_,i)=>({...f.steps[0],id:String(i)})),[{...f.steps[0],permission:'owner'}]])expect(()=>f.run(value)).toThrow();
 let accessed=false;const malicious={...f.steps[0],get inputs(){accessed=true;return {value:1};}};expect(()=>f.run([malicious])).toThrow();expect(accessed).toBe(false);
});
test('failed verification stops the plan without running or retrying later steps',async()=>{
 const f=fixture({verify:async()=>false}),result=await f.run();expect(result.state).toBe('FAILED');expect(result.steps.map(step=>step.state)).toEqual(['FAILED','SKIPPED']);expect(f.calls).toEqual([1]);
});
test('revoked permission between steps prevents the next tool from executing',async()=>{
 let f:ReturnType<typeof fixture>;f=fixture({},()=>{if(f?.runner.snapshot().steps[0]?.state==='SUCCEEDED')f.deny();});
 const result=await f.run();expect(result.state).toBe('FAILED');expect(f.calls).toEqual([1]);
});
test('STOP keeps the plan active until an uncooperative tool settles and discards late success',async()=>{
 let release!:(value:number)=>void;const f=fixture({execute:()=>new Promise(resolve=>{release=resolve;})}),task=f.run();await new Promise(resolve=>setImmediate(resolve));
 const stopping=f.runner.stop();expect(f.runner.active).toBe(true);expect(f.runner.snapshot()).toMatchObject({state:'RUNNING',stopRequested:true});expect(()=>f.run()).toThrow();
 release(1);await stopping;expect((await task).state).toBe('CANCELLED');expect(f.runner.active).toBe(false);expect(f.journal.recent()[0].state).toBe('CANCELLED');
});
test('input mutation and snapshot mutation cannot alter captured steps',async()=>{
 const f=fixture(),task=f.run();f.steps[0].inputs.value=999;const snapshot=f.runner.snapshot();snapshot.steps[0].toolId='unknown';
 expect((await task).state).toBe('SUCCEEDED');expect(f.calls).toEqual([1,2]);
});
test('final reflection detects evidence changed after earlier success',async()=>{
 let f:ReturnType<typeof fixture>;f=fixture({},()=>{const steps=f?.runner.snapshot().steps;if(steps?.[1]?.state==='SUCCEEDED')f.db.prepare("UPDATE actions SET result_hash=? WHERE id=?").run('0'.repeat(64),steps[0].actionId!);});
 const result=await f.run();expect(result.state).toBe('FAILED');expect(result.steps[0].state).toBe('FAILED');expect(f.calls).toEqual([1,2]);
});
test('forged turns, unknown people and an already-aborted signal never start a plan',()=>{
 const f=fixture();expect(()=>f.runner.run(f.steps,{...f.turn},'person',new AbortController().signal)).toThrow();f.forget();expect(()=>f.run()).toThrow();
 const g=fixture(),abort=new AbortController();abort.abort();expect(()=>g.run(g.steps,abort.signal)).toThrow();expect(g.calls).toEqual([]);
});
test('journal failure and diagnostic failure cannot manufacture success or extra actions',async()=>{
 const f=fixture();f.db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON action_events BEGIN SELECT RAISE(ABORT,'fixture'); END;");expect((await f.run()).state).toBe('FAILED');expect(f.calls).toEqual([]);
 const g=fixture({},()=>{throw new Error('observer');});expect((await g.run()).state).toBe('SUCCEEDED');expect(g.calls).toEqual([1,2]);
});

test('parent cancellation and identity loss cannot start later steps',async()=>{
 const abort=new AbortController();let f:ReturnType<typeof fixture>;f=fixture({},()=>{if(f?.runner.snapshot().steps[0]?.state==='SUCCEEDED')abort.abort();});
 expect((await f.run(f.steps,abort.signal)).state).toBe('CANCELLED');expect(f.calls).toEqual([1]);
 let g:ReturnType<typeof fixture>;g=fixture({},()=>{if(g?.runner.snapshot().steps[0]?.state==='SUCCEEDED')g.forget();});expect((await g.run()).state).toBe('CANCELLED');expect(g.calls).toEqual([1]);
});

test('verified outputs reach only the trusted handoff after all steps pass',async()=>{
 let received:readonly VerifiedPlanOutput[]=[];const f=fixture({},()=>{},outputs=>{expect(f.runner.snapshot().steps.every(step=>step.state==='SUCCEEDED')).toBe(true);received=outputs;});
 expect((await f.run()).state).toBe('SUCCEEDED');expect(received.map(output=>output.result)).toEqual([1,2]);expect(Object.isFrozen(received)).toBe(true);
 expect(Object.isFrozen(received[0])).toBe(true);expect(JSON.stringify(f.runner.snapshot())).not.toContain('result');
 let calls=0;const g=fixture({verify:async()=>false},()=>{},()=>{calls++;});expect((await g.run()).state).toBe('FAILED');expect(calls).toBe(0);
});
test('handoff errors cannot cause retries or a successful plan',async()=>{
 const f=fixture({},()=>{},()=>{throw new Error('handoff failed');});expect((await f.run()).state).toBe('FAILED');expect(f.calls).toEqual([1,2]);expect(f.runner.active).toBe(false);
});

test('permission revoked after final tool success withholds all results during reflection',async()=>{
 let delivered=0;let f:ReturnType<typeof fixture>;
 f=fixture({},()=>{if(f?.runner.snapshot().steps[1]?.state==='SUCCEEDED')f.deny();},()=>{delivered++;});
 const report=await f.run();expect(f.calls).toEqual([1,2]);expect(f.journal.recent().every(action=>action.state==='SUCCEEDED')).toBe(true);
 expect(report.state).toBe('FAILED');expect(delivered).toBe(0);
});
test('tool availability revoked before handoff withholds earlier verified data',async()=>{
 let available=true,delivered=0;let f:ReturnType<typeof fixture>;
 f=fixture({available:()=>available},()=>{if(f?.runner.snapshot().steps[1]?.state==='SUCCEEDED')available=false;},()=>{delivered++;});
 expect((await f.run()).state).toBe('FAILED');expect(delivered).toBe(0);expect(f.calls).toEqual([1,2]);
});
