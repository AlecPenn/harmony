import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

/** HARMONY's guardian: who is talking, who is at the PC, and whether an action may happen.
 *
 * Evidence (all computed on this PC by workers/guard): a voice print of each spoken request, and, if turned on, a
 * face print plus a liveness score from a moment of camera. Prints are stored only inside an encrypted vault
 * (Windows DPAPI), and only after a secret random rotation ("cancelable biometrics"): similarity between prints is
 * unchanged, but a stolen print is useless without the key, and "Reset" makes every old print worthless.
 *
 * Decisions:
 *  - A voice that isn't yours gets guest mode (general questions; no memory, mail, calendar, screen or actions).
 *  - Touching the desktop needs a tap on your paired phone, with number matching (the phone must pick the number
 *    HARMONY shows or says), single use, 60 seconds, and a cool-down if requests keep being refused.
 *  - With no phone paired, an approval can also be given by saying three random words HARMONY picks right then, in
 *    your voice. A recording of you can't know them, and someone else saying them doesn't match your voice print.
 *  - She locks when Windows locks or you've been away, on "lock down", on your duress phrase (silently), when a photo
 *    or screen is held up to the camera, or when strangers keep trying. Strict locks open only from your phone.
 * Nothing here records audio or images; the event log holds times and short descriptions, never prints.
 */

export type Who='owner'|'stranger'|'unsure'|'unchecked';
export interface Verdict {who:Who;score:number|null;}
export type Channel='voice'|'typed'|'screen'|'phone'|'agent';
export interface GuardSettings {
 voice:boolean; face:boolean; strangers:'guest'|'ignore'; phone:'always'|'unless-seen'|'off'; changes:boolean;
 autoLock:boolean; lockAfterMin:number; veil:boolean;
}
export const DEFAULT_SETTINGS:GuardSettings={voice:true,face:false,strangers:'guest',phone:'always',changes:false,autoLock:true,lockAfterMin:15,veil:true};
export interface GuardEvent {at:string;kind:string;detail:string;}
export interface PendingApproval {id:string;title:string;detail:string;choices:number[];expiresAt:string;}
export interface GuardStatus {
 ready:boolean; cipher:boolean; settings:GuardSettings;
 voice:{enrolled:number;adaptive:number;threshold:number;model:boolean};
 face:{enrolled:number;threshold:number;model:boolean;lastSeen:string|null};
 duress:boolean; locked:null|{reason:string;strict:boolean;at:string};
 lastVoice:Verdict|null; onlookers:number; veil:boolean; paused:string|null;
 approvals:(PendingApproval&{code:number;via:'phone'|'desk';group:string;words?:string[]})[]; faceRequest:number; events:GuardEvent[];
}
export interface FaceReading {faces:number;embedding:Float32Array|null;live:number|null;yaw:number|null;reason?:string;}
export interface Seal {available():Promise<boolean>;encrypt(text:string):Promise<Buffer>;decrypt(data:Buffer):Promise<string>;}
export interface GuardDeps {
 /** True when at least one phone is paired with signed approvals. */
 phonePaired():boolean;
 /** Something worth knowing right away (desktop notification + phone notice). */
 alert(text:string):void;
 changed():void;
 models():{voice:boolean;face:boolean};
 /** Spoken challenge words: open (true) or close (false) the microphone mid-turn. Returns whether it's live. */
 listen?(on:boolean):boolean;
}
export class GuardDenied extends Error {}

/** Tools anyone may use: public information only. Everything else is personal or changes something. */
export const PUBLIC_TOOLS=new Set(['web.weather','web.news','web.search','web.read','skills.list','godseye.ask']);
const DESKTOP=/^computer\./;
const VOICE_DIM=256,FACE_DIM=128,MAX_VOICE=6,MAX_ADAPTIVE=8,MAX_FACE=5,APPROVAL_MS=60000,TRUST_MS=10*60000;
const FAIL_WINDOW=10*60000,FAIL_LIMIT=3,PAUSE_MS=10*60000,STRANGER_WINDOW=2*60000,STRANGER_LIMIT=3,SEEN_MS=20000;
export const LIVE_OK=.5,LIVE_SPOOF=-1;

const b64=(v:Float32Array)=>Buffer.from(v.buffer,v.byteOffset,v.byteLength).toString('base64');
export function vector(text:unknown,dim:number):Float32Array|null{
 if(typeof text!=='string'||text.length>4*dim*2)return null;
 const raw=Buffer.from(text,'base64');if(raw.length!==dim*4)return null;
 const v=new Float32Array(dim);for(let i=0;i<dim;i++)v[i]=raw.readFloatLE(i*4);
 return normalize(v);
}
function normalize(v:Float32Array):Float32Array|null{
 let n=0;for(const x of v){if(!Number.isFinite(x))return null;n+=x*x;}n=Math.sqrt(n);if(n<1e-9)return null;
 return v.map(x=>x/n);
}
export const cosine=(a:Float32Array,b:Float32Array)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};

