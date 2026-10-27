import {test,expect} from 'vitest';
import {ApplicationEventBus} from '../core/application-events.ts';
import {ApprovedEstimate,estimatePolicy,estimateProposal} from '../core/approved-estimate.ts';
import {reasoningPolicy,reasoningProposal} from '../core/approved-reasoning.ts';
import {ActionApprovals} from '../packages/permissions/approvals.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {catalogueReviewedAt,catalogueExpiresAt} from '../packages/reasoning/catalogue.ts';
function fixture(){
 const bus=new ApplicationEventBus(),turn=bus.beginTurn();let identified=true,calls=0,keys=0,now=catalogueReviewedAt;
 const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(person:string)=>identified&&person==='owner'};
 const policy=new PermissionPolicy([estimatePolicy,reasoningPolicy],[{id:'owner',permissions:['cloud_reasoning']}],{denyTools:[],lowRiskWriteTools:[]});
 const approvals=new ActionApprovals(()=>policy,authority);
 const counter=new ResponsesTokenCounter(async()=>{calls++;return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:51}),{headers:{'content-type':'application/json'}});});
 const runner=new ApprovedEstimate(approvals,authority,async()=>{keys++;return 'fixture_not_a_real_key';},counter,()=>now);
 const proposal=estimateProposal('owner','Hello',128,'budget'),ticket=approvals.request(proposal,turn)!;
 return {bus,turn,authority,approvals,counter,runner,proposal,ticket,counts:()=>({calls,keys}),revoke:()=>{identified=false;},time:(value:number)=>{now=value;}};
}
const signal=()=>new AbortController().signal;
test('exact approved text produces a frozen counted price plan once',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);
 const result=await f.runner.estimate(f.ticket,f.proposal,f.turn,signal());
 expect(result).toMatchObject({text:'Hello',personId:'owner',turnId:f.turn.id,inputTokens:51,ceilingMicros:7038});expect(Object.isFrozen(result)).toBe(true);
 await expect(f.runner.estimate(f.ticket,f.proposal,f.turn,signal())).rejects.toThrow('denied');expect(f.counts()).toEqual({calls:1,keys:1});
});
test('unapproved, copied, changed and revoked proposals cannot load a key',async()=>{
 for(const change of ['unapproved','copy','text','budget','output','person','stop','identity']){
  const f=fixture();if(change!=='unapproved')f.approvals.approve(f.ticket);let ticket=f.ticket;
  if(change==='copy')ticket={...ticket};if(change==='text')(f.proposal.inputs as any).text='Changed';
  if(change==='budget')(f.proposal.inputs as any).budgetId='other';if(change==='output')(f.proposal.inputs as any).maxOutputTokens=1024;
  if(change==='person')f.proposal.personId='other';if(change==='stop')f.bus.cancelAll();if(change==='identity')f.revoke();
  await expect(f.runner.estimate(ticket,f.proposal,f.turn,signal())).rejects.toThrow();expect(f.counts()).toEqual({calls:0,keys:0});
 }
});
test('generation permission cannot authorize counting',async()=>{
 const f=fixture(),proposal=reasoningProposal('owner','Hello',128),ticket=f.approvals.request(proposal,f.turn)!;f.approvals.approve(ticket);
 await expect(f.runner.estimate(ticket,proposal,f.turn,signal())).rejects.toThrow('denied');expect(f.counts()).toEqual({calls:0,keys:0});
});
test('expired pricing is rejected before disclosure',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);f.time(catalogueExpiresAt);
 await expect(f.runner.estimate(f.ticket,f.proposal,f.turn,signal())).rejects.toThrow('did not complete');expect(f.counts()).toEqual({calls:0,keys:0});
});
test('STOP interrupts pending key loading and late credentials cannot dispatch',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);let release!:(key:string)=>void;const controller=new AbortController();
 const runner=new ApprovedEstimate(f.approvals,f.authority,()=>new Promise(resolve=>{release=resolve;}),f.counter,()=>catalogueReviewedAt);
 const pending=runner.estimate(f.ticket,f.proposal,f.turn,controller.signal);await new Promise(resolve=>setImmediate(resolve));
 controller.abort();await expect(pending).rejects.toThrow('cancelled');release('fixture_not_a_real_key');await new Promise(resolve=>setImmediate(resolve));expect(f.counts().calls).toBe(0);
});
test('identity revocation during counting discards its result',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);
 const counter=new ResponsesTokenCounter(async()=>{f.revoke();return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:51}),{headers:{'content-type':'application/json'}});});
 const runner=new ApprovedEstimate(f.approvals,f.authority,async()=>'fixture_not_a_real_key',counter,()=>catalogueReviewedAt);
 await expect(runner.estimate(f.ticket,f.proposal,f.turn,signal())).rejects.toThrow('cancelled');
});
