import {test,expect} from 'vitest';
import {ApplicationEventBus} from '../core/application-events.ts';
import {openDatabase} from '../core/storage.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {ToolDispatcher} from '../core/tool-dispatcher.ts';
import {ToolRegistry,type ToolDefinition} from '../packages/tools/registry.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
function fixture(overrides:Partial<ToolDefinition>={},executionStarted:()=>void=()=>{}){
 const db=openDatabase(':memory:'),journal=new ActionJournal(db),bus=new ApplicationEventBus(),turn=bus.beginTurn(),registry=new ToolRegistry();let calls=0,identified=true;
 const tool:ToolDefinition={id:'fixture.read',version:1,name:'Fixture',description:'Read-only fixture',risk:'SAFE',permissions:['fixture_read'],inputSchema:{type:'object',properties:{value:{type:'number'}},required:['value']},outputSchema:{type:'number'},available:()=>true,execute:async input=>{calls++;return (input as {value:number}).value;},verify:async(input,result)=>result===(input as {value:number}).value,...overrides};
 registry.register(tool);let policy=new PermissionPolicy(registry.policies(),[{id:'person',permissions:['fixture_read']}],{denyTools:[],lowRiskWriteTools:[]});
 const dispatcher=new ToolDispatcher(registry,()=>policy,journal,{isCurrent:t=>bus.isCurrent(t),identifies:id=>identified&&id==='person'},executionStarted);
 const run=(input:unknown={value:7})=>dispatcher.run(turn,'person',tool.id,input,new AbortController().signal);
 return {db,journal,bus,turn,registry,tool,dispatcher,run,calls:()=>calls,setIdentity:(v:boolean)=>{identified=v;},deny:()=>{policy=new PermissionPolicy(registry.policies(),[{id:'person',permissions:[]}],{denyTools:[],lowRiskWriteTools:[]});}};
}
test('registered read-only tool records execution and independent verification before returning data',async()=>{
 const f=fixture();try{const result=await f.run();expect(result.result).toBe(7);expect(f.journal.events(result.actionId).map(e=>e.state)).toEqual(['PREPARED','RUNNING','VERIFYING','SUCCEEDED']);}finally{f.db.close();}
});
test('unknown inputs, dependencies, people and write-capable tools fail before invocation',async()=>{
 for(const options of [{available:()=>false},{risk:'LOW_RISK_WRITE' as const},{}]){const f=fixture(options);try{if(Object.keys(options).length===0)f.setIdentity(false);await expect(f.run()).rejects.toThrow();expect(f.calls()).toBe(0);expect(f.journal.recent()).toHaveLength(0);}finally{f.db.close();}}
 const f=fixture();try{await expect(f.run({value:1,command:'injected'})).rejects.toThrow();expect(f.calls()).toBe(0);}finally{f.db.close();}
});
test('invalid output and failed verification cannot produce a success record',async()=>{
 for(const overrides of [{execute:async()=> 'bad'},{verify:async()=>false}]){const f=fixture(overrides);try{await expect(f.run()).rejects.toThrow();expect(f.journal.recent()[0].state).toBe('FAILED');}finally{f.db.close();}}
});
test('STOP during execution discards late results and blocks overlapping work',async()=>{
 let release!:(value:number)=>void;const f=fixture({execute:()=>new Promise(r=>{release=r;})});
 try{const run=f.run(),rejected=expect(run).rejects.toThrow();await expect(f.run()).rejects.toThrow();f.dispatcher.cancelAll();f.bus.cancelAll();release(7);await rejected;expect(f.journal.recent()[0].state).toBe('CANCELLED');expect(f.dispatcher.activeCount).toBe(0);}finally{f.db.close();}
});
test('revoked permission during verification withholds the result',async()=>{
 let release!:(value:boolean)=>void;const f=fixture({verify:()=>new Promise(r=>{release=r;})});
 try{const run=f.run(),rejected=expect(run).rejects.toThrow();await Promise.resolve();await Promise.resolve();f.deny();release(true);await rejected;expect(f.journal.recent()[0].state).toBe('FAILED');}finally{f.db.close();}
});
test('journal write failure prevents invoking a tool',async()=>{
 const f=fixture();try{f.db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON action_events BEGIN SELECT RAISE(ABORT,'fixture'); END;");await expect(f.run()).rejects.toThrow();expect(f.calls()).toBe(0);}finally{f.db.close();}
});
test('registry rejects duplicate ids and captures immutable schema and metadata',()=>{
 const f=fixture();try{expect(()=>f.registry.register(f.tool)).toThrow();f.tool.risk='RESTRICTED';expect(f.registry.resolve(f.tool.id).risk).toBe('SAFE');expect(()=>f.registry.register({...f.tool,id:'other',permissions:[]})).toThrow();}finally{f.db.close();}
});

test('real computer overview is a scoped local diagnostic and does not authorize household identity',async()=>{
 const {Runtime}=await import('../core/runtime.ts');
 const runtime=new Runtime(':memory:',{state:'OFF',async check(){},async stop(){}});runtime.boot();
 try{await runtime.inspectComputer();const s=runtime.snapshot();expect(s.computerInfo?.logicalCores).toBeGreaterThan(0);expect(s.computerInfo?.memoryGiB).toBeGreaterThan(0);expect(s.actions?.[0]).toMatchObject({tool:'system.information',state:'SUCCEEDED'});expect(s.identity).toBe('UNKNOWN');expect(s.latency?.metrics.tool_start_ms.state).toBe('completed');expect(s.latency?.metrics.tool_complete_ms.state).toBe('completed');expect(s.latency!.metrics.tool_complete_ms.ms!).toBeGreaterThanOrEqual(s.latency!.metrics.tool_start_ms.ms!);expect(s.latency?.metrics.full_turn_ms.ms).toBeGreaterThanOrEqual(s.latency!.metrics.tool_complete_ms.ms!);await runtime.stop();expect(()=>runtime.inspectComputer()).toThrow();}finally{await runtime.close();}
});


test('execution timing is emitted only after permission and journal checks and before tool invocation',async()=>{
 const order:string[]=[];const f=fixture({execute:async()=>{order.push('execute');return 7;}},()=>{order.push(String(f.journal.recent()[0].state));order.push('start');});
 try{await f.run();expect(order).toEqual(['RUNNING','start','execute']);f.deny();await expect(f.run()).rejects.toThrow();expect(order).toEqual(['RUNNING','start','execute']);}finally{f.db.close();}
});

test('diagnostic observer failure cannot fail authorized work',async()=>{
 const f=fixture({},()=>{throw new Error('diagnostic failure');});try{expect((await f.run()).result).toBe(7);}finally{f.db.close();}
});