/** A secret rotation of the print space, made from the vault key: cos(Qa,Qb)=cos(a,b). Gram-Schmidt on a
 * deterministic Gaussian matrix (HMAC-SHA256 counter stream, Box-Muller). */
export function rotation(seed:Buffer,dim:number):Float64Array[]{
 let counter=0,pool:number[]=[];
 const uniform=()=>{if(!pool.length){const h=createHmac('sha256',seed).update(`${dim}:${counter++}`).digest();for(let i=0;i<32;i+=4)pool.push((h.readUInt32LE(i)+.5)/4294967296);}return pool.pop()!;};
 const gauss=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
 const rows:Float64Array[]=[];
 while(rows.length<dim){
  const r=new Float64Array(dim);for(let i=0;i<dim;i++)r[i]=gauss();
  for(const q of rows){let d=0;for(let i=0;i<dim;i++)d+=r[i]*q[i];for(let i=0;i<dim;i++)r[i]-=d*q[i];}
  let n=0;for(const x of r)n+=x*x;n=Math.sqrt(n);if(n<1e-6)continue;
  for(let i=0;i<dim;i++)r[i]/=n;rows.push(r);
 }
 return rows;
}
const rotate=(q:Float64Array[],v:Float32Array)=>{const out=new Float32Array(q.length);for(let r=0;r<q.length;r++){let s=0;const row=q[r];for(let i=0;i<v.length;i++)s+=row[i]*v[i];out[r]=s;}return out;};

