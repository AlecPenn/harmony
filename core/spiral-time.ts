import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {MissionStore} from './missions.ts';
import type {JobScout} from './job-scout.ts';
import {redact} from './redact.ts';

/** Spiral Time: Alec says "Spiral Time" at night and HARMONY hands her heavy background work to Claude.
 *
 * HARMONY writes a ticket (handoff/ticket.json) listing the night's jobs: open research missions, things saved "for
 * Spiral Time", a security news check, and a weekly scan for faster models. A Claude scheduled task looks for a ticket
 * once an hour in the evening, works the jobs one at a time and writes each result to handoff/inbox/ as soon as it's
 * finished. It works until Alec's usage limit stops it; whatever is left stays queued for the next Spiral Time.
 *
 * HARMONY imports results as finished research (so "read me the research" works), only for jobs she issued, on tickets
 * she wrote, and only as text: nothing in the inbox can make her do anything. Anything else is moved to
 * handoff/rejected/. */

export type SpiralKind='research'|'security-news'|'model-scan'|'job-scout';
export interface SpiralJob {id:string;kind:SpiralKind;text:string;}
export interface SpiralTicket {v:1;id:string;createdAt:string;expiresAt:string;jobs:SpiralJob[];}
export interface SpiralResult {v:1;ticket:string;job:string;summary:string;report:string;sources:{title:string;url:string}[];extra?:{leads:unknown;letter:unknown};}
interface Issued {id:string;createdAt:string;expiresAt:string;jobs:SpiralJob[];done:string[];}

