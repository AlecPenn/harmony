import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ReminderInputError} from './reminders.ts';

/** Focus ("lock in"): a simpler, calmer screen and a timed session. Ghost: the interface collapses to a small presence;
 * voice still works. In every mode reminders and timers you set are still spoken: you asked for them. */
export type HarmonyMode='normal'|'focus'|'ghost';
export const MODES:readonly HarmonyMode[]=['normal','focus','ghost'];
export interface ModeStatus {mode:HarmonyMode;since:string|null;}

export class ModeStore {
 private db:DatabaseSync;private now:()=>Date;private changed:()=>void;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date(),changed:()=>void=()=>{}){this.db=db;this.now=now;this.changed=changed;}
 #get(key:string){const r=this.db.prepare('SELECT value FROM memory_settings WHERE key=?').get(key);return r?String(r.value):null;}
 #put(key:string,value:string){this.db.prepare('INSERT INTO memory_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 status():ModeStatus{const m=this.#get('mode') as HarmonyMode|null;return {mode:m&&MODES.includes(m)?m:'normal',since:m&&m!=='normal'?this.#get('mode_since'):null};}
 /** Returns what it was before (with how long it lasted), so undo can put it back and the reply can say how long you focused. */
 set(mode:HarmonyMode):{previous:HarmonyMode;minutes:number|null}{
  if(!MODES.includes(mode))throw new Error('Invalid mode');
  const before=this.status(),since=before.since?Date.parse(before.since):NaN;
  this.#put('mode',mode);this.#put('mode_since',this.now().toISOString());
  try{this.changed();}catch{}
  return {previous:before.mode,minutes:Number.isFinite(since)?Math.max(0,Math.round((this.now().getTime()-since)/60000)):null};
 }
}

/** Idea Mode: "Harmony, idea: …" is captured at once, with no discussion, and can be moved through stages later. */
export type IdeaStage='NEW'|'EXPLORE'|'ATTACK'|'TEST'|'BUILD'|'ARCHIVE';
export const IDEA_STAGES:readonly IdeaStage[]=['NEW','EXPLORE','ATTACK','TEST','BUILD','ARCHIVE'];
export interface Idea {id:string;at:string;text:string;projectId:string|null;stage:IdeaStage;}
export const MAX_IDEAS=500;
export class IdeaStore {
 private db:DatabaseSync;private now:()=>Date;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 #row=(r:Record<string,unknown>):Idea=>({id:String(r.id),at:String(r.at),text:String(r.text),projectId:r.project_id?String(r.project_id):null,stage:String(r.stage) as IdeaStage});
 add(text:string,projectId:string|null):Idea{
  const t=String(text??'').replace(/[\u0000-\u001f\u007f<>]+/g,' ').replace(/\s+/g,' ').trim().replace(/^(idea[:,\s]+)/i,'').replace(/[.!]+$/,'').slice(0,400);
  if(t.length<3)throw new ReminderInputError("What's the idea?");
  if(Number(this.db.prepare('SELECT COUNT(*) AS n FROM ideas').get()?.n??0)>=MAX_IDEAS)throw new ReminderInputError('The idea list is full. Archive or delete some in the Projects panel.');
  const idea:Idea={id:randomUUID(),at:this.now().toISOString(),text:t,projectId,stage:'NEW'};
  this.db.prepare('INSERT INTO ideas (id,at,text,project_id,stage) VALUES (?,?,?,?,?)').run(idea.id,idea.at,idea.text,idea.projectId,idea.stage);
  return idea;
 }
 get(id:string){const r=this.db.prepare('SELECT * FROM ideas WHERE id=?').get(id);return r?this.#row(r):null;}
 list(limit=100):Idea[]{return this.db.prepare("SELECT * FROM ideas ORDER BY CASE stage WHEN 'ARCHIVE' THEN 1 ELSE 0 END, at DESC, rowid DESC LIMIT ?").all(Math.min(limit,MAX_IDEAS)).map(r=>this.#row(r));}
 setStage(id:string,stage:IdeaStage):boolean{if(!IDEA_STAGES.includes(stage))throw new Error('Invalid stage');return Number(this.db.prepare('UPDATE ideas SET stage=? WHERE id=?').run(stage,id).changes)===1;}
 remove(id:string):boolean{this.db.prepare('DELETE FROM embeddings WHERE item=?').run('idea:'+id);return Number(this.db.prepare('DELETE FROM ideas WHERE id=?').run(id).changes)===1;}
}
