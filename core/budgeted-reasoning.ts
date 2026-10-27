import {textModel} from '../packages/reasoning/text-contract.ts';
import type {ModelHealth,ModelAttempt} from '../packages/reasoning/model-health.ts';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {latencyFields,type LatencyTrace} from '../packages/contracts/latency.ts';
import type {TurnContext} from '../packages/contracts/events.ts';
import {ActionApprovals,type ApprovalAuthority,type ApprovalTicket} from '../packages/permissions/approvals.ts';
import type {ProposedAction,ToolPolicy} from '../packages/permissions/policy.ts';
import {ResponsesReasoner,type ReasoningEvent} from '../packages/reasoning/responses.ts';
import {reasoningRequestHash,type BoundTextRequest} from '../packages/reasoning/request-binding.ts';
import {estimateTextCeiling} from '../packages/reasoning/catalogue.ts';
import {ReasoningBudget} from './reasoning-budget.ts';
export const budgetedReasoningPolicy:ToolPolicy=Object.freeze({id:'reasoning.openai.budgeted',version:1,risk:'CONFIRM',permissions:Object.freeze(['cloud_reasoning'])});
/** The human review must show exact text, model, output ceiling and cost/budget. */
export function budgetedReasoningProposal(plan:BoundTextRequest):ProposedAction{
 reasoningRequestHash(plan);
 textModel(plan.modelId);
 return {personId:plan.personId,toolId:budgetedReasoningPolicy.id,inputs:structuredClone(plan)};
}
/** Trusted generation bridge. Count approval does not authorize generation.
 * Possible sends retain their full ceiling until a trusted billing reconciler settles them.
 */
export class BudgetedReasoning {
 constructor(private approvals:ActionApprovals,private authority:ApprovalAuthority,private budget:ReasoningBudget,
  private readKey:()=>Promise<string|null>,private provider:ResponsesReasoner=new ResponsesReasoner(),private now:()=>number=Date.now,private diagnostics?:{publish:(trace:LatencyTrace)=>unknown;clock?:()=>number},private health?:ModelHealth,private routeGuard?:(plan:Readonly<BoundTextRequest>)=>void){}
 async *stream(ticket:ApprovalTicket,proposal:ProposedAction,turn:TurnContext,signal:AbortSignal):AsyncGenerator<ReasoningEvent>{
  if(signal.aborted)throw new Error('Reasoning cancelled');
  const reviewed=this.approvals.consume(ticket,proposal,turn);
  if(!reviewed||reviewed.action.toolId!==budgetedReasoningPolicy.id||reviewed.toolVersion!==1)throw new Error('Budgeted reasoning approval expired or denied');
  const plan=reviewed.action.inputs as BoundTextRequest;
  budgetedReasoningProposal(plan);
  if(plan.personId!==reviewed.action.personId||plan.turnId!==turn.id)throw new Error('Mismatched reasoning plan');
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(120000)]);
  const current=()=>!combined.aborted&&this.authority.isCurrent(turn)&&this.authority.identifies(plan.personId,turn);
  const priced=()=>{
   const price=estimateTextCeiling({modelId:plan.modelId,inputTokens:plan.inputTokens,maxOutputTokens:plan.maxOutputTokens,nowMs:this.now(),processing:'standard',region:'global',modality:'text',toolCount:0});
   if(price.estimateVersion!==plan.estimateVersion||price.ceilingMicros!==plan.ceilingMicros)throw new Error('Stale price');
  };
  const profiler=new LatencyProfiler(this.diagnostics?.clock);profiler.begin('reasoning');
  for(const field of latencyFields)if(field!=='llm_first_token_ms'&&field!=='full_turn_ms'&&!(this.routeGuard&&field==='model_router_ms'))profiler.notApplicable(field);
  const publish=()=>{try{const trace=profiler.snapshot();if(trace)Promise.resolve(this.diagnostics?.publish(trace)).catch(()=>{});}catch{}};
  let outcome:'completed'|'failed'|'cancelled'='cancelled',first=true;publish();
  const checkRoute=()=>{if(!this.routeGuard)return;const span=profiler.start('model_router_ms');try{this.routeGuard(Object.freeze({...plan}));profiler.end(span);}catch(error){profiler.end(span,'failed');throw error;}};
  let reservation:string|undefined,dispatched=false,attempt:ModelAttempt|undefined;
  const finishHealth=()=>{try{if(attempt)this.health?.finish(attempt,outcome);}catch{this.health?.clear();}};
  try{
   if(!current())throw new Error();priced();checkRoute();reservation=this.budget.reserve(plan);
   const key=await new Promise<string|null>((resolve,reject)=>{
    const abort=()=>reject(new Error('Cancelled'));combined.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{combined.throwIfAborted();return this.readKey();}).then(resolve,reject).finally(()=>combined.removeEventListener('abort',abort));
   });
   if(!current()||!key)throw new Error();priced();checkRoute();
   // Persist send intent before the adapter can touch the network. Fail closed on write failure.
   this.budget.dispatch(reservation,plan);dispatched=true;
   if(!current())throw new Error();
   let completed=false;const firstToken=profiler.start('llm_first_token_ms');
   try{attempt=this.health?.begin(plan.modelId,{inputTokens:plan.inputTokens,maxOutputTokens:plan.maxOutputTokens});}catch{this.health?.clear();}
   for await(const event of this.provider.stream({text:plan.text,model:textModel(plan.modelId),maxOutputTokens:plan.maxOutputTokens,cloudApproved:true,signal:combined},key)){
    if(!current())throw new Error();
    if(first&&(event.type==='text'||event.type==='refusal')&&event.text){first=false;profiler.end(firstToken);try{if(attempt)this.health?.firstText(attempt);}catch{this.health?.clear();}publish();}
    if(event.type==='completed'){
     // Reported usage is not proof of the invoice or cache/tier billing treatment.
     // A mismatch still holds the full ceiling for reconciliation and is not success.
     if(event.inputTokens!==plan.inputTokens||event.outputTokens>plan.maxOutputTokens)throw new Error();
     completed=true;
    }
    yield event;if(!current())throw new Error();
   }
   if(!completed)throw new Error();outcome='completed';
  }catch{outcome=!current()?'cancelled':'failed';throw new Error(!current()?'Reasoning cancelled':'Budgeted reasoning did not complete');}
  finally{
   controller.abort();
   if(reservation){
    try{if(dispatched)this.budget.uncertain(reservation);else this.budget.release(reservation);}
    catch{outcome='failed';finishHealth();profiler.finish(outcome);publish();throw new Error('Reasoning accounting requires recovery');}
   }
   finishHealth();profiler.finish(outcome);publish();
  }
 }
}
