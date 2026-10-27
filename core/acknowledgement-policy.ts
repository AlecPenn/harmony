import type {TurnContext} from '../packages/contracts/events.ts';
export type AcknowledgementEvent='wake'|'processing_delay'|'tool_started';
export interface AcknowledgementContext {quiet:boolean;speaking:boolean;listening:boolean;responseStarted:boolean;elapsedMs:number;}
/** Called only by trusted core event producers; a plan is not a tool_started event. */
export class AcknowledgementPolicy {
 #used=new WeakSet<TurnContext>();#last=-Infinity;
 constructor(private isCurrent:(turn:TurnContext)=>boolean,private now:()=>number=()=>performance.now()){}
 consider(turn:TurnContext,event:AcknowledgementEvent,context:AcknowledgementContext):'Yeah?'|'One sec.'|'On it.'|null{
  const time=this.now();
  if(!Number.isFinite(time)||!Number.isFinite(context.elapsedMs)||context.elapsedMs<0||!this.isCurrent(turn)||this.#used.has(turn)||context.quiet||context.speaking||context.listening||context.responseStarted||time-this.#last<30000)return null;
  let text:'Yeah?'|'One sec.'|'On it.';
  if(event==='wake'){if(context.elapsedMs>1500)return null;text='Yeah?';}
  else if(event==='tool_started'){if(context.elapsedMs>3000)return null;text='On it.';}
  else if(event==='processing_delay'){if(context.elapsedMs<700||context.elapsedMs>5000)return null;text='One sec.';}
  else return null;
  this.#used.add(turn);this.#last=time;return text;
 }
}
