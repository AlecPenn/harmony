import type {TurnContext} from '../packages/contracts/events.ts';
import {actionInputHash,PermissionPolicy} from '../packages/permissions/policy.ts';
import {ToolRegistry,validateValue} from '../packages/tools/registry.ts';
import {ActionJournal} from './action-journal.ts';
export interface DispatchAuthority {isCurrent(turn:TurnContext):boolean;identifies(personId:string,turn:TurnContext):boolean;}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
type Tool=ReturnType<ToolRegistry['resolve']>;
/** SAFE reads, or LOW_RISK_WRITE tools that carry an undo. Policy still decides whether a write is ALLOWED. */
const dispatchable=(tool:Tool)=>tool.risk==='SAFE'||(tool.risk==='LOW_RISK_WRITE'&&typeof tool.undo==='function'&&typeof tool.rollbackReference==='function');
const reference=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(v);
/** Runs registered tools under live policy. SAFE reads, plus explicitly allow-listed LOW_RISK_WRITE tools that record an
 * undo reference before success and are reversed if anything fails after their effect. Higher risks stay disabled. */
export class ToolDispatcher {
 #running=new Map<TurnContext,AbortController>();
 private registry:ToolRegistry;private policy:()=>PermissionPolicy;private journal:ActionJournal;private authority:DispatchAuthority;private executionStarted:()=>void;
 constructor(registry:ToolRegistry,policy:()=>PermissionPolicy,journal:ActionJournal,authority:DispatchAuthority,executionStarted:()=>void=()=>{}){
  this.registry=registry;this.policy=policy;this.journal=journal;this.authority=authority;this.executionStarted=executionStarted;
 }
 /** Revalidate access before releasing already-verified data; journal success is not current permission. */
 assertAuthorized(turn:TurnContext,personId:string,toolId:string,inputs:unknown,signal:AbortSignal):void{
  signal.throwIfAborted();
  if(!this.authority.isCurrent(turn)||!this.authority.identifies(personId,turn))throw new Error('Tool authority expired');
  const tool=this.registry.resolve(toolId);
  if(!dispatchable(tool)||!tool.available())throw new Error('Tool unavailable');
  validateValue(inputs,tool.inputSchema);
  const decision=this.policy().evaluate({toolId,personId,inputs});
  if(decision.state!=='ALLOWED'||decision.risk!==tool.risk||decision.toolVersion!==tool.version)throw new Error('Tool permission revoked');
 }
 async run(turn:TurnContext,personId:string,toolId:string,value:unknown,signal:AbortSignal):Promise<{actionId:string;result:unknown}>{
  if(signal.aborted||!this.authority.isCurrent(turn)||!this.authority.identifies(personId,turn)||this.#running.has(turn)||this.#running.size>=4)throw new Error('Tool dispatch unavailable');
  const tool=this.registry.resolve(toolId);if(!dispatchable(tool)||!tool.available())throw new Error('Tool unavailable');
  validateValue(value,tool.inputSchema);const inputs=freeze(structuredClone(value));
  const decision=this.policy().evaluate({toolId,personId,inputs});
  if(decision.state!=='ALLOWED'||decision.risk!==tool.risk||decision.toolVersion!==tool.version)throw new Error('Tool permission denied');
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  this.#running.set(turn,controller);
  let actionId:string|null=null,revision=0,phase:'PREPARED'|'RUNNING'|'VERIFYING'='PREPARED',effect:string|null=null;
  const write=tool.risk==='LOW_RISK_WRITE';
  const current=()=>this.assertAuthorized(turn,personId,toolId,inputs,controller.signal);
  try{
   current();
   actionId=this.journal.prepare({personId,turnId:turn.id,intent:tool.id,toolId:tool.id,toolVersion:tool.version,risk:tool.risk,permission:'policy',requestHash:actionInputHash({toolId,inputs}),inputsHash:decision.inputsHash});
   revision=this.journal.transition(actionId,revision,'RUNNING');phase='RUNNING';current();
   const context={signal:controller.signal,actionId};
   // Private diagnostics cannot override authorization or turn a tool into a failure.
   try{this.executionStarted();}catch{}
   const result=await tool.execute(inputs,context);
   if(write){
    const ref:unknown=tool.rollbackReference!(result);
    // An effect whose reference cannot be journaled is reversed immediately with whatever reference the tool gave.
    if(!reference(ref)){if(typeof ref==='string'&&ref.length<=200)try{await tool.undo!(ref,context);}catch{}throw new Error('Write effect unreferenced');}
    effect=ref;
   }
   current();
   validateValue(result,tool.outputSchema);const verifiedResult=freeze(structuredClone(result));
   revision=this.journal.transition(actionId,revision,'VERIFYING');phase='VERIFYING';
   if(await tool.verify(inputs,verifiedResult,context)!==true)throw new Error('Tool verification failed');current();
   this.journal.transition(actionId,revision,'SUCCEEDED',write?{resultHash:actionInputHash(verifiedResult),rollbackReference:effect!}:{resultHash:actionInputHash(verifiedResult)});
   effect=null;
   return {actionId,result:verifiedResult};
  }catch{
   // A write that took effect but did not complete verified success is reversed before reporting failure.
   if(effect)try{await tool.undo!(effect,{signal:new AbortController().signal,actionId:actionId??'unrecorded'});}catch{}
   if(actionId){
    // A journal failure must escape as failure; it can never turn an unrecorded effect into success.
    this.journal.transition(actionId,revision,controller.signal.aborted||!this.authority.isCurrent(turn)?'CANCELLED':phase==='PREPARED'?'CANCELLED':'FAILED');
   }
   throw new Error('Tool execution did not complete with verified success');
  }finally{signal.removeEventListener('abort',abort);this.#running.delete(turn);}
 }
 /** Reverses a successful low-risk write recorded in the journal. Requires the same live authority as running it. */
 async undo(turn:TurnContext,personId:string,actionId:string,signal:AbortSignal):Promise<boolean>{
  const row=this.journal.get(actionId);
  if(!row||row.state!=='SUCCEEDED'||row.person_id!==personId||!reference(row.rollback_reference))throw new Error('Nothing to undo');
  const tool=this.registry.resolve(String(row.tool_id));
  if(tool.risk!=='LOW_RISK_WRITE'||typeof tool.undo!=='function'||tool.version!==Number(row.tool_version))throw new Error('Undo unavailable');
  signal.throwIfAborted();if(!this.authority.isCurrent(turn)||!this.authority.identifies(personId,turn))throw new Error('Tool authority expired');
  let revision=this.journal.transition(actionId,Number(row.revision),'ROLLING_BACK');
  let ok=false;try{ok=await tool.undo(String(row.rollback_reference),{signal,actionId})===true;}catch{ok=false;}
  this.journal.transition(actionId,revision,ok?'UNDONE':'UNDO_FAILED',{resultHash:actionInputHash({undone:ok,reference:row.rollback_reference})});
  return ok;
 }
 cancelAll(){for(const controller of this.#running.values())controller.abort();}
 get activeCount(){return this.#running.size;}
}