export const SPIRAL_PHRASE=/^(?:(?:start|begin|it'?s)\s+)?(?:spiral|sprial|spiral's)\s+time$/;
const MAX_JOBS=10,MODEL_SCAN_DAYS=6,MAX_FILE=200_000;
const clean=(v:unknown,n:number)=>String(v??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g,' ').replace(/<\/?(?:tool_call|function|parameter)[^>]*>/gi,'').trim().slice(0,n);
export const STANDING:Record<Exclude<SpiralKind,'research'|'job-scout'>,string>={
 'security-news':'Security news check: any breach, stolen key, compromised certificate authority, poisoned package or hijacked account reported in the last day that could affect HARMONY (Electron, Node, npm, Python, ONNX models, GitHub) or a Windows/Google/GitHub user. Say what was exposed, whether HARMONY is affected, and the countermeasure.',
 'model-scan':'Model scan: newer, faster or smaller local models on GitHub and Hugging Face that would fit HARMONY on a GTX 1650 (4 GB) PC: speech recognition, wake word, text to speech, speaker recognition, and a small instruction model with tool calling. For each: name, link, size, license, and why it would be faster or better than what HARMONY uses now.',
};

/** Validates one inbox file; null if it isn't a well-formed result. */
export function parseResult(text:string):SpiralResult|null{
 let v:Record<string,unknown>;try{v=JSON.parse(text);}catch{return null;}
 if(!v||typeof v!=='object'||v.v!==1||typeof v.ticket!=='string'||typeof v.job!=='string'||typeof v.report!=='string')return null;
 const sources=(Array.isArray(v.sources)?v.sources:[]).slice(0,12).flatMap(s=>{
  const t=clean((s as {title?:unknown})?.title,160),u=String((s as {url?:unknown})?.url??'');
  try{const url=new URL(u);return url.protocol==='https:'||url.protocol==='http:'?[{title:t||url.hostname,url:url.href.slice(0,500)}]:[];}catch{return [];}
 });
 const report=clean(v.report,5600);if(report.length<20)return null;
 return {v:1,ticket:clean(v.ticket,40),job:clean(v.job,40),summary:clean(v.summary,400),report,sources,...(v.leads!==undefined||v.letter!==undefined?{extra:{leads:v.leads,letter:v.letter}}:{})};
}

export class SpiralTime {
 private dir:string;private db:DatabaseSync;private missions:MissionStore;private now:()=>Date;private scout:JobScout|null;
 constructor(dir:string,db:DatabaseSync,missions:MissionStore,now:()=>Date=()=>new Date(),scout:JobScout|null=null){this.dir=dir;this.db=db;this.missions=missions;this.now=now;this.scout=scout;}
 #get(key:string){try{return (this.db.prepare('SELECT value FROM memory_settings WHERE key=?').get(key) as {value?:string}|undefined)?.value??null;}catch{return null;}}
 #set(key:string,value:string){this.db.prepare('INSERT INTO memory_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 #issued():Issued[]{try{const v=JSON.parse(this.#get('spiral_tickets')??'[]');return Array.isArray(v)?v:[];}catch{return [];}}
 #saveIssued(list:Issued[]){this.#set('spiral_tickets',JSON.stringify(list.slice(-6)));}
 get ticketPath(){return join(this.dir,'ticket.json');}

 /** Tonight's jobs: open research (oldest first), then the standing checks. */
 jobs():SpiralJob[]{
  // What goes to Claude has secrets masked (a password or card number said in passing never leaves the PC).
  const out:SpiralJob[]=this.missions.open().slice(0,MAX_JOBS-3).map(m=>({id:m.id,kind:'research' as const,text:redact(m.objective)}));
  out.push({id:`sec-${randomBytes(6).toString('hex')}`,kind:'security-news',text:STANDING['security-news']});
  const last=Date.parse(this.#get('spiral_model_scan')??'');
  if(!Number.isFinite(last)||this.now().getTime()-last>=MODEL_SCAN_DAYS*86400000)out.push({id:`scan-${randomBytes(6).toString('hex')}`,kind:'model-scan',text:STANDING['model-scan']});
  if(this.scout?.due())out.push({id:`jobs-${randomBytes(6).toString('hex')}`,kind:'job-scout',text:redact(this.scout.jobText())});
  return out;
 }
 /** "Spiral Time": write the ticket. One at a time: a waiting, unexpired ticket isn't replaced. */
 start():{ticket:SpiralTicket;already:boolean}{
  mkdirSync(join(this.dir,'inbox'),{recursive:true});
  try{
   const t=JSON.parse(readFileSync(this.ticketPath,'utf8')) as SpiralTicket;
   if(Date.parse(t.expiresAt)>this.now().getTime()&&this.#issued().some(i=>i.id===t.id))return {ticket:t,already:true};
  }catch{}
  const now=this.now(),expires=new Date(now);expires.setHours(7,0,0,0);if(expires.getTime()-now.getTime()<3600000)expires.setDate(expires.getDate()+1);
  const ticket:SpiralTicket={v:1,id:`t-${randomBytes(8).toString('hex')}`,createdAt:now.toISOString(),expiresAt:expires.toISOString(),jobs:this.jobs()};
  this.#saveIssued([...this.#issued(),{id:ticket.id,createdAt:ticket.createdAt,expiresAt:ticket.expiresAt,jobs:ticket.jobs,done:[]}]);
  const tmp=join(this.dir,`.ticket-${ticket.id}.tmp`);writeFileSync(tmp,JSON.stringify(ticket,null,1));renameSync(tmp,this.ticketPath);
  for(const j of ticket.jobs)if(j.kind==='research'){const m=this.missions.get(j.id);if(m&&m.state.spiral){m.stage='Handed off for Spiral Time';this.missions.save(m);}}
  return {ticket,already:false};
 }
 /** Undo of "Spiral Time" before Claude has picked it up: the ticket is set aside and forgotten. */
 cancel(id:string):boolean{
  try{const t=JSON.parse(readFileSync(this.ticketPath,'utf8')) as SpiralTicket;if(t.id!==id)return false;renameSync(this.ticketPath,join(this.dir,`cancelled-${id}.json`));}catch{return false;}
  this.#saveIssued(this.#issued().filter(i=>i.id!==id));return true;
 }
 /** Moves finished results into HARMONY. Returns how many were imported. */
 importInbox():number{
  const inbox=join(this.dir,'inbox');if(!existsSync(inbox))return 0;
  const issued=this.#issued();let imported=0;
  const move=(name:string,to:'done'|'rejected')=>{try{mkdirSync(join(this.dir,to),{recursive:true});renameSync(join(inbox,name),join(this.dir,to,`${Date.now()}-${name}`));}catch{}};
  for(const name of readdirSync(inbox).filter(n=>/^[\w.-]{1,80}\.json$/.test(n)).slice(0,50)){
   let r:SpiralResult|null=null;
   try{if(statSync(join(inbox,name)).size<=MAX_FILE)r=parseResult(readFileSync(join(inbox,name),'utf8'));}catch{}
   const t=r?issued.find(i=>i.id===r!.ticket):undefined,job=t?.jobs.find(j=>j.id===r!.job);
   if(!r||!t||!job||t.done.includes(job.id)){move(name,'rejected');continue;}
   this.#apply(job,r);t.done.push(job.id);imported++;move(name,'done');
  }
  if(imported)this.#saveIssued(issued);
  return imported;
 }
 #apply(job:SpiralJob,r:SpiralResult){
  const body=`${r.summary?`${r.summary}\n\n`:''}${r.report}`.slice(0,5600);
  let m=job.kind==='research'?this.missions.get(job.id):null;
  if(!m){
   const label=job.kind==='job-scout'?'Remote job scout':job.kind==='security-news'?`Security news check, ${this.now().toLocaleDateString('en-US',{month:'short',day:'numeric'})}`:job.kind==='model-scan'?'Faster model scan':job.text;
   m=this.missions.create(label,null,1,1,true);
   if(job.kind==='model-scan')this.#set('spiral_model_scan',this.now().toISOString());
  }
  if(job.kind==='job-scout')try{this.scout?.record(r.extra);}catch{}
  m.state.evidence=r.sources.map((s,i)=>{let site='';try{site=new URL(s.url).hostname.replace(/^www\./,'');}catch{}return {n:i+1,title:s.title,url:s.url,site,excerpt:'',query:'Spiral Time'};});
  m.report=body;m.status='DONE';m.stage='Done in Spiral Time';m.heard=false;this.missions.save(m);
 }
 /** For the morning brief: what the last Spiral Time finished and what's still waiting. */
 morningLine():string|null{
  const last=this.#issued().at(-1);if(!last)return null;
  const day=this.#get('spiral_reported');if(day===last.id)return null;
  if(this.now().getTime()<Date.parse(last.expiresAt)-2*3600000)return null; // wait for morning (from 5 AM)
  this.#set('spiral_reported',last.id);
  const done=last.done.length,total=last.jobs.length,waiting=this.missions.open().filter(m=>last.jobs.some(j=>j.id===m.id)).length;
  if(!done)return `Spiral Time didn't get to its ${total} job${total>1?'s':''} last night${waiting?`; ${waiting} still wait${waiting>1?'':'s'} for next time`:''}.`;
  return `Spiral Time finished ${done} of ${total} job${total>1?'s':''}${waiting?`; ${waiting} wait${waiting>1?'':'s'} for next time`:''}. Say "read me the research" to hear them.`;
 }
}
