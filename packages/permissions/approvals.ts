import type {TurnContext} from '../contracts/events.ts';
import {PermissionPolicy,type ProposedAction,type PermissionDecision} from './policy.ts';
export interface ApprovalTicket {readonly kind:'action-approval';}
type Review=Extract<PermissionDecision,{inputsHash:string}>;
interface Pending {action:ProposedAction;review:Review;turn:TurnContext;expiresAt:number;approved:boolean;}
export interface ApprovalAuthority {
 isCurrent(turn:TurnContext):boolean;
 /** Must resolve a current trusted identity, never trust a renderer-supplied person id. */
 identifies(personId:string,turn:TurnContext):boolean;
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
/** Private core boundary. approve() is reserved for the future trusted human-review adapter.
 * No renderer IPC, automation handler or model may call it directly.
 */
export class ActionApprovals {
 #pending=new Map<ApprovalTicket,Pending>();#lastTime=0;
 constructor(private policy:()=>PermissionPolicy,private authority:ApprovalAuthority,private now:()=>number=Date.now){}
 #time(){const now=this.now();if(!Number.isSafeInteger(now)||now<=0||now<this.#lastTime){this.cancelAll();return null;}this.#lastTime=now;return now;}
 #valid(p:Pending,now:number){return now<p.expiresAt&&this.authority.isCurrent(p.turn)&&this.authority.identifies(p.action.personId,p.turn);}
 request(action:ProposedAction,turn:TurnContext):ApprovalTicket|null{
  const now=this.#time();if(now===null||!this.authority.isCurrent(turn)||!this.authority.identifies(action.personId,turn))return null;
  for(const [ticket,p] of this.#pending)if(!this.#valid(p,now))this.#pending.delete(ticket);
  if(this.#pending.size>=64)return null;
  const review=this.policy().evaluate(action);if(review.state!=='APPROVAL_REQUIRED')return null;
  const copy=freeze({toolId:action.toolId,personId:action.personId,inputs:structuredClone(action.inputs)});
  const ticket=Object.freeze({kind:'action-approval' as const});this.#pending.set(ticket,{action:copy,review,turn,expiresAt:now+60000,approved:false});return ticket;
 }
 approve(ticket:ApprovalTicket):boolean{
  const p=this.#pending.get(ticket),now=this.#time();if(!p||now===null)return false;
  if(!this.#valid(p,now)){this.#pending.delete(ticket);return false;}
  if(p.approved)return false;p.approved=true;return true;
 }
 consume(ticket:ApprovalTicket,action:ProposedAction,turn:TurnContext):Readonly<{action:ProposedAction;toolVersion:number}>|null{
  const p=this.#pending.get(ticket),now=this.#time();this.#pending.delete(ticket);
  if(!p||now===null||!p.approved||p.turn!==turn||!this.#valid(p,now))return null;
  const current=this.policy().evaluate(action);
  if(current.state==='DENIED'||current.personId!==p.review.personId||current.toolId!==p.review.toolId||current.toolVersion!==p.review.toolVersion||current.risk!==p.review.risk||current.inputsHash!==p.review.inputsHash)return null;
  // Caller must execute this immutable snapshot, never the mutable proposal or post-review hooks.
  return freeze({action:structuredClone(p.action),toolVersion:current.toolVersion});
 }
 deny(ticket:ApprovalTicket){this.#pending.delete(ticket);}
 cancelAll(){this.#pending.clear();}
}
