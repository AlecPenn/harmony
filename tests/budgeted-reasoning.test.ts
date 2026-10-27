import {test,expect,afterEach,vi} from 'vitest';
import {ApplicationEventBus} from '../core/application-events.ts';
import {BudgetedReasoning,budgetedReasoningPolicy,budgetedReasoningProposal} from '../core/budgeted-reasoning.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {openDatabase} from '../core/storage.ts';
import {ActionApprovals} from '../packages/permissions/approvals.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
import {catalogueReviewedAt,catalogueExpiresAt,estimateTextCeiling} from '../packages/reasoning/catalogue.ts';
const databases:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();vi.restoreAllMocks();});
function fixture(limit=10000){
 const db=openDatabase(':memory:');databases.push(db);const budget=new ReasoningBudget(db);budget.create('budget',limit,'owner');
 const bus=new ApplicationEventBus(),turn=bus.beginTurn();let identified=true,calls=0,keys=0,now=catalogueReviewedAt;
 const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(person:string)=>identified&&person==='owner'};
 const policy=new PermissionPolicy([budgetedReasoningPolicy],[{id:'owner',permissions:['cloud_reasoning']}],{denyTools:[],lowRiskWriteTools:[]});
 const approvals=new ActionApprovals(()=>policy,authority);
 const price=estimateTextCeiling({modelId:'gpt-6-astra',inputTokens:51,maxOutputTokens:128,nowMs:now,processing:'standard',region:'global',modality:'text',toolCount:0});
 const plan={personId:'owner',turnId:turn.id,budgetId:'budget',modelId:'gpt-6-astra',text:'Private prompt',inputTokens:51,maxOutputTokens:128,...price};
 const provider=new ResponsesReasoner(async()=>{
  calls++;expect(db.prepare('SELECT state FROM reasoning_reservations').get()?.state).toBe('DISPATCHED');
  return response();
 });
 const readKey=async()=>{keys++;return 'fixture_not_a_real_key';};
 const runner=new BudgetedReasoning(approvals,authority,budget,readKey,provider,()=>now);
 const proposal=budgetedReasoningProposal(plan),ticket=approvals.request(proposal,turn)!;
 const state=()=>db.prepare('SELECT state FROM reasoning_reservations').get()?.state;
 return {db,budget,bus,turn,authority,approvals,provider,readKey,runner,proposal,ticket,plan,state,counts:()=>({calls,keys}),revoke:()=>{identified=false;},time:(n:number)=>{now=n;}};
}
function response(input=51,output=5){return new Response('data: '+JSON.stringify({type:'response.output_text.delta',sequence_number:1,delta:'Hi'})+'\n\ndata: '+JSON.stringify({type:'response.completed',sequence_number:2,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:input,output_tokens:output}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});}
async function collect(stream:AsyncIterable<unknown>){const events=[];for await(const event of stream)events.push(event);return events;}
const signal=()=>new AbortController().signal;
test('approved stream reserves and persists dispatch before transport, then retains uncertain billing',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);
 expect(await collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).toHaveLength(2);
 expect(f.state()).toBe('UNCERTAIN');expect(f.budget.balance('budget').committedMicros).toBe(f.plan.ceilingMicros);
 await expect(collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('denied');expect(f.counts()).toEqual({calls:1,keys:1});
 expect(JSON.stringify(f.db.prepare('SELECT * FROM reasoning_reservations').all())).not.toContain('Private prompt');
});
test('no approval, changed plans and revoked turns cannot reserve or read keys',async()=>{
 for(const change of ['unapproved','text','cost','turn','person','stop']){
  const f=fixture();if(change!=='unapproved')f.approvals.approve(f.ticket);
  if(change==='text')(f.proposal.inputs as any).text='changed';if(change==='cost')(f.proposal.inputs as any).ceilingMicros=0;
  if(change==='turn')(f.proposal.inputs as any).turnId='other';if(change==='person')f.proposal.personId='other';if(change==='stop')f.bus.cancelAll();
  await expect(collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow();expect(f.state()).toBeUndefined();expect(f.counts()).toEqual({calls:0,keys:0});
 }
});
test('insufficient allowance and stale pricing stop before credential access',async()=>{
 for(const failure of ['budget','pricing']){
  const f=fixture(failure==='budget'?1:10000);f.approvals.approve(f.ticket);if(failure==='pricing')f.time(catalogueExpiresAt);
  await expect(collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('did not complete');expect(f.state()).toBeUndefined();expect(f.counts()).toEqual({calls:0,keys:0});
 }
});
test('STOP while loading credentials releases unsent reservation and blocks late send',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);const controller=new AbortController();let release!:(key:string)=>void;
 const runner=new BudgetedReasoning(f.approvals,f.authority,f.budget,()=>new Promise(resolve=>{release=resolve;}),f.provider,()=>catalogueReviewedAt);
 const pending=collect(runner.stream(f.ticket,f.proposal,f.turn,controller.signal));await new Promise(resolve=>setImmediate(resolve));expect(f.state()).toBe('RESERVED');
 controller.abort();await expect(pending).rejects.toThrow('cancelled');expect(f.state()).toBe('RELEASED');release('fixture_not_a_real_key');await new Promise(resolve=>setImmediate(resolve));expect(f.counts().calls).toBe(0);
});
test('pricing expiry during key loading releases the unsent reservation',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);
 // Inject a clock that advances after the first freshness check.
 let reads=0;const changing=new BudgetedReasoning(f.approvals,f.authority,f.budget,f.readKey,f.provider,()=>++reads===1?catalogueReviewedAt:catalogueExpiresAt);
 await expect(collect(changing.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('did not complete');expect(f.state()).toBe('RELEASED');expect(f.counts().calls).toBe(0);
});
test('consumer interruption or provider failure after dispatch never refunds the ceiling',async()=>{
 for(const failure of ['consumer','provider','usage']){
  const f=fixture();f.approvals.approve(f.ticket);
  const provider=failure==='consumer'?f.provider:new ResponsesReasoner(async()=>failure==='usage'?response(99):new Response('private failure',{status:500}));
  const runner=new BudgetedReasoning(f.approvals,f.authority,f.budget,f.readKey,provider,()=>catalogueReviewedAt);
  if(failure==='consumer'){for await(const event of runner.stream(f.ticket,f.proposal,f.turn,signal())){expect(event.type).toBe('text');break;}}
  else await expect(collect(runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('did not complete');
  expect(f.state()).toBe('UNCERTAIN');expect(f.budget.balance('budget').committedMicros).toBe(f.plan.ceilingMicros);
 }
});
test('failed durable dispatch blocks the provider and releases unsent funds',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);vi.spyOn(f.budget,'dispatch').mockImplementation(()=>{throw new Error('disk failure');});
 await expect(collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('did not complete');expect(f.state()).toBe('RELEASED');expect(f.counts().calls).toBe(0);
});
test('failed accounting cleanup retains dispatched balance for startup recovery',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);vi.spyOn(f.budget,'uncertain').mockImplementation(()=>{throw new Error('disk failure');});
 await expect(collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('accounting requires recovery');expect(f.state()).toBe('DISPATCHED');
 expect(f.budget.balance('budget').committedMicros).toBe(f.plan.ceilingMicros);f.budget.recover();expect(f.state()).toBe('UNCERTAIN');
});
