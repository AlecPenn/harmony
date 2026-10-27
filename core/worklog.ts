import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

/** Step 17: maintenance mode, Alec's own work log for his day job. Only he sees it; it is not connected to
 * the work-order system. By voice he logs jobs ("new job, unit 214, leaking faucet"), progress and time ("214:
 * replaced the cartridge, 40 minutes"), parts ordered and arriving, and when a job is done. Receipts (photos or PDFs)
 * attach to a job in the Work panel. At the end of the day HARMONY sums it up: what got done, what moved, what's waiting
 * on parts, and time logged. Everything stays in HARMONY's database (so it's in the backups) and is private: guests and
 * other voices can't read it. */

export type JobStatus='open'|'in_progress'|'waiting_parts'|'done';
export interface WorkEvent {id:number;at:string;kind:'note'|'progress'|'part_ordered'|'part_received'|'status'|'receipt';text:string;minutes:number|null;part:string|null;qty:number|null;vendor:string|null;}
export interface Job {id:string;createdAt:string;updatedAt:string;place:string;title:string;status:JobStatus;doneAt:string|null;}
export interface JobView extends Job {events:WorkEvent[];minutes:number;partsWaiting:{part:string;qty:number|null;vendor:string|null;since:string}[];files:{id:string;name:string;mime:string;bytes:number;at:string}[];}
export class WorkInputError extends Error {}

