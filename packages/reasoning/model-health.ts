import {performance} from 'node:perf_hooks';
import {reasoningCatalogue} from './catalogue.ts';
import type {ModelCandidate} from './router.ts';
export interface RequestShape {inputTokens:number;maxOutputTokens:number;}
export interface ModelAttempt {readonly kind:'model-attempt';}
type Attempt={id:string;shape:RequestShape;started:number;first:number|null;sequence:number;};
type Evidence={shape:RequestShape;checked:number;first:number|null;duration:number;};
/** Ephemeral trusted-adapter evidence. No credentials, prompts, network probes or automatic recovery. */
export class ModelHealth {
 #pending=new Map<ModelAttempt,Attempt>();#latest=new Map<string,number>();#evidence=new Map<string,Evidence>();#sequence=0;#last=0;
 constructor(private clock:()=>number=()=>performance.now()){}
 clear(){this.#pending.clear();this.#latest.clear();this.#evidence.clear();}
 #now(){const now=this.clock();if(!Number.isFinite(now)||now<0||now<this.#last){this.clear();throw new Error('Model evidence clock unavailable');}this.#last=now;return now;}
 #shape(shape:RequestShape){if(!shape||!Number.isSafeInteger(shape.inputTokens)||shape.inputTokens<1||!Number.isSafeInteger(shape.maxOutputTokens)||shape.maxOutputTokens<1)throw new Error('Invalid request shape');return {inputTokens:shape.inputTokens,maxOutputTokens:shape.maxOutputTokens};}
 begin(id:string,shape:RequestShape):ModelAttempt{
  if(!reasoningCatalogue.some(entry=>entry.id===id))throw new Error('Unknown model');
  const copy=this.#shape(shape),now=this.#now();
  for(const [ticket,value] of this.#pending)if(now-value.started>=120000)this.#pending.delete(ticket);
  if(this.#pending.size>=32)throw new Error('Too many model attempts');
  const ticket=Object.freeze({kind:'model-attempt' as const}),sequence=++this.#sequence;
  this.#pending.set(ticket,{id,shape:copy,started:now,first:null,sequence});this.#latest.set(id,sequence);return ticket;
 }
 firstText(ticket:ModelAttempt){const attempt=this.#pending.get(ticket);if(!attempt)return;const now=this.#now();if(attempt.first===null)attempt.first=now-attempt.started;}
 finish(ticket:ModelAttempt,outcome:'completed'|'failed'|'cancelled'){
  const attempt=this.#pending.get(ticket);this.#pending.delete(ticket);if(!attempt)return;
  const now=this.#now();if(this.#latest.get(attempt.id)!==attempt.sequence)return;
  this.#evidence.delete(attempt.id);
  if(outcome==='completed'&&now-attempt.started<120000)this.#evidence.set(attempt.id,{shape:attempt.shape,checked:now,first:attempt.first,duration:now-attempt.started});
 }
 candidate(id:string,shape:RequestShape,ceilingMicros:number|null):ModelCandidate{
  const model=reasoningCatalogue.find(entry=>entry.id===id);if(!model)throw new Error('Unknown model');
  const clean=this.#shape(shape),now=this.#now();if(ceilingMicros!==null&&(!Number.isSafeInteger(ceilingMicros)||ceilingMicros<0))throw new Error('Invalid cost');
  const evidence=this.#evidence.get(id),fresh=!!evidence&&now-evidence.checked<=60000;
  const same=fresh&&evidence.shape.inputTokens===clean.inputTokens&&evidence.shape.maxOutputTokens===clean.maxOutputTokens;
  return {id,tier:model.tier,location:'cloud',capabilities:['text'],ready:fresh,healthy:fresh,checkedAtMs:evidence?.checked??now,contextTokens:model.contextTokens,maxOutputTokens:model.maxOutputTokens,memoryMiB:0,requestCeilingMicros:ceilingMicros,firstTokenMs:same?evidence.first:null,expectedTurnMs:null};
 }
}
