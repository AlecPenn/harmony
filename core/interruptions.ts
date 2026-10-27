import {randomUUID} from 'node:crypto';
import type {HarmonyMode} from './modes.ts';

/** Phase 30: every proactive event is scored, then one decision is made, so HARMONY can be proactive without being
 * annoying. Reminders and timers the person set are CRITICAL: they asked for them. Everything else earns its way in. */
export type Decision='IGNORE'|'STORE'|'SHOW'|'SPEAK_WHEN_FREE'|'INTERRUPT'|'CRITICAL';
export interface ProactiveEvent {/** Long spoken texts (the morning brief): up to 2600 characters instead of 300. */long?:boolean;
 source:'reminder'|'timer'|'calendar'|'screen'|'system';
 /** What would be said or shown (plain, short). */
 text:string;
 /** Same key = same thing: repeats within the repeat window are stored, not said again. */
 key:string;
 importance:number;urgency:number;confidence:number;relevance:number;
 /** After this it's no longer worth mentioning. */
 expiresAt:number;
}
/** proactivity (0–1, from the personality): nudges how readily non-critical things are said. 0.5 is neutral. */
export interface Situation {mode:HarmonyMode;busy:boolean;quietHours:boolean;now:number;proactivity?:number;}
export interface Notice {id:string;at:string;source:ProactiveEvent['source'];text:string;decision:Decision;}
export const REPEAT_MS=30*60000,MAX_NOTICES=30;
const unit=(v:number)=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;

export function decide(e:ProactiveEvent,s:Situation,lastSaid:number|undefined):Decision{
 if(s.now>=e.expiresAt)return 'IGNORE';
 if(e.source==='reminder'||e.source==='timer')return 'CRITICAL';
 if(lastSaid!==undefined&&s.now-lastSaid<REPEAT_MS)return 'STORE';
 if(unit(e.confidence)<.5)return 'STORE';
 const score=unit(e.importance)*.5+unit(e.urgency)*.35+unit(e.relevance)*.15+(unit(s.proactivity??.5)-.5)*.2;
 if(s.mode==='ghost')return score>=.35?'SHOW':'STORE';
 // Quiet hours: shown, not spoken, unless it's very important and urgent.
 if(s.quietHours&&score<.9)return score>=.35?'SHOW':'STORE';
 if(s.mode==='focus')return score>=.8?'SPEAK_WHEN_FREE':score>=.35?'SHOW':'STORE';
 if(score>=.85&&!s.busy)return 'INTERRUPT';
 if(score>=.6)return 'SPEAK_WHEN_FREE';
 return score>=.35?'SHOW':'STORE';
}
export function inQuietHours(now:Date,start=22,end=7){const h=now.getHours();return start>end?h>=start||h<end:h>=start&&h<end;}

/** Routes events: speaks (through the announcement queue, which already waits for a reply in progress), shows them in
 * the notice tray, or keeps them quietly. Keeps the last 30 notices for the screen; nothing is written to disk. */
export class InterruptionEngine {
 #lastSaid=new Map<string,number>();#notices:Notice[]=[];
 private situation:()=>Situation;private speak:(text:string)=>void;private changed:()=>void;
 constructor(situation:()=>Situation,speak:(text:string)=>void,changed:()=>void=()=>{}){this.situation=situation;this.speak=speak;this.changed=changed;}
 raise(e:ProactiveEvent):Decision{
  const s=this.situation(),decision=decide(e,s,this.#lastSaid.get(e.key));
  if(decision==='IGNORE')return decision;
  const text=e.text.replace(/\s+/g,' ').trim().slice(0,e.long?2600:300);
  this.#notices.unshift({id:randomUUID(),at:new Date(s.now).toISOString(),source:e.source,text,decision});this.#notices.length=Math.min(this.#notices.length,MAX_NOTICES);
  if(decision==='CRITICAL'||decision==='INTERRUPT'||decision==='SPEAK_WHEN_FREE'){this.#lastSaid.set(e.key,s.now);try{this.speak(text);}catch{}}
  else if(decision==='SHOW')this.#lastSaid.set(e.key,s.now);
  for(const [k,t] of this.#lastSaid)if(s.now-t>REPEAT_MS*4)this.#lastSaid.delete(k);
  try{this.changed();}catch{}
  return decision;
 }
 /** Notices the person should see (STORE ones are kept but not shown). */
 notices():Notice[]{return this.#notices.filter(n=>n.decision!=='STORE').map(n=>({...n}));}
 dismiss(id:string):boolean{const before=this.#notices.length;this.#notices=this.#notices.filter(n=>n.id!==id);if(before!==this.#notices.length){try{this.changed();}catch{}return true;}return false;}
 clear(){this.#notices=[];try{this.changed();}catch{}}
}

/** Calendar heads-up: about ten minutes before a timed event, once per event. Polls only while Calendar is connected. */
export class CalendarWatcher {
 #timer:ReturnType<typeof setInterval>|null=null;#announced=new Set<string>();#busy=false;
 private events:(range:{start:Date;end:Date},signal:AbortSignal)=>Promise<{id:string;start:Date;allDay:boolean;title:string;where:string}[]>;
 private connected:()=>boolean;private engine:InterruptionEngine;private now:()=>Date;
 constructor(events:CalendarWatcher['events'],connected:()=>boolean,engine:InterruptionEngine,now:()=>Date=()=>new Date()){this.events=events;this.connected=connected;this.engine=engine;this.now=now;}
 start(everyMs=5*60000,firstMs=60000){if(!this.#timer){this.#timer=setInterval(()=>{void this.check();},everyMs);this.#timer.unref?.();const f=setTimeout(()=>{void this.check();},firstMs);f.unref?.();}} // first look after startup has settled
 stop(){if(this.#timer)clearInterval(this.#timer);this.#timer=null;}
 async check():Promise<number>{
  if(this.#busy||!this.connected())return 0;this.#busy=true;
  try{
   const now=this.now(),c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
   let list:Awaited<ReturnType<CalendarWatcher['events']>>=[];
   try{list=await this.events({start:now,end:new Date(now.getTime()+16*60000)},c.signal);}catch{return 0;}finally{clearTimeout(t);}
   let raised=0;
   for(const e of list){
    const minutes=Math.round((e.start.getTime()-now.getTime())/60000);
    if(e.allDay||minutes<0||minutes>15||this.#announced.has(e.id+e.start.toISOString()))continue;
    this.#announced.add(e.id+e.start.toISOString());raised++;
    this.engine.raise({source:'calendar',key:`calendar:${e.id}`,text:`Heads up: ${e.title}${e.where?` at ${e.where}`:''} starts ${minutes<=1?'now':`in ${minutes} minutes`}.`,
     importance:.7,urgency:minutes<=10?.9:.6,confidence:1,relevance:.8,expiresAt:e.start.getTime()+5*60000});
   }
   return raised;
  }finally{this.#busy=false;}
 }
}