const clean=(v:unknown,n:number)=>String(v??'').replace(/[\u0000-\u001f\u007f<>]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
/** "unit 214", "Apt. 214B", "#214" → "214B"; anything else (boiler room, the pool) as said. */
export function normalPlace(v:unknown):string{
 const s=clean(v,60).replace(/^the\s+/i,'').replace(/^(?:unit|apt\.?|apartment|suite|ste\.?|rm\.?|#)\s*/i,'').replace(/[.,;:]+$/,'');
 return /^\d+[a-z]?$/i.test(s)?s.toUpperCase():s.toLowerCase();
}
const words=(s:string)=>s.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2&&!['the','and','for','with','unit'].includes(w));
const MIMES=new Set(['image/jpeg','image/png','image/webp','image/heic','application/pdf']);
export const MAX_FILE=10*1024*1024;

export class WorkLog {
 private db:DatabaseSync;private now:()=>Date;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 #row=(r:Record<string,unknown>):Job=>({id:String(r.id),createdAt:String(r.created_at),updatedAt:String(r.updated_at),place:String(r.place),title:String(r.title),status:String(r.status) as JobStatus,doneAt:r.done_at===null?null:String(r.done_at)});
 #touch(id:string,status?:JobStatus){
  const at=this.now().toISOString();
  if(status)this.db.prepare('UPDATE work_jobs SET updated_at=?,status=?,done_at=? WHERE id=?').run(at,status,status==='done'?at:null,id);
  else this.db.prepare('UPDATE work_jobs SET updated_at=? WHERE id=?').run(at,id);
 }
 #event(id:string,e:Partial<Omit<WorkEvent,'id'|'at'>>&{kind:WorkEvent['kind']}){
  this.db.prepare('INSERT INTO work_events (job_id,at,kind,text,minutes,part,qty,vendor) VALUES (?,?,?,?,?,?,?,?)')
   .run(id,this.now().toISOString(),e.kind,clean(e.text,300),e.minutes??null,e.part?clean(e.part,120):null,e.qty??null,e.vendor?clean(e.vendor,60):null);
 }
 get(id:string):Job|null{const r=this.db.prepare('SELECT * FROM work_jobs WHERE id=?').get(id);return r?this.#row(r):null;}
 jobs(which:'active'|'all'='active',limit=60):Job[]{
  return this.db.prepare(`SELECT * FROM work_jobs ${which==='active'?"WHERE status!='done'":''} ORDER BY updated_at DESC LIMIT ?`).all(limit).map(r=>this.#row(r));
 }
 /** The job meant by a place and/or words: an active job at that place (newest), else the best word match. */
 find(place:string,text=''):Job|null{
  const p=normalPlace(place),active=this.jobs('active',200),recent=this.jobs('all',200);
  const at=p?active.filter(j=>j.place===p):[];
  if(at.length===1||(at.length&&!text))return at[0];
  const want=words(text);
  const score=(j:Job)=>words(`${j.place} ${j.title}`).filter(w=>want.some(x=>w.startsWith(x.slice(0,5))||x.startsWith(w.slice(0,5)))).length;
  const pool=at.length?at:p?recent.filter(j=>j.place===p):active;
  let best:Job|null=null,top=0;for(const j of pool){const s=score(j);if(s>top){top=s;best=j;}}
  return best??(pool[0]&&p?pool[0]:null);
 }
 /** How to undo the last change: "job id.last event id before it.status before it" (or "new.job id"). */
 lastRef='';
 #mark(j:Job){const m=this.db.prepare('SELECT coalesce(max(id),0) AS m FROM work_events WHERE job_id=?').get(j.id) as {m:number};this.lastRef=`${j.id}.${Number(m.m)}.${j.status}`;}
 revert(ref:string):boolean{
  if(ref.startsWith('new.'))return this.removeIfEmpty(ref.slice(4));
  const [id,last,status]=ref.split('.');if(!this.get(id)||!['open','in_progress','waiting_parts','done'].includes(status))return false;
  this.db.prepare('DELETE FROM work_events WHERE job_id=? AND id>?').run(id,Number(last));
  this.#touch(id,status as JobStatus);return true;
 }
 #need(place:string,text:string):Job{
  const j=this.find(place,text);
  if(!j)throw new WorkInputError(place?`I don't have a job at ${normalPlace(place)}. Say "new job" first.`:'Which job? Say the unit or place.');
  this.#mark(j);return j;
 }
 add(place:string,title:string):{job:Job;existing:boolean}{
  const p=normalPlace(place),t=clean(title,160);if(!t)throw new WorkInputError('What needs doing?');
  const same=this.jobs('active',200).find(j=>j.place===p&&words(j.title).join(' ')===words(t).join(' '));
  if(same){this.#mark(same);return {job:same,existing:true};} // undo then changes nothing
  const at=this.now().toISOString(),id=randomUUID();
  this.db.prepare("INSERT INTO work_jobs (id,created_at,updated_at,place,title,status,done_at) VALUES (?,?,?,?,?,'open',NULL)").run(id,at,at,p,t);this.lastRef=`new.${id}`;
  return {job:this.get(id)!,existing:false};
 }
 progress(place:string,text:string,minutes:number|null):Job{
  const j=this.#need(place,text);this.#event(j.id,{kind:'progress',text,minutes});
  this.#touch(j.id,j.status==='open'?'in_progress':undefined);return this.get(j.id)!;
 }
 ordered(place:string,part:string,qty:number|null,vendor:string|null):Job{
  const j=this.#need(place,part);if(!clean(part,120))throw new WorkInputError('Which part?');
  this.#event(j.id,{kind:'part_ordered',text:`Ordered ${qty?`${qty} × `:''}${clean(part,120)}${vendor?` from ${clean(vendor,60)}`:''}`,part,qty,vendor});
  this.#touch(j.id,'waiting_parts');return this.get(j.id)!;
 }
 /** Parts arrived: a named part, or (with no part named) everything outstanding for the job. */
 arrived(place:string,part:string):{job:Job;parts:string[]}{
  const j=this.#need(place,part),waiting=this.view(j.id)!.partsWaiting;
  const want=words(part),hit=want.length?waiting.filter(w=>words(w.part).some(x=>want.some(y=>x.startsWith(y.slice(0,5))||y.startsWith(x.slice(0,5))))):waiting;
  const got=hit.length?hit:waiting;
  for(const w of got)this.#event(j.id,{kind:'part_received',text:`Received ${w.part}`,part:w.part,qty:w.qty});
  if(waiting.length===got.length)this.#touch(j.id,'in_progress');else this.#touch(j.id);
  return {job:this.get(j.id)!,parts:got.map(g=>g.part)};
 }
 done(place:string,text:string,minutes:number|null):Job{
  const j=this.#need(place,text);this.#event(j.id,{kind:'status',text:text?`Done: ${clean(text,280)}`:'Done',minutes});
  this.#touch(j.id,'done');return this.get(j.id)!;
 }
 reopen(id:string){const j=this.get(id);if(!j)return false;this.#event(id,{kind:'status',text:'Reopened'});this.#touch(id,'in_progress');return true;}
 /** Undo of "new job": removes it only while nothing else has been logged on it. */
 removeIfEmpty(id:string){const n=Number((this.db.prepare('SELECT count(*) AS n FROM work_events WHERE job_id=?').get(id) as {n:number}).n);if(n)return false;return Number(this.db.prepare('DELETE FROM work_jobs WHERE id=?').run(id).changes)===1;}
 attach(id:string,name:string,mime:string,bytes:Uint8Array):string{
  if(!this.get(id))throw new WorkInputError('That job is gone.');
  if(!MIMES.has(mime))throw new WorkInputError('Receipts can be photos (JPEG, PNG, WebP, HEIC) or PDFs.');
  if(!bytes.length||bytes.length>MAX_FILE)throw new WorkInputError('Receipts can be up to 10 MB.');
  const fid=randomUUID();
  this.db.prepare('INSERT INTO work_files (id,job_id,at,name,mime,bytes) VALUES (?,?,?,?,?,?)').run(fid,id,this.now().toISOString(),clean(name,120)||'receipt',mime,bytes);
  this.#event(id,{kind:'receipt',text:`Receipt: ${clean(name,100)||'receipt'}`});this.#touch(id);return fid;
 }
 file(fid:string):{name:string;mime:string;bytes:Uint8Array}|null{
  const r=this.db.prepare('SELECT name,mime,bytes FROM work_files WHERE id=?').get(fid) as {name:string;mime:string;bytes:Uint8Array}|undefined;return r??null;
 }
 view(id:string):JobView|null{
  const j=this.get(id);if(!j)return null;
  const events=this.db.prepare('SELECT * FROM work_events WHERE job_id=? ORDER BY id').all(id).map(r=>({id:Number(r.id),at:String(r.at),kind:String(r.kind) as WorkEvent['kind'],text:String(r.text),minutes:r.minutes===null?null:Number(r.minutes),part:r.part===null?null:String(r.part),qty:r.qty===null?null:Number(r.qty),vendor:r.vendor===null?null:String(r.vendor)}));
  const waiting:JobView['partsWaiting']=[];
  for(const e of events){
   if(e.kind==='part_ordered'&&e.part)waiting.push({part:e.part,qty:e.qty,vendor:e.vendor,since:e.at});
   if(e.kind==='part_received'&&e.part){const i=waiting.findIndex(w=>w.part===e.part);if(i>=0)waiting.splice(i,1);}
  }
  const files=this.db.prepare('SELECT id,name,mime,length(bytes) AS n,at FROM work_files WHERE job_id=? ORDER BY at').all(id).map(r=>({id:String(r.id),name:String(r.name),mime:String(r.mime),bytes:Number(r.n),at:String(r.at)}));
  return {...j,events,minutes:events.reduce((a,e)=>a+(e.minutes??0),0),partsWaiting:waiting,files};
 }
 /** For the panel: active jobs and today's finished ones, with their history. */
 snapshot():{jobs:JobView[];summary:string}{
  const start=new Date(this.now());start.setHours(0,0,0,0);
  const doneToday=this.db.prepare("SELECT id FROM work_jobs WHERE status='done' AND done_at>=? ORDER BY done_at DESC LIMIT 30").all(start.toISOString()).map(r=>String(r.id));
  const ids=[...this.jobs('active',60).map(j=>j.id),...doneToday];
  return {jobs:ids.map(id=>this.view(id)!).filter(Boolean),summary:this.summary()};
 }
 /** End of day, in plain sentences for speaking: done, moved, waiting on parts, still open, time. */
 summary(day:Date=this.now()):string{
  const start=new Date(day);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);
  const s=start.toISOString(),e=end.toISOString();
  const label=(j:Job)=>`${/^\d/.test(j.place)?`unit ${j.place}`:j.place||'no place'}: ${j.title}`;
  const done=this.db.prepare("SELECT * FROM work_jobs WHERE status='done' AND done_at>=? AND done_at<?").all(s,e).map(r=>this.#row(r));
  const movedIds=this.db.prepare("SELECT DISTINCT job_id FROM work_events WHERE at>=? AND at<? AND kind IN ('progress','part_ordered','part_received','note')").all(s,e).map(r=>String(r.job_id));
  const moved=movedIds.map(id=>this.get(id)!).filter(j=>j&&j.status!=='done');
  const minutes=Number((this.db.prepare('SELECT coalesce(sum(minutes),0) AS m FROM work_events WHERE at>=? AND at<?').get(s,e) as {m:number}).m);
  const active=this.jobs('active',200),waiting=active.filter(j=>j.status==='waiting_parts');
  const added=Number((this.db.prepare('SELECT count(*) AS n FROM work_jobs WHERE created_at>=? AND created_at<?').get(s,e) as {n:number}).n);
  const parts:string[]=[];for(const j of waiting)for(const w of this.view(j.id)!.partsWaiting)parts.push(`${w.part} for ${/^\d/.test(j.place)?`unit ${j.place}`:j.place}`);
  if(!done.length&&!moved.length&&!added)return active.length?`Nothing logged today. ${active.length} job${active.length>1?'s are':' is'} still open.`:'Nothing logged today, and no open jobs.';
  const lines=[];
  lines.push(done.length?`Done today (${done.length}): ${done.map(label).join('; ')}.`:'Nothing finished today.');
  if(moved.length)lines.push(`Moved forward: ${moved.map(label).join('; ')}.`);
  if(parts.length)lines.push(`Waiting on parts: ${parts.slice(0,6).join('; ')}.`);
  lines.push(`${active.length} job${active.length===1?'':'s'} still open${added?`, ${added} new today`:''}.`);
  if(minutes)lines.push(`Time logged: ${minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:`${minutes} min`}.`);
  return lines.join(' ');
 }
 /** Spoken list of active jobs (optionally only those waiting on parts). */
 listText(onlyWaiting=false):string{
  const jobs=this.jobs('active',60).filter(j=>!onlyWaiting||j.status==='waiting_parts');
  if(!jobs.length)return onlyWaiting?'Nothing is waiting on parts.':'No open jobs.';
  const st:Record<JobStatus,string>={open:'not started',in_progress:'in progress',waiting_parts:'waiting on parts',done:'done'};
  return `${jobs.length} ${onlyWaiting?'waiting on parts':`open job${jobs.length>1?'s':''}`}: ${jobs.slice(0,8).map(j=>`${/^\d/.test(j.place)?`unit ${j.place}`:j.place||'no place'}, ${j.title} (${st[j.status]})`).join('; ')}${jobs.length>8?`; and ${jobs.length-8} more`:''}.`;
 }
}
export const WORKLOG_MIGRATION=`CREATE TABLE work_jobs (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, place TEXT NOT NULL CHECK(length(place) <= 60),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160), status TEXT NOT NULL CHECK(status IN ('open','in_progress','waiting_parts','done')), done_at TEXT
  );
  CREATE INDEX work_jobs_status ON work_jobs(status, updated_at);
  CREATE TABLE work_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES work_jobs(id) ON DELETE CASCADE, at TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('note','progress','part_ordered','part_received','status','receipt')), text TEXT NOT NULL CHECK(length(text) <= 300),
    minutes INTEGER CHECK(minutes IS NULL OR minutes BETWEEN 0 AND 1440), part TEXT CHECK(part IS NULL OR length(part) <= 120), qty INTEGER, vendor TEXT CHECK(vendor IS NULL OR length(vendor) <= 60)
  );
  CREATE INDEX work_events_job ON work_events(job_id, at);
  CREATE INDEX work_events_at ON work_events(at);
  CREATE TABLE work_files (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES work_jobs(id) ON DELETE CASCADE, at TEXT NOT NULL, name TEXT NOT NULL CHECK(length(name) <= 120),
    mime TEXT NOT NULL CHECK(length(mime) <= 60), bytes BLOB NOT NULL CHECK(length(bytes) <= 10485760)
  );
  CREATE INDEX work_files_job ON work_files(job_id);`;
