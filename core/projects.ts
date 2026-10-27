/** Project engine (Phase 25) and "Where was I?" (Phase 26).
 * Projects and their notes live in HARMONY's local SQLite database. One project can be active; work notes (tasks,
 * decisions, blockers, notes) go to it, and "Where was I?" summarises from what is stored here, never from guesses.
 */
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ReminderInputError} from './reminders.ts';

export type NoteKind='task'|'decision'|'blocker'|'note';
export type World='default'|'prismatic'|'war-room'|'broadcast'|'gallery'|'executive';
export interface Project {id:string;name:string;description:string;goals:string;status:'ACTIVE'|'PAUSED'|'DONE';world:World;createdAt:string;lastActiveAt:string;}
export interface ProjectNote {id:string;projectId:string;kind:NoteKind;text:string;open:boolean;createdAt:string;closedAt:string|null;}
export interface ProjectsStatus {
 activeId:string|null;
 projects:(Project&{openTasks:number;openBlockers:number})[];
 active:{project:Project;tasks:ProjectNote[];blockers:ProjectNote[];decisions:ProjectNote[];notes:ProjectNote[]}|null;
}
export const emptyProjects:ProjectsStatus={activeId:null,projects:[],active:null};
export const WORLDS:readonly World[]=['default','prismatic','war-room','broadcast','gallery','executive'];
const MAX_PROJECTS=60,MAX_NOTES=400,MAX_TEXT=240;

/** Starter projects for a new install, one per atmosphere (rename or add your own by voice). */
export const SEED_PROJECTS:readonly {name:string;description:string;world:World}[]=[
 {name:'HARMONY',description:'Personal JARVIS-style desktop assistant.',world:'default'},
 {name:'Writing',description:'Stories, worldbuilding and lore.',world:'prismatic'},
 {name:"God's Eye",description:'Local global intelligence dashboard.',world:'war-room'},
 {name:'Music',description:'Songs, shows and releases.',world:'broadcast'},
 {name:"Artist's Studio",description:'Art, design and archives.',world:'gallery'},
 {name:'Business',description:'Business admin.',world:'executive'},
];

