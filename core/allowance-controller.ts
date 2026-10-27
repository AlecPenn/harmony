import {randomUUID} from 'node:crypto';
import {ApplicationEventBus} from './application-events.ts';
import {ActionApprovals,type ApprovalTicket} from '../packages/permissions/approvals.ts';
import {PermissionPolicy,type ProposedAction} from '../packages/permissions/policy.ts';
import type {TurnContext} from '../packages/contracts/events.ts';
import {BudgetAdministration,allowancePolicy,allowanceProposal} from './budget-administration.ts';
import type {ReasoningBudget} from './reasoning-budget.ts';
import type {OwnerVerification} from './owner-verification.ts';
export const LOCAL_ALLOWANCE_ID='local-owner-v1';
export interface AllowanceStatus {state:'IDLE'|'REVIEW'|'VERIFYING'|'CREATED'|'CANCELLED'|'ERROR';reviewId:string|null;limitMicros:number|null;error:string|null;}
interface Pending {id:string;ticket:ApprovalTicket;proposal:ProposedAction;turn:TurnContext;abort:AbortController;}
/** Decimal text avoids rounding financial input through floating-point dollars. */
export function allowanceAmount(value:unknown):number{
 if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/.test(value))throw new Error('Enter a USD amount with at most two decimal places');
 const [whole,fraction='']=value.split('.'),micros=BigInt(whole)*1000000n+BigInt(fraction.padEnd(2,'0'))*10000n;
 if(micros>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Allowance is too large');return Number(micros);
}
/** Trusted chamber adapter foundation. No renderer-supplied identity, budget ID or proof. */
export class AllowanceController {
 #bus=new ApplicationEventBus();#pending:Pending|null=null;#task:Promise<void>|null=null;#timer:ReturnType<typeof setTimeout>|null=null;
 #status:AllowanceStatus={state:'IDLE',reviewId:null,limitMicros:null,error:null};
 #authority={isCurrent:(turn:TurnContext)=>this.#bus.isCurrent(turn),identifies:(person:string,turn:TurnContext)=>person==='local_desktop'&&this.#bus.isCurrent(turn),canManageBudget:(person:string,beneficiary:string,turn:TurnContext)=>person==='local_desktop'&&beneficiary==='local_desktop'&&this.#bus.isCurrent(turn)};
 #policy=new PermissionPolicy([allowancePolicy],[{id:'local_desktop',permissions:['manage_reasoning_budget']}],{denyTools:[],lowRiskWriteTools:[]});
 #approvals=new ActionApprovals(()=>this.#policy,this.#authority);#admin:BudgetAdministration;
 constructor(private budget:ReasoningBudget,owner:Pick<OwnerVerification,'verify'|'consume'>,private changed:()=>void=()=>{}){this.#admin=new BudgetAdministration(this.#approvals,this.#authority,budget,owner);}
 get active(){return !!this.#pending||!!this.#task;}
 snapshot(){
  let balance:ReturnType<ReasoningBudget['breakdown']>|null=null,history:ReturnType<ReasoningBudget['recent']>|null=null;
  try{balance=this.budget.breakdown(LOCAL_ALLOWANCE_ID);history=this.budget.recent(LOCAL_ALLOWANCE_ID);}catch{}
  return {...this.#status,balance,history};
 }
 #notify(){try{this.changed();}catch{}}
 #clear(){if(this.#timer)clearTimeout(this.#timer);this.#timer=null;}
 review(amount:unknown){
  if(this.active)throw new Error('Finish or cancel the current allowance review');
  const limitMicros=allowanceAmount(amount),proposal=allowanceProposal('local_desktop',{budgetId:LOCAL_ALLOWANCE_ID,beneficiaryId:'local_desktop',limitMicros}),turn=this.#bus.beginTurn();
  const ticket=this.#approvals.request(proposal,turn);if(!ticket){this.#bus.endTurn(turn);throw new Error('Allowance review unavailable');}
  const pending={id:randomUUID(),ticket,proposal,turn,abort:new AbortController()};this.#pending=pending;
  this.#status={state:'REVIEW',reviewId:pending.id,limitMicros,error:null};
  this.#timer=setTimeout(()=>{if(this.#pending===pending)void this.stop();},60000);this.#notify();
 }
 approve(id:unknown,signal:AbortSignal):Promise<void>{
  const pending=this.#pending;
  if(signal.aborted||typeof id!=='string'||!pending||id!==pending.id||this.#task||this.#status.state!=='REVIEW'||!this.#approvals.approve(pending.ticket))return Promise.reject(new Error('Allowance review expired or denied'));
  this.#clear();this.#status.state='VERIFYING';this.#status.reviewId=null;
  const combined=AbortSignal.any([signal,pending.abort.signal]);
  const task=Promise.resolve().then(()=>this.#admin.createVerified(pending.ticket,pending.proposal,pending.turn,combined))
   .then(()=>{if(this.#pending===pending)this.#status.state='CREATED';})
   .catch(()=>{if(this.#pending===pending){this.#status.state=combined.aborted?'CANCELLED':'ERROR';this.#status.error=combined.aborted?null:'Allowance was not created. Owner verification may be unavailable, or this allowance is already established with a different limit.';}})
   .finally(()=>{this.#bus.endTurn(pending.turn);if(this.#pending===pending)this.#pending=null;if(this.#task===task)this.#task=null;this.#notify();});
  this.#task=task;this.#notify();return task;
 }
 async stop(){this.#clear();this.#approvals.cancelAll();this.#bus.cancelAll();const pending=this.#pending;this.#pending=null;pending?.abort.abort();this.#status={state:'CANCELLED',reviewId:null,limitMicros:null,error:null};this.#notify();await this.#task;}
}
