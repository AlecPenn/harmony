import {spawn as nodeSpawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

/** Turns short texts into unit-length meaning vectors. Returns null whenever it can't (not set up, busy, failed):
 * memory search then falls back to words alone, so nothing ever waits on it for long. */
export interface TextEmbedder {readonly model:string|null;embed(texts:readonly string[],signal?:AbortSignal):Promise<Float32Array[]|null>;}
export type EmbedderState='NOT_INSTALLED'|'OFF'|'STARTING'|'READY'|'FAILED';
type Spawner=(command:string,args:readonly string[],options:{windowsHide:true;stdio:'pipe';env:NodeJS.ProcessEnv})=>ChildProcessWithoutNullStreams;
const MAX_TEXTS=32,MAX_CHARS=2000;

/** Reads the pinned manifest written by scripts/setup-memory-model.py; missing means not set up (a normal state). */
export function memoryModelId(root:string):string|null{
 try{const m=JSON.parse(readFileSync(join(root,'docs','MEMORY-MODEL.json'),'utf8'));return typeof m?.id==='string'&&/^[a-z0-9.-]{1,80}$/.test(m.id)?m.id:null;}catch{return null;}
}

/** Supervises workers/memory/embed_worker.py: started on first use, stopped after a quiet spell, one request at a time. */
export class LocalEmbedder implements TextEmbedder {
 #child:ChildProcessWithoutNullStreams|null=null;#ready:Promise<boolean>|null=null;#state:EmbedderState='OFF';#dim=0;
 #queue:Promise<unknown>=Promise.resolve();#idle:ReturnType<typeof setTimeout>|null=null;#next=1;#failures=0;
 #waiting:{id:number;count:number;resolve:(v:Float32Array[]|null)=>void}|null=null;
 readonly model:string|null;
 private root:string;private spawn:Spawner;private idleMs:number;private timeoutMs:number;private python:string;private onState:()=>void;
 constructor(root:string,options:{spawn?:Spawner;idleMs?:number;timeoutMs?:number;python?:string;onState?:()=>void}={}){
  this.root=root;this.spawn=options.spawn??(nodeSpawn as unknown as Spawner);this.idleMs=options.idleMs??5*60000;this.timeoutMs=options.timeoutMs??20000;
  this.python=options.python??join(root,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
  this.onState=options.onState??(()=>{});this.model=memoryModelId(root);
  if(!this.model)this.#state='NOT_INSTALLED';
 }
 get state():EmbedderState{return this.#state;}
 #set(s:EmbedderState){if(this.#state!==s){this.#state=s;try{this.onState();}catch{}}}
 #start():Promise<boolean>{
  if(this.#ready)return this.#ready;
  if(!this.model||(isAbsolute(this.python)&&!existsSync(this.python)))return Promise.resolve(false);
  // After repeated failures, stop trying until restart (word search keeps working).
  if(this.#failures>=3)return Promise.resolve(false);
  this.#set('STARTING');
  this.#ready=new Promise<boolean>(resolve=>{
   let child:ChildProcessWithoutNullStreams,buffer='',settled=false;
   const done=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(!ok){this.#failures++;this.#ready=null;this.#set("FAILED");try{child?.kill();}catch{}}else{this.#failures=0;this.#set('READY');}resolve(ok);};
   // Verifying ~190 MB the first time takes a few seconds on Alec's PC; later starts are quick.
   const timer=setTimeout(()=>done(false),60000);
   try{child=this.spawn(this.python,['-I','-u',join(this.root,'workers','memory','embed_worker.py')],{windowsHide:true,stdio:'pipe',env:{...process.env,OMP_NUM_THREADS:'2'}});}
   catch{done(false);return;}
   this.#child=child;
   child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
   child.on('error',()=>done(false));
   child.on('close',()=>{if(this.#child===child){this.#child=null;this.#ready=null;}done(false);
    if(this.#waiting){this.#waiting.resolve(null);this.#waiting=null;}
    if(this.#state==='READY'||this.#state==='STARTING')this.#set('OFF');});
   child.stdout.on('data',(data:Buffer)=>{
    buffer+=data.toString('utf8');
    if(buffer.length>4_000_000){try{child.kill();}catch{}return;}
    let n:number;
    while((n=buffer.indexOf('\n'))>=0){
     const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let m:Record<string,unknown>;
     try{m=JSON.parse(line);}catch{continue;}
     if(m.type==='ready'&&m.version===1&&Number.isSafeInteger(m.dim)&&(m.dim as number)>0&&(m.dim as number)<=4096&&m.model===this.model){this.#dim=m.dim as number;done(true);}
     else if(m.type==='vectors'&&this.#waiting&&m.id===this.#waiting.id&&m.dim===this.#dim&&typeof m.data==='string'){
      const w=this.#waiting;this.#waiting=null;const bytes=Buffer.from(m.data,'base64');
      if(bytes.length!==w.count*this.#dim*4){w.resolve(null);continue;}
      const all=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
      w.resolve(Array.from({length:w.count},(_,i)=>all.slice(i*this.#dim,(i+1)*this.#dim)));
     }else if(m.type==='error'){if(!settled)done(false);else if(this.#waiting){this.#waiting.resolve(null);this.#waiting=null;}}
    }
   });
  });
  return this.#ready;
 }
 #scheduleIdle(){if(this.#idle)clearTimeout(this.#idle);this.#idle=setTimeout(()=>{void this.stop();},this.idleMs);this.#idle.unref?.();}
 /** Starts the worker ahead of need (e.g. when a conversation starts), so the first search isn't slowed by loading. */
 warm():void{void this.#start().then(ok=>{if(ok)this.#scheduleIdle();});}
 embed(texts:readonly string[],signal?:AbortSignal):Promise<Float32Array[]|null>{
  if(!this.model||!texts.length)return Promise.resolve(texts.length?null:[]);
  const batch=texts.slice(0,MAX_TEXTS).map(t=>String(t).slice(0,MAX_CHARS));
  const run=async():Promise<Float32Array[]|null>=>{
   if(signal?.aborted)return null;
   if(!await this.#start()||!this.#child)return null;
   this.#scheduleIdle();
   const child=this.#child,id=this.#next++;
   return new Promise<Float32Array[]|null>(resolve=>{
    let finished=false;
    const finish=(v:Float32Array[]|null)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(this.#waiting?.id===id)this.#waiting=null;resolve(v);};
    const timer=setTimeout(()=>finish(null),this.timeoutMs);
    // A cancelled search stops waiting; the worker finishes its batch and the answer is discarded.
    const cancel=()=>finish(null);signal?.addEventListener('abort',cancel,{once:true});
    this.#waiting={id,count:batch.length,resolve:finish};
    child.stdin.write(JSON.stringify({type:'embed',id,texts:batch})+'\n',error=>{if(error)finish(null);});
   });
  };
  const result=this.#queue.then(run,run);this.#queue=result.catch(()=>null);
  return result;
 }
 stop():Promise<void>{
  if(this.#idle){clearTimeout(this.#idle);this.#idle=null;}
  const child=this.#child;if(!child){if(this.#state!=='NOT_INSTALLED'&&this.#state!=='FAILED')this.#set('OFF');return Promise.resolve();}
  return new Promise<void>(resolve=>{
   const kill=setTimeout(()=>{try{child.kill();}catch{}},1500);
   child.once('close',()=>{clearTimeout(kill);resolve();});
   try{child.stdin.end(JSON.stringify({type:'stop'})+'\n');}catch{try{child.kill();}catch{}}
  });
 }
}

/** Cosine similarity for unit vectors (dot product); 0 when shapes differ. */
export function similarity(a:Float32Array,b:Float32Array):number{if(a.length!==b.length)return 0;let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
export const toBlob=(v:Float32Array)=>new Uint8Array(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength));
export const fromBlob=(b:unknown):Float32Array|null=>b instanceof Uint8Array&&b.byteLength%4===0&&b.byteLength>0?new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)):null;
