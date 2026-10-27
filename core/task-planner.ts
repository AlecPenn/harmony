import {performance} from 'node:perf_hooks';
import type {TurnContext} from '../packages/contracts/events.ts';
import {actionInputHash} from '../packages/permissions/policy.ts';
import {ToolRegistry,validateValue} from '../packages/tools/registry.ts';
import {ToolDispatcher,type DispatchAuthority} from './tool-dispatcher.ts';
import {ActionJournal} from './action-journal.ts';
import {ReadOnlyOrchestrator,type PlanReport,type VerifiedPlanOutput} from './read-only-orchestrator.ts';

/** Authority derived by trusted core from the user's explicit request. Never parsed from model text. */
export interface TaskScope {requestHash:string;maxSteps:number;tools:Record<string,{maxCalls:number}>;}
/** Recorded by the trusted caller, not declared by the proposal. Provenance grants nothing. */
export type PlanProvenance='trusted_template'|'model_proposal';
export interface ProposedStep {id:string;toolId:string;inputs:unknown;after?:readonly string[];}
export interface PreparedPlanHandle {readonly kind:'prepared-task-plan';}
export interface PreparedPlanSummary {
 readonly fingerprint:string;readonly scopeFingerprint:string;readonly provenance:PlanProvenance;readonly preparationMs:number;
 readonly steps:readonly {readonly id:string;readonly toolId:string;readonly after:readonly string[]}[];
}
export interface StructuredPlanReport extends PlanReport {fingerprint:string;scopeFingerprint:string;provenance:PlanProvenance;preparationMs:number;}
interface CapturedStep {id:string;toolId:string;version:number;inputs:unknown;inputsHash:string;after:string[];}
interface Prepared {turn:TurnContext;personId:string;scope:TaskScope;scopeFingerprint:string;provenance:PlanProvenance;steps:CapturedStep[];fingerprint:string;expiresAt:number;preparationMs:number;}

const identifier=/^[a-zA-Z0-9_.-]{1,80}$/;
const keys=(value:object)=>Object.keys(value).sort().join(',');
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const fingerprintOf=(p:Omit<Prepared,'fingerprint'|'expiresAt'|'preparationMs'|'scope'|'turn'>&{turn:TurnContext})=>actionInputHash({
 scope:p.scopeFingerprint,provenance:p.provenance,turn:p.turn.id,generation:p.turn.generation,person:p.personId,
 steps:p.steps.map(s=>({id:s.id,toolId:s.toolId,version:s.version,inputs:s.inputsHash,after:s.after}))
});

/** Bounded structured planning on top of the verified read-only runner.
 * prepare() validates a complete proposal against an explicit scope and current policy, then returns an opaque
 * one-use handle bound to the exact turn, person, scope, tool versions and inputs. execute() consumes it and runs
 * only through ReadOnlyOrchestrator/ToolDispatcher. A prepared plan is not completed work and never grants permission.
 * Trusted core entry point only: no renderer IPC or model adapter calls this directly.
 */
