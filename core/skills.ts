import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

/** Phase 34: the skill registry. Every capability HARMONY has is a skill with a manifest; each can be turned off by voice
 * ("disable computer control") or in Settings, and a disabled skill's functions are simply not offered to the model.
 * Turning a skill on never grants anything beyond its manifest's fixed permissions. */
export interface SkillManifest {
 id:string;name:string;description:string;version:number;author:'HARMONY';
 /** Permission names its tools use (fixed here; a skill cannot add more). */
 permissions:readonly string[];
 /** Model function names it provides. */
 tools:readonly string[];
 dependencies:readonly string[];
 /** The test file that covers it. */
 tests:string;
 /** Core skills can't be turned off (STOP and status must always work). */
 core?:boolean;
 aliases:readonly string[];
}
export interface SkillStatus {id:string;name:string;description:string;version:number;status:'ENABLED'|'DISABLED'|'UNAVAILABLE';core:boolean;hash:string;tools:readonly string[];permissions:readonly string[];}

export const SKILLS:readonly SkillManifest[]=Object.freeze([
 {id:'reminders',name:'Reminders and timers',description:'Set, list and cancel reminders and timers.',version:1,author:'HARMONY',permissions:['reminders'],tools:['set_reminder','set_timer','list_reminders','cancel_reminder'],dependencies:[],tests:'tests/reminders.test.ts',aliases:['reminder','timers','timer','alarms']},
 {id:'status',name:'Status',description:'"Harmony, status": a rundown of what matters now.',version:1,author:'HARMONY',permissions:['status'],tools:['status_report'],dependencies:[],tests:'tests/workspace.test.ts',core:true,aliases:['status report','rundown']},
 {id:'memory',name:'Memory',description:'Remember and forget what you ask.',version:2,author:'HARMONY',permissions:['memory'],tools:['remember','forget'],dependencies:[],tests:'tests/memory.test.ts',aliases:['remembering','long term memory']},
 {id:'recall',name:'Recall',description:'Find what you told her or talked about, by meaning.',version:1,author:'HARMONY',permissions:['memory'],tools:['recall'],dependencies:['memory'],tests:'tests/recall.test.ts',aliases:['memory search','search memory']},
 {id:'projects',name:'Projects',description:'Switch projects, note tasks, decisions and blockers; "where was I?".',version:1,author:'HARMONY',permissions:['projects'],tools:['switch_project','project_note','where_was_i'],dependencies:[],tests:'tests/projects.test.ts',aliases:['project','tasks','where was i']},
 {id:'ideas',name:'Ideas',description:'"Idea: …" captured instantly.',version:1,author:'HARMONY',permissions:['ideas'],tools:[],dependencies:['projects'],tests:'tests/modes.test.ts',aliases:['idea','idea mode']},
 {id:'modes',name:'Focus and ghost modes',description:'"Lock in", "go ghost", "back to normal".',version:1,author:'HARMONY',permissions:['modes'],tools:['set_mode'],dependencies:[],tests:'tests/modes.test.ts',aliases:['focus','focus mode','ghost','ghost mode','modes','lock in']},
 {id:'web',name:'Web lookups',description:'Weather, news and web search, with sources.',version:1,author:'HARMONY',permissions:['web'],tools:['get_weather','get_news','web_search'],dependencies:[],tests:'tests/web.test.ts',aliases:['web','internet','web search','search','weather','news','browsing']},
 {id:'research',name:'Research missions',description:'Background research with cited sources.',version:1,author:'HARMONY',permissions:['missions','web'],tools:['research'],dependencies:['web'],tests:'tests/missions.test.ts',aliases:['research','missions','agents']},
 {id:'calendar',name:'Google Calendar',description:'Read your calendar; heads-ups before events.',version:1,author:'HARMONY',permissions:['google'],tools:['calendar_events'],dependencies:[],tests:'tests/google.test.ts',aliases:['calendar','schedule']},
 {id:'email',name:'Gmail',description:'Check and search your email (read only).',version:1,author:'HARMONY',permissions:['google'],tools:['check_email'],dependencies:[],tests:'tests/google.test.ts',aliases:['email','gmail','mail','inbox']},
 {id:'screen',name:'Screen awareness',description:'"Harmony, look": read the window you are using.',version:1,author:'HARMONY',permissions:['screen'],tools:['look_at_screen'],dependencies:[],tests:'tests/desktop.test.ts',aliases:['screen','looking','screen reading','vision']},
 {id:'computer',name:'Computer control',description:'Open apps and websites, switch windows, music and volume.',version:1,author:'HARMONY',permissions:['computer'],tools:['control_computer'],dependencies:[],tests:'tests/desktop.test.ts',aliases:['computer','control','computer control','browser control','apps','media','volume','music control']},
 {id:'workspace',name:'Workspace time machine',description:'"Save my place" and "put me back".',version:1,author:'HARMONY',permissions:['workspace','computer'],tools:['workspace'],dependencies:['computer'],tests:'tests/workspace.test.ts',aliases:['workspace','save my place','put me back','time machine']},
 {id:'godseye',name:"God's Eye",description:'A live 3D globe of public world data: flights, ships, quakes, fires, storms, satellites.',version:1,author:'HARMONY',permissions:['godseye'],tools:['gods_eye'],dependencies:[],tests:'tests/gods-eye.test.ts',aliases:["god's eye",'gods eye','globe','world map','gev']},
 {id:'worklog',name:'Maintenance work log',description:'Jobs, progress, parts and receipts for your day job, with an end-of-day summary.',version:1,author:'HARMONY',permissions:['work'],tools:['work_log'],dependencies:[],tests:'tests/worklog.test.ts',aliases:['work log','maintenance','maintenance mode','work orders','jobs']},
 {id:'skills',name:'Skill registry',description:'List skills and turn them on or off.',version:1,author:'HARMONY',permissions:['skills'],tools:['skills'],dependencies:[],tests:'tests/skills.test.ts',core:true,aliases:['skills','skill list']},
]);
const hashOf=(m:SkillManifest)=>createHash('sha256').update(JSON.stringify({id:m.id,version:m.version,permissions:m.permissions,tools:m.tools,dependencies:m.dependencies})).digest('hex').slice(0,16);
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z ]+/g,' ').replace(/\b(the|my|skill|feature|please)\b/g,' ').replace(/\s+/g,' ').trim();

