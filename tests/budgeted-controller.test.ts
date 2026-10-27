import {ModelHealth} from '../packages/reasoning/model-health.ts';
import {test,expect,afterEach,vi} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {ReasoningController} from '../core/reasoning-controller.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {catalogueReviewedAt} from '../packages/reasoning/catalogue.ts';
import {LOCAL_ALLOWANCE_ID} from '../core/allowance-controller.ts';
const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function fixture(limit:number|null=1000000,readKey?:()=>Promise<string|null>){
 const db=openDatabase(':memory:');dbs.push(db);const budget=new ReasoningBudget(db);if(limit!==null)budget.create(LOCAL_ALLOWANCE_ID,limit,'local_desktop');
 let sends=0,reads=0;
 const provider=new ResponsesReasoner(async()=>{
  sends++;expect(db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('DISPATCHED');
  return new Response([{type:'response.output_text.delta',sequence_number:1,delta:'Hello'}, {type:'response.completed',sequence_number:2,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:10,output_tokens:2}}}].map(v=>'data: '+JSON.stringify(v)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 });
 const counter=new ResponsesTokenCounter(async()=>new Response(JSON.stringify({object:'response.input_tokens',input_tokens:10}),{headers:{'content-type':'application/json'}}));
 const health=new ModelHealth();
 const controller=new ReasoningController(async()=>{reads++;return readKey?readKey():'fixture_not_a_real_key';},()=>{},provider,{counter,now:()=>catalogueReviewedAt},budget,health);
 return {db,budget,controller,health,sends:()=>sends,reads:()=>reads};
}
async function wait(c:ReasoningController){for(let i=0;i<100&&['ESTIMATING','STREAMING'].includes(c.snapshot().state);i++)await new Promise(resolve=>setImmediate(resolve));}
async function estimate(c:ReasoningController){c.review('Hello');c.approve(c.snapshot().reviewId);await wait(c);expect(c.snapshot().state).toBe('REVIEW');}
test('controller binds its estimate to a durable reservation and preserves first-text telemetry',async()=>{
 const f=fixture();await estimate(f.controller);const ceiling=f.controller.snapshot().estimate!.ceilingMicros;
 expect(f.sends()).toBe(0);expect(f.budget.balance(LOCAL_ALLOWANCE_ID).committedMicros).toBe(0);
 f.controller.approve(f.controller.snapshot().reviewId);await wait(f.controller);
 expect(f.controller.snapshot()).toMatchObject({state:'FINISHED',text:'Hello',trace:{state:'completed',metrics:{llm_first_token_ms:{state:'completed'}}}});
 expect(f.health.candidate('gpt-6-astra',{inputTokens:10,maxOutputTokens:1024},ceiling).healthy).toBe(true);
 expect(f.sends()).toBe(1);expect(f.db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('UNCERTAIN');
 expect(f.budget.balance(LOCAL_ALLOWANCE_ID).committedMicros).toBe(ceiling);await f.controller.stop();
 expect(f.budget.balance(LOCAL_ALLOWANCE_ID).committedMicros).toBe(ceiling);expect(f.health.candidate('gpt-6-astra',{inputTokens:10,maxOutputTokens:1024},ceiling).healthy).toBe(false);
});
test('missing or exhausted allowance blocks generation before generation-key access',async()=>{
 for(const limit of [null,0]){const f=fixture(limit);await estimate(f.controller);f.controller.approve(f.controller.snapshot().reviewId);await wait(f.controller);
  expect(f.controller.snapshot().state).toBe('ERROR');expect(f.sends()).toBe(0);expect(f.reads()).toBe(1);expect(f.db.prepare('SELECT COUNT(*) AS n FROM reasoning_reservations').get()?.n).toBe(0);await f.controller.stop();}
});
test('STOP while loading the generation key releases only its unsent reservation',async()=>{
 let reads=0,release!:(key:string)=>void;const f=fixture(1000000,async()=>++reads===1?'fixture_not_a_real_key':new Promise(resolve=>{release=resolve;}));
 await estimate(f.controller);f.controller.approve(f.controller.snapshot().reviewId);await new Promise(resolve=>setImmediate(resolve));
 expect(f.db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('RESERVED');
 await f.controller.stop();release('fixture_not_a_real_key');await new Promise(resolve=>setImmediate(resolve));
 expect(f.sends()).toBe(0);expect(f.db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('RELEASED');expect(f.budget.balance(LOCAL_ALLOWANCE_ID).committedMicros).toBe(0);
});
test('budgeted controller cannot be constructed without the estimation stage',()=>{
 const f=fixture();expect(()=>new ReasoningController(async()=>null,()=>{},undefined,undefined,f.budget)).toThrow('require estimation');
});

test('readiness observer failure cannot bypass accounting or turn a valid response into a retry',async()=>{
 const f=fixture();vi.spyOn(f.health,'begin').mockImplementation(()=>{throw new Error('clock unavailable');});
 await estimate(f.controller);f.controller.approve(f.controller.snapshot().reviewId);await wait(f.controller);
 expect(f.sends()).toBe(1);expect(f.controller.snapshot().state).toBe('FINISHED');expect(f.db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('UNCERTAIN');await f.controller.stop();
});

test('model selection is explicit, cannot change during review, and prices the selected model',async()=>{
 const f=fixture();f.controller.review('Hello','gpt-6-luna');expect(f.controller.snapshot().modelId).toBe('gpt-6-luna');
 expect(()=>f.controller.review('Hello','gpt-6-astra')).toThrow();f.controller.approve(f.controller.snapshot().reviewId);await wait(f.controller);
 expect(f.controller.snapshot()).toMatchObject({state:'REVIEW',modelId:'gpt-6-luna'});expect(f.controller.snapshot().estimate!.ceilingMicros).toBeLessThan(1000);
 await f.controller.stop();expect(()=>f.controller.review('Hello','unknown')).toThrow();expect(f.sends()).toBe(0);
});
