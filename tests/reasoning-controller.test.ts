import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {catalogueReviewedAt,catalogueExpiresAt} from '../packages/reasoning/catalogue.ts';
import {test,expect,vi} from 'vitest';
import {ReasoningController} from '../core/reasoning-controller.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
import {Runtime} from '../core/runtime.ts';
async function settled(c:ReasoningController){for(let i=0;i<100&&c.active;i++)await new Promise(resolve=>setImmediate(resolve));expect(c.active).toBe(false);}
function fixture(){
 let calls=0,keys=0;
 const provider=new ResponsesReasoner(async()=>{calls++;return new Response('data: '+JSON.stringify({type:'response.output_text.delta',sequence_number:1,delta:'Hello'})+'\n\ndata: '+JSON.stringify({type:'response.completed',sequence_number:2,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:10,output_tokens:5}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 const readKey=async()=>{keys++;return 'fixture_not_a_real_key';};
 return {provider,readKey,counts:()=>({calls,keys})};
}
test('review is local and one approval streams a bounded response with timing',async()=>{
 const f=fixture(),c=new ReasoningController(f.readKey,()=>{},f.provider);
 c.review('Hello');expect(c.snapshot()).toMatchObject({state:'REVIEW',prompt:'Hello',text:'',maxOutputTokens:1024});expect(f.counts()).toEqual({calls:0,keys:0});
 const id=c.snapshot().reviewId!;expect(()=>c.approve('wrong')).toThrow();c.approve(id);expect(()=>c.approve(id)).toThrow();
 await settled(c);expect(c.snapshot()).toMatchObject({state:'FINISHED',text:'Hello',usage:{inputTokens:10,outputTokens:5},trace:{operation:'reasoning',state:'completed'}});expect(f.counts()).toEqual({calls:1,keys:1});
 await c.stop();expect(c.snapshot()).toMatchObject({state:'CANCELLED',prompt:'',text:'',trace:null});
});
test('STOP revokes review ids and replacement prompts need fresh review',async()=>{
 const f=fixture(),c=new ReasoningController(f.readKey,()=>{},f.provider);c.review('First');const id=c.snapshot().reviewId!;
 expect(()=>c.review('Overlap')).toThrow();await c.stop();c.review('Second');expect(()=>c.approve(id)).toThrow();expect(f.counts()).toEqual({calls:0,keys:0});await c.stop();
});
test('review expires without reading credentials or making requests',async()=>{
 vi.useFakeTimers();try{const f=fixture(),c=new ReasoningController(f.readKey,()=>{},f.provider);c.review('Hello');const id=c.snapshot().reviewId!;await vi.advanceTimersByTimeAsync(60000);expect(c.active).toBe(false);expect(()=>c.approve(id)).toThrow();expect(f.counts()).toEqual({calls:0,keys:0});}finally{vi.useRealTimers();}
});
test('STOP during stalled key loading resolves without allowing a network request',async()=>{
 const f=fixture();let started=false;const c=new ReasoningController(()=>{started=true;return new Promise(()=>{});},()=>{},f.provider);
 c.review('Hello');c.approve(c.snapshot().reviewId!);await new Promise(resolve=>setImmediate(resolve));expect(started).toBe(true);
 await c.stop();expect(c.active).toBe(false);expect(f.counts().calls).toBe(0);expect(c.snapshot().state).toBe('CANCELLED');
});
test('provider failure keeps partial text visibly incomplete without a false completion',async()=>{
 const provider=new ResponsesReasoner(async()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',sequence_number:1,delta:'Partial'})+'\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 const c=new ReasoningController(async()=>'fixture_not_a_real_key',()=>{},provider);c.review('Hello');c.approve(c.snapshot().reviewId!);await settled(c);
 expect(c.snapshot()).toMatchObject({state:'ERROR',text:'Partial',usage:null,trace:{state:'failed'}});expect(c.snapshot().error).toContain('incomplete');await c.stop();
});
test('runtime serializes reasoning with tools and STOP clears pending review before Resume',async()=>{
 const f=fixture();let runtime!:Runtime;const c=new ReasoningController(f.readKey,()=>runtime.publishReasoning(),f.provider);
 runtime=new Runtime(':memory:',{state:'OFF',async check(){},async stop(){}},undefined,undefined,undefined,c);runtime.boot();
 runtime.reviewReasoning('Hello');expect(runtime.snapshot().system).toBe('ACTIVE');await expect(runtime.check()).rejects.toThrow('not ready');expect(()=>runtime.inspectComputer()).toThrow('not ready');
 const id=c.snapshot().reviewId!;await runtime.stop();expect(runtime.snapshot()).toMatchObject({system:'STOPPED',reasoning:{state:'CANCELLED',text:'',prompt:''}});expect(()=>runtime.approveReasoning(id)).toThrow();
 runtime.resume();runtime.reviewReasoning('New');runtime.approveReasoning(c.snapshot().reviewId!);expect(runtime.snapshot().system).toBe('BUSY');await settled(c);
 expect(runtime.snapshot()).toMatchObject({system:'PASSIVE',identity:'UNKNOWN',latency:{operation:'reasoning',state:'completed'}});await runtime.close();
});


test('fast text bursts publish the first chunk immediately and preserve all text without flooding snapshots',async()=>{
 vi.useFakeTimers();try{
  const frames=Array.from({length:100},(_,i)=>({type:'response.output_text.delta',sequence_number:i,delta:'x'}));
  const body=[...frames,{type:'response.completed',sequence_number:100,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:1,output_tokens:100}}}].map(value=>'data: '+JSON.stringify(value)+'\n\n').join('');
  const provider=new ResponsesReasoner(async()=>new Response(body,{headers:{'Content-Type':'text/event-stream'}}));
  const seen:ReturnType<ReasoningController['snapshot']>[]=[];let c!:ReasoningController;
  c=new ReasoningController(async()=>'fixture_not_a_real_key',()=>seen.push(c.snapshot()),provider);
  c.review('Hello');c.approve(c.snapshot().reviewId!);await vi.advanceTimersByTimeAsync(0);
  expect(c.active).toBe(false);expect(c.snapshot().text).toBe('x'.repeat(100));
  expect(seen.find(s=>s.text.length>0)?.text).toBe('x');expect(seen.length).toBeLessThan(15);
  const completed=seen.length;await vi.advanceTimersByTimeAsync(100);expect(seen).toHaveLength(completed);
 }finally{vi.useRealTimers();}
});
test('STOP clears a queued text update and never republishes cancelled output',async()=>{
 vi.useFakeTimers();try{
  const body=[{type:'response.output_text.delta',sequence_number:1,delta:'one'},{type:'response.output_text.delta',sequence_number:2,delta:'two'}].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('');
  const provider=new ResponsesReasoner(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(body));}}),{headers:{'Content-Type':'text/event-stream'}}));
  const seen:ReturnType<ReasoningController['snapshot']>[]=[];let c!:ReasoningController;
  c=new ReasoningController(async()=>'fixture_not_a_real_key',()=>seen.push(c.snapshot()),provider);c.review('Hello');c.approve(c.snapshot().reviewId!);
  await vi.advanceTimersByTimeAsync(0);expect(c.snapshot().text).toBe('onetwo');await c.stop();const stopped=seen.length;
  await vi.advanceTimersByTimeAsync(100);expect(seen).toHaveLength(stopped);expect(c.snapshot()).toMatchObject({state:'CANCELLED',text:''});
 }finally{vi.useRealTimers();}
});


