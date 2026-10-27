import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ReminderInputError} from './reminders.ts';
import type {MemoryStatus} from '../packages/contracts/memory.ts';

/** Something the person explicitly asked HARMONY to remember. Kept on this PC until they say to forget it. */
export interface Memory {id:string;text:string;createdAt:string;source:'voice'|'typed'|'screen';pinned:boolean;project:string|null;}
export const MAX_MEMORIES=200,MAX_MEMORY_TEXT=200;
const CONTEXT_CHARS=2500;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);

/** "remember that my son's practice is on Tuesdays." → "my son's practice is on Tuesdays" */
export function memoryText(value:unknown):string{
 if(typeof value!=='string')throw new ReminderInputError('What should I remember?');
 const text=value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/[<>]/g,' ').replace(/\s+/g,' ').trim()
  .replace(/^(please\s+)?(remember|note|don't forget|do not forget)(\s+that)?[\s,:]+/i,'').replace(/^that\s+/i,'').replace(/[.!,;:]+$/,'').trim();
 if(text.length<3)throw new ReminderInputError('What should I remember?');
 if(text.length>MAX_MEMORY_TEXT)throw new ReminderInputError('That is a lot to remember at once. Try a shorter version.');
 return text;
}
const words=(s:string)=>s.toLowerCase().replace(/[^a-z0-9' ]+/g,' ').split(' ').filter(w=>w.length>2&&!['the','and','that','about','this','with','for','you','remember','forget','thing','what','was'].includes(w));
const row=(r:Record<string,unknown>):Memory=>({id:String(r.id),text:String(r.text),createdAt:String(r.created_at),source:r.source==='typed'?'typed':r.source==='screen'?'screen':'voice',pinned:Number(r.importance??2)>=3,project:r.project_id?String(r.project_id):null});

/** Durable personal memory in HARMONY's local SQLite database. Bounded; never sent anywhere. */
export class MemoryStore {
 private db:DatabaseSync;private now:()=>Date;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 /** Where new memories are filed: the current project, when there is one (it helps recall rank them). */
 currentProject:()=>string|null=()=>null;
 /** Pinned memories are always in the instructions; the rest are found by recall when they matter. */
 pin(memoryId:string,pinned:boolean):boolean{if(!id(memoryId))return false;return Number(this.db.prepare("UPDATE memories SET importance=? WHERE id=? AND state='ACTIVE'").run(pinned?3:2,memoryId).changes)===1;}
 #tx<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const out=work();this.db.exec('COMMIT');return out;}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}}
 add(text:string,source:Memory['source']):Memory{
  const body=memoryText(text);if(!['voice','typed','screen'].includes(source))throw new Error('Invalid source');
  return this.#tx(()=>{
   const same=this.db.prepare("SELECT * FROM memories WHERE state='ACTIVE' AND lower(text)=lower(?)").get(body);
   if(same)return row(same);
   const count=Number(this.db.prepare("SELECT COUNT(*) AS n FROM memories WHERE state='ACTIVE'").get()?.n??0);
   if(count>=MAX_MEMORIES)throw new ReminderInputError("My memory is full. Forget a few things in the Memory panel first.");
   let project:string|null=null;try{project=this.currentProject();}catch{}
   const value:Memory={id:randomUUID(),text:body,createdAt:this.now().toISOString(),source,pinned:false,project};
   this.db.prepare("INSERT INTO memories (id,text,created_at,source,state,project_id) VALUES (?,?,?,?,'ACTIVE',?)").run(value.id,value.text,value.createdAt,source,project);
   return value;
  });
 }
 get(memoryId:string):(Memory&{state:string})|null{if(!id(memoryId))return null;const r=this.db.prepare('SELECT * FROM memories WHERE id=?').get(memoryId);return r?{...row(r),state:String(r.state)}:null;}
 active():Memory[]{return this.db.prepare("SELECT * FROM memories WHERE state='ACTIVE' ORDER BY created_at DESC,id LIMIT ?").all(MAX_MEMORIES).map(row);}
 /** Forgetting by id also removes its search vector, so a forgotten thing can't be found by meaning either. */
 #dropVector(memoryId:string){try{this.db.prepare('DELETE FROM embeddings WHERE item=?').run('memory:'+memoryId);}catch{}}
 forget(memoryId:string):boolean{if(!id(memoryId))return false;const ok=Number(this.db.prepare("UPDATE memories SET state='FORGOTTEN' WHERE id=? AND state='ACTIVE'").run(memoryId).changes)===1;if(ok)this.#dropVector(memoryId);return ok;}
 restore(memoryId:string):boolean{if(!id(memoryId))return false;return Number(this.db.prepare("UPDATE memories SET state='ACTIVE' WHERE id=? AND state='FORGOTTEN'").run(memoryId).changes)===1;}
 /** Removes every memory for good (not just hidden): the text is deleted from the database. */
 forgetAll():number{try{this.db.prepare("DELETE FROM embeddings WHERE item LIKE 'memory:%'").run();}catch{}return Number(this.db.prepare('DELETE FROM memories').run().changes);}
 /** The best match for "forget the thing about the plumber", or the most recent for "that"/"last". */
 find(which:string):Memory|null{
  const list=this.active();if(!list.length)return null;
  const w=which.trim().toLowerCase();
  if(!w||['last','latest','that','it','the last one','most recent','the last thing'].includes(w))return list[0];
  const want=words(w);let best:Memory|null=null,score=0;
  for(const m of list){const s=words(m.text).filter(x=>want.includes(x)).length;if(s>score){score=s;best=m;}}
  return best;
 }
 /** What goes into the model's instructions: newest first, bounded, dated, clearly labelled as the person's own words. */
 context(maxChars=CONTEXT_CHARS):string{return this.contextEntries(maxChars).text;}
 /** Pinned first, then newest, within a character budget; also which memories made it in. */
 contextEntries(maxChars=CONTEXT_CHARS):{text:string;ids:Set<string>}{
  const lines:string[]=[],ids=new Set<string>();let used=0;
  const list=this.active(),ordered=[...list.filter(m=>m.pinned),...list.filter(m=>!m.pinned)];
  for(const m of ordered){
   const line=`- ${m.text.replace(/[<>\n]/g,' ')} (saved ${new Date(m.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})})`;
   if(used+line.length>maxChars)break;lines.push(line);ids.add(m.id);used+=line.length;
  }
  return {text:lines.length?'Things the person asked you to remember (use them when relevant; do not recite them unless asked):\n'+lines.join('\n'):'',ids};
 }
 status():MemoryStatus{return {items:this.active().map(({id,text,createdAt,source,pinned})=>({id,text,createdAt,source,pinned})),limit:MAX_MEMORIES};}
}
