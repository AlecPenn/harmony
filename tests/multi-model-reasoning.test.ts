import {test,expect} from 'vitest';
import {textModels,textInputHash,textInput} from '../packages/reasoning/text-contract.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {ApprovedEstimate,estimatePolicy,estimateProposal} from '../core/approved-estimate.ts';
import {BudgetedReasoning,budgetedReasoningPolicy,budgetedReasoningProposal} from '../core/budgeted-reasoning.ts';
import {ActionApprovals} from '../packages/permissions/approvals.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
import {ApplicationEventBus} from '../core/application-events.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {openDatabase} from '../core/storage.ts';
import {catalogueReviewedAt} from '../packages/reasoning/catalogue.ts';
const key='fixture_not_a_real_key',signal=()=>new AbortController().signal;
async function collect(stream:AsyncIterable<unknown>){const result=[];for await(const event of stream)result.push(event);return result;}
test.each(textModels)('approved counting and budgeted generation use the exact same %s contract',async model=>{
 const db=openDatabase(':memory:');try{
  const budget=new ReasoningBudget(db);budget.create('budget',1000000,'owner');const bus=new ApplicationEventBus(),turn=bus.beginTurn();
  const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(id:string)=>id==='owner'};
  const policy=new PermissionPolicy([estimatePolicy,budgetedReasoningPolicy],[{id:'owner',permissions:['cloud_reasoning']}],{denyTools:[],lowRiskWriteTools:[]}),approvals=new ActionApprovals(()=>policy,authority);
  let counted:any,generated:any;
  const counter=new ResponsesTokenCounter(async(_url,init)=>{counted=JSON.parse(init!.body as string);return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:10}),{headers:{'content-type':'application/json'}});});
  const proposal=estimateProposal('owner','Hello',128,'budget',model),ticket=approvals.request(proposal,turn)!;approvals.approve(ticket);
  const plan=await new ApprovedEstimate(approvals,authority,async()=>key,counter,()=>catalogueReviewedAt).estimate(ticket,proposal,turn,signal());expect(plan.modelId).toBe(model);
  const provider=new ResponsesReasoner(async(_url,init)=>{generated=JSON.parse(init!.body as string);return new Response('data: '+JSON.stringify({type:'response.completed',sequence_number:1,response:{status:'completed',model,usage:{input_tokens:10,output_tokens:2}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});});
  const answer=budgetedReasoningProposal(plan),answerTicket=approvals.request(answer,turn)!;approvals.approve(answerTicket);
  await collect(new BudgetedReasoning(approvals,authority,budget,async()=>key,provider,()=>catalogueReviewedAt).stream(answerTicket,answer,turn,signal()));
  const {stream,store,max_output_tokens,...input}=generated;expect(input).toEqual(counted);expect(input.model).toBe(model);expect(store).toBe(false);expect(db.prepare('SELECT model_id,state FROM reasoning_reservations').get()).toMatchObject({model_id:model,state:'UNCERTAIN'});
 }finally{db.close();}
});
test('model hashes differ and unknown model selection fails before transport',async()=>{
 expect(new Set(textModels.map(model=>textInputHash('Hello',model))).size).toBe(3);expect(()=>textInput('Hello','unapproved-model')).toThrow();
 let calls=0;const provider=new ResponsesReasoner(async()=>{calls++;throw new Error();});
 await expect(collect(provider.stream({text:'Hello',model:'unapproved-model' as any,maxOutputTokens:128,cloudApproved:true,signal:signal()},key))).rejects.toThrow();expect(calls).toBe(0);
});
test('a different returned model cannot complete an approved stream and caller mutation cannot switch models',async()=>{
 const request={text:'Hello',model:'gpt-6-luna' as const,maxOutputTokens:128,cloudApproved:true,signal:signal()};
 const provider=new ResponsesReasoner(async()=>{(request as any).model='gpt-6-astra';return new Response('data: '+JSON.stringify({type:'response.completed',sequence_number:1,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:10,output_tokens:2}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});});
 await expect(collect(provider.stream(request,key))).rejects.toThrow();
});
