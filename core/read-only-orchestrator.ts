import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {latencyFields,type LatencyTrace} from '../packages/contracts/latency.ts';
import {randomUUID} from 'node:crypto';
import type {TurnContext} from '../packages/contracts/events.ts';
import {actionInputHash} from '../packages/permissions/policy.ts';
import {ToolRegistry,validateValue} from '../packages/tools/registry.ts';
import {ToolDispatcher,type DispatchAuthority} from './tool-dispatcher.ts';
import {ActionJournal} from './action-journal.ts';
export interface ReadOnlyStep {id:string;toolId:string;inputs:unknown;}
export interface VerifiedPlanOutput {readonly stepId:string;readonly actionId:string;readonly result:unknown;}
export interface PlanReport {
 trace:LatencyTrace|null;
 id:string;state:'IDLE'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED';stopRequested:boolean;
 steps:{id:string;toolId:string;state:'PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'SKIPPED';actionId:string|null}[];
}
/** Bounded sequential read-only execution. A plan never grants permission.
 * Trusted core entry point only: no model/renderer can invoke this directly.
 * No retries, reflection-generated actions, persistence or restart replay.
 */
export class ReadOnlyOrchestrator {
 #profiler=new LatencyProfiler();
 #report:PlanReport={trace:null,id:'',state:'IDLE',stopRequested:false,steps:[]};
 #task:Promise<PlanReport>|null=null;#abort:AbortController|null=null;
 constructor(private registry:ToolRegistry,private dispatcher:ToolDispatcher,private journal:ActionJournal,
  private authority:DispatchAuthority,private changed:()=>void=()=>{},private handoff:(outputs:readonly VerifiedPlanOutput[])=>void=()=>{}){}
 get active(){return this.#task!==null;}
 snapshot():PlanReport{return {...structuredClone(this.#report),trace:this.#profiler.snapshot()};}
 #notify(){try{this.changed();}catch{}}
 run(value:unknown,turn:TurnContext,personId:string,signal:AbortSignal):Promise<PlanReport>{
  if(this.active||signal.aborted||!this.authority.isCurrent(turn)||!this.authority.identifies(personId,turn))throw new Error('Plan execution unavailable');
  // Reject accessors/prototypes/oversized JSON before reading any plan fields.
  actionInputHash(value);
  if(!Array.isArray(value)||value.length<1||value.length>16)throw new Error('Invalid read-only plan');
  const ids=new Set<string>();
  const steps=value.map((item:ReadOnlyStep)=>{
   if(!item||Object.keys(item).sort().join(',')!=='id,inputs,toolId'||typeof item.id!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(item.id)||ids.has(item.id))throw new Error('Invalid plan step');
   ids.add(item.id);const tool=this.registry.resolve(item.toolId);
   if(tool.risk!=='SAFE'||!tool.available())throw new Error('Plan contains unavailable or non-read-only tool');
   validateValue(item.inputs,tool.inputSchema);
   return {id:item.id,toolId:tool.id,version:tool.version,inputs:structuredClone(item.inputs)};
  });
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});this.#abort=controller;
  this.#profiler.begin('tool');for(const field of latencyFields)if(!['tool_start_ms','tool_complete_ms','full_turn_ms'].includes(field))this.#profiler.notApplicable(field);
  this.#report={trace:null,id:randomUUID(),state:'RUNNING',stopRequested:false,steps:steps.map(step=>({id:step.id,toolId:step.toolId,state:'PENDING',actionId:null}))};
  const current=()=>{controller.signal.throwIfAborted();if(!this.authority.isCurrent(turn)||!this.authority.identifies(personId,turn))throw new Error('Plan authority expired');};
  const evidence=(index:number,resultHash:string)=>{
   const step=steps[index];
   this.dispatcher.assertAuthorized(turn,personId,step.toolId,step.inputs,controller.signal);
   const row=this.journal.get(this.#report.steps[index].actionId!);
   if(!row||row.state!=='SUCCEEDED'||row.person_id!==personId||row.turn_id!==turn.id||row.tool_id!==step.toolId||row.tool_version!==step.version
     ||row.inputs_hash!==actionInputHash(step.inputs)||row.result_hash!==resultHash)throw new Error('Plan evidence unavailable');
  };
  this.#task=Promise.resolve().then(async()=>{
   let index=0;const hashes:string[]=[],outputs:VerifiedPlanOutput[]=[];
   try{
    for(;index<steps.length;index++){
     current();const step=steps[index],status=this.#report.steps[index];status.state='RUNNING';this.#notify();current();
     const span=this.#profiler.start('tool_complete_ms');
     const receipt=await this.dispatcher.run(turn,personId,step.toolId,step.inputs,controller.signal);current();
     status.actionId=receipt.actionId;const hash=actionInputHash(receipt.result);evidence(index,hash);hashes.push(hash);outputs.push(Object.freeze({stepId:step.id,actionId:receipt.actionId,result:receipt.result}));this.#profiler.end(span);
     status.state='SUCCEEDED';this.#notify();
    }
    // Reflection checks actual verified receipts, never an assistant's completion claim.
    for(index=0;index<steps.length;index++){current();evidence(index,hashes[index]);}
    // Synchronous trusted-core result handoff only, after every receipt has been verified.
    current();this.handoff(Object.freeze(outputs));current();this.#report.state='SUCCEEDED';
   }catch{
    const cancelled=controller.signal.aborted||!this.authority.isCurrent(turn)||!this.authority.identifies(personId,turn);
    this.#report.state=cancelled?'CANCELLED':'FAILED';
    if(index<steps.length)this.#report.steps[index].state=cancelled?'CANCELLED':'FAILED';
    for(const step of this.#report.steps)if(step.state==='PENDING')step.state='SKIPPED';
   }finally{this.#profiler.finish(this.#report.state==='SUCCEEDED'?'completed':this.#report.state==='CANCELLED'?'cancelled':'failed');signal.removeEventListener('abort',abort);this.#abort=null;this.#notify();}
   return this.snapshot();
  }).finally(()=>{this.#task=null;});
  this.#notify();return this.#task;
 }
 async stop():Promise<void>{
  if(!this.#task)return;this.#report.stopRequested=true;this.#abort?.abort();this.#notify();
  // Still active until the underlying tool settles; cancellation is not termination evidence.
  await this.#task;
 }
}
