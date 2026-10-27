import type {DatabaseSync} from 'node:sqlite';
import {SPIRAL_PHRASE} from './spiral-time.ts';
import {TEACH,draft as draftRoutine,describeSteps,type Routine} from './routines.ts';
import {normalPlace} from './worklog.ts';
import {NEEDS_INTERNET} from './connectivity.ts';
import {existsSync} from 'node:fs';
import {ApplicationEventBus} from './application-events.ts';
import {ActionJournal} from './action-journal.ts';
import {ToolDispatcher} from './tool-dispatcher.ts';
import {ToolRegistry,type ToolDefinition} from '../packages/tools/registry.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
import type {TurnContext} from '../packages/contracts/events.ts';
import type {ModelTool} from '../packages/reasoning/local-chat.ts';
import {ReminderStore,ReminderInputError,reminderText,resolveDue,spokenWhen,spokenDuration,type Reminder} from './reminders.ts';
import {MemoryStore,memoryText,type Memory} from './memory.ts';
import {WebLookup,WebError,lookupReport,type WebResult,type WebSource} from './web.ts';
import {GoogleAccount,GoogleError,calendarRange} from './google.ts';
import {ProjectStore,type NoteKind} from './projects.ts';
import type {Recall} from './recall.ts';
import {WorkspaceStore,snapshotRange} from './workspace.ts';
import {ModeStore,IdeaStore,MODES,type HarmonyMode} from './modes.ts';
import {MissionStore} from './missions.ts';
import {SkillRegistry} from './skills.ts';
import {Personality,EasterEggs} from './personality.ts';
import {Desktop,DesktopError,findApp,findWindow,websiteUrl,screenReport,MEDIA_KEYS,type MediaKey} from './desktop.ts';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {Channel,Verdict} from './guardian.ts';
/** The guardian as actions see it: may this run now (it may wait for a phone tap)? Throws with a sentence to say. */
export interface ActionGuard {
 authorize(toolId:string,risk:string,inputs:unknown,signal:AbortSignal,say?:(text:string)=>void,who?:{channel:Channel;verdict:Verdict}):Promise<void>;
 principal(channel:Channel):{channel:Channel;verdict:Verdict};
 /** Locked: typed requests get guest mode too (nothing personal in the prompt). */
 readonly locked?:unknown;
}
const GUEST_NOTE='HARMONY is locked right now. Help with general questions only; you have no access to the person\'s memory, messages, calendar, files, screen or computer until they unlock you.';
import {routeQuestion,gnssText} from './gods-eye.ts';
import {busIntent,MetroError} from './metro.ts';
import {WorldFeeds,worldRoute,nearby,report as worldReport,pins,eventFilter,type Near,type WorldEvent} from './world-feeds.ts';
const asking=new AsyncLocalStorage<{who:{channel:Channel;verdict:Verdict};say?:(text:string)=>void}>();

/** A function call the model asked for. It is a request only: names and values are validated here. */
export interface ToolCall {name:string;arguments:Record<string,string>;}
const MAX_CALLS=2,MAX_VALUE=300,MAX_CAPTURE=4000;
const list=(items:readonly string[])=>items.length<2?items.join(''):`${items.slice(0,-1).join(', ')} and ${items.at(-1)}`;

/** Splits a streamed reply into speakable text and the function-call markup after it.
 * Holds back a possible partial "<tool_call>" so markup never reaches the screen or the voice.
 */
