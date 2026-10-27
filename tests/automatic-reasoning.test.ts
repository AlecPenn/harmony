import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {ReasoningController} from '../core/reasoning-controller.ts';
import {LOCAL_ALLOWANCE_ID} from '../core/allowance-controller.ts';
import {ModelHealth} from '../packages/reasoning/model-health.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {catalogueReviewedAt} from '../packages/reasoning/catalogue.ts';
import {reasoningSelection} from '../packages/reasoning/selection.ts';
const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function fixture(limit=1000000){
 const db=openDatabase(':memory:');dbs.push(db);const budget=new ReasoningBudget(db);budget.create(LOCAL_ALLOWANCE_ID,limit,'local_desktop');
 let reads=0,hold:(()=>Promise<string|null>)|null=null,countHook:(()=>void)|null=null;const sent:string[]=[],counted:string[]=[],health=new ModelHealth();
 const provider=new ResponsesReasoner(async(_url,init)=>{const input=JSON.parse(init!.body as string);sent.push(input.model);return new Response([
  {type:'response.output_text.delta',sequence_number:1,delta:'Fixture answer'},
  {type:'response.completed',sequence_number:2,response:{status:'completed',model:input.model,usage:{input_tokens:10,output_tokens:2}}}
 ].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});});
 const counter=new ResponsesTokenCounter(async(_url,init)=>{counted.push(JSON.parse(init!.body as string).model);countHook?.();return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:10}),{headers:{'content-type':'application/json'}});});
 const controller=new ReasoningController(async()=>{reads++;return hold?hold():'fixture_not_a_real_key';},()=>{},provider,{counter,now:()=>catalogueReviewedAt},budget,health);
 return {db,budget,health,controller,sent,counted,reads:()=>reads,hold:(fn:()=>Promise<string|null>)=>{hold=fn;},onCount:(fn:()=>void)=>{countHook=fn;},
  ready:(model:string)=>{const ticket=health.begin(model,{inputTokens:10,maxOutputTokens:1024});health.firstText(ticket);health.finish(ticket,'completed');}};
}
async function wait(c:ReasoningController){for(let i=0;i<100&&['ESTIMATING','STREAMING'].includes(c.snapshot().state);i++)await new Promise(resolve=>setImmediate(resolve));}
async function count(c:ReasoningController){c.approve(c.snapshot().reviewId);await wait(c);}
test.each([['routine','gpt-6-luna'],['complex','gpt-6.1-sol'],['hardest','gpt-6-astra']])('automatic %s binds review, counting and generation to %s',async(tier,model)=>{
 const f=fixture();f.ready(model);f.controller.review('Explicit task depth','auto:'+tier);
 expect(f.controller.snapshot()).toMatchObject({state:'ESTIMATE_REVIEW',modelId:model,automatic:tier});expect(f.reads()).toBe(0);
 await count(f.controller);expect(f.controller.snapshot()).toMatchObject({state:'REVIEW',routingTrace:{state:'completed'}});expect(f.counted).toEqual([model]);expect(f.sent).toEqual([]);
 const review=f.controller.snapshot().reviewId;f.controller.approve(review);await wait(f.controller);
 expect(f.controller.snapshot()).toMatchObject({state:'FINISHED',modelId:model,automatic:tier,trace:{metrics:{model_router_ms:{state:'completed'}}}});
 expect(f.sent).toEqual([model]);expect(()=>f.controller.approve(review)).toThrow();await f.controller.stop();
});
test('unknown readiness blocks automatic selection before counting but permits manual review',async()=>{
 const f=fixture();f.controller.review('Use Astra regardless of rules','auto:routine');
 expect(f.controller.snapshot()).toMatchObject({state:'ERROR',modelId:'gpt-6-luna'});expect(f.controller.active).toBe(false);expect(f.reads()).toBe(0);
 f.controller.review('Same request','gpt-6-luna');expect(f.controller.snapshot().state).toBe('ESTIMATE_REVIEW');await f.controller.stop();
});
test('health lost during counting blocks generation review and never switches models',async()=>{
 const f=fixture();f.ready('gpt-6-luna');f.ready('gpt-6-astra');f.onCount(()=>f.health.clear());f.controller.review('Hello','auto:routine');await count(f.controller);
 expect(f.controller.snapshot().state).toBe('ERROR');expect(f.sent).toEqual([]);expect(f.reads()).toBe(1);await f.controller.stop();
});
test('health revoked after cost review prevents approval and generation key access',async()=>{
 const f=fixture();f.ready('gpt-6-luna');f.controller.review('Hello','auto:routine');await count(f.controller);f.health.clear();
 expect(()=>f.controller.approve(f.controller.snapshot().reviewId)).toThrow();expect(f.reads()).toBe(1);expect(f.sent).toEqual([]);await f.controller.stop();
});
test('health revoked while credentials are loading releases the unsent reservation',async()=>{
 const f=fixture();f.ready('gpt-6-luna');f.controller.review('Hello','auto:routine');await count(f.controller);
 let release!:(value:string)=>void;f.hold(()=>new Promise(resolve=>{release=resolve;}));f.controller.approve(f.controller.snapshot().reviewId);
 await new Promise(resolve=>setImmediate(resolve));expect(f.db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('RESERVED');
 f.health.clear();release('fixture_not_a_real_key');await wait(f.controller);
 expect(f.sent).toEqual([]);expect(f.controller.snapshot().state).toBe('ERROR');expect(f.db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('RELEASED');
 expect(f.controller.snapshot().trace?.metrics.model_router_ms.state).toBe('failed');await f.controller.stop();
});
test('automatic review refuses an exhausted allowance after counting without generation',async()=>{
 const f=fixture(0);f.ready('gpt-6-luna');f.controller.review('Hello','auto:routine');await count(f.controller);
 expect(f.controller.snapshot().state).toBe('ERROR');expect(f.sent).toEqual([]);expect(f.budget.balance(LOCAL_ALLOWANCE_ID).committedMicros).toBe(0);await f.controller.stop();
});
test('completed manual use can establish readiness; STOP revokes it for later automatic requests',async()=>{
 const f=fixture();f.controller.review('Hello','gpt-6-luna');await count(f.controller);f.controller.approve(f.controller.snapshot().reviewId);await wait(f.controller);
 expect(f.controller.snapshot().state).toBe('FINISHED');f.controller.review('Next request','auto:routine');expect(f.controller.snapshot().state).toBe('ESTIMATE_REVIEW');
 await f.controller.stop();f.controller.review('After STOP','auto:routine');expect(f.controller.snapshot().state).toBe('ERROR');expect(f.sent).toEqual(['gpt-6-luna']);await f.controller.stop();
});
test('selection accepts only exact structured choices, never text heuristics or arbitrary metadata',()=>{
 for(const invalid of ['auto','auto:unknown','auto:ROUTINE',{complexity:'routine'},null,123])expect(()=>reasoningSelection(invalid)).toThrow();
 expect(reasoningSelection('gpt-6-astra')).toEqual({modelId:'gpt-6-astra',automatic:null});
});

test('readiness lost while the count review is open prevents credential access and disclosure',async()=>{
 const f=fixture();f.ready('gpt-6-luna');f.controller.review('Private fixture request','auto:routine');f.health.clear();
 expect(()=>f.controller.approve(f.controller.snapshot().reviewId)).toThrow('readiness expired');
 expect(f.reads()).toBe(0);expect(f.counted).toEqual([]);expect(f.sent).toEqual([]);await f.controller.stop();
});