const clean=(v:unknown,max=MAX_TEXT)=>{
 if(typeof v!=='string')return '';
 return v.replace(/[\u0000-\u001f\u007f<>]+/g,' ').replace(/\s+/g,' ').trim().replace(/[.!,;:]+$/,'').slice(0,max);
};
const words=(s:string)=>s.toLowerCase().replace(/[^a-z0-9' ]+/g,' ').split(' ').filter(w=>w.length>1&&!['the','a','an','project','my','to','on','of','and'].includes(w));
const proj=(r:Record<string,unknown>):Project=>({id:String(r.id),name:String(r.name),description:String(r.description),goals:String(r.goals),status:r.status as Project['status'],world:(WORLDS.includes(r.world as World)?r.world:'default') as World,createdAt:String(r.created_at),lastActiveAt:String(r.last_active_at)});
const note=(r:Record<string,unknown>):ProjectNote=>({id:String(r.id),projectId:String(r.project_id),kind:r.kind as NoteKind,text:String(r.text),open:Number(r.open)===1,createdAt:String(r.created_at),closedAt:r.closed_at?String(r.closed_at):null});
const ago=(iso:string,now:Date)=>{
 const m=Math.round((now.getTime()-new Date(iso).getTime())/60000);
 return m<2?'just now':m<60?`${m} minutes ago`:m<1440?`${Math.round(m/60)} hours ago`:`${Math.round(m/1440)} days ago`;
};

export class ProjectStore {
 private db:DatabaseSync;private now:()=>Date;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 #tx<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const out=work();this.db.exec('COMMIT');return out;}catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}}

 /** Adds the specification's projects once (only into an empty project list). */
 seed(){
  if(Number(this.db.prepare('SELECT COUNT(*) AS n FROM projects').get()?.n??0)>0)return;
  for(const p of SEED_PROJECTS)this.create(p.name,p.description,p.world,false);
 }
 all():Project[]{return this.db.prepare("SELECT * FROM projects ORDER BY status='DONE', last_active_at DESC LIMIT ?").all(MAX_PROJECTS).map(proj);}
 get(id:string):Project|null{const r=this.db.prepare('SELECT * FROM projects WHERE id=?').get(id);return r?proj(r):null;}
 activeId():string|null{const r=this.db.prepare("SELECT value FROM project_state WHERE key='active'").get();return r?String(r.value):null;}
 active():Project|null{const id=this.activeId();return id?this.get(id):null;}
 /** Best match for a spoken name: exact (ignoring case), then the most shared words. */
 find(name:string):Project|null{
  const n=clean(name,80).toLowerCase();if(!n)return null;
  const list=this.all();
  const exact=list.find(p=>p.name.toLowerCase()===n||p.name.toLowerCase().replace(/'/g,'')===n.replace(/'/g,''));if(exact)return exact;
  const want=words(n);let best:Project|null=null,score=0;
  for(const p of list){const have=words(p.name);const s=have.filter(w=>want.includes(w)||want.some(x=>x.length>3&&(w.startsWith(x)||x.startsWith(w)))).length/Math.max(1,Math.min(have.length,want.length))+0.01*have.filter(w=>want.includes(w)).length/Math.max(1,have.length);if(s>score){score=s;best=p;}}
  return score>=0.5?best:null;
 }
 create(name:string,description='',world:World='default',activate=true):Project{
  const n=clean(name,60);if(n.length<2)throw new ReminderInputError('What should the project be called?');
  if(this.find(n)?.name.toLowerCase()===n.toLowerCase())throw new ReminderInputError(`There's already a project called ${n}.`);
  if(this.all().length>=MAX_PROJECTS)throw new ReminderInputError('That is a lot of projects. Mark some as done first.');
  const now=this.now().toISOString(),p:Project={id:randomUUID(),name:n,description:clean(description,300),goals:'',status:'ACTIVE',world:WORLDS.includes(world)?world:'default',createdAt:now,lastActiveAt:now};
  this.#tx(()=>{
   this.db.prepare('INSERT INTO projects (id,name,description,goals,status,world,created_at,last_active_at) VALUES (?,?,?,?,?,?,?,?)').run(p.id,p.name,p.description,p.goals,p.status,p.world,p.createdAt,p.lastActiveAt);
   if(activate)this.#setActive(p.id);
  });
  return p;
 }
 remove(id:string):boolean{return this.#tx(()=>{this.db.prepare('DELETE FROM project_notes WHERE project_id=?').run(id);if(this.activeId()===id)this.db.prepare("DELETE FROM project_state WHERE key='active'").run();return Number(this.db.prepare('DELETE FROM projects WHERE id=?').run(id).changes)===1;});}
 #setActive(id:string|null){
  if(id===null){this.db.prepare("DELETE FROM project_state WHERE key='active'").run();return;}
  this.db.prepare("INSERT INTO project_state (key,value) VALUES ('active',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);
  this.db.prepare('UPDATE projects SET last_active_at=? WHERE id=?').run(this.now().toISOString(),id);
 }
 /** Returns the previously active project id (for undo). */
 switchTo(id:string|null):string|null{
  if(id!==null&&!this.get(id))throw new ReminderInputError("I couldn't find that project.");
  return this.#tx(()=>{const before=this.activeId();this.#setActive(id);return before;});
 }
 /** Marks the active project as worked on now (called once per conversation turn). */
 touch(){const id=this.activeId();if(id)this.db.prepare('UPDATE projects SET last_active_at=? WHERE id=?').run(this.now().toISOString(),id);}
 update(id:string,patch:Partial<Pick<Project,'description'|'goals'|'status'|'world'>>){
  const p=this.get(id);if(!p)return false;
  const next={description:patch.description!==undefined?clean(patch.description,300):p.description,goals:patch.goals!==undefined?clean(patch.goals,600):p.goals,
   status:patch.status&&['ACTIVE','PAUSED','DONE'].includes(patch.status)?patch.status:p.status,world:patch.world&&WORLDS.includes(patch.world)?patch.world:p.world};
  this.db.prepare('UPDATE projects SET description=?,goals=?,status=?,world=? WHERE id=?').run(next.description,next.goals,next.status,next.world,id);return true;
 }

 addNote(projectId:string,kind:NoteKind,text:string):ProjectNote{
  const t=clean(text);if(t.length<2)throw new ReminderInputError('What should I note?');
  if(!['task','decision','blocker','note'].includes(kind))throw new ReminderInputError('I can note a task, a decision, a blocker or a note.');
  if(!this.get(projectId))throw new ReminderInputError("I couldn't find that project.");
  if(Number(this.db.prepare('SELECT COUNT(*) AS n FROM project_notes WHERE project_id=?').get(projectId)?.n??0)>=MAX_NOTES)throw new ReminderInputError('This project has a lot of notes. Clear some finished ones first.');
  const n:ProjectNote={id:randomUUID(),projectId,kind,text:t,open:kind==='task'||kind==='blocker',createdAt:this.now().toISOString(),closedAt:null};
  this.db.prepare('INSERT INTO project_notes (id,project_id,kind,text,open,created_at,closed_at) VALUES (?,?,?,?,?,?,NULL)').run(n.id,projectId,kind,t,n.open?1:0,n.createdAt);
  this.touch();return n;
 }
 getNote(id:string):ProjectNote|null{const r=this.db.prepare('SELECT * FROM project_notes WHERE id=?').get(id);return r?note(r):null;}
 removeNote(id:string){return Number(this.db.prepare('DELETE FROM project_notes WHERE id=?').run(id).changes)===1;}
 setOpen(id:string,open:boolean){return Number(this.db.prepare('UPDATE project_notes SET open=?,closed_at=? WHERE id=?').run(open?1:0,open?null:this.now().toISOString(),id).changes)===1;}
 notes(projectId:string,kind?:NoteKind,limit=50):ProjectNote[]{
  return (kind?this.db.prepare('SELECT * FROM project_notes WHERE project_id=? AND kind=? ORDER BY created_at DESC,id LIMIT ?').all(projectId,kind,limit)
   :this.db.prepare('SELECT * FROM project_notes WHERE project_id=? ORDER BY created_at DESC,id LIMIT ?').all(projectId,limit)).map(note);
 }
 /** The open task or blocker best matching spoken words ("the upload"), or the newest for "that"/"last". */
 findOpen(projectId:string,which:string):ProjectNote|null{
  const open=this.notes(projectId,undefined,200).filter(n=>n.open);if(!open.length)return null;
  const w=which.trim().toLowerCase();if(!w||['that','it','last','the last one'].includes(w))return open[0];
  const want=words(w);let best:ProjectNote|null=null,score=0;
  for(const n of open){const s=words(n.text).filter(x=>want.includes(x)).length;if(s>score){score=s;best=n;}}
  return best;
 }

 /** The facts "Where was I?" is answered from: last active project, its open work, latest decision, timeline. */
 whereWasI(projectId?:string|null):string{
  const p=projectId?this.get(projectId):this.active()??this.all().find(x=>x.status!=='DONE')??null;
  if(!p)return 'No projects are stored yet.';
  const now=this.now(),all=this.notes(p.id,undefined,200);
  const open=(k:NoteKind)=>all.filter(n=>n.kind===k&&n.open);
  const lines=[`Project: ${p.name}${p.status!=='ACTIVE'?` (${p.status.toLowerCase()})`:''}, last worked on ${ago(p.lastActiveAt,now)}.`];
  if(p.description)lines.push(`About: ${p.description}`);
  if(p.goals)lines.push(`Goals: ${p.goals}`);
  const tasks=open('task'),blockers=open('blocker'),decisions=all.filter(n=>n.kind==='decision'),notes=all.filter(n=>n.kind==='note');
  const done=all.filter(n=>n.kind==='task'&&!n.open&&n.closedAt).sort((a,b)=>String(b.closedAt).localeCompare(String(a.closedAt)));
  if(done[0])lines.push(`Last finished task: ${done[0].text} (${ago(done[0].closedAt!,now)}).`);
  lines.push(tasks.length?`Open tasks (newest first): ${tasks.slice(0,4).map(t=>t.text).join('; ')}.`:'No open tasks.');
  lines.push(blockers.length?`Unresolved blocker: ${blockers.slice(0,2).map(b=>b.text).join('; ')}.`:'No open blockers.');
  if(decisions[0])lines.push(`Latest decision: ${decisions[0].text} (${ago(decisions[0].createdAt,now)}).`);
  if(notes[0])lines.push(`Latest note: ${notes[0].text}.`);
  const others=this.all().filter(x=>x.id!==p.id&&x.status==='ACTIVE').slice(0,3);
  if(others.length)lines.push(`Other active projects: ${others.map(o=>`${o.name} (${ago(o.lastActiveAt,now)})`).join(', ')}.`);
  return lines.join('\n').slice(0,1500);
 }
 status():ProjectsStatus{
  const activeId=this.activeId();
  const projects=this.all().map(p=>({...p,
   openTasks:Number(this.db.prepare("SELECT COUNT(*) AS n FROM project_notes WHERE project_id=? AND kind='task' AND open=1").get(p.id)?.n??0),
   openBlockers:Number(this.db.prepare("SELECT COUNT(*) AS n FROM project_notes WHERE project_id=? AND kind='blocker' AND open=1").get(p.id)?.n??0)}));
  const a=activeId?this.get(activeId):null;
  return {activeId,projects,active:a?{project:a,
   tasks:this.notes(a.id,'task',40).filter(n=>n.open),blockers:this.notes(a.id,'blocker',20).filter(n=>n.open),
   decisions:this.notes(a.id,'decision',10),notes:this.notes(a.id,'note',10)}:null};
 }
 /** One line for the model's instructions so notes go to the right project. */
 context():string{const a=this.active();return a?`The person's current project is ${a.name}.`:'';}
}