export class ToolCallFilter {
 #pending='';#captured:string|null=null;
 static readonly open='<tool_call>';
 push(chunk:string):string{
  if(this.#captured!==null){if(this.#captured.length<MAX_CAPTURE)this.#captured+=chunk;return '';}
  this.#pending+=chunk;
  const at=this.#pending.indexOf(ToolCallFilter.open);
  if(at>=0){const out=this.#pending.slice(0,at);this.#captured=this.#pending.slice(at,at+MAX_CAPTURE);this.#pending='';return out;}
  let hold=0;
  for(let k=Math.min(this.#pending.length,ToolCallFilter.open.length-1);k>0;k--)if(ToolCallFilter.open.startsWith(this.#pending.slice(-k))){hold=k;break;}
  const out=this.#pending.slice(0,this.#pending.length-hold);this.#pending=this.#pending.slice(this.#pending.length-hold);return out;
 }
 finish():{text:string;calls:ToolCall[]}{
  const text=this.#captured===null?this.#pending:'';this.#pending='';
  return {text,calls:this.#captured===null?[]:parseToolCalls(this.#captured)};
 }
}
/** Reads Qwen's XML-style calls (and the older JSON style). Unknown shapes produce no call. */
export function parseToolCalls(text:string):ToolCall[]{
 const calls:ToolCall[]=[];
 for(const block of text.slice(0,MAX_CAPTURE).matchAll(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g)){
  if(calls.length>=MAX_CALLS)break;
  const body=block[1].trim();
  try{
   if(body.startsWith('{')){
    const value=JSON.parse(body) as {name?:unknown;arguments?:unknown};
    if(typeof value.name!=='string'||!/^[a-z_]{1,40}$/.test(value.name))continue;
    const args:Record<string,string>={};
    if(value.arguments&&typeof value.arguments==='object'&&!Array.isArray(value.arguments))
     for(const [k,v] of Object.entries(value.arguments).slice(0,8))if(/^[a-z_]{1,40}$/.test(k)&&['string','number'].includes(typeof v))args[k]=String(v).slice(0,MAX_VALUE);
    calls.push({name:value.name,arguments:args});continue;
   }
  }catch{continue;}
  const fn=/^<function=([a-z_]{1,40})>([\s\S]*?)(?:<\/function>|$)/.exec(body);if(!fn)continue;
  const args:Record<string,string>={};
  for(const p of fn[2].matchAll(/<parameter=([a-z_]{1,40})>\s*([\s\S]*?)\s*<\/parameter>/g)){if(Object.keys(args).length>=8)break;args[p[1]]=p[2].slice(0,MAX_VALUE);}
  calls.push({name:fn[1],arguments:args});
 }
 return calls;
}

/** What the model is offered. Descriptions are written for a small model: short and concrete. */
export const reminderModelTools:readonly ModelTool[]=Object.freeze<ModelTool[]>([
 {name:'set_reminder',description:'Remind the person about something at a later time.',parameters:{type:'object',properties:{
  text:{type:'string',description:'What to remind them about, e.g. "pick up the kids".'},
  minutes:{type:'number',description:'Minutes from now, for requests like "in 20 minutes". Leave out when a clock time is given.'},
  time:{type:'string',description:'Clock time, 24-hour "HH:MM", e.g. "16:30". Leave out when minutes is given.'},
  date:{type:'string',description:'"today", "tomorrow", a weekday name, or YYYY-MM-DD. Only with time.'}},required:['text']}},
 {name:'set_timer',description:'Start a countdown timer.',parameters:{type:'object',properties:{
  minutes:{type:'number',description:'Length in minutes.'},seconds:{type:'number',description:'Extra seconds, if any.'},
  label:{type:'string',description:'Optional short name, e.g. "pasta".'}},required:[]}},
 {name:'list_reminders',description:'Say which reminders and timers are coming up.',parameters:{type:'object',properties:{},required:[]}},
 {name:'cancel_reminder',description:'Cancel a reminder or timer.',parameters:{type:'object',properties:{
  which:{type:'string',description:'"last" for the most recent one, or words from the reminder, e.g. "kids".'}},required:['which']}}
]);

/** Offered only when long-term memory is enabled. */
export const memoryModelTools:readonly ModelTool[]=Object.freeze<ModelTool[]>([
 {name:'remember',description:'Save something the person explicitly asked you to remember about them, for future conversations.',parameters:{type:'object',properties:{
  fact:{type:'string',description:'The thing to remember, as a short statement, e.g. "Sam has soccer practice on Tuesdays".'}},required:['fact']}},
 {name:'forget',description:'Forget something you were asked to remember.',parameters:{type:'object',properties:{
  which:{type:'string',description:'"last" for the most recent, or words from it, e.g. "soccer".'}},required:['which']}}
]);

const PERSON='local_desktop';
const item={type:'object' as const,properties:{id:{type:'string' as const,maxLength:36},kind:{type:'string' as const,maxLength:8},text:{type:'string' as const,maxLength:200},dueAt:{type:'string' as const,maxLength:40}},required:['id','kind','text','dueAt'] as const};
const result=(r:Reminder)=>({id:r.id,kind:r.kind,text:r.text,dueAt:r.dueAt});
const capital=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1);
const words=(s:string)=>s.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(' ').filter(w=>w.length>2&&!['the','and','for','about','reminder','timer','remind','that','this','to'].includes(w));

/** Reminder tools behind the existing permission policy, dispatcher and action journal.
 * Writes are LOW_RISK_WRITE with an undo; only these tool ids are allow-listed, for the local desktop person.
 */
export function reminderTools(store:ReminderStore):ToolDefinition[]{
 const set:ToolDefinition={id:'reminders.set',version:1,risk:'LOW_RISK_WRITE',permissions:['reminders'],name:'Set a reminder or timer',description:'Stores a reminder or timer on this PC.',
  inputSchema:{type:'object',properties:{kind:{type:'string',maxLength:8},text:{type:'string',maxLength:200},dueAt:{type:'string',maxLength:40}},required:['kind','text','dueAt']},
  outputSchema:item,available:()=>true,
  execute:async inputs=>{const v=inputs as {kind:'reminder'|'timer';text:string;dueAt:string};if(!['reminder','timer'].includes(v.kind))throw new Error('Invalid kind');return result(store.add(v.kind,v.text,new Date(v.dueAt)));},
  verify:async(_inputs,out)=>{const v=out as {id:string;dueAt:string};const r=store.get(v.id);return !!r&&r.state==='PENDING'&&r.dueAt===v.dueAt;},
  rollbackReference:out=>(out as {id:string}).id,undo:async ref=>store.cancel(ref)};
 const cancel:ToolDefinition={id:'reminders.cancel',version:1,risk:'LOW_RISK_WRITE',permissions:['reminders'],name:'Cancel a reminder',description:'Cancels one pending reminder or timer.',
  inputSchema:{type:'object',properties:{id:{type:'string',maxLength:36}},required:['id']},outputSchema:item,available:()=>true,
  execute:async inputs=>{const id=(inputs as {id:string}).id,r=store.get(id);if(!r||!store.cancel(id))throw new Error('Not pending');return result(r);},
  verify:async(_i,out)=>store.get((out as {id:string}).id)?.state==='CANCELLED',
  rollbackReference:out=>(out as {id:string}).id,undo:async ref=>store.restore(ref)};
 const list:ToolDefinition={id:'reminders.list',version:1,risk:'SAFE',permissions:['reminders'],name:'List reminders',description:'Reads upcoming reminders and timers.',
  inputSchema:{type:'object',properties:{},required:[]},outputSchema:{type:'array',items:item,maxItems:20},available:()=>true,
  execute:async()=>store.pending(20).map(result),verify:async(_i,out)=>Array.isArray(out)};
 return [set,cancel,list];
}
/** Memory as reversible low-risk writes: remembering can be forgotten, forgetting can be restored. */
export function memoryTools(store:MemoryStore):ToolDefinition[]{
 const fact={type:'object' as const,properties:{id:{type:'string' as const,maxLength:36},text:{type:'string' as const,maxLength:200}},required:['id','text'] as const};
 const remember:ToolDefinition={id:'memory.remember',version:1,risk:'LOW_RISK_WRITE',permissions:['memory'],name:'Remember',description:'Saves something the person asked to be remembered.',
  inputSchema:{type:'object',properties:{text:{type:'string',maxLength:200},source:{type:'string',maxLength:8}},required:['text','source']},outputSchema:fact,available:()=>true,
  execute:async inputs=>{const v=inputs as {text:string;source:Memory['source']};const m=store.add(v.text,v.source);return {id:m.id,text:m.text};},
  verify:async(_i,out)=>store.get((out as {id:string}).id)?.state==='ACTIVE',rollbackReference:out=>(out as {id:string}).id,undo:async ref=>store.forget(ref)};
 const forget:ToolDefinition={id:'memory.forget',version:1,risk:'LOW_RISK_WRITE',permissions:['memory'],name:'Forget',description:'Forgets one remembered thing.',
  inputSchema:{type:'object',properties:{id:{type:'string',maxLength:36}},required:['id']},outputSchema:fact,available:()=>true,
  execute:async inputs=>{const m=store.get((inputs as {id:string}).id);if(!m||!store.forget(m.id))throw new Error('Not active');return {id:m.id,text:m.text};},
  verify:async(_i,out)=>store.get((out as {id:string}).id)?.state==='FORGOTTEN',rollbackReference:out=>(out as {id:string}).id,undo:async ref=>store.restore(ref)};
 return [remember,forget];
}

/** Offered when recall is available: searches what was remembered, project records and (if kept) past conversations. */
export const recallModelTool:ModelTool={name:'recall',description:'Search your memory of this person: things they told you, their project notes and past conversations. Use for "what did I say about…", "do you remember…", "when did we talk about…".',
 parameters:{type:'object',properties:{query:{type:'string',description:'What to look for, in a few words.'}},required:['query']}};
/** "Harmony, status" (always offered) and the Workspace Time Machine (offered with the desktop helper). */
export const statusModelTool:ModelTool={name:'status_report',description:'A quick overview when the person says "status" or asks how things stand; also when they ask why you are slow, or for a self-check or health check.',
 parameters:{type:'object',properties:{focus:{type:'string',description:'"speed" when they ask why you are slow or how fast you are, "network" when they ask who is on their Wi-Fi or about new devices, otherwise "".'}},required:['focus']}};
export const workspaceModelTool:ModelTool={name:'workspace',description:'"Save my place": remember the open apps, windows and project. "Put me back": reopen them, optionally from a time like "Tuesday night".',
 parameters:{type:'object',properties:{action:{type:'string',description:'"save" or "restore".'},when:{type:'string',description:'For restore: "" for the latest, or a time like "yesterday" or "Tuesday night".'}},required:['action','when']}};
export const researchModelTool:ModelTool={name:'research',description:'Background research: "start" to research now, "later" to save it for Spiral Time (done overnight by Claude), "spiral" when they say Spiral Time, "report" to read results, "cancel" to stop one, "jobs" for the remote job scout (topic "scout" to send it, "" for the leads).',
 parameters:{type:'object',properties:{action:{type:'string',description:'"start", "later", "spiral", "report", "cancel" or "jobs".'},topic:{type:'string',description:'What to research, or which research they mean ("" for the latest).'}},required:['action','topic']}};
export const skillsModelTool:ModelTool={name:'skills',description:'HARMONY\'s own skills: "list" when they ask what you can do or what skills you have; "enable" or "disable" a skill by name.',
 parameters:{type:'object',properties:{action:{type:'string',description:'"list", "enable" or "disable".'},name:{type:'string',description:'The skill, e.g. "computer control", "screen", "research"; "" for list.'}},required:['action','name']}};
export const modeModelTool:ModelTool={name:'set_mode',description:'Change HARMONY\'s mode: "focus" when they say lock in or focus, "ghost" to collapse the screen and stay quiet, "normal" to go back.',
 parameters:{type:'object',properties:{mode:{type:'string',description:'"focus", "ghost" or "normal".'}},required:['mode']}};
/** Offered on Windows while enabled in Settings. Looking happens only when asked; controls are limited and undoable. */
export const desktopModelTools={
 look:{name:'look_at_screen',description:'Look at the app window on the person\'s screen and read it. Only when they ask you to look at, read or check their screen or "this".',
  parameters:{type:'object',properties:{question:{type:'string',description:'What they want to know about the screen, in a few words.'}},required:['question']}},
 control:{name:'control_computer',description:'Open an app or website, switch to an open window, or control music and volume on this computer.',
  parameters:{type:'object',properties:{action:{type:'string',description:'"open_app", "open_website", "switch_to", "play_pause", "next_track", "previous_track", "volume_up", "volume_down" or "mute".'},
   target:{type:'string',description:'The app, website, search or window name; for volume a number of percent like "10"; otherwise "".'}},required:['action','target']}},
} as const satisfies Record<string,ModelTool>;
/** God's Eye View: a live 3D globe of public world data in its own window. HARMONY picks the data source itself. */
export const workModelTool:ModelTool={name:'work_log',description:'A maintenance work log: "new" job, "update" progress or notes, "ordered" a part, "arrived" parts, "done" finished, "list" open jobs ("waiting" for parts), "summary" of the day. place: unit or location.',
 parameters:{type:'object',properties:{action:{type:'string',description:'"new", "update", "ordered", "arrived", "done", "list", "waiting" or "summary".'},place:{type:'string',description:'Unit number or location, e.g. "214" or "boiler room"; "" if not said.'},
  text:{type:'string',description:'The job, what was done, or the part; "" if none.'},minutes:{type:'string',description:'Time spent in minutes, e.g. "40"; "" if not said.'},qty:{type:'string',description:'How many parts; "" if not said.'},vendor:{type:'string',description:'Where parts were ordered from; "" if not said.'}},required:['action','place','text','minutes','qty','vendor']}};
export const godsEyeModelTool:ModelTool={name:'gods_eye',description:'God\'s Eye: a live 3D globe of public world data (flights, ships, quakes, fires, storms, satellites, launches, military aircraft, traffic, cameras, GPS jamming). Use to open it, show something on it, start or stop ambient mode, or for what is happening somewhere now.',
 parameters:{type:'object',properties:{action:{type:'string',description:'"open" to open or show; "close"; "watch" to alert them about new events near the place ("" place lists what is watched); "unwatch" to stop.'},
  what:{type:'string',description:'What they want to see, e.g. "flights", "earthquakes", "the ISS", "fires", or "" to just open it.'},
  place:{type:'string',description:'A place name like "Chicago" or "Japan", or "" for none.'}},required:['action','what','place']}};
/** What the desktop app provides for God's Eye (its window and its local server). */
/** "ambient mode" / "living globe" / "screensaver" / "spin the globe" → true; "stop ambient (mode)" / "stop spinning" → false. */
export function ambientIntent(what:string):boolean|null{
 const q=what.toLowerCase();
 if(/\b(stop|end|exit|turn off|quit)\b.*\b(ambient|screensaver|living globe|spinning|rotating|turning)\b/.test(q))return false;
 if(/\b(ambient( mode)?|screen ?saver( mode)?|living globe|spin(ning)? the (globe|earth|world)|rotate the (globe|earth)|let the (globe|earth) (spin|turn))\b/.test(q))return true;
 return null;
}
/** "replay today's earthquakes", "play back the disasters", "time-lapse of volcano alerts": true. */
export const replayIntent=(what:string)=>/\b(replay|play (it |them )?back|playback|time ?-?lapse|walk me through|tour)\b/i.test(what);
const clock=(iso:string|null)=>{if(!iso)return '';const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}):'';};
export interface GodsEyeBridge {
 available():boolean;
 /** Ambient mode (the globe turning on a spare screen). Optional: older hosts don't have it. */
 ambient?(on:boolean):Promise<boolean>;
 /** Replay: tour events in time order on the globe. Optional. */
 replay?(stops:import('./gods-eye.ts').ReplayStop[],layers:string[]):Promise<void>;
 open(view:{layers:string[];place:string;view:import('./gods-eye.ts').GevView|null}):Promise<void>;
 close():Promise<boolean>;
 call(tool:string,args:Record<string,unknown>,signal:AbortSignal):Promise<import('./gods-eye.ts').GevAnswer>;
 /** GPS interference near a point (God's Eye View's GNSS-integrity endpoint). Optional. */
 gnss?(lat:number,lon:number,signal:AbortSignal):Promise<import('./gods-eye.ts').GnssSummary>;
}
/** Offered when web lookups are enabled: read-only, answered in a second pass from the fetched data. */
export const webModelTools:readonly ModelTool[]=Object.freeze<ModelTool[]>([
 {name:'get_weather',description:'Current weather and the next days\' forecast for a place.',parameters:{type:'object',properties:{
  place:{type:'string',description:'Town or city, e.g. "Madison, Wisconsin". Use where the person lives if they did not say.'}},required:['place']}},
 {name:'get_news',description:'Latest news headlines, optionally about a topic.',parameters:{type:'object',properties:{
  topic:{type:'string',description:'What the news should be about, or "" for top stories.'}},required:['topic']}},
 {name:'web_search',description:'Search the web for current facts, scores, prices, events or anything you are unsure of.',parameters:{type:'object',properties:{
  query:{type:'string',description:'A short search query.'}},required:['query']}}
]);
/** Offered only while that Google permission is connected. Read-only; answered in the action-free second pass. */
export const googleModelTools={
 calendar:{name:'calendar_events',description:"Events on the person's Google Calendar.",parameters:{type:'object',properties:{
  when:{type:'string',description:'"today", "tomorrow", "this week", "next week", a weekday, "next 3 days" or a date like 2026-10-23.'}},required:['when']}},
 gmail:{name:'check_email',description:"Search the person's Gmail (read only). Returns sender, subject and a short preview.",parameters:{type:'object',properties:{
  query:{type:'string',description:'Gmail search, e.g. "is:unread newer_than:1d" or "from:landlord rent". Use "is:unread newer_than:2d" for new mail.'}},required:['query']}},
} as const satisfies Record<string,ModelTool>;
/** Project engine: switch or start a project, note work, and "Where was I?". */
export const projectModelTools:readonly ModelTool[]=Object.freeze<ModelTool[]>([
 {name:'switch_project',description:'Switch to one of the person\'s projects, or start a new one when they say "new" or "start".',parameters:{type:'object',properties:{
  name:{type:'string',description:'Project name, e.g. "Eden\'s Gate".'},new:{type:'string',description:'"yes" only if they asked to start a new project, otherwise "no".'}},required:['name','new']}},
 {name:'project_note',description:'Record work on the current project: a task to do, a decision made, a blocker, a general note, or "done" when they finished a task.',parameters:{type:'object',properties:{
  kind:{type:'string',description:'"task", "decision", "blocker", "note", "idea" (when they say "idea: …") or "done".'},text:{type:'string',description:'The task, decision, blocker or note in a few words; for "done", which task.'}},required:['kind','text']}},
 {name:'where_was_i',description:'Summarise where the person left off: last project, open tasks, latest decision, unresolved blocker.',parameters:{type:'object',properties:{
  project:{type:'string',description:'A project name, or "" for the most recent.'}},required:['project']}},
]);
export const LOOKUP_FUNCTIONS=new Set(['gods_eye','research','skills',...webModelTools.map(t=>t.name),googleModelTools.calendar.name,googleModelTools.gmail.name,'where_was_i','recall','look_at_screen','status_report']);
const ID={type:'string' as const,maxLength:100};
/** Desktop: looking is a SAFE read (nothing changes); each control is a LOW_RISK_WRITE with a real undo where one exists. */
export function desktopTools(desktop:Desktop,projects:ProjectStore|null,now:()=>Date):ToolDefinition[]{
 const out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:100},name:{type:'string' as const,maxLength:300}},required:['id','name'] as const};
 const look=lookupTool('screen.look','Look at the screen','question','screen',async v=>{
  const r=await desktop.look();
  return {kind:'local',query:'screen',retrievedAt:now().toISOString(),text:screenReport(r,v,projects?.all().map(p=>p.name)??[],now()),sources:[]};
 });
 const write=(id:string,name:string,description:string,input:Record<string,{type:'string';maxLength:number}>,execute:(i:Record<string,string>)=>Promise<{id:string;name:string}>,undo:(ref:string)=>Promise<boolean>):ToolDefinition=>({
  id,version:1,risk:'LOW_RISK_WRITE',permissions:['computer'],name,description,inputSchema:{type:'object',properties:input,required:Object.keys(input)},outputSchema:out,available:()=>desktop.canControl,
  execute:async i=>execute(i as Record<string,string>),verify:async(_i,o)=>typeof (o as {id:string}).id==='string',rollbackReference:o=>(o as {id:string}).id,undo:async ref=>{try{return await undo(ref);}catch{return false;}}});
 const nums=(ref:string)=>ref.split('.').slice(1).map(Number).filter(n=>Number.isSafeInteger(n)&&n>0);
 return [look,
  // Undo closes exactly the windows this launch opened (the app may ask to save first). An app that was already open opened nothing new.
  write('computer.open_app','Open app','Starts an app from the Start menu.',{appId:{type:'string',maxLength:400},name:{type:'string',maxLength:120}},
   async i=>{const r=await desktop.launch({id:i.appId,name:i.name});return {id:`w.${r.windows.join('.')||'none'}`,name:r.name};},
   async ref=>{const w=nums(ref);return w.length>0&&await desktop.close(w)>0;}),
  // A page opened in the browser can't be closed safely from here, so this undo honestly reports that it did nothing.
  write('computer.open_url','Open website','Opens a web address in the default browser.',{url:{type:'string',maxLength:2000}},
   async i=>{await desktop.openUrl(i.url);return {id:'url',name:new URL(i.url).hostname};},async()=>false),
  write('computer.focus','Switch window','Brings an open window to the front.',{hwnd:{type:'string',maxLength:20}},
   async i=>{const h=Number(i.hwnd);if(!Number.isSafeInteger(h)||h<=0)throw new DesktopError('No such window.');const r=await desktop.focus(h);if(!r.ok)throw new DesktopError("Windows wouldn't switch to it.");return {id:`f.${r.previous??0}`,name:String(h)};},
   async ref=>{const [p]=nums(ref);return !!p&&(await desktop.focus(p)).ok;}),
  write('computer.media','Media key','Presses a media or volume key.',{key:{type:'string',maxLength:20},times:{type:'string',maxLength:2}},
   async i=>{const k=i.key as MediaKey,t=Number(i.times);await desktop.key(k,t);return {id:`k.${k}.${t}`,name:k};},
   async ref=>{const [,k,t]=ref.split('.');const back:Record<string,MediaKey>={volume_up:'volume_down',volume_down:'volume_up',mute:'mute',play_pause:'play_pause',next:'previous',previous:'next'};
    if(!back[k])return false;await desktop.key(back[k],Number(t)||1);return true;})];
}
/** Saving a workspace is a reversible write (undo deletes the snapshot); the status overview is a SAFE read. */
export function workspaceTools(store:WorkspaceStore,desktop:Desktop):ToolDefinition[]{
 const save:ToolDefinition={id:'workspace.save',version:1,risk:'LOW_RISK_WRITE',permissions:['workspace'],name:'Save my place',description:'Records the open apps, windows and project.',
  inputSchema:{type:'object',properties:{label:{type:'string',maxLength:80}},required:['label']},outputSchema:{type:'object',properties:{id:{type:'string',maxLength:36},name:{type:'string',maxLength:300}},required:['id','name']},available:()=>desktop.available,
  execute:async i=>{const snap=store.save(await desktop.windows(),await desktop.apps(),(i as {label:string}).label);return {id:snap.id,name:`${snap.windows.length}`};},
  verify:async(_i,o)=>!!store.get((o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>store.remove(ref)};
 return [save];
}
/** Missions: starting and cancelling are reversible writes (undo cancels, or puts it back in the queue); reading is SAFE. */
export function missionTools(store:MissionStore,projects:ProjectStore|null,now:()=>Date):ToolDefinition[]{
 const out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:100},name:{type:'string' as const,maxLength:400}},required:['id','name'] as const};
 return [
  {id:'missions.start',version:1,risk:'LOW_RISK_WRITE',permissions:['missions'],name:'Start research',description:'Queues a background research mission (read-only lookups).',
   inputSchema:{type:'object',properties:{objective:{type:'string',maxLength:300}},required:['objective']},outputSchema:out,available:()=>true,
   execute:async i=>{const m=store.create((i as {objective:string}).objective,projects?.activeId()??null);return {id:m.id,name:m.objective};},
   verify:async(_i,o)=>!!store.get((o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>store.cancel(ref)},
  {id:'missions.cancel',version:1,risk:'LOW_RISK_WRITE',permissions:['missions'],name:'Cancel research',description:'Cancels a research mission (it keeps its progress).',
   inputSchema:{type:'object',properties:{id:{type:'string',maxLength:36}},required:['id']},outputSchema:out,available:()=>true,
   execute:async i=>{const id=(i as {id:string}).id;if(!store.cancel(id))throw new Error('Not active');return {id,name:store.get(id)!.objective};},
   verify:async(_i,o)=>store.get((o as {id:string}).id)?.status==='CANCELLED',rollbackReference:o=>(o as {id:string}).id,undo:async ref=>store.requeue(ref)},
  lookupTool('missions.report','Research report','topic','missions',async v=>{
   const m=store.find(v);
   if(!m)return {kind:'local',query:'research',retrievedAt:now().toISOString(),text:'There is no research yet. (Say they can ask you to research something.)',sources:[]};
   const sources=m.state.evidence.slice(0,8).map(e=>({title:e.title,url:e.url,site:e.site}));
   if(m.status!=='DONE'&&m.status!=='FAILED')return {kind:'local',query:'research',retrievedAt:now().toISOString(),text:`Research "${m.objective}" is still in progress: ${m.stage}; ${m.used} of ${m.budget} lookups used.`,sources:[]};
   if(m.status==='DONE'||m.report){m.heard=true;store.save(m);}
   return {kind:'local',query:'research',retrievedAt:now().toISOString(),text:`HARMONY's research on "${m.objective}" (${m.status==='DONE'?'finished':'incomplete'}):\n${(m.report??'').replace(/\n\nSources:[\s\S]*$/,'').slice(0,1800)}${m.state.problems.length?`\nNotes: ${m.state.problems.slice(0,2).join(' ')}`:''}\n(Read the summary out naturally and briefly; no web addresses.)`,sources};
  })];
}
/** Turning a skill on or off is a reversible write (undo restores what it was); listing is SAFE. */
export function skillTools(skills:SkillRegistry,now:()=>Date):ToolDefinition[]{
 return [{id:'skills.set',version:1,risk:'LOW_RISK_WRITE',permissions:['skills'],name:'Turn a skill on or off',description:'Enables or disables one skill.',
  inputSchema:{type:'object',properties:{id:{type:'string',maxLength:40},on:{type:'string',maxLength:5}},required:['id','on']},outputSchema:{type:'object',properties:{id:{type:'string',maxLength:60},name:{type:'string',maxLength:100}},required:['id','name']},available:()=>true,
  execute:async i=>{const v=i as {id:string;on:string};const before=skills.set(v.id,v.on==='true');return {id:`${v.id}.${before?'on':'off'}`,name:v.id};},
  verify:async(i)=>skills.enabled((i as {id:string}).id)===((i as {on:string}).on==='true')||(i as {on:string}).on==='true',rollbackReference:o=>(o as {id:string}).id,
  undo:async ref=>{const [id,was]=ref.split('.');try{skills.set(id,was==='on');return true;}catch{return false;}}},
  lookupTool('skills.list','Skills','topic','skills',async()=>({kind:'local',query:'skills',retrievedAt:now().toISOString(),sources:[],
   text:`HARMONY's skills:\n${skills.list().map(s=>`- ${s.name}: ${s.status==='ENABLED'?'on':s.status==='DISABLED'?'off':'not available (not set up or not connected)'} — ${s.description}`).join('\n')}\n(Summarise briefly: what's on, and anything off or not set up.)`}))];
}
/** Modes and ideas as reversible writes: undo restores the previous mode or deletes the idea. */
export function modeTools(modes:ModeStore|null,ideas:IdeaStore|null):ToolDefinition[]{
 const out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:100},name:{type:'string' as const,maxLength:400}},required:['id','name'] as const};
 const tools:ToolDefinition[]=[];
 if(modes)tools.push({id:'mode.set',version:1,risk:'LOW_RISK_WRITE',permissions:['modes'],name:'Set mode',description:'Switches between normal, focus and ghost.',
  inputSchema:{type:'object',properties:{mode:{type:'string',maxLength:10}},required:['mode']},outputSchema:out,available:()=>true,
  execute:async i=>{const r=modes.set((i as {mode:HarmonyMode}).mode);return {id:r.previous,name:r.minutes===null?'':String(r.minutes)};},
  verify:async(i)=>modes.status().mode===(i as {mode:string}).mode,rollbackReference:o=>(o as {id:string}).id,undo:async ref=>{if(!MODES.includes(ref as HarmonyMode))return false;modes.set(ref as HarmonyMode);return true;}});
 if(ideas)tools.push({id:'ideas.add',version:1,risk:'LOW_RISK_WRITE',permissions:['ideas'],name:'Capture idea',description:'Saves an idea.',
  inputSchema:{type:'object',properties:{text:{type:'string',maxLength:400},projectId:{type:'string',maxLength:40}},required:['text','projectId']},outputSchema:out,available:()=>true,
  execute:async i=>{const v=i as {text:string;projectId:string};const idea=ideas.add(v.text,v.projectId||null);return {id:idea.id,name:idea.text};},
  verify:async(_i,o)=>!!ideas.get((o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>ideas.remove(ref)});
 return tools;
}
/** Memory search as a SAFE (read-only) tool. */
export function recallTools(recall:Recall):ToolDefinition[]{
 return [lookupTool('memory.recall','Recall','query','memory',async(v,signal)=>({kind:'local',query:v.slice(0,200),retrievedAt:new Date().toISOString(),text:await recall.report(v,signal),sources:[]}))];
}
/** Project writes as reversible LOW_RISK_WRITE tools (each can be undone); the summary is a SAFE read. */
export function projectTools(store:ProjectStore):ToolDefinition[]{
 const out={type:'object' as const,properties:{id:ID,name:{type:'string' as const,maxLength:300}},required:['id','name'] as const};
 const create:ToolDefinition={id:'projects.create',version:1,risk:'LOW_RISK_WRITE',permissions:['projects'],name:'Start project',description:'Creates and switches to a new project.',
  inputSchema:{type:'object',properties:{name:{type:'string',maxLength:60}},required:['name']},outputSchema:out,available:()=>true,
  execute:async i=>{const before=store.activeId();const p=store.create((i as {name:string}).name);return {id:`${p.id}.${before??'none'}`,name:p.name};},
  verify:async(_i,o)=>!!store.get(String((o as {id:string}).id).split('.')[0]),rollbackReference:o=>(o as {id:string}).id,
  undo:async ref=>{const [id,before]=ref.split('.');const ok=store.remove(id);if(before&&before!=='none'&&store.get(before))store.switchTo(before);return ok;}};
 const sw:ToolDefinition={id:'projects.switch',version:1,risk:'LOW_RISK_WRITE',permissions:['projects'],name:'Switch project',description:'Makes a project the current one.',
  inputSchema:{type:'object',properties:{id:ID},required:['id']},outputSchema:out,available:()=>true,
  execute:async i=>{const id=(i as {id:string}).id;const before=store.switchTo(id);return {id:`${id}.${before??'none'}`,name:store.get(id)!.name};},
  verify:async(_i,o)=>store.activeId()===String((o as {id:string}).id).split('.')[0],rollbackReference:o=>(o as {id:string}).id,
  undo:async ref=>{const before=ref.split('.')[1];store.switchTo(before&&before!=='none'&&store.get(before)?before:null);return true;}};
 const add:ToolDefinition={id:'projects.note',version:1,risk:'LOW_RISK_WRITE',permissions:['projects'],name:'Project note',description:'Adds a task, decision, blocker or note to a project.',
  inputSchema:{type:'object',properties:{projectId:ID,kind:{type:'string',maxLength:10},text:{type:'string',maxLength:240}},required:['projectId','kind','text']},outputSchema:out,available:()=>true,
  execute:async i=>{const v=i as {projectId:string;kind:NoteKind;text:string};const n=store.addNote(v.projectId,v.kind,v.text);return {id:n.id,name:n.text};},
  verify:async(_i,o)=>!!store.getNote((o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>store.removeNote(ref)};
 const close:ToolDefinition={id:'projects.close',version:1,risk:'LOW_RISK_WRITE',permissions:['projects'],name:'Finish task',description:'Marks a task or blocker as done.',
  inputSchema:{type:'object',properties:{id:ID},required:['id']},outputSchema:out,available:()=>true,
  execute:async i=>{const n=store.getNote((i as {id:string}).id);if(!n||!n.open||!store.setOpen(n.id,false))throw new Error('Not open');return {id:n.id,name:n.text};},
  verify:async(_i,o)=>store.getNote((o as {id:string}).id)?.open===false,rollbackReference:o=>(o as {id:string}).id,undo:async ref=>store.setOpen(ref,true)};
 const where=lookupTool('projects.summary','Where was I','project','projects',async v=>{
  const p=v.trim()?store.find(v):null;
  if(v.trim()&&!p)throw new WebError(`I don't have a project called ${v.trim().slice(0,60)}.`);
  return {kind:'local',query:'where was I',retrievedAt:new Date().toISOString(),text:`HARMONY's project records:\n${store.whereWasI(p?.id)}`,sources:[]};
 });
 return [create,sw,add,close,where];
}
const source={type:'object' as const,properties:{title:{type:'string' as const,maxLength:300},url:{type:'string' as const,maxLength:2000},site:{type:'string' as const,maxLength:200},published:{type:'string' as const,maxLength:100}},required:['title','url','site'] as const};
const webOut={type:'object' as const,properties:{kind:{type:'string' as const,maxLength:10},query:{type:'string' as const,maxLength:200},retrievedAt:{type:'string' as const,maxLength:40},
 text:{type:'string' as const,maxLength:6000},sources:{type:'array' as const,items:source,maxItems:8}},required:['kind','query','retrievedAt','text','sources'] as const};
/** Web lookups as SAFE (read-only) tools: they change nothing on this computer. */
export function webTools(web:WebLookup):ToolDefinition[]{
 return [lookupTool('web.weather','Weather','place','web',(v,s)=>web.weather(v,s)),lookupTool('web.news','News','topic','web',(v,s)=>web.news(v,s)),lookupTool('web.search','Web search','query','web',(v,s)=>web.search(v,s)),
  lookupTool('web.read','Read web page','url','web',(v,s)=>web.read(v,s),2000)];
}
/** Spec names: calendar.list and gmail.search. Read-only (SAFE); drafting and sending come later, approval-gated. */
export function googleTools(google:GoogleAccount,now:()=>Date,triage?:(signal:AbortSignal)=>Promise<string>):ToolDefinition[]{
 // "triage" is the inbox brief (step 18): what needs you, what's FYI, and today's calendar.
 return [lookupTool('calendar.list','Calendar','when','google',(v,s)=>google.calendar(calendarRange(v,now()),s)),lookupTool('gmail.search','Gmail search','query','google',async(v,s)=>v==='triage'&&triage?{kind:'local',query:'inbox brief',retrievedAt:now().toISOString(),text:await triage(s),sources:[{title:'Gmail',url:'https://mail.google.com/',site:'Gmail'}]}:google.mail(v,s))];
}
function lookupTool(id:string,name:string,field:string,permission:string,run:(v:string,signal:AbortSignal)=>Promise<WebResult>,maxLength=200):ToolDefinition{
 const def=(id:string,name:string,field:string,run:(v:string,signal:AbortSignal)=>Promise<WebResult>):ToolDefinition=>({id,version:1,risk:'SAFE',permissions:[permission],name,description:`${name}, read only.`,
  inputSchema:{type:'object',properties:{[field]:{type:'string',maxLength}},required:[field]},outputSchema:webOut,available:()=>true,
  execute:async(inputs,ctx)=>{
   const value=String((inputs as Record<string,string>)[field]);
   try{const r=await run(value,ctx.signal);return {...r,text:r.text.slice(0,6000),sources:r.sources.slice(0,8)};}
   catch(e){
    // Expected failures (no such place, search blocked, offline) become the result, so the answer can explain them.
    if(e instanceof WebError||e instanceof GoogleError||e instanceof DesktopError)return {kind:id==='web.weather'?'weather':id==='web.news'?'news':id.startsWith('web.')?'search':'local',query:value.slice(0,200),retrievedAt:new Date().toISOString(),text:`Lookup failed: ${e.message}`,sources:[]};
    throw e;
   }},
  verify:async(_i,out)=>typeof (out as WebResult).text==='string'});
 return def(id,name,field,run);
}

export interface ActionsOutcome {spoken:string;report:string;changed:boolean;
 /** Present when the model asked to look something up: data for a second, action-free answering pass. */
 lookup?:{report:string;sources:WebSource[]};}

/** Runs the model's requested reminder actions and produces fixed, honest confirmations to speak. */
export class AssistantActions {
 #bus=new ApplicationEventBus();#registry=new ToolRegistry();#dispatcher:ToolDispatcher;#journal:ActionJournal;
 private store:ReminderStore;private changed:()=>void;private now:()=>Date;private memory:MemoryStore|null;private web:WebLookup|null;private db:DatabaseSync;private google:GoogleAccount|null;private projects:ProjectStore|null;private recall:Recall|null;private desktop:Desktop|null;private workspace:WorkspaceStore|null;private modes:ModeStore|null;private ideas:IdeaStore|null;private missions:MissionStore|null;private skills:SkillRegistry|null;private more:{personality?:Personality|null;eggs?:EasterEggs|null;onFlourish?:(kind:string)=>void;diagnostics?:()=>string;guard?:ActionGuard|null;godsEye?:GodsEyeBridge|null;world?:WorldFeeds|null;watch?:import('./watch-zones.ts').WatchZones|null;spiral?:import('./spiral-time.ts').SpiralTime|null;update?:{status():import('./updater.ts').UpdateStatus;apply():Promise<string>;undo():Promise<string>}|null;work?:import('./worklog.ts').WorkLog|null;inbox?:{brief(signal:AbortSignal):Promise<string>}|null;drills?:{run():Promise<string>}|null;offline?:{online():boolean;failed():void}|null;jobs?:import('./job-scout.ts').JobScout|null;network?:{spoken():string;scan():Promise<void>}|null;routines?:import('./routines.ts').RoutineStore|null;dailyBrief?:{spoken():string}|null;metro?:import('./metro.ts').MadisonMetro|null};#contextIds=new Set<string>();
 constructor(store:ReminderStore,db:DatabaseSync,changed:()=>void=()=>{},now:()=>Date=()=>new Date(),memory:MemoryStore|null=null,web:WebLookup|null=null,google:GoogleAccount|null=null,projects:ProjectStore|null=null,recall:Recall|null=null,desktop:Desktop|null=null,workspace:WorkspaceStore|null=null,more:{modes?:ModeStore|null;ideas?:IdeaStore|null;missions?:MissionStore|null;skills?:SkillRegistry|null;personality?:Personality|null;eggs?:EasterEggs|null;onFlourish?:(kind:string)=>void;diagnostics?:()=>string;guard?:ActionGuard|null;godsEye?:GodsEyeBridge|null;world?:WorldFeeds|null;watch?:import('./watch-zones.ts').WatchZones|null;spiral?:import('./spiral-time.ts').SpiralTime|null;update?:{status():import('./updater.ts').UpdateStatus;apply():Promise<string>;undo():Promise<string>}|null;work?:import('./worklog.ts').WorkLog|null;inbox?:{brief(signal:AbortSignal):Promise<string>}|null;drills?:{run():Promise<string>}|null;offline?:{online():boolean;failed():void}|null;jobs?:import('./job-scout.ts').JobScout|null;network?:{spoken():string;scan():Promise<void>}|null;routines?:import('./routines.ts').RoutineStore|null;dailyBrief?:{spoken():string}|null;metro?:import('./metro.ts').MadisonMetro|null}={}){
  this.store=store;this.changed=changed;this.now=now;this.memory=memory;this.web=web;this.db=db;this.google=google;this.projects=projects;this.recall=memory?recall:null;this.desktop=desktop;this.workspace=desktop?workspace:null;this.modes=more.modes??null;this.ideas=more.ideas??null;this.missions=web?more.missions??null:null;this.skills=more.skills??null;this.more=more;
  if(this.skills)for(const tool of skillTools(this.skills,now))this.#registry.register(tool);
  if(this.missions)for(const tool of missionTools(this.missions,projects,now))this.#registry.register(tool);
  for(const tool of modeTools(this.modes,this.ideas))this.#registry.register(tool);
  if(desktop)for(const tool of desktopTools(desktop,projects,now))this.#registry.register(tool);
  if(this.workspace)for(const tool of workspaceTools(this.workspace,desktop!))this.#registry.register(tool);
  if(more.watch){
   const w=more.watch,removed=new Map<string,import('./watch-zones.ts').WatchZone>();
   const out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:100},name:{type:'string' as const,maxLength:100}},required:['id','name'] as const};
   this.#registry.register({id:'watch.add',version:1,risk:'LOW_RISK_WRITE',permissions:['watch'],name:'Watch an area',description:'Alerts about new events near a place.',
    inputSchema:{type:'object',properties:{name:{type:'string',maxLength:100},lat:{type:'number'},lon:{type:'number'}},required:['name','lat','lon']},outputSchema:out,available:()=>true,
    execute:async i=>{const v=i as {name:string;lat:number;lon:number};const z=w.add(v.name,v.lat,v.lon);return {id:z.id,name:z.name};},verify:async(_i,o)=>w.list().some(z=>z.id===(o as {id:string}).id),
    rollbackReference:o=>(o as {id:string}).id,undo:async ref=>w.remove(ref)});
   this.#registry.register({id:'watch.remove',version:1,risk:'LOW_RISK_WRITE',permissions:['watch'],name:'Stop watching',description:'Stops watching an area.',
    inputSchema:{type:'object',properties:{name:{type:'string',maxLength:100}},required:['name']},outputSchema:out,available:()=>true,
    execute:async i=>{const q=(i as {name:string}).name.toLowerCase();const z=w.list().find(x=>x.name.toLowerCase()===q||x.name.toLowerCase().startsWith(q));if(!z||!w.remove(z.id))throw new ReminderInputError(`I'm not watching ${(i as {name:string}).name.slice(0,60)}.`);removed.set(z.id,z);return {id:z.id,name:z.name};},
    verify:async(_i,o)=>!w.list().some(z=>z.id===(o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>{const z=removed.get(ref);if(!z)return false;w.add(z.name,z.lat,z.lon,z.radiusKm);return true;}});
  }
  if(more.update){
   const up=more.update,out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:100},name:{type:'string' as const,maxLength:400}},required:['id','name'] as const};
   // Changing HARMONY's own code: the owner only (it's an action), approved like a security change inside apply().
   this.#registry.register({id:'system.update',version:1,risk:'LOW_RISK_WRITE',permissions:['status'],name:'Update HARMONY',description:'Builds and restarts into the newest version in HARMONY\'s folder.',
    inputSchema:{type:'object',properties:{},required:[]},outputSchema:out,available:()=>true,
    execute:async()=>({id:up.status().head??'none',name:await up.apply()}),verify:async()=>true,rollbackReference:o=>(o as {id:string}).id,undo:async()=>{await up.undo();return true;}});
   this.#registry.register({id:'system.rollback',version:1,risk:'LOW_RISK_WRITE',permissions:['status'],name:'Undo the update',description:'Goes back to the previous version on restart.',
    inputSchema:{type:'object',properties:{},required:[]},outputSchema:out,available:()=>true,
    execute:async()=>({id:'rollback',name:await up.undo()}),verify:async()=>true,rollbackReference:()=>'rollback',undo:async()=>false});
  }
  if(more.work){
   const w=more.work,out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:200},name:{type:'string' as const,maxLength:400}},required:['id','name'] as const};
   const str={type:'string' as const,maxLength:300},num={type:'number' as const};
   const write=(id:string,name:string,props:Record<string,unknown>,run:(i:Record<string,unknown>)=>string)=>this.#registry.register({id,version:1,risk:'LOW_RISK_WRITE',permissions:['work'],name,description:name,
    inputSchema:{type:'object',properties:props as never,required:Object.keys(props)},outputSchema:out,available:()=>true,
    execute:async i=>{const name=run(i as Record<string,unknown>);return {id:w.lastRef,name};},verify:async()=>true,rollbackReference:o=>(o as {id:string}).id,undo:async ref=>w.revert(ref)});
   const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0?Math.round(v):null,t=(v:unknown)=>String(v??'');
   write('work.add','New work job',{place:str,text:str},i=>{const r=w.add(t(i.place),t(i.text));return `${r.existing?'existing:':''}${r.job.place}|${r.job.title}`;});
   write('work.update','Log work progress',{place:str,text:str,minutes:num},i=>{const j=w.progress(t(i.place),t(i.text),n(i.minutes));return `${j.place}|${j.title}`;});
   write('work.order','Part ordered',{place:str,text:str,qty:num,vendor:str},i=>{const j=w.ordered(t(i.place),t(i.text),n(i.qty),t(i.vendor)||null);return `${j.place}|${j.title}`;});
   write('work.arrive','Parts arrived',{place:str,text:str},i=>{const r=w.arrived(t(i.place),t(i.text));return `${r.job.place}|${r.job.title}|${r.parts.join(', ')}|${r.job.status}`;});
   write('work.done','Job done',{place:str,text:str,minutes:num},i=>{const j=w.done(t(i.place),t(i.text),n(i.minutes));return `${j.place}|${j.title}`;});
   this.#registry.register(lookupTool('work.report','Work log','topic','work',async v=>({kind:'local',query:'work',retrievedAt:now().toISOString(),text:v==='summary'?w.summary():w.listText(v==='waiting'),sources:[]})));
  }
  if(more.spiral&&this.missions){
   const sp=more.spiral,ms=this.missions;
   const out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:100},name:{type:'string' as const,maxLength:400}},required:['id','name'] as const};
   this.#registry.register({id:'spiral.start',version:1,risk:'LOW_RISK_WRITE',permissions:['missions'],name:'Spiral Time',description:'Hands the night\'s background jobs to Claude (a ticket in the handoff folder).',
    inputSchema:{type:'object',properties:{},required:[]},outputSchema:out,available:()=>true,
    execute:async()=>{const r=sp.start();return {id:r.ticket.id,name:`${r.already?'already:':''}${r.ticket.jobs.map(j=>j.kind).join(',')}`};},
    verify:async(_i,o)=>existsSync(sp.ticketPath)&&(o as {id:string}).id.startsWith('t-'),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>sp.cancel(ref)});
   this.#registry.register({id:'spiral.add',version:1,risk:'LOW_RISK_WRITE',permissions:['missions'],name:'Save for Spiral Time',description:'Saves a research job for the next Spiral Time.',
    inputSchema:{type:'object',properties:{objective:{type:'string',maxLength:300}},required:['objective']},outputSchema:out,available:()=>true,
    execute:async i=>{const m=ms.create((i as {objective:string}).objective,projects?.activeId()??null,1,24*7,true);return {id:m.id,name:m.objective};},
    verify:async(_i,o)=>!!ms.get((o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>ms.cancel(ref)});
  }
  if(more.jobs&&more.spiral&&this.missions){
   const js=more.jobs;
   this.#registry.register({id:'jobs.scout',version:1,risk:'LOW_RISK_WRITE',permissions:['missions'],name:'Job scout',description:'Sets the remote job scout for the next Spiral Time.',
    inputSchema:{type:'object',properties:{},required:[]},outputSchema:{type:'object',properties:{id:{type:'string',maxLength:100},name:{type:'string',maxLength:100}},required:['id','name']},available:()=>true,
    execute:async()=>{const was=js.wanted();js.want(true);return {id:was?'scout.was':'scout.new',name:'scout'};},
    verify:async()=>js.wanted(),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>{if(ref==='scout.new')js.want(false);return true;}});
   this.#registry.register(lookupTool('jobs.report','Job leads','topic','missions',async()=>{js.markHeard();return {kind:'local',query:'job leads',retrievedAt:now().toISOString(),text:`${js.spoken()}\n(From HARMONY's remote job scout. Read it naturally; don't read out web addresses.)`,sources:[]};}));
  }
  if(more.routines&&more.skills){
   const rs=more.routines,removed=new Map<string,Routine>();
   const out={type:'object' as const,properties:{id:{type:'string' as const,maxLength:100},name:{type:'string' as const,maxLength:100}},required:['id','name'] as const};
   this.#registry.register({id:'skills.teach',version:1,risk:'LOW_RISK_WRITE',permissions:['skills'],name:'Teach a skill',description:'Saves a taught routine as a draft (it runs only after the owner approves it on the screen).',
    inputSchema:{type:'object',properties:{phrase:{type:'string',maxLength:80},description:{type:'string',maxLength:700}},required:['phrase','description']},outputSchema:out,available:()=>true,
    execute:async i=>{const v=i as {phrase:string;description:string};const r=rs.add(draftRoutine(v.phrase,v.description,t=>this.shortcut(t)));return {id:r.id,name:r.phrase.slice(0,100)};},
    verify:async(_i,o)=>!!rs.get((o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>rs.remove(ref)});
   this.#registry.register({id:'skills.forget',version:1,risk:'LOW_RISK_WRITE',permissions:['skills'],name:'Forget a taught skill',description:'Removes a taught routine.',
    inputSchema:{type:'object',properties:{id:{type:'string',maxLength:40}},required:['id']},outputSchema:out,available:()=>true,
    execute:async i=>{const r=rs.get((i as {id:string}).id);if(!r||!rs.remove(r.id))throw new ReminderInputError('I don\'t have that skill.');removed.set(r.id,r);return {id:r.id,name:r.phrase.slice(0,100)};},
    verify:async(_i,o)=>!rs.get((o as {id:string}).id),rollbackReference:o=>(o as {id:string}).id,undo:async ref=>{const r=removed.get(ref);if(!r)return false;rs.restore(r);return true;}});
  }
  if(more.godsEye){
   const ge=more.godsEye;
   this.#registry.register({id:'godseye.ask',version:1,risk:'SAFE',permissions:['godseye'],name:"God's Eye",description:"Asks God's Eye View (public live data) and shows the answer on its globe.",
    inputSchema:{type:'object',properties:{what:{type:'string',maxLength:200},place:{type:'string',maxLength:120}},required:['what','place']},outputSchema:webOut,available:()=>true,
    execute:async(inputs,ctx)=>this.#godsEye(ge,(inputs as {what:string}).what,(inputs as {place:string}).place,ctx.signal),
    verify:async(_i,out)=>typeof (out as WebResult).text==='string'});
  }
  this.#registry.register(lookupTool('status.report','Status','topic','status',async()=>({kind:'local',query:'status',retrievedAt:now().toISOString(),text:await this.#statusText(),sources:[]})));
  if(this.recall)for(const tool of recallTools(this.recall))this.#registry.register(tool);
  if(projects)for(const tool of projectTools(projects))this.#registry.register(tool);
  if(web)for(const tool of webTools(web))this.#registry.register(tool);
  if(google)for(const tool of googleTools(google,now,more.inbox?.brief))this.#registry.register(tool);
  for(const tool of reminderTools(store))this.#registry.register(tool);
  if(memory)for(const tool of memoryTools(memory))this.#registry.register(tool);
  const policy=new PermissionPolicy(this.#registry.policies(),[{id:PERSON,permissions:['reminders',...(memory?['memory']:[]),...(web?['web']:[]),...(google?['google']:[]),...(projects?['projects']:[]),...(desktop?['screen','computer']:[]),'status',...(desktop&&workspace?['workspace']:[]),...(more.modes?['modes']:[]),...(more.ideas?['ideas']:[]),...(web&&more.missions?['missions']:[]),...(more.skills?['skills']:[]),...(more.godsEye?['godseye']:[]),...(more.watch?['watch']:[]),...(more.work?['work']:[])]}],{denyTools:[],lowRiskWriteTools:['reminders.set','reminders.cancel',...(memory?['memory.remember','memory.forget']:[]),...(projects?['projects.create','projects.switch','projects.note','projects.close']:[]),...(desktop?['computer.open_app','computer.open_url','computer.focus','computer.media']:[]),...(desktop&&workspace?['workspace.save']:[]),...(more.modes?['mode.set']:[]),...(more.ideas?['ideas.add']:[]),...(web&&more.missions?['missions.start','missions.cancel']:[]),...(more.skills?['skills.set']:[]),...(more.skills&&more.routines?['skills.teach','skills.forget']:[]),...(more.watch?['watch.add','watch.remove']:[]),...(more.spiral&&more.missions?['spiral.start','spiral.add']:[]),...(more.jobs&&more.spiral&&more.missions?['jobs.scout']:[]),...(more.update?['system.update','system.rollback']:[]),...(more.work?['work.add','work.update','work.order','work.arrive','work.done']:[])]});
  const authority={isCurrent:(t:TurnContext)=>this.#bus.isCurrent(t),identifies:(person:string,t:TurnContext)=>person===PERSON&&this.#bus.isCurrent(t)};
  this.#journal=new ActionJournal(db);
  this.#dispatcher=new ToolDispatcher(this.#registry,()=>policy,this.#journal,authority);
 }
 get tools():readonly ModelTool[]{
  const g=this.google?[...(this.google.has('calendar')?[googleModelTools.calendar]:[]),...(this.google.has('gmail')?[googleModelTools.gmail]:[])]:[];
  const d:ModelTool[]=this.desktop?[...(this.desktop.canLook?[desktopModelTools.look]:[]),...(this.desktop.canControl?[desktopModelTools.control]:[])]:[];
  if(this.workspace&&this.desktop?.available)d.push(workspaceModelTool);
  const all:ModelTool[]=[...reminderModelTools,statusModelTool,...(this.modes?[modeModelTool]:[]),...(this.memory?memoryModelTools:[]),...(this.recall?[recallModelTool]:[]),...(this.projects?projectModelTools:[]),...d,...(this.web?webModelTools:[]),...(this.missions?[researchModelTool]:[]),...(this.more.godsEye?[godsEyeModelTool]:[]),...(this.more.work?[workModelTool]:[]),...g];
  // Skills turned off aren't offered at all.
  return this.skills?[...all.filter(t=>this.skills!.offers(t.name)),skillsModelTool]:all;
 }
 /** Extra instructions: what the person asked HARMONY to remember. Taken once per conversation. */
 context():string{
  if(this.more.guard?.locked)return GUEST_NOTE;
  const parts:string[]=[];
  // With meaning search set up, the always-present list is shorter (less to read each conversation); the rest is
  // brought in per turn by related() when it clearly matters. Without it, more is kept here.
  try{const m=this.memory?.contextEntries(this.recall?.engine==='meaning'?1200:2500);this.#contextIds=m?.ids??new Set();if(m?.text)parts.push(m.text);}catch{}
  try{const p=this.projects?.context();if(p)parts.push(p);}catch{}
  try{const p=this.more.personality?.instructions();if(p)parts.push(p);}catch{}
  return parts.join('\n\n');
 }
 /** Per turn: remembered facts that clearly bear on what was said, beyond those already in the instructions. Fast or nothing. */
 async related(text:string,signal?:AbortSignal):Promise<string>{if(this.more.guard?.locked)return '';try{return await this.recall?.related(text,this.#contextIds,signal)??'';}catch{return '';}}
 /** After a finished turn: kept only if the person turned on conversation memory. */
 logTurn(heard:string,reply:string){try{this.recall?.logTurn(heard,reply);}catch{}}
 /** Loads the meaning model ahead of the first turn and indexes anything new. */
 warm(){try{this.recall?.warm();}catch{}}
 /** Exact short commands ("Harmony, status.") go straight to their function instead of relying on the brain to pick it.
  * Returns the same call markup the brain would write (so history stays identical), or null. Only offered functions. */
 shortcut(text:string):string|null{
  const t=text.trim().toLowerCase().replace(/^(hey|ok|okay)\s+/,'').replace(/^harmony[,.!]?\s*/,'').replace(/[.!?]+$/,'').trim();
  const rules:[RegExp,string,Record<string,string>][]=[
   [/^(status|status report|give me (a|the|my) status( report)?|what'?s the status|rundown|give me (a|the) rundown)$/,'status_report',{focus:''}],
   [/^(why are you (so )?slow( today)?|why (is|are) (you|it|this) (so )?slow|speed check)$/,'status_report',{focus:'speed'}],
   [/^((run )?(a )?(self|health)[- ]check|check yourself|how are you running)$/,'status_report',{focus:'self-check'}],
   [/^((run )?(a |the )?security drills?|test your (security|defenses|defences)|drill)$/,'status_report',{focus:'drill'}],
   [/^(update yourself|update harmony|(install|apply) (the )?updates?|get the update)$/,'status_report',{focus:'update'}],
   [/^(who'?s on (my|the) (wi-?fi|network)|(any|are there any) (new|unknown) devices( on (my|the) (wi-?fi|network))?|check (my|the) (wi-?fi|network)|wi-?fi (check|watchdog))$/,'status_report',{focus:'network'}],
   [/^(undo|roll ?back|revert) (the |that |last )?update$/,'status_report',{focus:'rollback'}],
   [/^((give me (my|the) )?(end of (the )?day|work|daily) (summary|recap|report)|what did i (do|get done) today)$/,'work_log',{action:'summary',place:'',text:'',minutes:'',qty:'',vendor:''}],
   [/^(what'?s open|what jobs are open|open jobs|what'?s on my list|work list)$/,'work_log',{action:'list',place:'',text:'',minutes:'',qty:'',vendor:''}],
   [/^((triage|check|go through) my (email|inbox|mail)|inbox brief|email brief|what needs me|does anything need me|anything important in my (email|inbox))$/,'check_email',{query:'triage'}],
   [/^(what'?s waiting on parts|waiting on parts|what parts am i waiting on)$/,'work_log',{action:'waiting',place:'',text:'',minutes:'',qty:'',vendor:''}],
   [/^((find|scout|look for|search for) (me )?(some |a )?(good |new )?remote (jobs?|work|roles?)( tonight)?|job scout|scout (for )?jobs( tonight)?)$/,'research',{action:'jobs',topic:'scout'}],
   [/^((read me|tell me about|what are) (the |my )?(remote )?job (leads|scout)|any (good )?remote jobs|what (remote )?jobs did you find)$/,'research',{action:'jobs',topic:''}],
   [/^where was i$/,'where_was_i',{project:''}],
   [/^save my place$/,'workspace',{action:'save',when:''}],
   [/^put me back$/,'workspace',{action:'restore',when:''}],
   [/^(lock in|focus mode)$/,'set_mode',{mode:'focus'}],
   [/^(go ghost|ghost mode)$/,'set_mode',{mode:'ghost'}],
   [/^(back to normal|normal mode)$/,'set_mode',{mode:'normal'}],
   [/^(what skills do you have|list (your )?skills)$/,'skills',{action:'list',name:''}],
   [/^(open|show( me)?|launch) (god'?s|gods) eye( view)?$/,'gods_eye',{action:'open',what:'',place:''}],
   [/^close (god'?s|gods) eye( view)?$/,'gods_eye',{action:'close',what:'',place:''}],
   [/^what are you watching$/,'gods_eye',{action:'watch',what:'',place:''}],
   [/^((read me |give me |what'?s in )?(my |the |today'?s )?(daily brief|daily briefing)|claude'?s brief|read me (my|the) brief)$/,'status_report',{focus:'brief'}],
   [/^(morning brief|world brief|give me (the|my) (morning|world) brief)$/,'gods_eye',{action:'open',what:'world brief',place:''}],
  ];
  // "Spiral Time" and "save X for Spiral Time" (the topic is captured, so it can't be a fixed rule).
  const said=text.trim().replace(/^(hey|ok|okay)\s+/i,'').replace(/^harmony[,.!]?\s*/i,'').replace(/[.!?]+$/,'').trim();
  const later=said.match(/^(?:save|add|put|queue) (.{3,200}?) (?:for|to|on) (?:spiral|sprial) time$/i)??said.match(/^(?:for|add to|save for) (?:spiral|sprial) time[,:]? (.{3,200})$/i);
  // Step 27: taught skills. Teaching and forgetting capture words; a taught phrase runs its routine (approved ones only).
  if(this.more.routines&&this.tools.some(tool=>tool.name==='skills')){
   const call=(action:string,name:string)=>`<tool_call>\n<function=skills>\n<parameter=action>\n${action}\n</parameter>\n<parameter=name>\n${name.replace(/[<>]/g,'')}\n</parameter>\n</function>\n</tool_call>`;
   if(TEACH.test(said))return call('teach',said.slice(0,700));
   const forget=said.match(/^(?:forget|delete|remove) (?:the |my )?(?:taught )?(?:skill|routine) (.{2,60})$/i);if(forget)return call('forget',forget[1]);
   const routine=this.more.routines.match(said);if(routine)return call('run',routine.id);
  }
  if(this.more.spiral&&this.tools.some(tool=>tool.name==='research')){
   const args=SPIRAL_PHRASE.test(t)?{action:'spiral',topic:''}:later?{action:'later',topic:later[1]}:null;
   if(args)return `<tool_call>\n<function=research>\n<parameter=action>\n${args.action}\n</parameter>\n<parameter=topic>\n${args.topic.replace(/[<>]/g,'')}\n</parameter>\n</function>\n</tool_call>`;
  }
  // Step 42: bus questions go straight to Metro's live feed (not offered to the brain, so every prompt stays the same size).
  if(this.more.metro){const b=busIntent(said);if(b)return `<tool_call>\n<function=bus_times>\n<parameter=action>\n${b.action}\n</parameter>\n<parameter=stop>\n${b.stop.replace(/[<>]/g,'')}\n</parameter>\n<parameter=route>\n${b.route.replace(/[<>]/g,'')}\n</parameter>\n</function>\n</tool_call>`;}
  const hit=rules.find(([re])=>re.test(t));if(!hit)return null;
  if(!this.tools.some(tool=>tool.name===hit[1]))return null;
  return `<tool_call>\n<function=${hit[1]}>\n${Object.entries(hit[2]).map(([k,v])=>`<parameter=${k}>\n${v}\n</parameter>`).join('\n')}\n</function>\n</tool_call>`;
 }
 /** God's Eye: HARMONY picks the source from the words, asks GEV, and shows the answer on the globe. */
 async #godsEye(bridge:GodsEyeBridge,what:string,place:string,signal:AbortSignal):Promise<WebResult>{
  const at=new Date().toISOString();
  const ge:GodsEyeBridge=bridge.available()?bridge:{...bridge,open:async()=>{}};
  // Ambient mode: "ambient mode", "living globe", "screensaver mode", "spin the globe"; "stop ambient mode" ends it.
  const amb=ambientIntent(what);
  if(amb!==null&&ge.ambient){
   if(!bridge.available())return {kind:'local',query:'open',retrievedAt:at,text:'God\'s Eye isn\'t set up yet, so there\'s no globe to turn.',sources:[]};
   const ok=await ge.ambient(amb).catch(()=>false);
   return {kind:'local',query:'ambient',retrievedAt:at,text:amb?(ok?'Ambient mode: the globe is turning on your second screen. Press Esc, or say "stop ambient mode", to end it.':'I opened the globe, but it didn\'t start turning. It may still be loading; ask again in a moment.'):'Ambient mode is off.',sources:[]};
  }
  // Replay: "replay today's earthquakes" (God's Eye's USGS feed) or any world-feed subject ("replay the disasters").
  if(replayIntent(what)&&ge.replay&&bridge.available()){
   type Stop=import('./gods-eye.ts').ReplayStop;let stops:{at:string|null;stop:Stop}[]=[],label='events',layers:string[]=[];
   if(/\bquakes?\b|earthquakes?|seismic/i.test(what)){
    const a=await ge.call('get_earthquakes',{limit:12,...(place?{area:{place}}:{})},signal);
    const rows=Array.isArray((a.data as {rows?:unknown})?.rows)?(a.data as {rows:Record<string,unknown>[]}).rows:[];
    stops=rows.flatMap(r=>typeof r.lat==='number'&&typeof r.lon==='number'?[{at:typeof r.time==='string'?r.time:null,stop:{lat:r.lat,lon:r.lon,label:`${clock(typeof r.time==='string'?r.time:null)} · M${typeof r.magnitude==='number'?r.magnitude.toFixed(1):'?'} ${String(r.place??'').slice(0,60)}`.trim(),color:typeof r.magnitude==='number'&&r.magnitude>=6?'red':typeof r.magnitude==='number'&&r.magnitude>=4.5?'amber':'cyan'} as Stop}]:[]);
    label='earthquakes in the last 24 hours';layers=['earthquakes'];
   }else{
    const wr=this.more.world?worldRoute(what.replace(/\b(replay|play (it |them )?back|playback|time ?-?lapse|walk me through|tour)\b/gi,''),!!place):null;
    if(wr&&this.more.world&&!wr.needsPlace){
     const results=await Promise.all(wr.kinds.map(k=>this.more.world!.feed(k,signal)));const filter=eventFilter(what);
     const events=results.flatMap(r=>r.events).filter(e=>e.lat!==null&&e.lon!==null&&(!wr.match||wr.match.test(`${e.title} ${e.detail} ${e.source}`)||e.kind==='volcano')).filter(filter.keep);
     stops=events.map(e=>({at:e.at,stop:{lat:e.lat!,lon:e.lon!,label:`${clock(e.at)} · ${e.title}`.replace(/^ · /,'').slice(0,110),color:e.severity>=.8?'red':e.severity>=.5?'amber':'cyan'} as Stop}));
     label=wr.label;layers=wr.layers??[];
    }
   }
   // In time order, oldest first; the most recent 12.
   stops.sort((x,y)=>(Date.parse(x.at??'')||0)-(Date.parse(y.at??'')||0));stops=stops.slice(-12);
   if(!stops.length)return {kind:'local',query:'replay',retrievedAt:at,text:`There's nothing to replay for ${label} right now.`,sources:[]};
   void ge.replay(stops.map(s=>s.stop),layers).catch(()=>{});
   return {kind:'local',query:'replay',retrievedAt:at,text:`Replaying ${stops.length} ${label} in God's Eye, oldest first, from ${clock(stops[0].at)||'the earliest'} to ${clock(stops.at(-1)!.at)||'the latest'}.`,sources:[]};
  }
  // v9's world feeds (volcanoes, tsunami, floods, alerts, disasters, outages, space weather, auroras, fireballs, asteroids).
  const world=this.more.world?worldRoute(what,!!place):null;
  if(world&&this.more.world)return this.#world(ge,this.more.world,world,place,signal,what);
  const route=routeQuestion(what,place);
  if(route.needsPlace)return {kind:'local',query:'open',retrievedAt:at,text:`Which place should I look at for ${route.label}?`,sources:[]};
  // GPS jamming for a place: the numbers behind God's Eye View's interference map, said out loud.
  if(!route.tool&&route.layers.includes('gnss-integrity')&&place&&ge.gnss&&this.web&&bridge.available()){
   try{
    const g=await this.web.geocode(place,signal),name=g.name.split(',')[0];
    const s=await ge.gnss(g.lat,g.lon,signal);
    void ge.open({layers:route.layers,place,view:null}).catch(()=>{});
    return {kind:'local',query:'gnss',retrievedAt:at,text:gnssText(s,name),sources:[]};
   }catch(e){
    await ge.open({layers:route.layers,place,view:null});
    return {kind:'local',query:'open',retrievedAt:at,text:`Showing GPS interference over ${place} in God's Eye. ${e instanceof Error&&e.message.length<120?e.message:'The numbers aren\'t available right now.'}`,sources:[]};
   }
  }
  if(!route.tool){
   await ge.open({layers:route.layers,place,view:null});
   return {kind:'local',query:'open',retrievedAt:at,text:route.layers.length?`Showing ${route.label}${place?` over ${place}`:''} in God's Eye.`:place?`Opening God's Eye over ${place}.`:'Opening God\'s Eye.',sources:[]};
  }
  const answer=await ge.call(route.tool,route.args,signal);
  // The window opens either way; with a view, the globe goes where the answer is.
  void ge.open({layers:route.layers,place,view:answer.view}).catch(()=>{});
  const text=answer.ok&&answer.summary?answer.summary:answer.summary||'God\'s Eye had nothing for that right now.';
  return {kind:'local',query:`${route.label}${place?` near ${place}`:''}`.slice(0,200),retrievedAt:at,
   text:`God's Eye View (live public data), ${route.label}${place?` near ${place}`:''}: ${text}`.slice(0,5000),sources:[]};
 }
 async #world(ge:GodsEyeBridge,feeds:WorldFeeds,route:import('./world-feeds.ts').WorldRoute,place:string,signal:AbortSignal,what=''):Promise<WebResult>{
  const at=new Date().toISOString();
  if(route.needsPlace)return {kind:'local',query:'open',retrievedAt:at,text:`Which place should I check for ${route.label}?`,sources:[]};
  let near:Near|null=null;
  if(place&&this.web){try{const g=await this.web.geocode(place,signal);near={lat:g.lat,lon:g.lon,radiusKm:route.radiusKm,name:g.name.split(',')[0]};}catch{near=null;}}
  const results=await Promise.all(route.kinds.map(k=>feeds.feed(k,signal,near??undefined)));
  let events:WorldEvent[]=results.flatMap(r=>r.events);
  if(route.match)events=events.filter(e=>route.match!.test(`${e.title} ${e.detail} ${e.source}`)||e.kind==='volcano');
  const filter=eventFilter(what);events=events.filter(filter.keep);
  events=nearby(events,near,12);
  const marks=pins(events),first=events.find(e=>e.lat!==null);
  const camera=near?{lat:near.lat,lon:near.lon,altitude_m:Math.min(20_000_000,Math.max(300_000,route.radiusKm*2500))}:first?{lat:first.lat!,lon:first.lon!,altitude_m:6_000_000}:undefined;
  void ge.open({layers:route.layers??[],place:'',view:{...(camera?{camera}:{}),annotations:marks}}).catch(()=>{});
  return {kind:'local',query:`${route.label}${near?.name?` near ${near.name}`:''}`.slice(0,200),retrievedAt:at,text:worldReport(route.label[0].toUpperCase()+route.label.slice(1)+(filter.words?` (${filter.words})`:''),results,events,near),sources:[]};
 }
 /** Easter eggs: a fixed line and maybe a visual flourish; null when nothing matches (or on cooldown). */
 egg(text:string):{say:string;flourish:string|null}|null{
  const e=this.more.eggs?.match(text);if(!e)return null;
  if(e.flourish)try{this.more.onFlourish?.(e.flourish);}catch{}
  return {say:e.say,flourish:e.flourish};
 }
 /** Called once per conversation turn: the current project was worked on now. */
 touchProject(){try{this.projects?.touch();}catch{}}
 async #dispatch<T>(toolId:string,inputs:unknown,signal:AbortSignal):Promise<T>{
  const guard=this.more.guard;
  if(guard){
   // Who is asking comes from the request that started this (voice, typed, phone, a click); unknown means a click.
   const ctx=asking.getStore()??{who:guard.principal('screen')};
   const risk=this.#registry.resolve(toolId).risk;
   try{await guard.authorize(toolId,risk,inputs,signal,ctx.say,ctx.who);}
   catch(e){signal.throwIfAborted();throw new ReminderInputError(e instanceof Error&&e.message.length<200?e.message:'Not allowed right now.');}
  }
  const turn=this.#bus.beginTurn();
  try{return (await this.#dispatcher.run(turn,PERSON,toolId,inputs,signal)).result as T;}
  finally{this.#bus.endTurn(turn);}
 }
 async #one(call:ToolCall,signal:AbortSignal,source:Memory['source']):Promise<{spoken:string;report:Record<string,unknown>;changed:boolean;lookup?:WebResult}>{
  const a=call.arguments,now=this.now();
  try{
   // A function from a skill that's turned off is refused plainly (the model shouldn't have it, but never trust that).
   const owner=this.skills?.skillOf(call.name);
   if(this.skills&&owner&&!this.skills.enabled(owner)){const m=this.skills.list().find(x=>x.id===owner)!;throw new ReminderInputError(`${m.name} is turned off. Say "enable ${m.name.toLowerCase()}" to use it.`);}
   // Offline: say so plainly. Web questions are saved and looked up when the internet is back (step 22).
   const net=NEEDS_INTERNET[call.name];
   if(net&&this.more.offline&&!this.more.offline.online()&&!(call.name==='gods_eye'&&/^(watch|unwatch)$/i.test((a.action??'').trim()))){
    const q=(call.name==='get_news'?(a.topic??'')||'the news':(a.query??'')).trim();
    if(net==='queue'&&q.length>=2&&this.missions){
     try{this.missions.create(`Look up: ${q}`.slice(0,300),this.projects?.activeId()??null,4,48);
      return {spoken:'The internet\'s down right now. I\'ve saved that and I\'ll look it up as soon as it\'s back, then tell you.',report:{function:call.name,ok:true,queued:true},changed:true};}catch{}
    }
    const what=call.name==='get_weather'?'the weather':call.name==='check_email'?'your email':call.name==='calendar_events'?'your calendar':call.name==='gods_eye'?'live world data':'the web';
    return {spoken:`The internet's down, so I can't check ${what} right now. Everything on this PC still works.`,report:{function:call.name,ok:false,offline:true},changed:false};
   }
   if(this.skills&&call.name==='project_note'&&(a.kind??'').trim().toLowerCase()==='idea'&&!this.skills.enabled('ideas'))throw new ReminderInputError('Ideas is turned off. Say "enable ideas" to use it.');
   if(call.name==='switch_project'&&this.projects){
    const name=(a.name??'').trim(),wantsNew=/^(yes|true|new)$/i.test((a.new??'').trim());
    const existing=this.projects.find(name);
    if(existing&&!wantsNew){
     if(this.projects.activeId()===existing.id)return {spoken:`You're already in ${existing.name}.`,report:{function:call.name,ok:true,project:existing.name},changed:false};
     await this.#dispatch('projects.switch',{id:existing.id},signal);
     return {spoken:`Switched to ${existing.name}.`,report:{function:call.name,ok:true,project:existing.name},changed:true};
    }
    if(!wantsNew)throw new ReminderInputError(`I don't have a project called ${name.slice(0,60)||'that'}. Say "start a new project called" and the name to create it.`);
    const r=await this.#dispatch<{name:string}>('projects.create',{name},signal);
    return {spoken:`Started a new project: ${r.name}. It's your current project now.`,report:{function:call.name,ok:true,created:r.name},changed:true};
   }
   if(call.name==='project_note'&&this.ideas&&(a.kind??'').trim().toLowerCase()==='idea'){
    // Captured straight away, with or without a current project; no discussion (Idea Mode).
    const p=this.projects?.active()??null;
    if((a.text??'').replace(/^idea[:,\s]+/i,'').replace(/[^\p{L}\p{N}]+/gu,'').length<3)throw new ReminderInputError("What's the idea?");
    await this.#dispatch('ideas.add',{text:(a.text??'').slice(0,400),projectId:p?.id??''},signal);
    return {spoken:p?`Idea saved to ${p.name}.`:'Idea saved.',report:{function:call.name,ok:true,idea:true},changed:true};
   }
   if(call.name==='set_mode'&&this.modes){
    const want=(a.mode??'').trim().toLowerCase().replace(/^(lock in|locked in|focus mode)$/,'focus').replace(/^(back to normal|normal mode|off)$/,'normal') as HarmonyMode;
    if(!MODES.includes(want))throw new ReminderInputError('I can switch to focus, ghost, or back to normal.');
    const current=this.modes.status().mode;
    if(current===want)return {spoken:want==='normal'?"We're already in normal mode.":`You're already in ${want} mode.`,report:{function:call.name,ok:true,mode:want},changed:false};
    const r=await this.#dispatch<{id:string;name:string}>('mode.set',{mode:want},signal);
    const mins=Number(r.name),length=r.name!==''&&Number.isFinite(mins)?(mins>=60?`${Math.floor(mins/60)} hour${mins>=120?'s':''}${mins%60?` ${mins%60} minute${mins%60===1?'':'s'}`:''}`:`${mins} minute${mins===1?'':'s'}`):'';
    const said=want==='focus'?"Locked in. I'll keep the screen simple and stay quiet until you say back to normal."
     :want==='ghost'?"Ghost mode. I'm still listening; say back to normal to bring everything back."
     :`Back to normal.${current==='focus'&&length?` You were locked in for ${length}.`:''}`;
    return {spoken:said,report:{function:call.name,ok:true,mode:want},changed:true};
   }
   if(call.name==='project_note'&&this.projects){
    const project=this.projects.active();
    if(!project)throw new ReminderInputError('Which project is this for? Say "switch to" and the project first.');
    const kind=(a.kind??'').trim().toLowerCase(),text=(a.text??'').trim();
    if(kind==='done'){
     const target=this.projects.findOpen(project.id,text);
     if(!target)throw new ReminderInputError(`I couldn't find an open task like that in ${project.name}.`);
     await this.#dispatch('projects.close',{id:target.id},signal);
     return {spoken:`Nice. Marked done: ${target.text}.`,report:{function:call.name,ok:true,done:target.text},changed:true};
    }
    const k=(['task','decision','blocker','note'].includes(kind)?kind:'note') as NoteKind;
    const r=await this.#dispatch<{name:string}>('projects.note',{projectId:project.id,kind:k,text},signal);
    const said={task:`Added a task to ${project.name}: ${r.name}.`,decision:`Noted the decision for ${project.name}: ${r.name}.`,blocker:`Logged a blocker for ${project.name}: ${r.name}.`,note:`Noted for ${project.name}: ${r.name}.`}[k];
    return {spoken:said,report:{function:call.name,ok:true,project:project.name,kind:k,text:r.name},changed:true};
   }
   if(call.name==='skills'&&this.skills){
    const act=(a.action??'').trim().toLowerCase(),name=(a.name??'').trim();
    const rs=this.more.routines;
    if(rs&&act==='teach'){
     const m=name.match(TEACH);if(!m)throw new ReminderInputError('Say it like: teach you a skill, when I say start my day, open Quickbase, then the weather in Madison.');
     const d=draftRoutine(m[1],m[2],t=>this.shortcut(t));if(d.problem)throw new ReminderInputError(d.problem+(d.unknown.length?` I didn't know: ${d.unknown.slice(0,3).join('; ')}.`:''));
     await this.#dispatch('skills.teach',{phrase:m[1].slice(0,80),description:m[2].slice(0,700)},signal);
     return {spoken:`Saved as a draft. When you say "${d.phrase}", I'll ${describeSteps(d.steps)}.${d.unknown.length?` I left out what I didn't know: ${d.unknown.slice(0,3).join('; ')}.`:''} Read it over and approve it in Settings, under taught skills, before I'll run it.`,report:{function:call.name,ok:true,steps:d.steps.length,unknown:d.unknown.length},changed:true};
    }
    if(rs&&act==='forget'){
     const r=rs.find(name);if(!r)throw new ReminderInputError(`I don't have a taught skill called "${name.slice(0,60)}".`);
     await this.#dispatch('skills.forget',{id:r.id},signal);
     return {spoken:`Forgot "${r.phrase}". Say undo to bring it back.`,report:{function:call.name,ok:true},changed:true};
    }
    if(rs&&act==='run'){
     const r=rs.get(name)??rs.find(name);
     if(!r)throw new ReminderInputError('I don\'t have that skill.');
     if(r.status!=='approved')throw new ReminderInputError(`"${r.phrase}" is still a draft. Approve it in Settings first.`);
     const spokenParts:string[]=[],texts:string[]=[],sources:WebResult['sources']=[];let changed=false;
     for(const step of r.steps){
      signal.throwIfAborted();
      if(step.name==='say'){spokenParts.push(step.arguments.text);continue;}
      if(step.name==='skills')continue;
      const out=await this.#one({name:step.name,arguments:step.arguments},signal,source);
      if(out.spoken)spokenParts.push(out.spoken);changed||=out.changed;
      if(out.lookup){texts.push(out.lookup.text);sources.push(...out.lookup.sources);}
     }
     rs.ran(r.id);
     return {spoken:texts.length?'':spokenParts.join(' ')||'Done.',report:{function:call.name,ok:true,routine:r.phrase,steps:r.steps.length},changed,
      ...(texts.length?{lookup:{kind:'local' as const,query:r.phrase,retrievedAt:now.toISOString(),text:`${spokenParts.length?`Say this first: ${spokenParts.join(' ')}\n`:''}${texts.join('\n\n').slice(0,5000)}\n(Results of the owner's taught skill "${r.phrase}". Say them briefly, in order.)`,sources:sources.slice(0,8)}}:{})};
    }
    if(act==='enable'||act==='disable'){
     const skill=this.skills.find(name);if(!skill)throw new ReminderInputError(`I don't have a skill called ${name.slice(0,60)||'that'}. Ask me what skills I have.`);
     if(skill.core&&act==='disable')throw new ReminderInputError(`${skill.name} always stays on.`);
     if(this.skills.enabled(skill.id)===(act==='enable'))return {spoken:`${skill.name} is already ${act==='enable'?'on':'off'}.`,report:{function:call.name,ok:true},changed:false};
     await this.#dispatch('skills.set',{id:skill.id,on:String(act==='enable')},signal);
     return {spoken:act==='enable'?`${skill.name} is on.`:`${skill.name} is off. Say "enable ${skill.name.toLowerCase()}" to turn it back on.`,report:{function:call.name,ok:true,skill:skill.id,on:act==='enable'},changed:true};
    }
    const r=await this.#dispatch<WebResult>('skills.list',{topic:''},signal);
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:r};
   }
   if(call.name==='research'&&this.missions){
    const act=(a.action??'').trim().toLowerCase(),topic=(a.topic??'').trim();
    if((act==='spiral'||act==='later')&&!this.more.spiral)throw new ReminderInputError("Spiral Time isn't set up on this PC.");
    if(act==='spiral'){
     const r=await this.#dispatch<{id:string;name:string}>('spiral.start',{},signal);
     const already=r.name.startsWith('already:'),kinds=r.name.replace(/^already:/,'').split(',');
     const research=kinds.filter(k=>k==='research').length,extra=[...(kinds.includes('security-news')?['the security news check']:[]),...(kinds.includes('model-scan')?['the model scan']:[]),...(kinds.includes('job-scout')?['the job scout']:[])];
     const what=list([...(research?[`${research} research job${research>1?'s':''}`]:[]),...extra]);
     return {spoken:already?`Spiral Time is already handed off: ${what}. Claude picks it up within the hour.`
      :`Spiral Time. Handing off ${what}. Claude picks it up within the hour and works until your limit; anything left waits for next time.`,report:{function:call.name,ok:true,jobs:kinds.length,already},changed:true};
    }
    if(act==='jobs'){
     if(!this.more.jobs||!this.more.spiral)throw new ReminderInputError("The job scout isn't set up on this PC.");
     if(/scout|find|search|look|new|tonight/i.test(topic)){
      if(!this.more.jobs.profile().enabled)throw new ReminderInputError('The job scout is turned off. Turn it on in the Jobs panel first.');
      await this.#dispatch('jobs.scout',{},signal);
      return {spoken:'Okay. The job scout goes out with the next Spiral Time: ranked remote roles and a cover letter for the best one, in the Jobs panel by morning.',report:{function:call.name,ok:true,scout:true},changed:true};
     }
     const r=await this.#dispatch<WebResult>('jobs.report',{topic:''},signal);
     return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:r};
    }
    if(act==='later'){
     if(topic.length<3)throw new ReminderInputError('What should I save for Spiral Time?');
     const r=await this.#dispatch<{name:string}>('spiral.add',{objective:topic.slice(0,300)},signal);
     return {spoken:`Saved for Spiral Time: ${r.name.slice(0,80)}.`,report:{function:call.name,ok:true},changed:true};
    }
    if(act==='start'){
     if(topic.length<3)throw new ReminderInputError('What should I research?');
     if(this.missions.list(50).filter(m=>(m.status==='QUEUED'||m.status==='RUNNING')&&!m.state.spiral).length>=3)throw new ReminderInputError('I already have three research missions going. Cancel one or wait for them to finish.');
     await this.#dispatch('missions.start',{objective:topic.slice(0,300)},signal);
     return {spoken:"On it. I'll research that in the background and tell you when it's ready.",report:{function:call.name,ok:true,started:topic.slice(0,80)},changed:true};
    }
    if(act==='cancel'){
     const m=this.missions.find(topic);
     if(!m||(m.status!=='QUEUED'&&m.status!=='RUNNING'))throw new ReminderInputError("There's no research running to cancel.");
     await this.#dispatch('missions.cancel',{id:m.id},signal);
     return {spoken:`Okay, I stopped the research on ${m.objective.slice(0,80)}.`,report:{function:call.name,ok:true},changed:true};
    }
    const r=await this.#dispatch<WebResult>('missions.report',{topic:topic.slice(0,200)},signal);
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:r};
   }
   if(call.name==='status_report'&&this.more.update&&/^(update|rollback)$/i.test((a.focus??'').trim())){
    const roll=/rollback/i.test(a.focus??'');
    const r=await this.#dispatch<{name:string}>(roll?'system.rollback':'system.update',{},signal);
    return {spoken:r.name,report:{function:call.name,ok:true,focus:roll?'rollback':'update'},changed:true};
   }
   if(call.name==='status_report'&&this.more.dailyBrief&&/^brief$/i.test((a.focus??'').trim())){
    if(this.more.guard?.locked)throw new ReminderInputError('Unlock me first.');
    return {spoken:'',report:{function:call.name,ok:true,focus:'brief'},changed:false,lookup:{kind:'local',query:'daily brief',retrievedAt:now.toISOString(),text:`${this.more.dailyBrief.spoken()}\n(the owner's daily brief, written by Claude this morning. Read it out as it is, warmly; don't add news of your own.)`,sources:[]}};
   }
   if(call.name==='status_report'&&this.more.network&&/network|wi-?fi|devices?/i.test(a.focus??'')){
    if(this.more.guard?.locked)throw new ReminderInputError('Unlock me first.');
    await this.more.network.scan().catch(()=>{});
    return {spoken:'',report:{function:call.name,ok:true,focus:'network'},changed:false,lookup:{kind:'local',query:'wifi',retrievedAt:now.toISOString(),text:`${this.more.network.spoken()}\n(From HARMONY's Wi-Fi watchdog on this PC. Say it plainly; don't read out device addresses unless asked.)`,sources:[]}};
   }
   if(call.name==='status_report'&&this.more.drills&&/drill/i.test(a.focus??'')){
    const text=await this.more.drills.run();
    return {spoken:'',report:{function:call.name,ok:true,focus:'drill'},changed:false,lookup:{kind:'local',query:'security drills',retrievedAt:now.toISOString(),text:`${text}\n(Results of HARMONY's own sandboxed security drills. Say briefly what held, and plainly anything that didn't.)`,sources:[]}};
   }
   if(call.name==='status_report'&&/speed|slow|fast|lag|self|health|check/i.test(a.focus??'')){
    // Self-diagnostics: measured timings of the last reply and the bottleneck. Read-only, no lookup needed.
    const text=this.more.diagnostics?.()??'Timing measurements are not available.',health=/self|health|check/i.test(a.focus??'');
    return {spoken:'',report:{function:call.name,ok:true,focus:health?'self-check':'speed'},changed:false,lookup:{kind:'local',query:health?'self-check':'speed',retrievedAt:now.toISOString(),
     text:`${text}\n(Measured data. ${health?'Say briefly whether everything is fine, and anything that needs them with its fix.':'Explain briefly what was slowest and why, in plain words.'})`,sources:[]}};
   }
   if(call.name==='status_report'){
    const r=await this.#dispatch<WebResult>('status.report',{topic:''},signal);
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:{...r,text:r.text+'\n(Give a short spoken rundown of what matters, in a few sentences, most important first. Skip anything empty.)'}};
   }
   if(call.name==='work_log'&&this.more.work){
    const act=(a.action??'').trim().toLowerCase(),place=(a.place??'').trim(),text=(a.text??'').trim();
    const num=(v:string|undefined)=>{const x=parseFloat(String(v??'').replace(/[^0-9.]/g,''));return Number.isFinite(x)&&x>0?x:null;};
    const where=(p:string)=>/^\d/.test(p)?`unit ${p}`:p;
    if(act==='list'||act==='waiting'||act==='summary'){
     const r=await this.#dispatch<WebResult>('work.report',{topic:act},signal);
     return {spoken:'',report:{function:call.name,ok:true,action:act},changed:false,lookup:{...r,text:`${r.text}\n(Read this to the owner plainly and briefly.)`}};
    }
    const ids:Record<string,string>={new:'work.add',add:'work.add',update:'work.update',progress:'work.update',note:'work.update',ordered:'work.order',order:'work.order',arrived:'work.arrive',received:'work.arrive',done:'work.done',finished:'work.done'};
    const id=ids[act];if(!id)throw new ReminderInputError('Say new job, an update, a part ordered or arrived, or done.');
    if(id==='work.add'&&!text)throw new ReminderInputError('What needs doing?');
    // Errors inside a dispatched action come back generic, so say exactly what's missing first.
    if(id!=='work.add'&&!this.more.work.find(place,text))throw new ReminderInputError(place?`I don't have a job at ${where(normalPlace(place))}. Say "new job" first.`:'Which job? Say the unit or place.');
    if(id==='work.order'&&!text)throw new ReminderInputError('Which part did you order?');
    const inputs:Record<string,unknown>={place,text};
    if(id==='work.update'||id==='work.done')inputs.minutes=num(a.minutes)??0;
    if(id==='work.order'){inputs.qty=num(a.qty)??0;inputs.vendor=(a.vendor??'').trim().slice(0,60);}
    try{
     const r=await this.#dispatch<{name:string}>(id,inputs,signal);const [p,title,parts,status]=r.name.replace(/^existing:/,'').split('|');
     const said=id==='work.add'?(r.name.startsWith('existing:')?`That's already on the list: ${where(p)}, ${title}.`:`Got it. New job${p?` at ${where(p)}`:''}: ${title}.`)
      :id==='work.update'?`Logged on ${where(p)||title}${num(a.minutes)?`, ${num(a.minutes)} minutes`:''}.`
      :id==='work.order'?`Noted: ${where(p)||title} is waiting on ${text}.`
      :id==='work.arrive'?`${parts?`${parts} arrived`:'Parts arrived'} for ${where(p)||title}.${status==='waiting_parts'?' Still waiting on other parts.':''}`
      :`Nice. ${where(p)||title} is done.`;
     return {spoken:said,report:{function:call.name,ok:true,action:act},changed:true};
    }catch(e){if(e instanceof Error&&e.constructor.name==='WorkInputError')throw new ReminderInputError(e.message);throw e;}
   }
   if(call.name==='workspace'&&this.workspace&&this.desktop){
    const act=(a.action??'').trim().toLowerCase();
    if(act==='save'){
     const r=await this.#dispatch<{id:string;name:string}>('workspace.save',{label:''},signal);
     const p=this.projects?.active();
     return {spoken:`Saved your place: ${r.name} window${r.name==='1'?'':'s'}${p?` in ${p.name}`:''}. Say "put me back" any time.`,report:{function:call.name,ok:true,saved:Number(r.name)},changed:true};
    }
    return await this.#restore((a.when??'').trim(),signal);
   }
   if(call.name==='gods_eye'&&this.more.godsEye){
    const ge=this.more.godsEye,action=(a.action??'open').trim().toLowerCase();
    // World-feed questions (volcanoes, alerts, space weather...) are answered even before the globe is set up.
    if(!ge.available()&&!['watch','unwatch'].includes(action)&&!(this.more.world&&worldRoute(a.what??'',!!(a.place??'').trim())))throw new ReminderInputError('God\'s Eye isn\'t set up yet. Double-click "Set up God\'s Eye" in the HARMONY folder, then ask again.');
    if((action==='watch'||action==='unwatch')&&this.more.watch){
     const w=this.more.watch,place=(a.place??'').trim().slice(0,100);
     if(action==='unwatch'){
      if(!place)throw new ReminderInputError('Which place should I stop watching?');
      const q=place.toLowerCase();if(!w.list().some(z=>z.name.toLowerCase()===q||z.name.toLowerCase().startsWith(q)))throw new ReminderInputError(`I'm not watching ${place}.`);
      const r=await this.#dispatch<{name:string}>('watch.remove',{name:place},signal);
      return {spoken:`Stopped watching ${r.name}.`,report:{function:call.name,ok:true},changed:true};
     }
     if(!place){const z=w.list();return {spoken:z.length?`I'm watching ${list(z.map(x=>x.name))}.`:"I'm not watching anywhere yet. Say \"watch\" and a place.",report:{function:call.name,ok:true,zones:z.length},changed:false};}
     if(!this.web)throw new ReminderInputError('Looking places up is turned off.');
     const g=await this.web.geocode(place,signal).catch(e=>{throw new ReminderInputError(e instanceof WebError?e.message:`I couldn't find ${place}.`);});
     const r=await this.#dispatch<{name:string}>('watch.add',{name:g.name.split(',')[0],lat:g.lat,lon:g.lon},signal);
     return {spoken:`Watching ${r.name}. I'll tell you about new earthquakes, severe weather alerts, disasters and volcano alerts within 150 kilometres.`,report:{function:call.name,ok:true,watching:r.name},changed:true};
    }
    if(action==='close'){const was=await ge.close();return {spoken:was?'Closed God\'s Eye.':'God\'s Eye isn\'t open.',report:{function:call.name,ok:true,closed:was},changed:false};}
    const what=(a.what??'').trim().slice(0,200),place=(a.place??'').trim().slice(0,120);
    const r=await this.#dispatch<WebResult>('godseye.ask',{what,place},signal);
    // Just opening (nothing to look up): a fixed confirmation, no second pass.
    if(r.kind==='local'&&r.query==='open')return {spoken:r.text,report:{function:call.name,ok:true},changed:false};
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:r};
   }
   if(call.name==='look_at_screen'&&this.desktop){
    if(!this.desktop.canLook)throw new ReminderInputError(this.desktop.available?'Looking at the screen is turned off in Settings.':'I can only look at the screen on Windows.');
    const r=await this.#dispatch<WebResult>('screen.look',{question:(a.question??'').slice(0,200)},signal);
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:r};
   }
   if(call.name==='control_computer'&&this.desktop){
    if(!this.desktop.canControl)throw new ReminderInputError(this.desktop.available?'Computer control is turned off in Settings.':'I can only do that on Windows.');
    return await this.#control((a.action??'').trim().toLowerCase(),(a.target??'').trim(),signal);
   }
   if(call.name==='recall'&&this.recall){
    const query=(a.query??'').trim();if(query.length<2)throw new ReminderInputError('What should I try to remember?');
    const r=await this.#dispatch<WebResult>('memory.recall',{query:query.slice(0,200)},signal);
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:r};
   }
   if(call.name==='where_was_i'&&this.projects){
    const r=await this.#dispatch<WebResult>('projects.summary',{project:(a.project??'').slice(0,60)},signal);
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:{...r,text:r.text+'\n(Answer like: "You were working on X. The unresolved piece was Y." Then suggest the most likely next step from the open tasks.)'}};
   }
   if((call.name===googleModelTools.calendar.name||call.name===googleModelTools.gmail.name)&&this.google){
    const calendar=call.name===googleModelTools.calendar.name;
    if(!this.google.has(calendar?'calendar':'gmail'))throw new ReminderInputError(`${calendar?'Calendar':'Gmail'} isn't connected yet. You can connect it in Settings.`);
    const r=await this.#dispatch<WebResult>(calendar?'calendar.list':'gmail.search',calendar?{when:(a.when??'today').slice(0,60)}:{query:(a.query??'').slice(0,200)},signal);
    // Private data: not logged to web_lookups. The reply's sources link back to Calendar or Gmail.
    return {spoken:'',report:{function:call.name,ok:true},changed:false,lookup:r};
   }
   if(call.name==='bus_times'&&this.more.metro){
    const m=this.more.metro,stop=(a.stop??'').trim().slice(0,80),route=(a.route??'').trim().slice(0,12);
    try{
     if(a.action==='save'){const name=await m.saveStop(stop,signal);return {spoken:`Got it. Your bus stop is ${name}. Ask "when's my bus" any time.`,report:{function:call.name,ok:true,saved:name},changed:true};}
     return {spoken:await m.next(stop,route,signal),report:{function:call.name,ok:true},changed:false};
    }catch(e){if(e instanceof MetroError)throw new ReminderInputError(e.message);throw e;}
   }
   if(LOOKUP_FUNCTIONS.has(call.name)&&this.web){
    const [id,field]=call.name==='get_weather'?['web.weather','place']:call.name==='get_news'?['web.news','topic']:['web.search','query'];
    const value=(call.name==='get_news'?(a.topic??''):(a[field]??'')).trim();
    if(call.name==='get_weather'&&value.length<2)throw new ReminderInputError("Which town should I check? You can also say: remember that I live in, and the town.");
    if(call.name==='web_search'&&value.length<2)throw new ReminderInputError('What should I look up?');
    const r=await this.#dispatch<WebResult>(id,{[field]:value},signal);
    try{this.db.prepare('INSERT INTO web_lookups (id,at,kind,query,sources) VALUES (?,?,?,?,?)').run(randomUUID(),r.retrievedAt,r.kind,r.query.slice(0,200),JSON.stringify(r.sources).slice(0,8000));}catch{}
    return {spoken:'',report:{function:call.name,ok:true,kind:r.kind,sources:r.sources.length},changed:false,lookup:r};
   }
   if(call.name==='remember'&&this.memory){
    const text=memoryText(a.fact);
    if(this.memory.active().some(m=>m.text.toLowerCase()===text.toLowerCase()))return {spoken:'I already know that.',report:{function:call.name,ok:true,already:true},changed:false};
    const m=await this.#dispatch<{text:string}>('memory.remember',{text,source},signal);
    return {spoken:`Okay, I'll remember that ${m.text}.`,report:{function:call.name,ok:true,remembered:m.text},changed:true};
   }
   if(call.name==='forget'&&this.memory){
    const which=(a.which??'').trim();
    if(/^(everything|all|all of it|everything you know)$/i.test(which))throw new ReminderInputError('To forget everything, use Forget everything in the Memory panel.');
    // By meaning when available ("the thing about the guy who fixes pipes"), otherwise by shared words.
    const byMeaning=this.recall&&which&&!/^(last|latest|that|it|the last one|most recent|the last thing)$/i.test(which)?await this.recall.findMemory(which,signal):null;
    const target=(byMeaning?this.memory.get(byMeaning):null)??this.memory.find(which);
    if(!target)throw new ReminderInputError(this.memory.active().length?`I don't remember anything about "${which.slice(0,60)}".`:"There's nothing in my memory right now.");
    const m=await this.#dispatch<{text:string}>('memory.forget',{id:target.id},signal);
    return {spoken:`Okay, I've forgotten that ${m.text}.`,report:{function:call.name,ok:true,forgot:m.text},changed:true};
   }
   if(call.name==='set_reminder'){
    const text=reminderText(a.text),due=resolveDue({minutes:a.minutes,time:a.time,date:a.date},now);
    const r=await this.#dispatch<{text:string;dueAt:string}>('reminders.set',{kind:'reminder',text,dueAt:due.toISOString()},signal);
    return {spoken:`Got it. ${capital(spokenWhen(new Date(r.dueAt),now))}, I'll remind you: ${r.text}.`,report:{function:call.name,ok:true,text:r.text,due:new Date(r.dueAt).toString()},changed:true};
   }
   if(call.name==='set_timer'){
    const minutes=Number(a.minutes||0),seconds=Number(a.seconds||0),ms=Math.round((minutes*60+seconds)*1000);
    if(!Number.isFinite(ms)||ms<1000)throw new ReminderInputError('How long should the timer be?');
    if(ms>24*3600000)throw new ReminderInputError('Timers can run for up to a day. For longer, ask for a reminder.');
    const label=(a.label??'').replace(/[^\p{L}\p{N} '-]+/gu,' ').replace(/\s+/g,' ').trim().slice(0,40),length=spokenDuration(ms);
    const r=await this.#dispatch<{text:string;dueAt:string}>('reminders.set',{kind:'timer',text:label?`${label} timer`:`timer for ${length}`,dueAt:new Date(now.getTime()+ms).toISOString()},signal);
    return {spoken:label?`${capital(label)} timer set for ${length}.`:`Timer set for ${length}.`,report:{function:call.name,ok:true,text:r.text,due:new Date(r.dueAt).toString()},changed:true};
   }
   if(call.name==='list_reminders'){
    const items=await this.#dispatch<{text:string;dueAt:string;kind:string}[]>('reminders.list',{},signal);
    if(!items.length)return {spoken:"You don't have any reminders or timers set.",report:{function:call.name,ok:true,count:0},changed:false};
    const said=items.slice(0,5).map(r=>r.kind==='timer'?`your ${r.text} ${spokenWhen(new Date(r.dueAt),now)}`:`${r.text}, ${spokenWhen(new Date(r.dueAt),now)}`);
    const intro=items.length===1?'You have one coming up:':`You have ${items.length} coming up.${items.length>5?' The next five are:':''}`;
    return {spoken:`${intro} ${said.join('; ')}.`,report:{function:call.name,ok:true,count:items.length,items:items.slice(0,5).map(r=>({text:r.text,due:new Date(r.dueAt).toString()}))},changed:false};
   }
   if(call.name==='cancel_reminder'){
    const which=(a.which??'').trim().toLowerCase(),pending=this.store.pending();
    if(!pending.length)throw new ReminderInputError("There's nothing to cancel right now.");
    let target:Reminder|undefined;
    if(!which||['last','latest','that','it','the last one','most recent'].includes(which))target=[...pending].sort((x,y)=>y.createdAt.localeCompare(x.createdAt))[0];
    else{
     const want=words(which);let best=0;
     for(const r of pending){const score=words(r.text).filter(w=>want.includes(w)).length;if(score>best){best=score;target=r;}}
     if(!target&&/timer/.test(which))target=pending.filter(r=>r.kind==='timer').sort((x,y)=>y.createdAt.localeCompare(x.createdAt))[0];
    }
    if(!target)throw new ReminderInputError(`I couldn't find a reminder matching "${which.slice(0,60)}".`);
    const r=await this.#dispatch<{text:string}>('reminders.cancel',{id:target.id},signal);
    return {spoken:`Okay, I cancelled the ${target.kind==='timer'?'':'reminder: '}${r.text}.`,report:{function:call.name,ok:true,cancelled:r.text},changed:true};
   }
   return {spoken:"Sorry, I can't do that yet.",report:{function:call.name,ok:false,error:'unknown function'},changed:false};
  }catch(error){
   signal.throwIfAborted();
   if(NEEDS_INTERNET[call.name]&&!(error instanceof ReminderInputError))try{this.more.offline?.failed();}catch{} // maybe the internet is down: check now
   const message=error instanceof ReminderInputError||error instanceof DesktopError?error.message
    :LOOKUP_FUNCTIONS.has(call.name)?(error instanceof WebError?error.message:"I couldn't look that up just now."):"Sorry, that didn't work just now.";
   return {spoken:message,report:{function:call.name,ok:false,error:message},changed:false};
  }
 }
 /** For background specialists: SAFE lookups only, from a fixed list, through the same journaled dispatcher. */
 async agentLookup(toolId:'web.search'|'web.read',value:string,signal:AbortSignal):Promise<WebResult>{
  if(!['web.search','web.read'].includes(toolId)||!this.web)throw new Error('Not allowed for agents');
  return this.#dispatch<WebResult>(toolId,toolId==='web.search'?{query:value.slice(0,200)}:{url:value.slice(0,2000)},signal);
 }
 /** Status overview from what HARMONY actually has; each part is optional and failures are stated, not hidden. */
 async #statusText():Promise<string>{
  const now=this.now(),lines=[`HARMONY status at ${now.toLocaleString('en-US',{weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'})}:`];
  const end=new Date(now);end.setHours(23,59,59,999);
  const today=this.store.pending(20).filter(r=>new Date(r.dueAt)<=end);
  if(today.length)lines.push(`- Reminders and timers still to come today: ${today.slice(0,4).map(r=>`${r.text} at ${new Date(r.dueAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`).join('; ')}${today.length>4?` (+${today.length-4} more)`:''}`);
  try{const u=this.more.update?.status();if(u?.available)lines.push(`- An update is ready${u.commits.length?` (${u.commits.slice(0,3).map(c=>c.subject).join('; ')})`:''}. They can say "update yourself".`);
   else if(u?.state==='building')lines.push('- Updating now; HARMONY restarts when the build finishes.');}catch{}
  const p=this.projects?.active();
  if(p){const tasks=this.projects!.notes(p.id,'task').filter(n=>n.open),blockers=this.projects!.notes(p.id,'blocker').filter(n=>n.open);
   lines.push(`- Current project: ${p.name}; ${tasks.length} open task${tasks.length===1?'':'s'}${tasks.length?` (newest: ${tasks[0].text})`:''}${blockers.length?`; blocker: ${blockers[0].text}`:''}`);}
  const timed=<T,>(work:(signal:AbortSignal)=>Promise<T>)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);return work(c.signal).finally(()=>clearTimeout(t));};
  const g=this.google;
  const [cal,mail]=await Promise.all([
   g?.has('calendar')?timed(s=>g.calendar(calendarRange('today',now),s)).then(r=>r.text.split('\n').slice(1,6).join('; ')).catch(()=>'could not be checked just now'):Promise.resolve(null),
   g?.has('gmail')?timed(s=>g.mail('is:unread newer_than:1d',s)).then(r=>{const l=r.text.split('\n');return `${l[0].replace(/^Gmail messages matching "[^"]*"/,'unread in the last day')} ${l.slice(1,4).join('; ')}`;}).catch(()=>'could not be checked just now'):Promise.resolve(null)]);
  if(cal)lines.push(`- Calendar today: ${cal}`);
  if(mail)lines.push(`- Email: ${mail.slice(0,400)}`);
  const alerts:string[]=[];
  if(g?.snapshot().needsReconnect)alerts.push('Google needs reconnecting in Settings');
  if(this.desktop?.available&&!this.desktop.settings.control)alerts.push('computer control is turned off');
  const ms=this.missions?.list(10)??[],running=ms.filter(m=>m.status==='QUEUED'||m.status==='RUNNING'),ready=ms.filter(m=>m.status==='DONE'&&!m.heard);
  if(running.length||ready.length)lines.push(`- Research: ${[...running.map(m=>`"${m.objective.slice(0,60)}" in progress (${m.stage})`),...ready.map(m=>`"${m.objective.slice(0,60)}" ready to hear`)].join('; ')}`);
  if(this.recall)lines.push(`- Memory: ${this.memory?.active().length??0} things remembered; search ${this.recall.engine==='meaning'?'by meaning':'by words only (memory search model not set up)'}${this.recall.episodesEnabled?'; conversations kept':''}`);
  if(alerts.length)lines.push(`- Alerts: ${alerts.join('; ')}`);
  if(lines.length===1)lines.push('- Nothing pending: no reminders today and no current project.');
  return lines.join('\n').slice(0,1800);
 }
 /** "Put me back": switch to the saved project and reopen the apps that aren't open, each through its own journaled action. */
 async #restore(when:string,signal:AbortSignal):Promise<{spoken:string;report:Record<string,unknown>;changed:boolean}>{
  const ws=this.workspace!,d=this.desktop!,range=snapshotRange(when,this.now());
  if(when&&!range&&!/^(last|latest|now|before|where i was)$/i.test(when))throw new ReminderInputError(`I didn't catch which time you mean. Try "yesterday" or "Tuesday night".`);
  const snap=ws.find(range??undefined);
  if(!snap)throw new ReminderInputError(range?"I don't have a saved place from then.":'I don\'t have a saved place yet. Say "save my place" first.');
  const said:string[]=[];let changed=false;
  if(snap.projectId&&this.projects?.get(snap.projectId)&&this.projects.activeId()!==snap.projectId){
   await this.#dispatch('projects.switch',{id:snap.projectId},signal);said.push(`switched to ${snap.project}`);changed=true;
  }
  const plan=ws.plan(snap,await d.windows());const opened:string[]=[];
  if(d.canControl)for(const app of plan.launch){
   signal.throwIfAborted();
   try{const r=await this.#dispatch<{name:string}>('computer.open_app',{appId:app.appId,name:app.name},signal);opened.push(r.name);changed=true;}catch{}
  }
  if(opened.length)said.push(`opened ${list(opened)}`);
  if(plan.launch.length&&!d.canControl)said.push(`${list(plan.launch.map(l=>l.name))} ${plan.launch.length===1?'was':'were'} open, but computer control is off, so I didn't reopen ${plan.launch.length===1?'it':'them'}`);
  if(plan.already.length&&!opened.length&&!plan.launch.length)said.push(`${list(plan.already)} ${plan.already.length===1?'is':'are'} already open`);
  if(plan.browserTabs.length)said.push(`in the browser you had ${list(plan.browserTabs.map(t=>t.slice(0,50)))}`);
  if(snap.tasks.length)said.push(`the open task was ${snap.tasks[0]}`);
  const label=new Date(snap.at).toLocaleString('en-US',{weekday:'long',hour:'numeric',minute:'2-digit'});
  return {spoken:`Putting you back to ${label}.${said.length?' '+said.map(x=>x[0].toUpperCase()+x.slice(1)+'.').join(' '):' Everything from then is already open.'}`,report:{function:'workspace',ok:true,restored:snap.id,opened},changed};
 }
 /** The computer controls. HARMONY resolves names itself (app list, window list, known sites), and the confirmation is
  * fixed text describing what actually happened. */
 async #control(action:string,target:string,signal:AbortSignal):Promise<{spoken:string;report:Record<string,unknown>;changed:boolean}>{
  const d=this.desktop!,done=(spoken:string,extra:Record<string,unknown>={})=>({spoken,report:{function:'control_computer',ok:true,action,...extra},changed:true});
  const media:Record<string,[MediaKey,string]>={play_pause:['play_pause','Okay.'],pause:['play_pause','Okay.'],play:['play_pause','Okay.'],next_track:['next','Next track.'],skip:['next','Next track.'],
   previous_track:['previous','Previous track.'],volume_up:['volume_up','Turned it up.'],volume_down:['volume_down','Turned it down.'],mute:['mute','Toggled mute.'],unmute:['mute','Toggled mute.']};
  if(media[action]){
   const [key,said]=media[action];
   // Each volume key press moves Windows' volume by 2%. Default: about 10%.
   const pct=Number((target.match(/\d+/)??[''])[0]),times=key.startsWith('volume_')?Math.min(25,Math.max(1,Math.round((pct||10)/2))):1;
   if(!MEDIA_KEYS.includes(key))throw new ReminderInputError("I can't do that one.");
   await this.#dispatch('computer.media',{key,times:String(times)},signal);
   return done(said,{key,times});
  }
  if(action==='open_app'){
   if(target.length<2)throw new ReminderInputError('Which app should I open?');
   const app=findApp(await d.apps(),target);
   if(!app){
    // Not an installed app but sounds like a website ("open YouTube"): open the site instead.
    const site=websiteUrl(target);
    if(site&&!site.includes('google.com/search')){await this.#dispatch('computer.open_url',{url:site},signal);return done(`Opening ${new URL(site).hostname.replace(/^www\./,'')}.`,{url:site});}
    throw new ReminderInputError(`I couldn't find an app called ${target.slice(0,60)} on this PC.`);
   }
   const r=await this.#dispatch<{name:string}>('computer.open_app',{appId:app.id,name:app.name},signal);
   return done(`Opening ${r.name}.`,{app:r.name});
  }
  if(action==='open_website'){
   const url=websiteUrl(target);if(!url)throw new ReminderInputError('Which website should I open?');
   await this.#dispatch('computer.open_url',{url},signal);
   return done(url.includes('google.com/search')?`Searching the web for ${target.slice(0,80)}.`:`Opening ${new URL(url).hostname.replace(/^www\./,'')}.`,{url});
  }
  if(action==='switch_to'){
   const w=findWindow(await d.windows(),target);
   if(!w)throw new ReminderInputError(`I don't see a window for ${target.slice(0,60)||'that'} open.`);
   await this.#dispatch('computer.focus',{hwnd:String(w.hwnd)},signal);
   return done(`Switched to ${w.app||w.title.slice(0,60)}.`,{window:w.app});
  }
  throw new ReminderInputError("I can open apps and websites, switch windows, and control music and volume. I can't do that one yet.");
 }
 /** Runs up to two requested calls in order. Fixed sentences are spoken; nothing the model said is trusted as done. */
 async run(calls:readonly ToolCall[],signal:AbortSignal,source:Memory['source']='voice',say?:(text:string)=>void):Promise<ActionsOutcome>{
  const guard=this.more.guard;
  if(guard)return asking.run({who:guard.principal(source==='screen'?'screen':source),say},()=>this.#run(calls,signal,source));
  return this.#run(calls,signal,source);
 }
 async #run(calls:readonly ToolCall[],signal:AbortSignal,source:Memory['source']):Promise<ActionsOutcome>{
  const spoken:string[]=[],reports:Record<string,unknown>[]=[],lookups:WebResult[]=[];let changed=false;
  for(const call of calls.slice(0,MAX_CALLS)){
   signal.throwIfAborted();
   const out=await this.#one(call,signal,source);if(out.spoken)spoken.push(out.spoken);reports.push(out.report);changed||=out.changed;if(out.lookup)lookups.push(out.lookup);
  }
  if(changed){try{this.changed();}catch{}void this.recall?.index().catch(()=>{});}
  return {spoken:spoken.join(' '),report:JSON.stringify(reports.length===1?reports[0]:reports),changed,
   ...(lookups.length?{lookup:{report:lookups.map(lookupReport).join('\n\n').slice(0,2400),sources:lookups.flatMap(l=>l.sources).slice(0,8)}}:{})};
 }
 /** Cancel from the reminder list on screen (an explicit click), through the same journaled path. */
 async cancelById(id:string):Promise<boolean>{
  if(!this.store.get(id)||this.store.get(id)?.state!=='PENDING')return false;
  try{await this.#dispatch('reminders.cancel',{id},new AbortController().signal);try{this.changed();}catch{}return true;}catch{return false;}
 }
 /** From the Memory panel (explicit clicks), through the same journaled path. */
 async rememberFromScreen(text:string):Promise<boolean>{
  if(!this.memory)return false;
  try{await this.#dispatch('memory.remember',{text:memoryText(text),source:'screen'},new AbortController().signal);try{this.changed();}catch{}void this.recall?.index().catch(()=>{});return true;}catch{return false;}
 }
 async forgetById(id:string):Promise<boolean>{
  if(!this.memory||this.memory.get(id)?.state!=='ACTIVE')return false;
  try{await this.#dispatch('memory.forget',{id},new AbortController().signal);try{this.changed();}catch{}return true;}catch{return false;}
 }
 stop(){this.#bus.cancelAll();this.#dispatcher.cancelAll();}
}
