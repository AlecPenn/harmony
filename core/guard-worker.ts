import {spawn as nodeSpawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {vector,type FaceReading} from './guardian.ts';

type Spawner=(command:string,args:readonly string[],options:{windowsHide:true;stdio:'pipe';env:NodeJS.ProcessEnv})=>ChildProcessWithoutNullStreams;
export interface HandReading {hands:{joints:[number,number][];right:boolean;conf:number}[];aspect:number;reason?:string;}
export interface VoiceReading {embedding:Float32Array|null;seconds:number;reason:string|null;}

/** Which guard models are installed (sizes match the pins; hashes are checked by the worker itself). */
export function guardModels(root:string):{voice:boolean;face:boolean;hands:boolean}{
 try{
  const m=JSON.parse(readFileSync(join(root,'docs','GUARD-MODELS.json'),'utf8')).models as Record<string,{path:string;bytes:number}>;
  const ok=(k:string)=>{const e=m[k];if(!e)return false;const p=resolve(root,e.path);try{return p.startsWith(resolve(root,'data','models'))&&statSync(p).size===e.bytes;}catch{return false;}};
  return {voice:ok('voice'),face:['face_detector','face_recognizer','face_liveness'].every(ok),hands:['hand_palm','hand_pose'].every(ok)};
 }catch{return {voice:false,face:false,hands:false};}
}

/** Supervises workers/guard/worker.py: started on first use, stopped after five quiet minutes, one request at a time. */
export class GuardWorker {
 #child:ChildProcessWithoutNullStreams|null=null;#ready:Promise<boolean>|null=null;#queue:Promise<unknown>=Promise.resolve();
 #idle:ReturnType<typeof setTimeout>|null=null;#next=1;#waiting:{id:number;resolve:(m:Record<string,unknown>|null)=>void}|null=null;
 private root:string;private spawn:Spawner;private python:string;private idleMs:number;
 constructor(root:string,options:{spawn?:Spawner;python?:string;idleMs?:number}={}){
  this.root=root;this.spawn=options.spawn??(nodeSpawn as unknown as Spawner);this.idleMs=options.idleMs??5*60000;
  this.python=options.python??join(root,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
 }
 #start():Promise<boolean>{
  if(this.#ready)return this.#ready;
  if(isAbsolute(this.python)&&!existsSync(this.python))return Promise.resolve(false);
  this.#ready=new Promise<boolean>(done=>{
   let child:ChildProcessWithoutNullStreams,buffer='',settled=false;
   const settle=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(!ok){this.#ready=null;try{child?.kill();}catch{}}done(ok);};
   const timer=setTimeout(()=>settle(false),30000);
   try{child=this.spawn(this.python,['-I','-u',join(this.root,'workers','guard','worker.py')],{windowsHide:true,stdio:'pipe',env:{...process.env,OMP_NUM_THREADS:'1',OPENCV_LOG_LEVEL:'ERROR'}});}
   catch{settle(false);return;}
   this.#child=child;child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>settle(false));
   child.on('close',()=>{if(this.#child===child){this.#child=null;this.#ready=null;}settle(false);this.#waiting?.resolve(null);this.#waiting=null;});
   child.stdout.on('data',(data:Buffer)=>{
    buffer+=data.toString('utf8');if(buffer.length>1_000_000){try{child.kill();}catch{}return;}
    let n:number;
    while((n=buffer.indexOf('\n'))>=0){
     const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let m:Record<string,unknown>;try{m=JSON.parse(line);}catch{continue;}
     if(m.type==='ready'&&m.version===1)settle(true);
     else if(this.#waiting&&m.id===this.#waiting.id){const w=this.#waiting;this.#waiting=null;w.resolve(m);}
    }
   });
  });
  return this.#ready;
 }
 #request(message:Record<string,unknown>,timeoutMs:number):Promise<Record<string,unknown>|null>{
  const run=async()=>{
   if(!await this.#start()||!this.#child)return null;
   if(this.#idle)clearTimeout(this.#idle);this.#idle=setTimeout(()=>{void this.stop();},this.idleMs);this.#idle.unref?.();
   const child=this.#child,id=this.#next++;
   return new Promise<Record<string,unknown>|null>(resolve=>{
    const t=setTimeout(()=>{if(this.#waiting?.id===id)this.#waiting=null;resolve(null);},timeoutMs);
    this.#waiting={id,resolve:m=>{clearTimeout(t);resolve(m);}};
    child.stdin.write(JSON.stringify({...message,id})+'\n',e=>{if(e){clearTimeout(t);if(this.#waiting?.id===id)this.#waiting=null;resolve(null);}});
   });
  };
  const r=this.#queue.then(run,run);this.#queue=r.catch(()=>null);return r;
 }
 /** pcm: 16 kHz mono 16-bit little-endian. */
 async voice(pcm:Buffer):Promise<VoiceReading>{
  if(pcm.length%2||pcm.length<16000*2*.8||pcm.length>16000*2*12)return {embedding:null,seconds:pcm.length/32000,reason:'Need about 1 to 12 seconds of speech'};
  const m=await this.#request({type:'voice',pcm:pcm.toString('base64')},20000);
  if(!m||m.type!=='voice')return {embedding:null,seconds:0,reason:'The voice check could not run. Run "Set up security" first.'};
  return {embedding:vector(m.embedding,256),seconds:Number(m.seconds)||0,reason:typeof m.reason==='string'?m.reason.slice(0,120):null};
 }
 /** image: JPEG or PNG bytes of one camera frame. */
 async face(image:Buffer):Promise<FaceReading>{
  if(!image.length||image.length>1_500_000)return {faces:0,embedding:null,live:null,yaw:null,reason:'bad frame'};
  const m=await this.#request({type:'face',jpeg:image.toString('base64')},20000);
  if(!m||m.type!=='face')return {faces:0,embedding:null,live:null,yaw:null,reason:'unavailable'};
  const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
  return {faces:Math.max(0,Math.min(20,Math.floor(Number(m.faces)||0))),embedding:vector(m.embedding,128),live:num(m.live),yaw:num(m.yaw),...(typeof m.reason==='string'?{reason:m.reason.slice(0,40)}:{})};
 }
 /** One small camera frame: the hands in it, as 21 joints each (fractions of the frame). */
 async hands(image:Buffer):Promise<HandReading>{
  if(!image.length||image.length>300_000)return {hands:[],aspect:1,reason:'bad frame'};
  const m=await this.#request({type:'hands',jpeg:image.toString('base64')},5000);
  if(!m||m.type!=='hands')return {hands:[],aspect:1,reason:'unavailable'};
  const aspect=typeof m.aspect==='number'&&m.aspect>.2&&m.aspect<5?m.aspect:1;
  const hands=(Array.isArray(m.hands)?m.hands:[]).slice(0,2).flatMap(h=>{
   const j=(h as {joints?:unknown})?.joints;if(!Array.isArray(j)||j.length!==21)return [];
   const joints=j.map(p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>-1&&v<2)?[p[0],p[1]] as [number,number]:null);
   if(joints.some(p=>!p))return [];
   return [{joints:joints as [number,number][],right:(h as {right?:unknown}).right===true,conf:Number((h as {conf?:unknown}).conf)||0}];
  });
  return {hands,aspect,...(typeof m.reason==='string'?{reason:m.reason.slice(0,40)}:{})};
 }
 stop():Promise<void>{
  if(this.#idle){clearTimeout(this.#idle);this.#idle=null;}
  const child=this.#child;if(!child)return Promise.resolve();
  return new Promise<void>(resolve=>{const k=setTimeout(()=>{try{child.kill();}catch{}},1500);child.once('close',()=>{clearTimeout(k);resolve();});try{child.stdin.end('{"type":"stop"}\n');}catch{try{child.kill();}catch{}}});
 }
}