function estimateFixture(){
 const f=fixture();let counts=0,now=catalogueReviewedAt;
 const counter=new ResponsesTokenCounter(async()=>{counts++;return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:10}),{headers:{'content-type':'application/json'}});});
 const c=new ReasoningController(f.readKey,()=>{},f.provider,{counter,now:()=>now});
 return {...f,c,countCalls:()=>counts,time:(n:number)=>{now=n;}};
}
async function estimated(c:ReasoningController){for(let i=0;i<100&&c.snapshot().state==='ESTIMATING';i++)await new Promise(resolve=>setImmediate(resolve));expect(c.snapshot().state).toBe('REVIEW');}
test('desktop estimate consent cannot generate an answer and second approval has a fresh id',async()=>{
 const f=estimateFixture();f.c.review('Hello');expect(f.c.snapshot().state).toBe('ESTIMATE_REVIEW');expect(f.countCalls()).toBe(0);
 const first=f.c.snapshot().reviewId!;f.c.approve(first);expect(f.c.snapshot().state).toBe('ESTIMATING');await estimated(f.c);
 expect(f.c.snapshot().estimate).toMatchObject({inputTokens:10,ceilingMicros:51325});expect(f.countCalls()).toBe(1);expect(f.counts().calls).toBe(0);
 expect(()=>f.c.approve(first)).toThrow();f.c.approve(f.c.snapshot().reviewId!);await settled(f.c);expect(f.counts().calls).toBe(1);await f.c.stop();
});
test('STOP during estimation prevents a late count from opening generation review',async()=>{
 let release!:(value:Response)=>void;const counter=new ResponsesTokenCounter(()=>new Promise(resolve=>{release=resolve;}));
 const c=new ReasoningController(async()=>'fixture_not_a_real_key',()=>{},undefined,{counter,now:()=>catalogueReviewedAt});
 c.review('Hello');c.approve(c.snapshot().reviewId!);await new Promise(resolve=>setImmediate(resolve));const stopping=c.stop();
 release(new Response(JSON.stringify({object:'response.input_tokens',input_tokens:10}),{headers:{'content-type':'application/json'}}));await stopping;
 expect(c.snapshot()).toMatchObject({state:'CANCELLED',estimate:null,reviewId:null});expect(c.active).toBe(false);
});
test('expired price blocks generation after a successful estimate',async()=>{
 const f=estimateFixture();f.c.review('Hello');f.c.approve(f.c.snapshot().reviewId!);await estimated(f.c);f.time(catalogueExpiresAt);
 expect(()=>f.c.approve(f.c.snapshot().reviewId!)).toThrow();expect(f.counts().calls).toBe(0);await f.c.stop();
});
test('estimate failure never falls through to generation',async()=>{
 const f=fixture();const c=new ReasoningController(f.readKey,()=>{},f.provider,{counter:new ResponsesTokenCounter(async()=>new Response('failure',{status:503})),now:()=>catalogueReviewedAt});
 c.review('Hello');c.approve(c.snapshot().reviewId!);await settled(c);expect(c.snapshot()).toMatchObject({state:'ERROR',estimate:null,text:''});expect(f.counts().calls).toBe(0);await c.stop();
});


