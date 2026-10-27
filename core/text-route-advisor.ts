import {performance} from 'node:perf_hooks';
import {estimateTextCeiling} from '../packages/reasoning/catalogue.ts';
import {ModelHealth} from '../packages/reasoning/model-health.ts';
import {reasoningRequestHash,type BoundTextRequest} from '../packages/reasoning/request-binding.ts';
import {explainRoute,type ModelRouteRequest,type RouteDecision} from '../packages/reasoning/router.ts';
import type {LatencyProfiler} from '../packages/telemetry/latency.ts';
import type {ReasoningBudget} from './reasoning-budget.ts';
export type TextRouteRequirements=Pick<ModelRouteRequest,'complexity'|'bigBrain'|'risk'|'online'|'localOnly'|'maxFirstTokenMs'|'maxTurnMs'>;
/** Trusted-core advisor, not an IPC entry point or dispatch authority.
 * Plans must originate from separately approved, model-specific token counting.
 * No prompt classification, key access, network activity, reservation or retry.
 */
export class TextRouteAdvisor {
 constructor(private budget:ReasoningBudget,private health:ModelHealth,
  private wallClock:()=>number=Date.now,private monotonic:()=>number=()=>performance.now()){}
 advise(plans:readonly BoundTextRequest[],requirements:TextRouteRequirements,profiler:LatencyProfiler):RouteDecision&{requestHash:string|null}{
  const span=profiler.start('model_router_ms');
  try{
   if(!Array.isArray(plans)||plans.length<1||plans.length>3)throw new Error('Invalid text routing plans');
   // Validate before reading/copying fields; rejects accessors and unknown properties.
   const hashes=plans.map(plan=>reasoningRequestHash(plan));
   const copies=plans.map(plan=>({...plan})),first=copies[0],ids=new Set<string>(),now=this.wallClock();
   for(const plan of copies){
    if(ids.has(plan.modelId)||plan.personId!==first.personId||plan.turnId!==first.turnId||plan.budgetId!==first.budgetId
      ||plan.text!==first.text||plan.maxOutputTokens!==first.maxOutputTokens)throw new Error('Routing plans do not describe the same request');
    ids.add(plan.modelId);
    const price=estimateTextCeiling({modelId:plan.modelId,inputTokens:plan.inputTokens,maxOutputTokens:plan.maxOutputTokens,
     nowMs:now,processing:'standard',region:'global',modality:'text',toolCount:0});
    if(price.estimateVersion!==plan.estimateVersion||price.ceilingMicros!==plan.ceilingMicros)throw new Error('Routing estimate expired or changed');
   }
   const balance=this.budget.balanceFor(first.budgetId,first.personId);
   const candidates=copies.map(plan=>this.health.candidate(plan.modelId,plan,plan.ceilingMicros));
   const nowMs=this.monotonic();
   // Each model has its own complete input count, never another model's tokenization.
   const decisions=copies.map((plan,index)=>explainRoute({...requirements,capabilities:['text'],toolCount:0,
    inputTokens:plan.inputTokens,maxOutputTokens:plan.maxOutputTokens,nowMs,maxHealthAgeMs:60000,
    availableMemoryMiB:0,remainingBudgetMicros:balance.remainingMicros},[candidates[index]]));
   const eligible=decisions.map((decision,index)=>({decision,index})).filter(item=>item.decision.route.modelId!==null);
   // The pinned catalogue contains exactly one model per tier. Never silently pick between duplicates.
   if(eligible.length>1)throw new Error('Ambiguous text route');
   const selected=eligible[0];
   const result={route:selected?.decision.route??decisions[0].route,
    candidates:decisions.flatMap(decision=>decision.candidates),requestHash:selected?hashes[selected.index]:null};
   profiler.end(span);return result;
  }catch(error){profiler.end(span,'failed');throw error;}
 }
}