export class TaskPlanner {
 #pending=new Map<PreparedPlanHandle,Prepared>();#lastTime=0;#runner:ReadOnlyOrchestrator|null=null;#task:Promise<StructuredPlanReport>|null=null;
 constructor(private registry:ToolRegistry,private dispatcher:ToolDispatcher,private journal:ActionJournal,private authority:DispatchAuthority,
  private now:()=>number=Date.now,private ttlMs=60000,private changed:()=>void=()=>{}){
  if(!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>300000)throw new Error('Invalid plan lifetime');
 }
 get active(){return this.#task!==null;}
 get pendingCount(){return this.#pending.size;}
 #time(){const now=this.now();if(!Number.isSafeInteger(now)||now<=0||now<this.#lastTime){this.cancelAll();return null;}this.#lastTime=now;return now;}
 #identified(turn:TurnContext,personId:string){return this.authority.isCurrent(turn)&&this.authority.identifies(personId,turn);}
 #scope(value:unknown):TaskScope{
  actionInputHash(value);const scope=value as TaskScope;
  if(!scope||typeof scope!=='object'||Array.isArray(scope)||keys(scope)!=='maxSteps,requestHash,tools'||typeof scope.requestHash!=='string'||!/^[a-f0-9]{64}$/.test(scope.requestHash)
   ||!Number.isSafeInteger(scope.maxSteps)||scope.maxSteps<1||scope.maxSteps>16||!scope.tools||typeof scope.tools!=='object'||Array.isArray(scope.tools))throw new Error('Invalid task scope');
  const tools=Object.entries(scope.tools);if(tools.length<1||tools.length>16)throw new Error('Invalid task scope');
  for(const [toolId,limit] of tools){
   if(!identifier.test(toolId)||!limit||typeof limit!=='object'||keys(limit)!=='maxCalls'||!Number.isSafeInteger(limit.maxCalls)||limit.maxCalls<1||limit.maxCalls>16)throw new Error('Invalid task scope');
   const tool=this.registry.resolve(toolId);if(tool.risk!=='SAFE'||!tool.available())throw new Error('Scope contains unavailable or non-read-only tool');
  }
  return freeze(structuredClone(scope));
 }
 prepare(scopeValue:unknown,provenance:PlanProvenance,value:unknown,turn:TurnContext,personId:string):{handle:PreparedPlanHandle;summary:PreparedPlanSummary}{
  const started=performance.now(),now=this.#time();
  if(now===null||this.active||!this.#identified(turn,personId)||!['trusted_template','model_proposal'].includes(provenance))throw new Error('Planning unavailable');
  const scope=this.#scope(scopeValue);
  // Reject accessors, prototypes and oversized JSON before reading proposal fields.
  actionInputHash(value);
  if(!Array.isArray(value)||value.length<1||value.length>scope.maxSteps)throw new Error('Plan exceeds task scope');
  const seen=new Set<string>(),calls=new Map<string,number>(),probe=new AbortController().signal;
  const steps:CapturedStep[]=value.map((item:ProposedStep)=>{
   const shape=item&&typeof item==='object'&&!Array.isArray(item)?keys(item):'';
   if(shape!=='id,inputs,toolId'&&shape!=='after,id,inputs,toolId'||typeof item.id!=='string'||!identifier.test(item.id)||seen.has(item.id)||typeof item.toolId!=='string')throw new Error('Invalid plan step');
   // Dependencies may only name earlier steps, so every accepted plan is acyclic and runs in declared order.
   const after=item.after===undefined?[]:item.after;
   if(!Array.isArray(after)||after.length>16||new Set(after).size!==after.length||after.some(id=>typeof id!=='string'||!seen.has(id)))throw new Error('Invalid plan dependency');
   if(!Object.hasOwn(scope.tools,item.toolId))throw new Error('Step outside task scope');
   const count=(calls.get(item.toolId)??0)+1;if(count>scope.tools[item.toolId].maxCalls)throw new Error('Step outside task scope');calls.set(item.toolId,count);
   const tool=this.registry.resolve(item.toolId);if(tool.risk!=='SAFE'||!tool.available())throw new Error('Plan contains unavailable or non-read-only tool');
   validateValue(item.inputs,tool.inputSchema);
   const inputs=freeze(structuredClone(item.inputs));
   // Current policy must already allow every step; execution and result release recheck it again.
   this.dispatcher.assertAuthorized(turn,personId,tool.id,inputs,probe);
   seen.add(item.id);return {id:item.id,toolId:tool.id,version:tool.version,inputs,inputsHash:actionInputHash(inputs),after:[...after]};
  });
  const scopeFingerprint=actionInputHash(scope);
  const base={turn,personId,scopeFingerprint,provenance,steps};
  const prepared:Prepared={...base,scope,fingerprint:fingerprintOf(base),expiresAt:now+this.ttlMs,preparationMs:Math.max(0,performance.now()-started)};
  freeze(prepared.steps);
  // Deliberate re-planning supersedes any unconsumed plan for the same turn; expired plans are discarded.
  for(const [handle,p] of this.#pending)if(p.turn===turn||now>=p.expiresAt||!this.#identified(p.turn,p.personId))this.#pending.delete(handle);
  if(this.#pending.size>=8)throw new Error('Too many prepared plans');
  const handle=Object.freeze({kind:'prepared-task-plan' as const});this.#pending.set(handle,prepared);this.#notify();
  return {handle,summary:this.#summary(prepared)};
 }
 #summary(p:Prepared):PreparedPlanSummary{
  return freeze({fingerprint:p.fingerprint,scopeFingerprint:p.scopeFingerprint,provenance:p.provenance,preparationMs:p.preparationMs,steps:p.steps.map(s=>({id:s.id,toolId:s.toolId,after:[...s.after]}))});
 }
 #notify(){try{this.changed();}catch{}}
 /** One-use: the handle is consumed before any check, so a failed, stale or copied handle can never run later. */
 execute(handle:PreparedPlanHandle,turn:TurnContext,personId:string,signal:AbortSignal,handoff:(outputs:readonly VerifiedPlanOutput[])=>void=()=>{}):Promise<StructuredPlanReport>{
  const p=this.#pending.get(handle);this.#pending.delete(handle);const now=this.#time();
  if(!p||now===null||now>=p.expiresAt||this.active||signal.aborted||p.turn!==turn||p.personId!==personId||!this.#identified(turn,personId))throw new Error('Prepared plan unavailable');
  for(const step of p.steps){
   const tool=this.registry.resolve(step.toolId);
   if(tool.version!==step.version||tool.risk!=='SAFE'||!tool.available()||!Object.hasOwn(p.scope.tools,step.toolId)||actionInputHash(step.inputs)!==step.inputsHash)throw new Error('Prepared plan changed');
  }
  if(fingerprintOf(p)!==p.fingerprint)throw new Error('Prepared plan changed');
  const runner=new ReadOnlyOrchestrator(this.registry,this.dispatcher,this.journal,this.authority,()=>this.#notify(),outputs=>{
   signal.throwIfAborted();if(!this.#identified(turn,personId))throw new Error('Plan authority expired');
   if(outputs.length!==p.steps.length||outputs.some((output,index)=>output.stepId!==p.steps[index].id))throw new Error('Plan evidence mismatch');
   handoff(outputs);
  });
  // run() validates synchronously; nothing is marked active if it refuses to start.
  const run=runner.run(p.steps.map(s=>({id:s.id,toolId:s.toolId,inputs:s.inputs})),turn,personId,signal);
  this.#runner=runner;
  this.#task=run.then(report=>({...report,fingerprint:p.fingerprint,scopeFingerprint:p.scopeFingerprint,provenance:p.provenance,preparationMs:p.preparationMs}))
   .finally(()=>{this.#task=null;this.#runner=null;this.#notify();});
  return this.#task;
 }
 /** Revokes every prepared plan for a turn, e.g. after the user changes the request. */
 revokeTurn(turn:TurnContext){for(const [handle,p] of this.#pending)if(p.turn===turn)this.#pending.delete(handle);this.#notify();}
 cancelAll(){this.#pending.clear();this.#notify();}
 /** STOP: revoke all prepared plans and wait until any running plan has actually settled. */
 async stop():Promise<void>{
  this.cancelAll();const task=this.#task;if(!task)return;
  await this.#runner?.stop();await task.catch(()=>{});
 }
}