export class SkillRegistry {
 private db:DatabaseSync;private available:(id:string)=>boolean;private changed:()=>void;
 constructor(db:DatabaseSync,available:(id:string)=>boolean=()=>true,changed:()=>void=()=>{}){this.db=db;this.available=available;this.changed=changed;}
 #off(id:string){return this.db.prepare('SELECT value FROM memory_settings WHERE key=?').get('skill:'+id)?.value==='off';}
 enabled(id:string):boolean{const m=SKILLS.find(s=>s.id===id);if(!m)return false;if(m.core)return true;return !this.#off(id)&&m.dependencies.every(d=>this.enabled(d));}
 /** Which skill a model function belongs to; functions not in any manifest are never offered. */
 skillOf(tool:string){return SKILLS.find(s=>s.tools.includes(tool))?.id??null;}
 offers(tool:string){const id=this.skillOf(tool);return id!==null&&this.enabled(id);}
 find(spoken:string):SkillManifest|null{
  const w=norm(spoken);if(!w)return null;
  return SKILLS.find(s=>norm(s.name)===w||s.id===w||s.aliases.includes(w))??SKILLS.find(s=>s.aliases.some(a=>w.includes(a))||w.includes(norm(s.name)))??null;
 }
 /** Returns the previous state so undo can restore it. Core skills can't be turned off. */
 set(id:string,on:boolean):boolean{
  const m=SKILLS.find(s=>s.id===id);if(!m)throw new Error('Unknown skill');if(m.core&&!on)throw new Error('Core skill');
  const before=!this.#off(id);
  this.db.prepare('INSERT INTO memory_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('skill:'+id,on?'on':'off');
  try{this.changed();}catch{}
  return before;
 }
 list():SkillStatus[]{
  return SKILLS.map(m=>({id:m.id,name:m.name,description:m.description,version:m.version,core:!!m.core,hash:hashOf(m),tools:m.tools,permissions:m.permissions,
   status:!this.available(m.id)?'UNAVAILABLE':this.enabled(m.id)?'ENABLED':'DISABLED'}));
 }
}