interface Vault {v:1;key:string;voice:string[];adaptive:string[];face:string[];voiceThreshold:number;faceThreshold:number;duress:string|null;}
const emptyVault=():Vault=>({v:1,key:randomBytes(32).toString('hex'),voice:[],adaptive:[],face:[],voiceThreshold:.48,faceThreshold:.4,duress:null});
const normalPhrase=(t:string)=>t.toLowerCase().replace(/^\s*(?:(?:hey|hi|ok(?:ay)?)[\s,]+)?harmony\b/,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
interface Approval extends PendingApproval {code:number;group:string;via:'phone'|'desk';expires:number;words?:string[];done:(ok:boolean)=>void;}
/** Challenge words: short, common, unlike each other and easy for the speech model to hear (no numbers, no homophones). */
export const CHALLENGE_WORDS=['amber','anchor','apple','arrow','banjo','basket','bison','blossom','canyon','castle','cedar','cobalt','copper','coral','cricket','dolphin',
 'ember','falcon','feather','forest','garnet','glacier','harbor','hazel','island','jasper','kettle','lantern','lemon','maple','marble','meadow',
 'mango','nectar','oyster','panda','pepper','pillow','planet','puzzle','quartz','rabbit','raven','ribbon','rocket','saddle','salmon','silver',
 'spider','summit','thunder','tiger','timber','tulip','velvet','violet','walnut','willow','window','yellow','zebra','orchid','parrot','pebble'] as const;
export function challengeWords(n=3):string[]{const out=new Set<string>();while(out.size<n)out.add(CHALLENGE_WORDS[randomInt(0,CHALLENGE_WORDS.length)]);return [...out];}
const near=(a:string,b:string)=>{ // equal, or one edit apart for longer words ("harbour", "pebbles")
 if(a===b)return true;if(b.length<5||Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
 return edits+(a.length-i)+(b.length-j)<=1;
};
/** The words, in order, and not buried in a long sentence (at most 3 other words). */
export function saidWords(text:string,words:readonly string[]):boolean{
 const said=normalPhrase(text).split(' ').filter(Boolean);if(!said.length||said.length>words.length+3)return false;
 let k=0;for(const w of said)if(k<words.length&&near(w,words[k]))k++;
 return k===words.length;
}
const LOCK_WORDS=/^(?:lock (?:down|up|yourself|it all|everything)|lockdown|go dark|privacy lock)$/;

/** What an action looks like on the phone and on screen. Only names and hosts, never message contents. */
export function describeAction(toolId:string,inputs:unknown):{title:string;detail:string}{
 const i=(inputs&&typeof inputs==='object'?inputs:{}) as Record<string,unknown>,s=(k:string,n=60)=>typeof i[k]==='string'?(i[k] as string).replace(/[\u0000-\u001f]/g,' ').slice(0,n):'';
 switch(toolId){
  case 'computer.open_app':return {title:`Open ${s('name')||'an app'}`,detail:'Starts an app on your PC'};
  case 'computer.open_url':{let host='a website';try{host=new URL(s('url',2000)).hostname;}catch{}return {title:`Open ${host}`,detail:'Opens it in your browser'};}
  case 'computer.focus':return {title:'Switch windows',detail:'Brings another window to the front'};
  case 'computer.media':return {title:`Press ${s('key').replace(/_/g,' ')||'a media key'}`,detail:'Music or volume'};
  case 'reminders.set':return {title:'Set a reminder',detail:s('text',80)};
  case 'reminders.cancel':return {title:'Cancel a reminder',detail:''};
  case 'memory.remember':return {title:'Remember something',detail:s('text',80)};
  case 'memory.forget':return {title:'Forget something',detail:''};
  case 'unlock':return {title:'Unlock HARMONY',detail:'Lets her use your private things again'};
  default:return {title:toolId.replace(/[._]/g,' '),detail:''};
 }
}

export class Guardian {
 #vault:Vault|null=null;#qVoice:Float64Array[]|null=null;#qFace:Float64Array[]|null=null;#cipher=false;
 #voices=new Map<number,{at:number;v:Float32Array|null}>();#voiceWaiters=new Map<number,((v:Float32Array|null)=>void)[]>();
 #lastVoice:Verdict|null=null;#voiceAt=0;#faceAt=0;#faceSeen:number|null=null;#onlookers=0;#onlookersAt=0;
 #strangers:number[]=[];#fails:number[]=[];#pausedUntil=0;#trust=new Map<string,number>();
 #locked:{reason:string;strict:boolean;at:number}|null=null;#approvals=new Map<string,Approval>();#faceRequest=0;#phoneAsk=0;
 #principal:{channel:Channel;verdict:Verdict}={channel:'typed',verdict:{who:'unchecked',score:null}};
 #save:Promise<void>=Promise.resolve();
 private db:DatabaseSync;private seal:Seal;private deps:GuardDeps;private now:()=>number;
 constructor(db:DatabaseSync,seal:Seal,deps:GuardDeps,now:()=>number=Date.now){this.db=db;this.seal=seal;this.deps=deps;this.now=now;}

 // ---- storage --------------------------------------------------------------------------------------------
 #get(key:string){try{const r=this.db.prepare('SELECT value FROM memory_settings WHERE key=?').get(key);return r?String(r.value):null;}catch{return null;}}
 #put(key:string,value:string|null){if(value===null)this.db.prepare('DELETE FROM memory_settings WHERE key=?').run(key);else this.db.prepare('INSERT INTO memory_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 /** Reads the encrypted vault. Without Windows encryption, prints are never stored and checks stay off. */
 async load(){
  this.#cipher=await this.seal.available().catch(()=>false);
  const sealed=this.#get('guard_vault');let vault:Vault|null=null;
  if(sealed&&this.#cipher)try{const v=JSON.parse(await this.seal.decrypt(Buffer.from(sealed,'base64')));if(v?.v===1&&/^[0-9a-f]{64}$/.test(v.key))vault=v;}catch{}
  if(sealed&&!vault)this.log('vault','The saved prints could not be opened, so they were set aside. Teach me again.');
  this.#use(vault??emptyVault());
  try{const l=JSON.parse(this.#get('guard_lock')??'null');if(l&&typeof l.reason==='string')this.#locked={reason:l.reason.slice(0,80),strict:l.strict===true,at:Number(l.at)||this.now()};}catch{}
  this.deps.changed();
 }
 #use(v:Vault){this.#vault=v;const key=Buffer.from(v.key,'hex');this.#qVoice=rotation(key,VOICE_DIM);this.#qFace=rotation(key,FACE_DIM);}
 #persist(){
  const v=this.#vault;if(!v||!this.#cipher)return this.#save;
  const json=JSON.stringify(v);
  this.#save=this.#save.then(async()=>{try{this.#put('guard_vault',(await this.seal.encrypt(json)).toString('base64'));}catch{this.log('vault','Could not save the prints.');}});
  return this.#save;
 }
 settings():GuardSettings{
  try{const s=JSON.parse(this.#get('guard_settings')??'{}');return sanitize({...DEFAULT_SETTINGS,...(s&&typeof s==='object'?s:{})});}catch{return {...DEFAULT_SETTINGS};}
 }
 update(patch:unknown){
  if(!patch||typeof patch!=='object')throw new GuardDenied('Bad settings');
  const next=sanitize({...this.settings(),...patch as object});
  this.#put('guard_settings',JSON.stringify(next));this.log('settings',`Security settings changed`);this.deps.changed();return next;
 }
 log(kind:string,detail:string){
  try{this.db.prepare('INSERT INTO guard_events (at,kind,detail) VALUES (?,?,?)').run(new Date(this.now()).toISOString(),kind.slice(0,20),detail.replace(/[\u0000-\u001f]/g,' ').slice(0,200));
   this.db.prepare('DELETE FROM guard_events WHERE id <= (SELECT MAX(id)-500 FROM guard_events)').run();}catch{}
 }
 events(limit=40):GuardEvent[]{try{return this.db.prepare('SELECT at,kind,detail FROM guard_events ORDER BY id DESC LIMIT ?').all(limit).map(r=>({at:String(r.at),kind:String(r.kind),detail:String(r.detail)}));}catch{return [];}}

 // ---- enrollment -----------------------------------------------------------------------------------------
 /** One clip of you talking. After three, the match line is set from how alike your own clips are. */
 enrollVoice(embedding:Float32Array):{count:number;ready:boolean}{
  const v=this.#vault;if(!v||!this.#cipher)throw new GuardDenied('Windows encryption is needed to keep voice prints safely.');
  const p=rotate(this.#qVoice!,embedding);if(v.voice.length>=MAX_VOICE)v.voice.shift();v.voice.push(b64(p));
  if(v.voice.length>=3){
   const all=v.voice.map(x=>vector(x,VOICE_DIM)!);let sum=0,n=0;
   for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){sum+=cosine(all[i],all[j]);n++;}
   v.voiceThreshold=clamp(sum/n-.2,.4,.6);
  }
  void this.#persist();this.log('enroll','Voice clip added');this.deps.changed();
  return {count:v.voice.length,ready:v.voice.length>=3};
 }
 /** One look at you. Must be a single, live, roughly front-facing face. */
 enrollFace(r:FaceReading):{count:number;ready:boolean;problem:string|null}{
  const v=this.#vault;if(!v||!this.#cipher)throw new GuardDenied('Windows encryption is needed to keep face prints safely.');
  const problem=r.faces===0||!r.embedding?(r.reason==='too far'?'Come a little closer.':r.reason==='blurry'?'Hold still, it was blurry.':'I can\'t see a face.')
   :r.faces>1?'Only you in the picture, please.':(r.live??-9)<LIVE_OK?'That doesn\'t look like a live face. Better light helps.':Math.abs(r.yaw??0)>.3?'Look straight at the camera.':null;
  if(problem||!r.embedding)return {count:v.face.length,ready:v.face.length>=2,problem};
  if(v.face.length>=MAX_FACE)v.face.shift();v.face.push(b64(rotate(this.#qFace!,r.embedding)));
  void this.#persist();this.log('enroll','Face look added');this.#faceAt=this.now();this.deps.changed();
  return {count:v.face.length,ready:v.face.length>=2,problem:null};
 }
 /** A phrase that, said to her, quietly locks everything while looking like nothing happened. */
 setDuress(phrase:string|null){
  const v=this.#vault;if(!v||!this.#cipher)throw new GuardDenied('Windows encryption is needed.');
  const p=phrase===null?'':normalPhrase(phrase);
  if(phrase!==null&&(p.split(' ').length<2||p.length>80))throw new GuardDenied('Use two to ten words nobody would say by accident.');
  v.duress=phrase===null?null:createHmac('sha256',Buffer.from(v.key,'hex')).update(p).digest('hex');
  void this.#persist();this.log('settings',phrase===null?'Duress phrase removed':'Duress phrase set');this.deps.changed();
 }
 /** Forget every print and make any copy of the old ones useless (new rotation key). */
 async reset(what:'voice'|'face'|'all'){
  const v=this.#vault;if(!v)return;
  if(what==='all')this.#use({...emptyVault(),duress:null});
  else if(what==='voice'){v.voice=[];v.adaptive=[];v.voiceThreshold=.48;}else{v.face=[];v.faceThreshold=.4;}
  await this.#persist();this.log('reset',what==='all'?'All prints erased; new key':what==='voice'?'Voice prints erased':'Face prints erased');this.deps.changed();
 }

 // ---- evidence ---------------------------------------------------------------------------------------------
 /** A voice print from the speech worker, for one finished request (segment). */
 voice(segment:number,embedding:Float32Array|null){
  if(!Number.isSafeInteger(segment))return;
  if(this.#voices.size>16)this.#voices.delete(this.#voices.keys().next().value!);
  this.#voices.set(segment,{at:this.now(),v:embedding});
  for(const w of this.#voiceWaiters.get(segment)??[])w(embedding);this.#voiceWaiters.delete(segment);
 }
 get voiceActive(){const s=this.settings();return s.voice&&(this.#vault?.voice.length??0)>=3&&this.deps.models().voice;}
 /** Who said a request. Waits briefly for its print (computed alongside transcription). */
 async verdict(segment:number|null,waitMs=700):Promise<Verdict>{
  if(!this.voiceActive)return {who:'unchecked',score:null};
  let v:Float32Array|null=null;
  if(segment!==null){
   const have=this.#voices.get(segment);
   v=have?have.v:await new Promise<Float32Array|null>(resolve=>{const t=setTimeout(()=>resolve(null),waitMs);(this.#voiceWaiters.get(segment)??this.#voiceWaiters.set(segment,[]).get(segment)!).push(x=>{clearTimeout(t);resolve(x);});});
  }
  return this.judgeVoice(v);
 }
 #score(v:Float32Array):{p:Float32Array;score:number;who:Who}{
  const vault=this.#vault!,p=rotate(this.#qVoice!,v),sims=[...vault.voice,...vault.adaptive].map(x=>cosine(p,vector(x,VOICE_DIM)!)).sort((a,b)=>b-a);
  const score=sims.length?(sims[0]+(sims[1]??sims[0]))/2:0,t=vault.voiceThreshold;
  return {p,score,who:score>=t?'owner':score>=t-.12?'unsure':'stranger'};
 }
 judgeVoice(v:Float32Array|null):Verdict{
  const vault=this.#vault!;
  if(!v){this.#lastVoice={who:'unsure',score:null};return this.#lastVoice;} // too short to tell
  const {p,score,who}=this.#score(v),t=vault.voiceThreshold,now=this.now();
  this.#lastVoice={who,score:Math.round(score*1000)/1000};
  if(who==='owner'){
   this.#voiceAt=now;
   // Learns your voice over time, but only from requests the camera also confirmed were you.
   if(score>=t+.08&&now-this.#faceAt<SEEN_MS&&(vault.voice.length+vault.adaptive.length)>0){if(vault.adaptive.length>=MAX_ADAPTIVE)vault.adaptive.shift();vault.adaptive.push(b64(p));void this.#persist();}
   if(this.#locked&&!this.#locked.strict&&!(this.settings().face&&(vault.face.length>0)))this.unlock('your voice');
  }else if(who==='stranger'){
   this.#strangers=this.#strangers.filter(t=>now-t<STRANGER_WINDOW);this.#strangers.push(now);
   this.log('stranger',`A voice I don't know (match ${Math.round(score*100)}%)`);
   if(this.#strangers.length>=STRANGER_LIMIT&&!this.#locked){this.lock('Several unknown voices tried to use me',false);this.deps.alert('HARMONY locked: several voices she doesn\'t know tried to use her.');this.#strangers=[];}
  }
  this.deps.changed();return this.#lastVoice;
 }
 /** A moment of camera. Owner (live) refreshes presence; your face but not live (a photo or screen) locks. */
 seen(r:FaceReading){
  const vault=this.#vault,now=this.now();if(!vault)return {who:'unchecked' as Who};
  let who:Who='unchecked',score:number|null=null;
  if(r.embedding&&vault.face.length){
   const p=rotate(this.#qFace!,r.embedding);score=Math.max(...vault.face.map(x=>cosine(p,vector(x,FACE_DIM)!)));
   const live=r.live??-9;
   if(score>=vault.faceThreshold&&live>=LIVE_OK){who='owner';this.#faceAt=now;this.#faceSeen=now;if(this.#locked&&!this.#locked.strict)this.unlock('your face');}
   else if(score>=vault.faceThreshold&&live<=LIVE_SPOOF){
    who='stranger';this.log('spoof','Your face was shown to the camera, but it looked like a photo or a screen');
    if(!this.#locked||!this.#locked.strict){this.lock('A photo or screen of your face was held up',true);this.deps.alert('HARMONY locked: someone held a photo or screen of your face to the camera.');}
   }else who=score>=vault.faceThreshold?'unsure':'stranger';
  }
  this.#onlookers=Math.max(0,r.faces-(who==='owner'?1:0));this.#onlookersAt=now;
  this.deps.changed();return {who,score};
 }
 /** Ask the window to take a quick camera look (it opens the camera for about a second). */
 requestFace(){if(this.settings().face&&(this.#vault?.face.length??0)>0&&this.deps.models().face){this.#faceRequest++;this.deps.changed();}}
 /** Called every minute: Windows idle seconds, and whether Windows itself is locked. */
 tick(idleSeconds:number){
  const s=this.settings(),now=this.now();
  for(const a of this.#approvals.values())if(now>=a.expires)this.#finish(a,false,'timeout');
  if(s.autoLock&&!this.#locked&&idleSeconds>=s.lockAfterMin*60&&now-this.#faceAt>=s.lockAfterMin*60000)this.lock('You were away',false);
  if(s.face&&!this.#locked&&idleSeconds<60)this.requestFace();      // a look now and then while you're working
  if(this.#locked&&!this.#locked.strict&&idleSeconds<30)this.requestFace(); // you're back: try to recognise you
 }
 windowsLocked(){if(this.settings().autoLock&&!this.#locked)this.lock('Windows was locked',false);}

 // ---- lock -----------------------------------------------------------------------------------------------
 lock(reason:string,strict:boolean){
  this.#locked={reason:reason.slice(0,80),strict,at:this.now()};this.#trust.clear();
  for(const a of this.#approvals.values())if(a.group!=='unlock')this.#finish(a,false,'locked');
  this.#put('guard_lock',JSON.stringify({reason:this.#locked.reason,strict,at:this.#locked.at}));
  this.log('lock',`${strict?'Locked down':'Locked'}: ${reason}`);this.deps.changed();
 }
 unlock(how:string){if(!this.#locked)return;this.#locked=null;this.#put('guard_lock',null);this.log('unlock',`Unlocked by ${how}`);this.deps.changed();}
 get locked(){return this.#locked;}
 /** Locked: send an unlock request to the phone (or the screen if no phone is paired). */
 async requestUnlock(signal?:AbortSignal):Promise<boolean>{
  if(!this.#locked)return true;
  const ok=await this.approve('unlock',describeAction('unlock',{}),signal,undefined,true);
  if(ok)this.unlock(this.deps.phonePaired()?'your phone':'the screen');return ok;
 }
 /** Words that mean something to the guardian, checked before anything else. Returns what to say, or null.
  * The duress phrase returns an ordinary "Okay." so whoever is watching sees nothing happen. */
 intercept(text:string,verdict:Verdict):string|null{
  const p=normalPhrase(text),v=this.#vault;
  if(v?.duress&&p&&timingSafeEqual(Buffer.from(createHmac('sha256',Buffer.from(v.key,'hex')).update(p).digest('hex')),Buffer.from(v.duress))){
   this.lock('Duress phrase',true);this.deps.alert('HARMONY: duress phrase heard. Everything private is locked until you unlock from this phone.');return 'Okay.';
  }
  if(LOCK_WORDS.test(p)&&verdict.who!=='stranger'){this.lock('You asked',true);return 'Locked down. Only your phone can unlock me.';}
  if(this.#locked&&/^unlock(?: yourself| harmony)?$/.test(p)){void this.requestUnlock().catch(()=>{});return this.deps.phonePaired()?'Check your phone to unlock me.':'Unlock me on the screen.';}
  return null;
 }

 // ---- who is asking --------------------------------------------------------------------------------------
 /** The next typed request came from the paired phone (not the keyboard). */
 markPhoneAsk(){this.#phoneAsk=this.now();}
 begin(channel:Channel,verdict:Verdict={who:'unchecked',score:null}){this.#principal=this.principal(channel,verdict);}
 /** Who is asking on this channel: typed text right after a phone ask is the phone; voice carries its verdict. */
 principal(channel:Channel,verdict?:Verdict):{channel:Channel;verdict:Verdict}{
  if(channel==='typed'&&this.now()-this.#phoneAsk<120000){channel='phone';this.#phoneAsk=0;}
  return {channel,verdict:verdict??(channel==='voice'?this.#principal.verdict:{who:'unchecked',score:null})};
 }
 /** A voice that isn't yours, or a locked HARMONY: answer general questions only, with nothing personal. */
 guest(verdict:Verdict):boolean{return !!this.#locked||(this.voiceActive&&(verdict.who==='stranger'||verdict.who==='unsure'));}
 ignoreStrangers(){return this.settings().strangers==='ignore';}
 #recentlySeen(){return this.now()-this.#faceAt<SEEN_MS;}
 /** Throws GuardDenied (with a sentence to say) unless this action may run now; may wait for a phone tap. */
 async authorize(toolId:string,risk:string,inputs:unknown,signal:AbortSignal,say?:(text:string)=>void,who?:{channel:Channel;verdict:Verdict}):Promise<void>{
  if(PUBLIC_TOOLS.has(toolId))return;
  const {channel,verdict}=who??this.#principal,s=this.settings();
  if(this.#locked){
   if(channel==='screen'&&!this.#locked.strict&&!this.deps.phonePaired())return; // clicks at the PC when no phone exists
   throw new GuardDenied(this.#locked.strict?'I\'m locked down. Unlock me from your phone first.':'I\'m locked. Say "unlock" or look at the camera.');
  }
  if(channel==='voice'&&this.voiceActive&&verdict.who!=='owner')throw new GuardDenied(verdict.who==='unsure'?'I couldn\'t be sure that was you. Say it again a little longer, or type it.':'Sorry, I only do that for the person I belong to.');
  if(risk==='SAFE')return;
  const desktop=DESKTOP.test(toolId);
  const needs=desktop?s.phone!=='off'&&!(s.phone==='unless-seen'&&this.#recentlySeen()&&(channel!=='voice'||this.now()-this.#voiceAt<SEEN_MS))
   :s.changes&&channel==='voice'&&verdict.who!=='owner';
  if(!needs||channel==='screen')return;
  const group=desktop?'desktop':'changes';
  if((this.#trust.get(group)??0)>this.now())return;
  const ok=await this.approve(group,describeAction(toolId,inputs),signal,say);
  if(!ok)throw new GuardDenied(this.#pausedUntil>this.now()?'Approvals are paused for a few minutes after several refusals.':'Not approved, so I left it.');
 }

 /** Changing security itself (settings, new prints, the duress phrase, erasing): never while locked, and with a
  * phone paired, only after it approves (then trusted for 10 minutes, long enough to finish setup). */
 async sensitive(title:string,signal?:AbortSignal):Promise<void>{
  if(this.#locked)throw new GuardDenied('Unlock HARMONY first.');
  if(!this.deps.phonePaired()||(this.#trust.get('security')??0)>this.now())return;
  const ok=await this.approve('security',{title,detail:'Security settings'},signal);
  if(!ok)throw new GuardDenied('Not approved on your phone.');
  this.#trust.set('security',this.now()+TRUST_MS);
 }

 // ---- approvals ------------------------------------------------------------------------------------------
 /** Number matching: HARMONY shows (and says) one number; the phone offers three and you tap that one. */
 approve(group:string,what:{title:string;detail:string},signal?:AbortSignal,say?:(text:string)=>void,unlock=false):Promise<boolean>{
  const now=this.now();
  if(this.#pausedUntil>now)return Promise.resolve(false);
  if(signal?.aborted)return Promise.resolve(false);
  if(this.#approvals.size>=3)return Promise.resolve(false);
  const via:'phone'|'desk'=this.deps.phonePaired()?'phone':'desk';
  const code=randomInt(10,100),choices=new Set([code]);while(choices.size<3)choices.add(randomInt(10,100));
  const id=randomBytes(8).toString('hex');
  // No phone: you can also approve by saying three fresh random words (checked against your voice print).
  const words=via==='desk'&&this.voiceActive&&!unlock&&this.#listen(true)?challengeWords():undefined;
  return new Promise<boolean>(resolve=>{
   const a:Approval={id,title:what.title.slice(0,80),detail:what.detail.slice(0,120),choices:shuffle([...choices]),expiresAt:new Date(now+APPROVAL_MS).toISOString(),
    code,group:unlock?'unlock':group,via,expires:now+APPROVAL_MS,...(words?{words}:{}),done:ok=>{signal?.removeEventListener('abort',abort);resolve(ok);}};
   const abort=()=>this.#finish(a,false,'cancelled');signal?.addEventListener('abort',abort,{once:true});
   this.#approvals.set(id,a);this.log('approval',`Asked: ${a.title}`);
   const where=via==='phone'?'on your phone':'on the screen';
   try{say?.(words?`To approve, say: ${words.join(', ')}. Or tap approve on the screen.`:`Approve it ${where}: tap ${code}.`);}catch{}
   this.deps.alert(words?`HARMONY wants to: ${a.title}. Say "${words.join(' ')}" or approve on the screen.`:`HARMONY wants to: ${a.title}. Tap ${code} ${where} to approve.`);this.deps.changed();
   const t=setTimeout(()=>this.#finish(a,false,'timeout'),APPROVAL_MS+50);t.unref?.();
  });
 }
 /** An answer from the phone (signed, checked by the companion server) or from the screen. */
 answer(id:string,answer:{approve:boolean;pick:number|null;trust:boolean},from:'phone'|'desk'):'ok'|'denied'|'wrong'|'gone'{
  const a=this.#approvals.get(id);if(!a||this.now()>=a.expires)return 'gone';
  if(from!==a.via)return 'gone'; // with a phone paired, only the phone can approve
  if(!answer.approve){this.#finish(a,false,'denied');return 'denied';}
  if(answer.pick!==a.code){this.#finish(a,false,'wrong number');return 'wrong';}
  if(answer.trust&&a.group!=='unlock')this.#trust.set(a.group,this.now()+TRUST_MS);
  this.#finish(a,true,answer.trust?'approved for 10 minutes':'approved');return 'ok';
 }
 #finish(a:Approval,ok:boolean,how:string){
  if(!this.#approvals.delete(a.id))return;
  if(a.words&&![...this.#approvals.values()].some(x=>x.words))this.#listen(false);
  this.log('approval',`${a.title}: ${how}`);
  if(!ok&&how!=='cancelled'&&how!=='locked'){
   const now=this.now();this.#fails=this.#fails.filter(t=>now-t<FAIL_WINDOW);this.#fails.push(now);
   if(this.#fails.length>=FAIL_LIMIT){this.#pausedUntil=now+PAUSE_MS;this.#fails=[];this.log('paused','Approvals paused for 10 minutes after repeated refusals');
    this.deps.alert('HARMONY paused approval requests for 10 minutes: several were refused or missed. If that wasn\'t you, someone may be trying to use her.');}
  }
  a.done(ok);this.deps.changed();
 }
 #listen(on:boolean):boolean{try{return this.deps.listen?.(on)??false;}catch{return false;}}
 /** Something said while challenge words are open. The words must be said in your voice; "no" or "cancel" from
  * you refuses. Anything else (including HARMONY hearing herself say the words) is ignored, without penalty. */
 async spoken(text:string,segment:number,waitMs=1500):Promise<'approved'|'refused'|'ignored'>{
  const open=[...this.#approvals.values()].filter(a=>a.words&&a.expires>this.now());if(!open.length||!this.voiceActive)return 'ignored';
  const match=open.find(a=>saidWords(text,a.words!)),no=/^(?:no|nope|cancel|stop|refuse|deny|don ?t|do not)\b/.test(normalPhrase(text));
  if(!match&&!no)return 'ignored';
  const have=this.#voices.get(segment);
  const v=have?have.v:await new Promise<Float32Array|null>(resolve=>{const t=setTimeout(()=>resolve(null),waitMs);(this.#voiceWaiters.get(segment)??this.#voiceWaiters.set(segment,[]).get(segment)!).push(x=>{clearTimeout(t);resolve(x);});});
  const who=v?this.#score(v).who:'unsure';
  if(match){
   if(!this.#approvals.has(match.id))return 'ignored';
   if(who==='owner'){this.#voiceAt=this.now();this.#finish(match,true,'approved by saying the words');return 'approved';}
   this.log('challenge',who==='stranger'?'The approval words were said in a voice I don\'t know':'The approval words were said, but I couldn\'t be sure it was you');
   return 'ignored';
  }
  if(who==='stranger')return 'ignored';
  const a=open.find(x=>this.#approvals.has(x.id));if(a)this.#finish(a,false,'refused out loud');return a?'refused':'ignored';
 }
 /** A thumbs up or down at the camera answers the one approval waiting on the screen, but only when the same frame
  * showed your live face. Phone approvals and unlocking never take a hand sign. */
 gesture(approve:boolean,who:Who):'approved'|'refused'|'ignored'{
  const open=[...this.#approvals.values()].filter(a=>a.via==='desk'&&a.group!=='unlock'&&a.expires>this.now());
  if(open.length!==1)return 'ignored';
  if(who!=='owner'){this.log('gesture',`A ${approve?'thumbs up':'thumbs down'} was shown, but the camera couldn't see it was you`);return 'ignored';}
  this.#faceAt=this.now();this.#finish(open[0],approve,approve?'approved with a thumbs up':'refused with a thumbs down');
  return approve?'approved':'refused';
 }
 /** Whether an approval is waiting on the screen that a hand sign could answer. */
 deskApproval():boolean{return [...this.#approvals.values()].some(a=>a.via==='desk'&&a.group!=='unlock'&&a.expires>this.now());}
 pending(via:'phone'|'desk'):PendingApproval[]{const now=this.now();return [...this.#approvals.values()].filter(a=>a.via===via&&a.expires>now).map(({id,title,detail,choices,expiresAt})=>({id,title,detail,choices,expiresAt}));}

 status():GuardStatus{
  const v=this.#vault,now=this.now(),s=this.settings(),m=this.deps.models();
  return {ready:!!v,cipher:this.#cipher,settings:s,
   voice:{enrolled:v?.voice.length??0,adaptive:v?.adaptive.length??0,threshold:v?.voiceThreshold??.48,model:m.voice},
   face:{enrolled:v?.face.length??0,threshold:v?.faceThreshold??.4,model:m.face,lastSeen:this.#faceSeen?new Date(this.#faceSeen).toISOString():null},
   duress:!!v?.duress,locked:this.#locked?{reason:this.#locked.reason,strict:this.#locked.strict,at:new Date(this.#locked.at).toISOString()}:null,
   lastVoice:this.#lastVoice,onlookers:now-this.#onlookersAt<60000?this.#onlookers:0,veil:s.veil&&now-this.#onlookersAt<60000&&this.#onlookers>0,
   paused:this.#pausedUntil>now?new Date(this.#pausedUntil).toISOString():null,
   approvals:[...this.#approvals.values()].filter(a=>a.expires>now).map(({id,title,detail,choices,expiresAt,code,via,group,words})=>({id,title,detail,choices,expiresAt,code,via,group,...(words?{words:[...words]}:{})})),
   faceRequest:this.#faceRequest,events:this.events(25)};
 }
}
const shuffle=(a:number[])=>{for(let i=a.length-1;i>0;i--){const j=randomInt(0,i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const clamp=(x:number,a:number,b:number)=>Math.min(b,Math.max(a,x));
function sanitize(s:Record<string,unknown>):GuardSettings{
 return {voice:s.voice!==false,face:s.face===true,strangers:s.strangers==='ignore'?'ignore':'guest',
  phone:s.phone==='off'||s.phone==='unless-seen'?s.phone:'always',changes:s.changes===true,autoLock:s.autoLock!==false,
  lockAfterMin:clamp(Math.round(Number(s.lockAfterMin)||15),2,240),veil:s.veil!==false};
}
/** Fingerprint for logs and tests: never the print itself. */
export const printId=(v:Float32Array)=>createHash('sha256').update(Buffer.from(v.buffer)).digest('hex').slice(0,8);
