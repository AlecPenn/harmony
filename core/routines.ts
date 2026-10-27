import {randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

/** Step 27: teach her a skill. Alec describes a routine in plain words ("teach you a skill: when I say start my day,
 * open Quickbase, triage my email, then the weather in Madison"). HARMONY turns each part into one of the commands she
 * already understands, exactly as if he'd said it, and saves it as a draft. Nothing runs until Alec reads the steps on
 * the screen and approves it (with the usual security approval). After that, saying the phrase runs the steps in order,
 * each through the same checks as when he asks for it directly.
 *
 * Parts she doesn't recognise are listed, not guessed: the draft says what to rephrase. A routine can't teach, change or
 * run other skills, and has at most six steps. */

export interface Step {said:string;name:string;arguments:Record<string,string>;}
export interface Routine {id:string;phrase:string;title:string;steps:Step[];status:'draft'|'approved';createdAt:string;approvedAt:string|null;runs:number;lastRun:string|null;}
export interface Draft {phrase:string;steps:Step[];unknown:string[];problem:string|null;}

const MAX_STEPS=6,MAX_ROUTINES=30;
/** Commands a routine may not contain: teaching or changing skills, and anything that waits on the person mid-way. */
const BLOCKED=new Set(['skills']);
export const phraseKey=(s:string)=>s.toLowerCase().replace(/^(hey|ok|okay)\s+/,'').replace(/^harmony[,.!]?\s*/,'').replace(/[“”"'’.,!?]+/g,'').replace(/\s+/g,' ').trim();

/** The teaching sentence: "[teach you|learn|new] [a] skill|routine[:,] when I say X[,:] steps". */
export const TEACH=/^(?:(?:i want to |let me |can i )?teach you (?:a |an |the )?(?:new )?(?:skill|routine|trick)|(?:learn|make|create|add) (?:a |an )?(?:new )?(?:skill|routine)|new (?:skill|routine))[,:.]?\s+(?:when|whenever|if) i say[,:]?\s+(.{2,60}?)[,:;-]\s*(.{3,600})$/i;

/** One command, from the words in a step. */
function stepFor(clause:string,shortcut:(text:string)=>string|null):Step|{unknown:string}{
 const said=clause.trim().replace(/^(?:and then|then|and|also|after that|next|finally)\s+/i,'').replace(/^(?:please\s+)?/i,'').replace(/[.!]+$/,'').trim();
 if(said.length<2)return {unknown:clause};
 const markup=shortcut(said);
 if(markup){
  const name=markup.match(/<function=([\w-]+)>/)?.[1];
  const args:Record<string,string>={};for(const m of markup.matchAll(/<parameter=([\w-]+)>\n([\s\S]*?)\n<\/parameter>/g))args[m[1]]=m[2];
  if(name&&!BLOCKED.has(name))return {said,name,arguments:args};
  return {unknown:said};
 }
 let m:RegExpMatchArray|null;
 if((m=said.match(/^(?:say|tell me)\s+["“]?(.{1,200}?)["”]?$/i)))return {said,name:'say',arguments:{text:m[1]}};
 if((m=said.match(/^(?:set |start )?(?:a )?(\d{1,3})[- ]?(?:min|mins|minute|minutes) timer(?: (?:for|called) (.{1,40}))?$/i)??said.match(/^(?:set |start )?(?:a )?timer (?:for )?(\d{1,3}) ?(?:min|mins|minute|minutes)(?: (?:for|called) (.{1,40}))?$/i)))
  return {said,name:'set_timer',arguments:{minutes:m[1],label:m[2]??''}};
 if((m=said.match(/^(?:give me |tell me |check |get |what'?s )?(?:the )?(?:weather|forecast)(?: (?:in|for) (.{2,60}))?$/i))){
  if(!m[1])return {unknown:`${said} (say which town, like "the weather in Madison")`};
  return {said,name:'get_weather',arguments:{place:m[1]}};
 }
 if((m=said.match(/^(?:give me |read me |get |check )?(?:the )?(?:news|headlines)(?: (?:about|on) (.{2,60}))?$/i)))return {said,name:'get_news',arguments:{topic:m[1]??''}};
 if((m=said.match(/^(?:go to|visit|open the website|open website|pull up the website)\s+(.{2,120})$/i)))return {said,name:'control_computer',arguments:{action:'open_website',target:m[1]}};
 if((m=said.match(/^(?:open|launch|start|pull up|bring up)\s+(?:up\s+)?(.{2,80})$/i))){
  const t=m[1].trim();
  return {said,name:'control_computer',arguments:/\.(com|org|net|io|ai|gov|edu|co|app|dev)\b|^https?:\/\//i.test(t)?{action:'open_website',target:t}:{action:'open_app',target:t.replace(/^(the|my)\s+/i,'').replace(/\s+app$/i,'')}};
 }
 if((m=said.match(/^(?:play|pause|resume)(?: (?:the )?music)?$/i)))return {said,name:'control_computer',arguments:{action:'play_pause',target:''}};
 if(/^(?:next|skip)(?: (?:song|track))?$/i.test(said))return {said,name:'control_computer',arguments:{action:'next_track',target:''}};
 if(/^(?:mute|unmute)(?: (?:the )?(?:sound|volume))?$/i.test(said))return {said,name:'control_computer',arguments:{action:'mute',target:''}};
 return {unknown:said};
}
/** Splits the description into steps and maps each to a command. */
export function draft(phrase:string,description:string,shortcut:(text:string)=>string|null):Draft{
 const key=phraseKey(phrase);
 if(key.length<2||key.split(' ').length>8)return {phrase:key,steps:[],unknown:[],problem:'The phrase should be a few words, like "start my day".'};
 if(shortcut(key))return {phrase:key,steps:[],unknown:[],problem:`"${key}" already means something to me. Pick another phrase.`};
 const parts=description.replace(/"[^"]*"|“[^”]*”/g,q=>q.replace(/,/g,'\u0001').replace(/\b(and|then)\b/gi,w=>`\u0002${w}`)).replace(/\s*;\s*/g,', ').split(/,\s*(?:and then |then |and |after that |next |finally )?|\s+(?:and then|then|after that|and also)\s+|\s+and\s+(?=(?:open|launch|start|set|give|tell|read|check|get|go|visit|play|pause|mute|say|lock|go ghost|triage|what)\b)/i).map(p=>p.replace(/\u0001/g,',').replace(/\u0002/g,'').trim()).filter(Boolean);
 const steps:Step[]=[],unknown:string[]=[];
 for(const p of parts){const s=stepFor(p,shortcut);if('unknown' in s)unknown.push(s.unknown);else steps.push(s);}
 if(steps.length>MAX_STEPS)return {phrase:key,steps:steps.slice(0,MAX_STEPS),unknown,problem:`That's more than ${MAX_STEPS} steps. Split it into two skills.`};
 return {phrase:key,steps,unknown,problem:steps.length?null:'I couldn\'t turn any of that into steps I know.'};
}
/** The steps in plain words, for the review card and for saying back. */
export function describeSteps(steps:readonly Step[]):string{
 const one=(s:Step)=>{const a=s.arguments;
  switch(s.name){
   case 'control_computer':return a.action==='open_app'?`open ${a.target}`:a.action==='open_website'?`open the website ${a.target}`:a.action==='play_pause'?'play or pause music':a.action==='next_track'?'skip the song':a.action==='mute'?'mute':`${a.action.replace(/_/g,' ')} ${a.target}`.trim();
   case 'set_timer':return `set a ${a.minutes}-minute timer${a.label?` for ${a.label}`:''}`;
   case 'get_weather':return `tell you the weather in ${a.place}`;
   case 'get_news':return a.topic?`read the news about ${a.topic}`:'read the headlines';
   case 'say':return `say "${a.text}"`;
   default:return s.said;
  }};
 const list=steps.map(one);
 return list.length<=1?list.join(''):`${list.slice(0,-1).join(', ')} and ${list.at(-1)}`;
}

export class RoutineStore {
 private db:DatabaseSync;private now:()=>Date;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 list():Routine[]{try{const v=JSON.parse((this.db.prepare("SELECT value FROM memory_settings WHERE key='routines'").get() as {value?:string}|undefined)?.value??'[]');return Array.isArray(v)?v:[];}catch{return [];}}
 #save(list:Routine[]){this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('routines',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(list));}
 get(id:string){return this.list().find(r=>r.id===id)??null;}
 /** Saves a draft (replacing an older one with the same phrase). It doesn't run until approved. */
 add(d:Draft):Routine{
  if(d.problem||!d.steps.length)throw new Error(d.problem??'No steps');
  const list=this.list().filter(r=>r.phrase!==d.phrase);if(list.length>=MAX_ROUTINES)throw new Error(`I can keep ${MAX_ROUTINES} skills. Forget one first.`);
  const r:Routine={id:`r-${randomBytes(5).toString('hex')}`,phrase:d.phrase,title:d.phrase.replace(/^./,c=>c.toUpperCase()),steps:d.steps,status:'draft',createdAt:this.now().toISOString(),approvedAt:null,runs:0,lastRun:null};
  this.#save([...list,r]);return r;
 }
 approve(id:string):boolean{const list=this.list(),r=list.find(x=>x.id===id);if(!r||r.status==='approved')return false;r.status='approved';r.approvedAt=this.now().toISOString();this.#save(list);return true;}
 remove(id:string):boolean{const list=this.list();if(!list.some(r=>r.id===id))return false;this.#save(list.filter(r=>r.id!==id));return true;}
 /** Removed by undo: brings a routine back exactly as it was. */
 restore(r:Routine){this.#save([...this.list().filter(x=>x.id!==r.id&&x.phrase!==r.phrase),r]);}
 /** The approved routine for something said, if it's exactly a routine's phrase. */
 match(text:string):Routine|null{const k=phraseKey(text);return this.list().find(r=>r.status==='approved'&&r.phrase===k)??null;}
 find(name:string):Routine|null{const k=phraseKey(name).replace(/^(?:the )?(?:skill|routine) /,'').replace(/ (?:skill|routine)$/,'');return this.list().find(r=>r.phrase===k||r.id===name)??null;}
 ran(id:string){const list=this.list(),r=list.find(x=>x.id===id);if(!r)return;r.runs++;r.lastRun=this.now().toISOString();this.#save(list);}
}
