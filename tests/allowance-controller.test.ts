import {Runtime} from '../core/runtime.ts';
import {test,expect,afterEach,vi} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {AllowanceController,allowanceAmount,LOCAL_ALLOWANCE_ID} from '../core/allowance-controller.ts';
const databases:ReturnType<typeof openDatabase>[]=[];
afterEach(()=>{vi.useRealTimers();for(const db of databases.splice(0))db.close();});
function fixture(changed:()=>void=()=>{}){
 const db=openDatabase(':memory:');databases.push(db);const budget=new ReasoningBudget(db);
 let calls=0,finish!:()=>void,scope:any,signal:AbortSignal;
 const grant={kind:'owner-verification' as const};
 const owner={verify:async(value:unknown,s:AbortSignal)=>{calls++;scope=value;signal=s;await new Promise<void>(resolve=>{finish=resolve;});return grant;},consume:(g:typeof grant,s:unknown)=>g===grant&&s===scope};
 const controller=new AllowanceController(budget,owner,changed);
 return {controller,budget,calls:()=>calls,scope:()=>scope,aborted:()=>signal.aborted,finish:()=>finish()};
}
test('decimal USD parsing is exact and rejects ambiguous or out-of-range input',()=>{
 for(const [text,micros] of [['0',0],['0.01',10000],['1.2',1200000],['42.99',42990000]] as const)expect(allowanceAmount(text)).toBe(micros);
 for(const value of ['01',' 1','1 ','1e3','+1','-1','1.001','1,000','1.','9999999999',1,null])expect(()=>allowanceAmount(value)).toThrow();
});
test('review creates no allowance or prompt; exact consent then verifies and writes',async()=>{
 const f=fixture();f.controller.review('12.34');const status=f.controller.snapshot();
 expect(f.calls()).toBe(0);expect(()=>f.budget.balance(LOCAL_ALLOWANCE_ID)).toThrow();
 status.limitMicros=1;expect(f.controller.snapshot().limitMicros).toBe(12340000);
 await expect(f.controller.approve('wrong',new AbortController().signal)).rejects.toThrow();expect(f.calls()).toBe(0);
 const task=f.controller.approve(status.reviewId,new AbortController().signal);await Promise.resolve();
 expect(f.scope().allowance).toEqual({budgetId:LOCAL_ALLOWANCE_ID,beneficiaryId:'local_desktop',limitMicros:12340000});
 expect(f.controller.snapshot().state).toBe('VERIFYING');
 await expect(f.controller.approve(status.reviewId,new AbortController().signal)).rejects.toThrow();
 f.finish();await task;expect(f.controller.snapshot().state).toBe('CREATED');expect(f.budget.balance(LOCAL_ALLOWANCE_ID).remainingMicros).toBe(12340000);
});
test('STOP waits for native work and a late proof cannot write',async()=>{
 const f=fixture();f.controller.review('1');const task=f.controller.approve(f.controller.snapshot().reviewId,new AbortController().signal);await Promise.resolve();
 let stopped=false;const stop=f.controller.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);expect(f.aborted()).toBe(true);expect(f.controller.active).toBe(true);
 f.finish();await task;await stop;expect(f.controller.active).toBe(false);expect(f.controller.snapshot().state).toBe('CANCELLED');expect(()=>f.budget.balance(LOCAL_ALLOWANCE_ID)).toThrow();
});
test('review expires without native work, and expired consent cannot revive',async()=>{
 vi.useFakeTimers();const f=fixture();f.controller.review('1');const id=f.controller.snapshot().reviewId;
 await vi.advanceTimersByTimeAsync(60001);expect(f.controller.snapshot().state).toBe('CANCELLED');expect(f.calls()).toBe(0);
 await expect(f.controller.approve(id,new AbortController().signal)).rejects.toThrow();
});
test('repeated setup preserves spent funds and cannot change the fixed allowance',async()=>{
 const f=fixture();f.budget.create(LOCAL_ALLOWANCE_ID,1000000,'local_desktop');
 const plan={budgetId:LOCAL_ALLOWANCE_ID,modelId:'fixture',estimateVersion:'v1',text:'Hi',personId:'local_desktop',turnId:'turn',inputTokens:1,maxOutputTokens:16,ceilingMicros:100};
 const reservation=f.budget.reserve(plan);f.budget.dispatch(reservation,plan);f.budget.uncertain(reservation);
 for(const amount of ['1','2']){
  f.controller.review(amount);const task=f.controller.approve(f.controller.snapshot().reviewId,new AbortController().signal);await Promise.resolve();f.finish();await task;
  expect(f.controller.snapshot().state).toBe(amount==='1'?'CREATED':'ERROR');expect(f.budget.balance(LOCAL_ALLOWANCE_ID).remainingMicros).toBe(999900);
 }
});
test('caller cancellation before verification does not open the native prompt',async()=>{
 const f=fixture(),abort=new AbortController();f.controller.review('1');abort.abort();
 await expect(f.controller.approve(f.controller.snapshot().reviewId,abort.signal)).rejects.toThrow();expect(f.calls()).toBe(0);await f.controller.stop();
});

test('runtime serializes allowance review and waits for cancelled verification before Resume',async()=>{
 let runtime!:Runtime;const f=fixture(()=>runtime.publishAllowance());
 runtime=new Runtime(':memory:',{state:'OFF',async check(){},async stop(){}},undefined,undefined,undefined,undefined,undefined,f.controller);runtime.boot();
 runtime.reviewAllowance('1');expect(runtime.snapshot().system).toBe('ACTIVE');await expect(runtime.check()).rejects.toThrow();expect(()=>runtime.inspectComputer()).toThrow();
 const task=runtime.approveAllowance(f.controller.snapshot().reviewId);await Promise.resolve();expect(runtime.snapshot().system).toBe('BUSY');
 const stopping=runtime.stop();await new Promise(resolve=>setImmediate(resolve));expect(()=>runtime.resume()).toThrow();expect(f.aborted()).toBe(true);
 f.finish();await task;await stopping;expect(runtime.snapshot()).toMatchObject({system:'STOPPED',shutdownFailed:false,allowance:{state:'CANCELLED',balance:null}});
 runtime.resume();expect(runtime.snapshot().system).toBe('PASSIVE');await runtime.close();
});
