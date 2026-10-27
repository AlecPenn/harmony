import {test,expect,afterEach} from 'vitest';
import {TaskPlanner,type TaskScope} from '../core/task-planner.ts';
import type {VerifiedPlanOutput} from '../core/read-only-orchestrator.ts';
import {ToolDispatcher} from '../core/tool-dispatcher.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {ApplicationEventBus} from '../core/application-events.ts';
import {openDatabase} from '../core/storage.ts';
import {ToolRegistry,type ToolDefinition} from '../packages/tools/registry.ts';
import {PermissionPolicy,actionInputHash} from '../packages/permissions/policy.ts';
const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
const requestHash=actionInputHash({request:'fixture'});
function fixture(overrides:Partial<ToolDefinition>={},options:{changed?:()=>void;ttl?:number}={}){
 const db=openDatabase(':memory:');dbs.push(db);const journal=new ActionJournal(db),bus=new ApplicationEventBus(),turn=bus.beginTurn(),registry=new ToolRegistry();
 let allowed=true,identified=true,clock=1000;const calls:string[]=[];
 const tool=(id:string,extra:Partial<ToolDefinition>={}):ToolDefinition=>({id,version:1,risk:'SAFE',permissions:['read'],name:id,description:'Fixture',available:()=>true,
  inputSchema:{type:'object',properties:{value:{type:'number'}},required:['value']},outputSchema:{type:'number'},
  execute:async inputs=>{const value=(inputs as {value:number}).value;calls.push(`${id}:${value}`);return value;},verify:async(inputs,result)=>result===(inputs as {value:number}).value,...extra});
 registry.register(tool('fixture.read',overrides));registry.register(tool('fixture.other'));registry.register(tool('fixture.write',{risk:'LOW_RISK_WRITE'}));
 const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(person:string)=>identified&&person==='person'};
 const dispatcher=new ToolDispatcher(registry,()=>new PermissionPolicy(registry.policies(),[{id:'person',permissions:allowed?['read']:[]}],{denyTools:[],lowRiskWriteTools:[]}),journal,authority);
 const planner=new TaskPlanner(registry,dispatcher,journal,authority,()=>clock,options.ttl??60000,options.changed);
 const scope:TaskScope={requestHash,maxSteps:4,tools:{'fixture.read':{maxCalls:2},'fixture.other':{maxCalls:1}}};
 const steps=[{id:'first',toolId:'fixture.read',inputs:{value:1}},{id:'second',toolId:'fixture.other',inputs:{value:2},after:['first']}];
 const prepare=(value:unknown=steps,s:unknown=scope,t=turn,person='person')=>planner.prepare(s,'trusted_template',value,t,person);
 const execute=(handle:ReturnType<typeof prepare>['handle'],handoff?:(o:readonly VerifiedPlanOutput[])=>void,signal=new AbortController().signal,t=turn,person='person')=>planner.execute(handle,t,person,signal,handoff);
 return {db,journal,bus,turn,registry,planner,scope,steps,prepare,execute,calls,deny:()=>{allowed=false;},forget:()=>{identified=false;},advance:(ms:number)=>{clock+=ms;}};
}
test('prepared plan executes once through verified dispatch and reports its binding fingerprint',async()=>{
 const f=fixture();let received:readonly VerifiedPlanOutput[]=[];
 const {handle,summary}=f.prepare();expect(f.calls).toEqual([]);expect(f.journal.recent()).toEqual([]);
 expect(summary).toMatchObject({provenance:'trusted_template',steps:[{id:'first',toolId:'fixture.read',after:[]},{id:'second',toolId:'fixture.other',after:['first']}]});
 expect(summary.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(summary.preparationMs).toBeGreaterThanOrEqual(0);expect(Object.isFrozen(summary)).toBe(true);
 expect(JSON.stringify(summary)).not.toContain('value');
 const report=await f.execute(handle,outputs=>{received=outputs;});
 expect(report).toMatchObject({state:'SUCCEEDED',fingerprint:summary.fingerprint,scopeFingerprint:summary.scopeFingerprint,provenance:'trusted_template'});
 expect(f.calls).toEqual(['fixture.read:1','fixture.other:2']);expect(received.map(o=>[o.stepId,o.result])).toEqual([['first',1],['second',2]]);
 for(const step of report.steps)expect(f.journal.get(step.actionId!)?.state).toBe('SUCCEEDED');
 expect(f.planner.pendingCount).toBe(0);expect(f.planner.active).toBe(false);
});
test('plans cannot expand the explicit scope: tools, call counts, step counts and write tools',()=>{
 const f=fixture(),s=f.steps[0];
 for(const invalid of [
  [{...s,toolId:'fixture.write'}],
  [s,{...s,id:'b'},{...s,id:'c'}],
  [{...f.steps[1]},{...f.steps[1],id:'again',after:[]}],
  Array.from({length:5},(_,i)=>({...s,id:`s${i}`,toolId:i%2?'fixture.read':'fixture.other'})),
  [{...s,toolId:'unknown'}],
 ])expect(()=>f.prepare(invalid)).toThrow();
 for(const scope of [
  {...f.scope,tools:{'fixture.write':{maxCalls:1}}},{...f.scope,tools:{'unknown':{maxCalls:1}}},{...f.scope,tools:{}},{...f.scope,maxSteps:17},{...f.scope,maxSteps:0},
  {...f.scope,requestHash:'not-a-hash'},{...f.scope,owner:true},{...f.scope,tools:{'fixture.read':{maxCalls:1,grant:'all'}}},{...f.scope,tools:{'fixture.read':{maxCalls:99}}}
 ])expect(()=>f.prepare([s],scope)).toThrow();
 expect(f.calls).toEqual([]);expect(f.journal.recent()).toEqual([]);expect(f.planner.pendingCount).toBe(0);
});
test('malformed proposals are rejected before anything is prepared',()=>{
 const f=fixture(),s=f.steps[0];
 for(const invalid of [
  [],{steps:[s]},[{...s,permission:'owner'}],[{...s,risk:'SAFE'}],[{...s,inputs:{value:1,command:'injected'}}],[{...s,inputs:{value:'1'}}],
  [s,{...s,id:'first'}],[{...s,id:'bad id!'}],[{...s,after:['first']}],[{...s,after:['later']},{...s,id:'later'}],
  [s,{...f.steps[1],after:['first','first']}],[s,{...f.steps[1],after:'first'}],[null],['step'],
 ])expect(()=>f.prepare(invalid)).toThrow();
 let accessed=false;const malicious={...s,get inputs(){accessed=true;return {value:1};}};expect(()=>f.prepare([malicious])).toThrow();expect(accessed).toBe(false);
 const proto=Object.assign(Object.create({toolId:'fixture.write'}),{id:'x',inputs:{value:1}});expect(()=>f.prepare([proto])).toThrow();
 expect(()=>f.planner.prepare(f.scope,'owner_override' as never,f.steps,f.turn,'person')).toThrow();
 expect(f.planner.pendingCount).toBe(0);
});
test('planning requires current identity, current turn and currently allowed tools',()=>{
 const f=fixture();expect(()=>f.prepare(f.steps,f.scope,{...f.turn})).toThrow();expect(()=>f.prepare(f.steps,f.scope,f.turn,'stranger')).toThrow();
 f.deny();expect(()=>f.prepare()).toThrow();
 const g=fixture();g.forget();expect(()=>g.prepare()).toThrow();
 const h=fixture();h.bus.endTurn(h.turn);expect(()=>h.prepare()).toThrow();
 const k=fixture();k.bus.cancelAll();expect(()=>k.prepare()).toThrow();
 expect([f,g,h].every(x=>x.planner.pendingCount===0&&x.calls.length===0)).toBe(true);
});
test('handles are one-use, identity-bound and cannot be copied, replayed or moved to another turn or person',async()=>{
 const f=fixture(),{handle}=f.prepare();
 expect((await f.execute(handle)).state).toBe('SUCCEEDED');expect(()=>f.execute(handle)).toThrow();expect(f.calls).toHaveLength(2);
 const copy=f.prepare().handle;expect(()=>f.execute({...copy})).toThrow();expect(()=>f.execute(Object.freeze({kind:'prepared-task-plan'}))).toThrow();
 // The genuine handle is still valid after a forged lookup fails.
 expect((await f.execute(copy)).state).toBe('SUCCEEDED');
 const other=f.prepare().handle;expect(()=>f.execute(other,undefined,undefined,f.turn,'stranger')).toThrow();expect(()=>f.execute(other)).toThrow();
 const g=fixture(),moved=g.prepare().handle;expect(()=>g.execute(moved,undefined,undefined,{...g.turn})).toThrow();expect(()=>g.execute(moved)).toThrow();
 expect(g.calls).toEqual([]);
});
test('prepared plans expire, and clock rollback revokes all of them',()=>{
 const f=fixture({}, {ttl:1000});const expired=f.prepare().handle;f.advance(1000);expect(()=>f.execute(expired)).toThrow();
 const g=fixture();const rolled=g.prepare().handle;g.advance(-1);expect(()=>g.execute(rolled)).toThrow();expect(g.planner.pendingCount).toBe(0);
 expect(f.calls).toEqual([]);expect(g.calls).toEqual([]);
});
test('deliberate re-planning supersedes the older plan; explicit revocation and STOP discard pending plans',async()=>{
 const f=fixture(),old=f.prepare().handle,next=f.prepare([f.steps[0]]).handle;expect(f.planner.pendingCount).toBe(1);
 expect(()=>f.execute(old)).toThrow();expect((await f.execute(next)).steps).toHaveLength(1);expect(f.calls).toEqual(['fixture.read:1']);
 const revoked=f.prepare().handle;f.planner.revokeTurn(f.turn);expect(()=>f.execute(revoked)).toThrow();
 const stopped=f.prepare().handle;await f.planner.stop();expect(()=>f.execute(stopped)).toThrow();expect(f.calls).toEqual(['fixture.read:1']);
});
test('ending the turn or a STOP generation change invalidates plans prepared for it',()=>{
 const f=fixture(),{handle}=f.prepare();f.bus.endTurn(f.turn);expect(()=>f.execute(handle)).toThrow();expect(f.calls).toEqual([]);
 const g=fixture(),stale=g.prepare().handle;g.bus.cancelAll();expect(()=>g.execute(stale)).toThrow();expect(g.calls).toEqual([]);
});
test('changing proposal or scope objects after preparation cannot change what executes',async()=>{
 const f=fixture(),steps=structuredClone(f.steps),scope=structuredClone(f.scope),{handle,summary}=f.prepare(steps,scope);
 steps[0].inputs.value=999;steps.push({id:'extra',toolId:'fixture.read',inputs:{value:3}});scope.tools['fixture.write']={maxCalls:5};
 const report=await f.execute(handle);expect(report.fingerprint).toBe(summary.fingerprint);expect(f.calls).toEqual(['fixture.read:1','fixture.other:2']);
});
test('fingerprints bind provenance, scope, inputs and turn without granting model proposals extra authority',()=>{
 const f=fixture(),a=f.prepare().summary,b=f.planner.prepare(f.scope,'model_proposal',f.steps,f.turn,'person').summary;
 const c=f.prepare([{...f.steps[0],inputs:{value:5}},f.steps[1]]).summary,d=f.prepare(f.steps,{...f.scope,requestHash:actionInputHash({request:'other'})}).summary;
 expect(new Set([a.fingerprint,b.fingerprint,c.fingerprint,d.fingerprint]).size).toBe(4);expect(b.provenance).toBe('model_proposal');
 expect(()=>f.planner.prepare(f.scope,'model_proposal',[{...f.steps[0],toolId:'fixture.write'}],f.turn,'person')).toThrow();
 expect(()=>f.planner.prepare(f.scope,'model_proposal',[f.steps[0],{...f.steps[0],id:'b'},{...f.steps[0],id:'c'}],f.turn,'person')).toThrow();
});
test('legitimate repeated reads within scope are preserved rather than deduplicated',async()=>{
 const f=fixture(),same={toolId:'fixture.read',inputs:{value:7}};
 expect((await f.execute(f.prepare([{id:'a',...same},{id:'b',...same}]).handle)).state).toBe('SUCCEEDED');expect(f.calls).toEqual(['fixture.read:7','fixture.read:7']);
 expect(f.journal.recent()).toHaveLength(2);
});
test('permission revoked between preparation and execution prevents every tool call',async()=>{
 const f=fixture(),{handle}=f.prepare();f.deny();const report=await f.execute(handle);
 expect(report.state).toBe('FAILED');expect(report.steps.map(s=>s.state)).toEqual(['FAILED','SKIPPED']);expect(f.calls).toEqual([]);
});
test('partial success stops at the failed step, keeps truthful records and withholds every result',async()=>{
 let delivered=0;const f=fixture({verify:async()=>false}),report=await f.execute(f.prepare([{id:'a',toolId:'fixture.read',inputs:{value:1}},{id:'b',toolId:'fixture.other',inputs:{value:2}}]).handle,()=>{delivered++;});
 expect(report.state).toBe('FAILED');expect(report.steps.map(s=>s.state)).toEqual(['FAILED','SKIPPED']);expect(delivered).toBe(0);expect(f.calls).toEqual(['fixture.read:1']);
 let g:ReturnType<typeof fixture>;let released=0;g=fixture({},{changed:()=>{if(g?.planner.active&&g.journal.recent().filter(a=>a.state==='SUCCEEDED').length===2)g.deny();}});
 const late=await g.execute(g.prepare().handle,()=>{released++;});expect(late.state).toBe('FAILED');expect(released).toBe(0);
 expect(g.journal.recent().every(a=>a.state==='SUCCEEDED')).toBe(true);
});
test('STOP during execution waits for an uncooperative tool, discards late success and blocks overlap',async()=>{
 let release!:(value:number)=>void,delivered=0;const f=fixture({execute:()=>new Promise(resolve=>{release=resolve;})});
 const task=f.execute(f.prepare().handle,()=>{delivered++;});await new Promise(resolve=>setImmediate(resolve));
 expect(()=>f.prepare()).toThrow();
 let stopped=false;const stopping=f.planner.stop().then(()=>{stopped=true;});await new Promise(resolve=>setImmediate(resolve));
 expect(stopped).toBe(false);expect(f.planner.active).toBe(true);
 release(1);await stopping;const report=await task;expect(report.state).toBe('CANCELLED');expect(report.steps.map(s=>s.state)).toEqual(['CANCELLED','SKIPPED']);
 expect(delivered).toBe(0);expect(f.planner.active).toBe(false);expect(f.planner.pendingCount).toBe(0);expect(f.journal.recent()[0].state).toBe('CANCELLED');
});
test('preparation is refused while a plan is running, and an aborted signal never starts execution',async()=>{
 let release!:(value:number)=>void;const f=fixture({execute:()=>new Promise(resolve=>{release=resolve;})});
 const task=f.execute(f.prepare().handle);await new Promise(resolve=>setImmediate(resolve));expect(()=>f.prepare()).toThrow();release(1);await task;
 const g=fixture(),abort=new AbortController();abort.abort();expect(()=>g.execute(g.prepare().handle,undefined,abort.signal)).toThrow();expect(g.calls).toEqual([]);
});
test('pending plans are bounded across concurrent turns and observer failures cannot affect planning',async()=>{
 const f=fixture({}, {changed:()=>{throw new Error('observer');}});
 expect((await f.execute(f.prepare().handle)).state).toBe('SUCCEEDED');
 const turns=Array.from({length:9},()=>f.bus.beginTurn());
 for(const turn of turns.slice(0,8))f.prepare(f.steps,f.scope,turn);expect(f.planner.pendingCount).toBe(8);
 expect(()=>f.prepare(f.steps,f.scope,turns[8])).toThrow();f.prepare(f.steps,f.scope,turns[0]);expect(f.planner.pendingCount).toBe(8);
 f.bus.endTurn(turns[1]);f.prepare(f.steps,f.scope,turns[8]);expect(f.planner.pendingCount).toBe(8);
});
test('invalid lifetimes are rejected',()=>{
 const f=fixture();for(const ttl of [0,-1,1.5,300001])expect(()=>new TaskPlanner(f.registry,{} as ToolDispatcher,f.journal,{isCurrent:()=>true,identifies:()=>true},Date.now,ttl)).toThrow();
});
