import {reasoningSelection} from '../packages/reasoning/selection.ts';
import type {ReasoningTier} from '../packages/reasoning/router.ts';
import {reasoningRequestHash,type BoundTextRequest} from '../packages/reasoning/request-binding.ts';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {TextRouteAdvisor} from './text-route-advisor.ts';
import {textModel} from '../packages/reasoning/text-contract.ts';
import {ModelHealth} from '../packages/reasoning/model-health.ts';
import {BudgetedReasoning,budgetedReasoningPolicy,budgetedReasoningProposal} from './budgeted-reasoning.ts';
import type {ReasoningBudget} from './reasoning-budget.ts';
import {LOCAL_ALLOWANCE_ID} from './allowance-controller.ts';
import {ApprovedEstimate,estimatePolicy,estimateProposal} from './approved-estimate.ts';
import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {estimateTextCeiling} from '../packages/reasoning/catalogue.ts';
import {randomUUID} from 'node:crypto';
import {ApplicationEventBus} from './application-events.ts';
import {ActionApprovals,type ApprovalTicket} from '../packages/permissions/approvals.ts';
import {PermissionPolicy,type ProposedAction} from '../packages/permissions/policy.ts';
import type {TurnContext} from '../packages/contracts/events.ts';
import {emptyReasoning,type ReasoningStatus} from '../packages/contracts/reasoning.ts';
import {ApprovedReasoning,reasoningPolicy,reasoningProposal} from './approved-reasoning.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
interface Pending {automatic:ReasoningTier|null;plan?:Readonly<BoundTextRequest>;id:string;ticket:ApprovalTicket;proposal:ProposedAction;turn:TurnContext;abort:AbortController;}
/** Explicit local desktop review only; never speaker/household authorization. */
export class ReasoningController {
 #bus=new ApplicationEventBus();#status:ReasoningStatus={...emptyReasoning};#pending:Pending|null=null;
 #textTimer:ReturnType<typeof setTimeout>|null=null;
 #task:Promise<void>|null=null;#timer:ReturnType<typeof setTimeout>|null=null;
 #authority={isCurrent:(turn:TurnContext)=>this.#bus.isCurrent(turn),identifies:(person:string,turn:TurnContext)=>person==='local_desktop'&&this.#bus.isCurrent(turn)};
 #policy=new PermissionPolicy([reasoningPolicy,estimatePolicy,budgetedReasoningPolicy],[{id:'local_desktop',permissions:['cloud_reasoning']}],{denyTools:[],lowRiskWriteTools:[]});
 #approvals=new ActionApprovals(()=>this.#policy,this.#authority);
 constructor(private readKey:()=>Promise<string|null>,private changed:()=>void=()=>{},private provider=new ResponsesReasoner(),private estimation?:{counter:ResponsesTokenCounter;now?:()=>number},private budget?:ReasoningBudget,private health=new ModelHealth()){if(budget&&!estimation)throw new Error('Budgeted requests require estimation');}
 get active(){return !!this.#pending||!!this.#task;}
 snapshot():ReasoningStatus{return structuredClone(this.#status);}
 #notify(){if(this.#textTimer)clearTimeout(this.#textTimer);this.#textTimer=null;try{this.changed();}catch{}}
 #queueText(){if(!this.#textTimer)this.#textTimer=setTimeout(()=>this.#notify(),50);}
 #clearTimer(){if(this.#timer)clearTimeout(this.#timer);this.#timer=null;}
 review(text:unknown,model:unknown='gpt-6-astra'):void{
  if(this.active)throw new Error('Finish or cancel the current request first');
  const {modelId,automatic}=reasoningSelection(model);if((automatic||modelId!=='gpt-6-astra')&&(!this.budget||!this.estimation))throw new Error('Model selection requires budgeted review');
  const proposal=this.estimation?estimateProposal('local_desktop',text as string,1024,this.budget?LOCAL_ALLOWANCE_ID:'preview-only',modelId):reasoningProposal('local_desktop',text as string,1024);
  if(automatic&&!this.health.candidate(modelId,{inputTokens:1,maxOutputTokens:1024},null).ready){
   this.#status={...emptyReasoning,state:'ERROR',modelId,automatic,error:'Automatic selection needs recent successful use of this model. Choose it manually for a separately reviewed request first.'};this.#notify();return;
  }
  const turn=this.#bus.beginTurn();
  const ticket=this.#approvals.request(proposal,turn);if(!ticket){this.#bus.endTurn(turn);throw new Error('Review unavailable');}
  const pending:Pending={automatic,id:randomUUID(),ticket,proposal,turn,abort:new AbortController()};this.#pending=pending;
  this.#status={...emptyReasoning,state:this.estimation?'ESTIMATE_REVIEW':'REVIEW',modelId,automatic,reviewId:pending.id,prompt:text as string};
  this.#timer=setTimeout(()=>{if(this.#pending===pending&&['REVIEW','ESTIMATE_REVIEW'].includes(this.#status.state))void this.stop();},60000);
  this.#notify();
 }
 approve(id:unknown):void{
  const pending=this.#pending,counting=this.#status.state==='ESTIMATE_REVIEW';
  if(typeof id!=='string'||!pending||id!==pending.id||this.#task||!['REVIEW','ESTIMATE_REVIEW'].includes(this.#status.state))throw new Error('Review expired or denied');
  if(counting&&pending.automatic&&!this.health.candidate(this.#status.modelId,{inputTokens:1,maxOutputTokens:1024},null).ready)throw new Error('Automatic model readiness expired');
  if(!counting&&this.estimation){
   const estimate=this.#status.estimate;if(!estimate)throw new Error('Estimate unavailable');
   const price=estimateTextCeiling({modelId:this.#status.modelId,inputTokens:estimate.inputTokens,maxOutputTokens:1024,nowMs:this.estimation.now?.()??Date.now(),processing:'standard',region:'global',modality:'text',toolCount:0});
   if(price.estimateVersion!==estimate.estimateVersion||price.ceilingMicros!==estimate.ceilingMicros)throw new Error('Estimate expired');
  }
  if(!counting&&pending.automatic){if(!pending.plan)throw new Error('Routing plan unavailable');this.#checkAdvice(pending,pending.plan);}
  if(!this.#approvals.approve(pending.ticket))throw new Error('Review expired or denied');
  this.#clearTimer();this.#status.state=counting?'ESTIMATING':'STREAMING';this.#status.reviewId=null;
  this.#task=Promise.resolve().then(()=>counting?this.#estimate(pending):this.#run(pending)).finally(()=>{this.#task=null;this.#notify();});this.#notify();
 }
 async #estimate(pending:Pending){
  try{
   const runner=new ApprovedEstimate(this.#approvals,this.#authority,this.readKey,this.estimation!.counter,this.estimation!.now);
   const plan=await runner.estimate(pending.ticket,pending.proposal,pending.turn,pending.abort.signal);
   if(this.#pending!==pending||pending.abort.signal.aborted)return;
   pending.plan=plan;if(pending.automatic)this.#checkAdvice(pending,plan);
   // Counting consent cannot authorize generation; bind a fresh review to the complete plan.
   const proposal=this.budget?budgetedReasoningProposal(plan):reasoningProposal('local_desktop',plan.text,plan.maxOutputTokens),ticket=this.#approvals.request(proposal,pending.turn);
   if(!ticket)throw new Error('Review unavailable');
   pending.id=randomUUID();pending.ticket=ticket;pending.proposal=proposal;
   this.#status={...emptyReasoning,state:'REVIEW',automatic:pending.automatic,routingTrace:this.#status.routingTrace,modelId:textModel(plan.modelId),prompt:plan.text,reviewId:pending.id,estimate:{inputTokens:plan.inputTokens,ceilingMicros:plan.ceilingMicros,estimateVersion:plan.estimateVersion}};
   this.#timer=setTimeout(()=>{if(this.#pending===pending&&this.#status.state==='REVIEW')void this.stop();},60000);
  }catch{
   if(this.#pending===pending){this.#status.state='ERROR';this.#status.error='The estimate did not finish. No answer was requested. Check model readiness, connection access, allowance and pricing before reviewing again.';this.#pending=null;}
   this.#bus.endTurn(pending.turn);
  }
 }
 #checkAdvice(pending:Pending,plan:Readonly<BoundTextRequest>){
  if(!pending.automatic||!this.budget)throw new Error('Automatic routing unavailable');
  const profiler=new LatencyProfiler();profiler.begin('reasoning');
  try{
   const advice=new TextRouteAdvisor(this.budget,this.health,this.estimation?.now).advise([plan],{complexity:pending.automatic,bigBrain:false,risk:'safe',online:true,localOnly:false,maxFirstTokenMs:null,maxTurnMs:null},profiler);
   if(advice.requestHash!==reasoningRequestHash(plan))throw new Error('No eligible model for this request');
   profiler.finish('completed');
  }catch(error){profiler.finish('failed');throw error;}
  finally{this.#status.routingTrace=profiler.snapshot();}
 }
 #guardRoute(pending:Pending,plan:Readonly<BoundTextRequest>){
  if(!pending.plan||reasoningRequestHash(pending.plan)!==reasoningRequestHash(plan))throw new Error('Routing plan changed');
  const candidate=this.health.candidate(plan.modelId,plan,plan.ceilingMicros);
  if(!candidate.ready||!candidate.healthy)throw new Error('Automatic model readiness expired');
 }
 async #run(pending:Pending){
  const runner=this.budget?new BudgetedReasoning(this.#approvals,this.#authority,this.budget,this.readKey,this.provider,this.estimation?.now,{publish:trace=>{if(this.#pending===pending){this.#status.trace=trace;this.#notify();}}},this.health,pending.automatic?plan=>this.#guardRoute(pending,plan):undefined):new ApprovedReasoning(this.#approvals,this.#authority,async()=>{
   const key=await this.readKey();
   if(this.estimation){const estimate=this.#status.estimate;if(!estimate)throw new Error('Estimate unavailable');
    const price=estimateTextCeiling({modelId:this.#status.modelId,inputTokens:estimate.inputTokens,maxOutputTokens:1024,nowMs:this.estimation.now?.()??Date.now(),processing:'standard',region:'global',modality:'text',toolCount:0});
    if(price.ceilingMicros!==estimate.ceilingMicros||price.estimateVersion!==estimate.estimateVersion)throw new Error('Estimate expired');}
   return key;
  },this.provider,{publish:trace=>{if(this.#pending===pending){this.#status.trace=trace;this.#notify();}}});
  try{
   for await(const event of runner.stream(pending.ticket,pending.proposal,pending.turn,pending.abort.signal)){
    if(this.#pending!==pending||pending.abort.signal.aborted)return;
    if(event.type==='completed'){this.#status.state='FINISHED';this.#status.usage={inputTokens:event.inputTokens,outputTokens:event.outputTokens};this.#notify();}
    else{const first=this.#status.text.length===0;this.#status.text+=event.text;this.#status.refused ||= event.type==='refusal';if(first)this.#notify();else this.#queueText();}
   }
  }catch{if(this.#pending===pending){this.#status.state='ERROR';this.#status.error='The request did not finish. Any text shown is incomplete. Check the saved key, account access and local allowance before reviewing a new request.';}}
  finally{this.#bus.endTurn(pending.turn);if(this.#pending===pending)this.#pending=null;this.#notify();}
 }
 async stop():Promise<void>{
  this.#clearTimer();this.#approvals.cancelAll();this.#bus.cancelAll();this.health.clear();
  const pending=this.#pending;this.#pending=null;pending?.abort.abort();
  this.#status={...emptyReasoning,state:'CANCELLED'};this.#notify();await this.#task;
 }
}
