import type {TurnContext} from '../packages/contracts/events.ts';
import {ActionApprovals,type ApprovalAuthority,type ApprovalTicket} from '../packages/permissions/approvals.ts';
import {actionInputHash,type ProposedAction,type ToolPolicy} from '../packages/permissions/policy.ts';
import type {OwnerVerification} from './owner-verification.ts';
import {ReasoningBudget} from './reasoning-budget.ts';
export interface BudgetAdminAuthority extends ApprovalAuthority {
 /** Trusted local admin verification; speaker identity or OWNER role alone is insufficient. */
 canManageBudget(personId:string,beneficiaryId:string,turn:TurnContext):boolean;
}
export interface AllowanceRequest {budgetId:string;beneficiaryId:string;limitMicros:number;}
export const allowancePolicy:ToolPolicy=Object.freeze({id:'reasoning.allowance.create',version:1,risk:'CONFIRM',permissions:Object.freeze(['manage_reasoning_budget'])});
export function allowanceProposal(adminId:string,request:AllowanceRequest):ProposedAction{
 actionInputHash(request);
 if(!request||Object.keys(request).sort().join(',')!=='beneficiaryId,budgetId,limitMicros'
  ||![adminId,request.budgetId,request.beneficiaryId].every(value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(value))
  ||!Number.isSafeInteger(request.limitMicros)||request.limitMicros<0)throw new Error('Invalid allowance');
 return {personId:adminId,toolId:allowancePolicy.id,inputs:structuredClone(request)};
}
/** No default allowance, monthly reset or household-role bypass. */
export class BudgetAdministration {
 constructor(private approvals:ActionApprovals,private authority:BudgetAdminAuthority,private budget:ReasoningBudget,private owner?:Pick<OwnerVerification,'verify'|'consume'>){}
 create(ticket:ApprovalTicket,proposal:ProposedAction,turn:TurnContext):void{
  if(this.owner)throw new Error('Owner verification required');
  const {input}=this.review(ticket,proposal,turn);
  this.budget.create(input.budgetId,input.limitMicros,input.beneficiaryId);
 }
 private review(ticket:ApprovalTicket,proposal:ProposedAction,turn:TurnContext){
  const reviewed=this.approvals.consume(ticket,proposal,turn);
  if(!reviewed||reviewed.action.toolId!==allowancePolicy.id||reviewed.toolVersion!==1
   ||!this.authority.isCurrent(turn)||!this.authority.identifies(reviewed.action.personId,turn))throw new Error('Allowance approval expired or denied');
  const input=allowanceProposal(reviewed.action.personId,reviewed.action.inputs as AllowanceRequest).inputs as AllowanceRequest;
  if(!this.authority.canManageBudget(reviewed.action.personId,input.beneficiaryId,turn))throw new Error('Allowance administration unavailable');
  return {input,adminId:reviewed.action.personId};
 }
 async createVerified(ticket:ApprovalTicket,proposal:ProposedAction,turn:TurnContext,signal:AbortSignal):Promise<void>{
  if(!this.owner||signal.aborted)throw new Error('Owner verification unavailable');
  const {input,adminId}=this.review(ticket,proposal,turn);
  // Household delegation is deliberately unavailable until its identity lifecycle exists.
  if(adminId!=='local_desktop'||input.beneficiaryId!=='local_desktop')throw new Error('Local owner required');
  const scope={action:allowancePolicy.id,version:allowancePolicy.version,adminId,turn:{id:turn.id,generation:turn.generation},allowance:input};
  const grant=await this.owner.verify(scope,signal);
  // Consume even on cancellation: no proof from an interrupted operation is reusable.
  const verified=this.owner.consume(grant,scope);
  if(!verified||signal.aborted||!this.authority.isCurrent(turn)||!this.authority.identifies(adminId,turn)
   ||!this.authority.canManageBudget(adminId,input.beneficiaryId,turn))throw new Error('Allowance approval expired or denied');
  this.budget.create(input.budgetId,input.limitMicros,input.beneficiaryId);
 }
}
