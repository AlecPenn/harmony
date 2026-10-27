import {existsSync,readFileSync,statSync,statfsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {GuardStatus} from './guardian.ts';

/** HARMONY's daily self-check: read-only, offline and quick (well under a second). Once a day, while you're away
 * from the PC, she checks her own health and tells you only if something needs you.
 *  - Her database (SQLite quick_check) and a fresh backup if the newest one is over a day old.
 *  - Free disk space where her data lives.
 *  - Every pinned model: present, and the exact size it was pinned at (hashes are checked by the workers on load).
 *  - God's Eye View: installed at the pinned commit.
 *  - Security: the encrypted vault, voice prints, a lock or paused approvals, and the certificate distrust list. */

export type Health='ok'|'warn'|'problem'|'off';
export interface CheckItem {id:string;label:string;health:Health;detail:string;fix?:string;}
export interface SelfCheckReport {at:string;items:CheckItem[];problems:number;warnings:number;summary:string;}
export interface SelfCheckDeps {
 root:string; dataRoot:string; db:DatabaseSync;
 backups?:{list():{at:string}[];daily(db:DatabaseSync):unknown}|null;
 guard?:(()=>GuardStatus|null)|null;
 trust?:(()=>{removed:string[]}|null)|null;
 offsite?:(()=>{on:boolean;confirmed:boolean;newest:string|null}|null)|null;
 freeBytes?:(path:string)=>number|null;
 now?:()=>Date;
}
const GB=1024**3;
interface Pinned {path:string;bytes:number;}

/** Each model group's pinned files, from the manifests in docs/. Optional groups count as "off" when absent. */
export function modelGroups(root:string):{id:string;label:string;optional:boolean;files:Pinned[]}[]{
 const read=(name:string)=>{try{return JSON.parse(readFileSync(join(root,'docs',name),'utf8'));}catch{return null;}};
 const list=(v:unknown):Pinned[]=>(Array.isArray(v)?v:v&&typeof v==='object'?Object.values(v):[])
  .filter((f):f is Pinned=>!!f&&typeof (f as Pinned).path==='string'&&Number.isSafeInteger((f as Pinned).bytes));
 const speaker=read('SPEAKER-MODEL.json'),guard=(read('GUARD-MODELS.json')?.models??{}) as Record<string,unknown>;
 return [
  {id:'speech',label:'Speech recognition',optional:false,files:list(read('SPEECH-MODELS.json')?.files)},
  {id:'wake',label:'Wake word',optional:true,files:list(read('WAKE-MODEL.json')?.files)},
  {id:'parakeet',label:'Faster speech model',optional:true,files:list(read('STT-PARAKEET.json')?.files)},
  {id:'speaker',label:'Voice recognition',optional:true,files:speaker?list([speaker]):[]},
  {id:'guard',label:'Face recognition',optional:true,files:list(Object.fromEntries(Object.entries(guard).filter(([k])=>!k.startsWith('hand_'))))},
  {id:'hands',label:'Hand signs',optional:true,files:list(Object.fromEntries(Object.entries(guard).filter(([k])=>k.startsWith('hand_'))))},
 ].filter(g=>g.files.length);
}
export function checkModels(root:string):CheckItem[]{
 const models=resolve(root,'data','models');
 return modelGroups(root).map(g=>{
  let missing=0,wrong=0;
  for(const f of g.files){
   const p=resolve(root,f.path);if(!p.startsWith(models)){wrong++;continue;}
   try{if(statSync(p).size!==f.bytes)wrong++;}catch{missing++;}
  }
  if(!missing&&!wrong)return {id:`model:${g.id}`,label:g.label,health:'ok',detail:`${g.files.length} file${g.files.length>1?'s':''} as pinned`};
  if(missing===g.files.length&&g.optional)return {id:`model:${g.id}`,label:g.label,health:'off',detail:'Not installed'};
  return {id:`model:${g.id}`,label:g.label,health:'problem',detail:wrong?`${wrong} file${wrong>1?'s have':' has'} changed size since it was pinned`:`${missing} of ${g.files.length} files missing`,
   fix:g.id==='guard'||g.id==='speaker'||g.id==='hands'?'Run "Set up security.cmd" again.':'Run the HARMONY setup again; it re-downloads and re-checks pinned models.'};
 });
}

export function runSelfCheck(d:SelfCheckDeps):SelfCheckReport{
 const now=(d.now??(()=>new Date()))(),items:CheckItem[]=[];
 const add=(i:CheckItem)=>items.push(i),safe=(id:string,label:string,f:()=>void)=>{try{f();}catch(e){add({id,label,health:'problem',detail:`Couldn't check: ${String((e as Error)?.message??e).slice(0,80)}`});}};

 safe('database','Database',()=>{
  const rows=d.db.prepare('PRAGMA quick_check').all() as {quick_check:string}[];const ok=rows.length===1&&rows[0].quick_check==='ok';
  add(ok?{id:'database',label:'Database',health:'ok',detail:'Healthy'}
   :{id:'database',label:'Database',health:'problem',detail:'SQLite found damage',fix:'Restore the newest backup in Settings → Backups.'});
 });
 if(d.backups)safe('backup','Backup',()=>{
  const newest=()=>d.backups!.list()[0],age=(b:{at:string}|undefined)=>b?(now.getTime()-Date.parse(b.at))/3600000:Infinity;
  if(age(newest())>=24)d.backups!.daily(d.db); // HARMONY may run for days: make today's backup here too
  const h=age(newest());
  add(h<36?{id:'backup',label:'Backup',health:'ok',detail:`Newest is ${h<1?'under an hour':`${Math.round(h)} hours`} old`}
   :{id:'backup',label:'Backup',health:'problem',detail:Number.isFinite(h)?`Newest is ${Math.round(h/24)} days old`:'No backups yet',fix:'Settings → Backups → Back up now. If that fails, check free disk space.'});
 });
 if(d.offsite)safe('offsite','Off-PC backup',()=>{
  const o=d.offsite!();if(!o)return;
  if(!o.on||!o.confirmed){add({id:'offsite',label:'Off-PC backup',health:'warn',detail:'Off. Everything is on this one disk',fix:'Settings → Backups → Off-PC copies: pick OneDrive or another drive.'});return;}
  const h=o.newest?(now.getTime()-Date.parse(o.newest))/3600000:Infinity;
  add(h<72?{id:'offsite',label:'Off-PC backup',health:'ok',detail:`Newest is ${h<1?'under an hour':`${Math.round(h)} hours`} old`}
   :{id:'offsite',label:'Off-PC backup',health:'problem',detail:Number.isFinite(h)?`Newest is ${Math.floor(h/24)} days old`:'None made yet',fix:'Plug in the backup drive, or check that OneDrive is running, then Settings → Backups → Back up off-PC now.'});
 });
 safe('disk','Disk space',()=>{
  const free=(d.freeBytes??freeBytes)(d.dataRoot);
  if(free===null){add({id:'disk',label:'Disk space',health:'off',detail:'Unknown'});return;}
  const gb=free/GB,text=`${gb>=10?Math.round(gb):gb.toFixed(1)} GB free`;
  add(gb<1?{id:'disk',label:'Disk space',health:'problem',detail:text,fix:'Free up space: backups, recordings and models stop saving when the disk is full.'}
   :gb<5?{id:'disk',label:'Disk space',health:'warn',detail:text,fix:'Getting low. Free a few GB soon.'}
   :{id:'disk',label:'Disk space',health:'ok',detail:text});
 });
 safe('models','Models',()=>{for(const i of checkModels(d.root))add(i);});
 safe('godseye',"God's Eye",()=>{
  const pin=JSON.parse(readFileSync(join(d.root,'docs','GODS-EYE-VIEW.json'),'utf8')) as {commit:string;folder:string};
  const folder=resolve(d.root,pin.folder),marker=join(folder,'.harmony-installed.json');
  if(!existsSync(folder)){add({id:'godseye',label:"God's Eye",health:'off',detail:'Not installed'});return;}
  let m:{commit?:string}={};try{m=JSON.parse(readFileSync(marker,'utf8'));}catch{}
  add(m.commit===pin.commit&&existsSync(join(folder,'node_modules','vite'))?{id:'godseye',label:"God's Eye",health:'ok',detail:`Installed at ${pin.commit.slice(0,7)}`}
   :{id:'godseye',label:"God's Eye",health:'problem',detail:m.commit?`Installed at ${m.commit.slice(0,7)}, but HARMONY expects ${pin.commit.slice(0,7)}`:'Install is incomplete',fix:'Delete .runtime\\gods-eye-view and run "Set up God\'s Eye.cmd".'});
 });
 if(d.guard)safe('security','Security',()=>{
  const g=d.guard!();if(!g){add({id:'security',label:'Security',health:'problem',detail:'The guardian is not running',fix:'Restart HARMONY.'});return;}
  if(!g.cipher)add({id:'security',label:'Security',health:'problem',detail:'Windows encryption is unavailable, so prints and keys can\'t be kept safely',fix:'Sign in to Windows normally (not as a guest) and restart HARMONY.'});
  else if(g.settings.voice&&g.voice.enrolled<3)add({id:'security',label:'Security',health:'warn',detail:'Your voice isn\'t taught yet, so anyone who talks to her is treated as you',fix:'Settings → Security → Teach my voice.'});
  else add({id:'security',label:'Security',health:'ok',detail:`Voice ${g.settings.voice?'on':'off'}, face ${g.settings.face?'on':'off'}`});
  if(g.locked)add({id:'lock',label:'Lock',health:'warn',detail:`Locked: ${g.locked.reason}`,fix:'Unlock when you\'re back.'});
  if(g.paused)add({id:'approvals',label:'Approvals',health:'warn',detail:'Approvals were paused after repeated refusals',fix:'Check Security → What happened.'});
 });
 if(d.trust)safe('trust','Certificates',()=>{
  const t=d.trust!();
  add(t?{id:'trust',label:'Certificates',health:'ok',detail:t.removed.length?`${t.removed.length} distrusted authorit${t.removed.length>1?'ies':'y'} removed`:'Distrust list applied (none present)'}
   :{id:'trust',label:'Certificates',health:'warn',detail:'The distrust list couldn\'t be applied to background connections',fix:'HARMONY\'s windows still refuse them. Restart HARMONY.'});
 });

 const problems=items.filter(i=>i.health==='problem').length,warnings=items.filter(i=>i.health==='warn').length;
 const bad=items.filter(i=>i.health==='problem'||i.health==='warn');
 const summary=!bad.length?`Self-check: all ${items.filter(i=>i.health==='ok').length} checks fine.`
  :`Self-check: ${bad.map(i=>`${i.label.toLowerCase()}: ${i.detail.charAt(0).toLowerCase()+i.detail.slice(1)}`).join('; ')}.`;
 return {at:now.toISOString(),items,problems,warnings,summary:summary.slice(0,400)};
}
export function freeBytes(path:string):number|null{try{const s=statfsSync(path);return Number(s.bavail)*Number(s.bsize);}catch{return null;}}

/** Runs the check once a day while you've been away from the PC for 10 minutes (or at startup if it's overdue by a
 * day), keeps the newest report, and raises a notice only when something needs you. */
export class SelfCheck {
 #timer:ReturnType<typeof setInterval>|null=null;#last:SelfCheckReport|null=null;
 private deps:SelfCheckDeps;private idleSeconds:()=>number;private notify:(r:SelfCheckReport)=>void;
 constructor(deps:SelfCheckDeps,idleSeconds:()=>number,notify:(r:SelfCheckReport)=>void){
  this.deps=deps;this.idleSeconds=idleSeconds;this.notify=notify;
  try{const v=deps.db.prepare("SELECT value FROM memory_settings WHERE key='self_check'").get() as {value?:string}|undefined;if(v?.value)this.#last=JSON.parse(v.value);}catch{}
 }
 get last(){return this.#last;}
 #now(){return (this.deps.now??(()=>new Date()))();}
 due(){const l=this.#last;if(!l)return true;const h=(this.#now().getTime()-Date.parse(l.at))/3600000;return h>=48||(h>=20&&this.idleSeconds()>=600);}
 run():SelfCheckReport{
  const r=runSelfCheck(this.deps);this.#last=r;
  try{this.deps.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('self_check',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(r));}catch{}
  if(r.problems||r.warnings)try{this.notify(r);}catch{}
  return r;
 }
 tick(){if(this.due())return this.run();return null;}
 start(){if(this.#timer)return;this.#timer=setInterval(()=>{try{this.tick();}catch{}},15*60000);this.#timer.unref?.();}
 stop(){if(this.#timer)clearInterval(this.#timer);this.#timer=null;}
}
