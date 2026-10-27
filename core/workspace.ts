import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {findApp,type StartApp,type WindowInfo} from './desktop.ts';
import type {ProjectStore} from './projects.ts';

/** Workspace Time Machine: "Save my place" records which apps and windows were open, the current project and its open
 * tasks; "Put me back" reopens what isn't open and switches to that project. Stored locally; titles only, no contents. */
export interface SnapshotWindow {app:string;title:string;appId:string|null;appName:string|null;}
export interface WorkspaceSnapshot {id:string;at:string;projectId:string|null;project:string|null;label:string;windows:SnapshotWindow[];tasks:string[];}
export const MAX_SNAPSHOTS=60;
const BROWSER=/chrome|edge|firefox|opera|brave|browser/i;
const IGNORE=/^(Program Manager|Settings|Task Manager|Windows Input Experience|Microsoft Text Input Application|NVIDIA GeForce Overlay)$/i;
const clean=(v:string,n:number)=>v.replace(/[\u0000-\u001f\u007f<>]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);

export class WorkspaceStore {
 private db:DatabaseSync;private projects:ProjectStore|null;private now:()=>Date;
 constructor(db:DatabaseSync,projects:ProjectStore|null,now:()=>Date=()=>new Date()){this.db=db;this.projects=projects;this.now=now;}
 /** Builds and stores a snapshot from the open windows (HARMONY's own are already excluded by the helper). */
 save(windows:readonly WindowInfo[],apps:readonly StartApp[],label=''):WorkspaceSnapshot{
  const seen=new Set<string>(),list:SnapshotWindow[]=[];
  for(const w of windows){
   const app=clean(w.app,80),title=clean(w.title,160);if(!title||IGNORE.test(app)||IGNORE.test(title))continue;
   const key=`${app}|${title}`;if(seen.has(key))continue;seen.add(key);
   const match=findApp(apps,app)??findApp(apps,title.split(/\s[-—–|]\s/).pop()??'');
   list.push({app,title,appId:match?.id??null,appName:match?.name??null});
   if(list.length>=30)break;
  }
  const project=this.projects?.active()??null;
  const tasks=project?this.projects!.notes(project.id,'task').filter(n=>n.open).slice(0,5).map(n=>n.text):[];
  const at=this.now();
  const snap:WorkspaceSnapshot={id:randomUUID(),at:at.toISOString(),projectId:project?.id??null,project:project?.name??null,
   label:clean(label,80)||at.toLocaleString('en-US',{weekday:'long',hour:'numeric',minute:'2-digit'}),windows:list,tasks};
  this.db.prepare('INSERT INTO workspace_snapshots (id,at,project_id,label,data) VALUES (?,?,?,?,?)').run(snap.id,snap.at,snap.projectId,snap.label,JSON.stringify({project:snap.project,windows:list,tasks}).slice(0,20000));
  this.db.prepare('DELETE FROM workspace_snapshots WHERE id IN (SELECT id FROM workspace_snapshots ORDER BY at DESC LIMIT -1 OFFSET ?)').run(MAX_SNAPSHOTS);
  return snap;
 }
 #row(r:Record<string,unknown>):WorkspaceSnapshot{
  let d:{project?:string|null;windows?:SnapshotWindow[];tasks?:string[]}={};try{d=JSON.parse(String(r.data));}catch{}
  return {id:String(r.id),at:String(r.at),projectId:r.project_id?String(r.project_id):null,project:d.project??null,label:String(r.label),windows:Array.isArray(d.windows)?d.windows:[],tasks:Array.isArray(d.tasks)?d.tasks:[]};
 }
 get(id:string):WorkspaceSnapshot|null{const r=this.db.prepare('SELECT * FROM workspace_snapshots WHERE id=?').get(id);return r?this.#row(r):null;}
 remove(id:string):boolean{return Number(this.db.prepare('DELETE FROM workspace_snapshots WHERE id=?').run(id).changes)===1;}
 list(limit=20):WorkspaceSnapshot[]{return this.db.prepare('SELECT * FROM workspace_snapshots ORDER BY at DESC LIMIT ?').all(Math.min(limit,MAX_SNAPSHOTS)).map(r=>this.#row(r));}
 /** The latest snapshot, or the latest within a time range ("Tuesday night"). */
 find(range?:{start:Date;end:Date}):WorkspaceSnapshot|null{
  const r=range?this.db.prepare('SELECT * FROM workspace_snapshots WHERE at>=? AND at<? ORDER BY at DESC LIMIT 1').get(range.start.toISOString(),range.end.toISOString())
   :this.db.prepare('SELECT * FROM workspace_snapshots ORDER BY at DESC LIMIT 1').get();
  return r?this.#row(r):null;
 }
 /** What to reopen: apps from the snapshot that can be started and aren't open now (one launch per app). */
 plan(snap:WorkspaceSnapshot,open:readonly WindowInfo[]):{launch:{appId:string;name:string}[];already:string[];browserTabs:string[];unknown:string[]}{
  const openApps=new Set(open.map(w=>w.app.toLowerCase())),launch:{appId:string;name:string}[]=[],already:string[]=[],browserTabs:string[]=[],unknown:string[]=[];
  for(const w of snap.windows){
   if(BROWSER.test(w.app))browserTabs.push(w.title.replace(/\s[-—–]\s(Google Chrome|Microsoft Edge|Mozilla Firefox|Opera|Brave)$/i,''));
   if(openApps.has(w.app.toLowerCase())){if(!already.includes(w.app))already.push(w.app);continue;}
   if(w.appId&&w.appName){if(!launch.some(l=>l.appId===w.appId))launch.push({appId:w.appId,name:w.appName});}
   else if(!unknown.includes(w.app))unknown.push(w.app);
  }
  return {launch:launch.slice(0,6),already,browserTabs:browserTabs.slice(0,6),unknown:unknown.slice(0,4)};
 }
}

/** "Saturday night" style ranges for "put me back to …": a day word plus an optional part of the day. */
export function snapshotRange(when:string,now:Date):{start:Date;end:Date}|null{
 const w=when.toLowerCase().trim();if(!w||/^(last|latest|now|before|where i was)$/.test(w))return null;
 const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
 let day:Date|null=null;
 if(/\btoday\b|\bthis (morning|afternoon|evening)\b|\btonight\b/.test(w))day=new Date(now);
 else if(/\byesterday\b|\blast night\b/.test(w))day=new Date(now.getTime()-86400000);
 else{const i=days.findIndex(d=>w.includes(d));if(i>=0){day=new Date(now);const back=(now.getDay()-i+7)%7||7;day.setDate(now.getDate()-back);}}
 if(!day)return null;
 const at=(h:number)=>{const d=new Date(day!);d.setHours(h,0,0,0);return d;};
 if(/morning/.test(w))return {start:at(5),end:at(12)};
 if(/afternoon/.test(w))return {start:at(12),end:at(17)};
 if(/evening|night|tonight/.test(w)){const end=at(0);end.setDate(end.getDate()+1);end.setHours(4);return {start:at(17),end};}
 const end=at(0);end.setDate(end.getDate()+1);return {start:at(0),end};
}