test('runtime keeps both estimate and answer reviews ACTIVE and estimation BUSY',async()=>{
 const f=fixture();let runtime!:Runtime;
 const counter=new ResponsesTokenCounter(async()=>new Response(JSON.stringify({object:'response.input_tokens',input_tokens:10}),{headers:{'content-type':'application/json'}}));
 const c=new ReasoningController(f.readKey,()=>runtime.publishReasoning(),f.provider,{counter,now:()=>catalogueReviewedAt});
 runtime=new Runtime(':memory:',{state:'OFF',async check(){},async stop(){}},undefined,undefined,undefined,c);runtime.boot();
 runtime.reviewReasoning('Hello');expect(runtime.snapshot().system).toBe('ACTIVE');runtime.approveReasoning(c.snapshot().reviewId!);expect(runtime.snapshot().system).toBe('BUSY');
 await estimated(c);expect(runtime.snapshot().system).toBe('ACTIVE');runtime.approveReasoning(c.snapshot().reviewId!);await settled(c);expect(runtime.snapshot().system).toBe('PASSIVE');await runtime.close();
});
test('pricing expiry during generation key loading prevents the generation request',async()=>{
 const f=fixture();let reads=0,now=catalogueReviewedAt;
 const counter=new ResponsesTokenCounter(async()=>new Response(JSON.stringify({object:'response.input_tokens',input_tokens:10}),{headers:{'content-type':'application/json'}}));
 const c=new ReasoningController(async()=>{if(++reads===2)now=catalogueExpiresAt;return 'fixture_not_a_real_key';},()=>{},f.provider,{counter,now:()=>now});
 c.review('Hello');c.approve(c.snapshot().reviewId!);await estimated(c);c.approve(c.snapshot().reviewId!);await settled(c);
 expect(c.snapshot().state).toBe('ERROR');expect(f.counts().calls).toBe(0);await c.stop();
});
test('answer review expires independently after counting',async()=>{
 vi.useFakeTimers();try{
  const f=estimateFixture();f.c.review('Hello');f.c.approve(f.c.snapshot().reviewId!);await vi.advanceTimersByTimeAsync(0);
  expect(f.c.snapshot().state).toBe('REVIEW');const id=f.c.snapshot().reviewId!;await vi.advanceTimersByTimeAsync(60000);
  expect(f.c.snapshot().state).toBe('CANCELLED');expect(()=>f.c.approve(id)).toThrow();expect(f.counts().calls).toBe(0);
 }finally{vi.useRealTimers();}
});
