import {spawn as nodeSpawn,type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {createServer} from 'node:net';
import {isAbsolute,join,normalize,relative,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import type {LocalEndpoint} from '../packages/reasoning/local-chat.ts';
import type {LocalModelState,LocalModelStatus} from '../packages/contracts/local-reasoning.ts';
export type {LocalModelState,LocalModelStatus};

/** Written only by scripts/provision-local-model.py after hash verification. */
export interface LocalModelManifest {
 version:1;
 engine:{build:string;variant:string;server:string};
 model:{id:string;name:string;file:string;sha256:string;bytes:number;license:string};
}
export interface LocalModelInstall {serverPath:string;modelPath:string;modelId:string;modelName:string;
 /** llama.cpp build number (b11715 → 11715), for flags only newer builds understand. */
 build?:number;}
export interface LocalModelOptions {gpuLayers:number|'auto';contextTokens:number;startTimeoutMs:number;stopTimeoutMs:number;idleMs:number;}
type Spawner=(command:string,args:readonly string[],options:{stdio:['ignore','ignore','ignore'];windowsHide:true;cwd:string})=>ChildProcess;

const inside=(base:string,path:string)=>{const r=relative(base,path);return !!r&&!r.startsWith('..')&&!isAbsolute(r);};
const safeRelative=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=200&&!isAbsolute(value)&&!normalize(value).split(/[\\/]/).includes('..');

/** Reads and validates the installed manifest. Missing install is a normal state, not an error. */
export function readLocalInstall(base:string):LocalModelInstall|null{
 const path=join(base,'installed.json');if(!existsSync(path))return null;
 const manifest=JSON.parse(readFileSync(path,'utf8')) as LocalModelManifest;
 const {engine,model}=manifest??{} as LocalModelManifest;
 if(manifest?.version!==1||!engine||!model||!/^b\d{1,6}$/.test(engine.build)||!/^[a-z0-9.-]{1,40}$/.test(engine.variant)||!safeRelative(engine.server)
  ||!/^[a-zA-Z0-9_.-]{1,120}$/.test(model.id)||typeof model.name!=='string'||model.name.length>120||!safeRelative(model.file)
  ||!/^[a-f0-9]{64}$/.test(model.sha256)||!Number.isSafeInteger(model.bytes)||model.bytes<1)throw new Error('Invalid local model manifest');
 const root=resolve(base),serverPath=resolve(root,engine.server),modelPath=resolve(root,model.file);
 if(!inside(root,serverPath)||!inside(root,modelPath))throw new Error('Invalid local model manifest');
 if(!existsSync(serverPath)||!existsSync(modelPath))return null;
 // Full hashing happens at install; a size mismatch here means the file changed afterwards.
 if(statSync(modelPath).size!==model.bytes)throw new Error('Local model file changed after installation');
 return {serverPath,modelPath,modelId:model.id,modelName:model.name,build:Number(engine.build.slice(1))};
}

// All layers on the GPU. Measured on the GTX 1650: forced offload ~30 tokens/s; llama.cpp's automatic fit chose
// mostly CPU and dropped to ~4 tokens/s, despite its "failed to fit" warning. 'auto' remains available as an option.
// 8,192 tokens (step 41, October 26): HARMONY's prompt start alone is ~3,800 tokens (instructions and functions), so
// with remembered context and a few turns of conversation 4,096 could overflow. Measured on Alec's PC: 8,192 costs no
// measurable speed or memory (the model keeps most of its memory in a fixed-size state), so no 8-bit cache is needed.
export const defaultLocalModelOptions:LocalModelOptions={gpuLayers:99,contextTokens:8192,startTimeoutMs:120000,stopTimeoutMs:10000,idleMs:45*60000};

function freePort():Promise<number>{
 return new Promise((resolvePort,reject)=>{
  const server=createServer();server.unref();server.on('error',reject);
  server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>typeof address==='object'&&address?resolvePort(address.port):reject(new Error('No port')));});
 });
}

/** Supervises one llama.cpp server bound to loopback with a per-launch random key.
 * Lazy start on first explicit request; idle unload frees GPU memory; STOP waits for actual process exit.
 */
export class LocalModelServer {
 #child:ChildProcess|null=null;#exited:Promise<void>|null=null;#endpoint:LocalEndpoint|null=null;
 #starting:Promise<LocalEndpoint>|null=null;#stopping:Promise<void>|null=null;#idle:ReturnType<typeof setTimeout>|null=null;
 #state:LocalModelState='OFF';#loadMs:number|null=null;#install:LocalModelInstall|null=null;
 readonly options:LocalModelOptions;
 // Plain fields (no constructor parameter properties) so Node's built-in type stripping can run scripts that import this.
 private locate:()=>LocalModelInstall|null;private changed:()=>void;private spawn:Spawner;private transport:typeof fetch;private port:()=>Promise<number>;
 constructor(locate:()=>LocalModelInstall|null,changed:()=>void=()=>{},spawn:Spawner=nodeSpawn as unknown as Spawner,
  transport:typeof fetch=fetch,options:Partial<LocalModelOptions>={},port:()=>Promise<number>=freePort){
  this.locate=locate;this.changed=changed;this.spawn=spawn;this.transport=transport;this.port=port;
  this.options={...defaultLocalModelOptions,...options};
  const o=this.options;
  if(o.gpuLayers!=='auto'&&(!Number.isSafeInteger(o.gpuLayers)||o.gpuLayers<0||o.gpuLayers>999)||!Number.isSafeInteger(o.contextTokens)||o.contextTokens<512||o.contextTokens>32768
   ||![o.startTimeoutMs,o.stopTimeoutMs,o.idleMs].every(v=>Number.isSafeInteger(v)&&v>0&&v<=3600000))throw new Error('Invalid local model options');
 }
 get active(){return this.#child!==null||this.#starting!==null||this.#stopping!==null;}
 snapshot():LocalModelStatus{
  let state=this.#state;
  if(state==='OFF'){try{const install=this.locate();if(!install)state='NOT_INSTALLED';else this.#install=install;}catch{state='FAILED';}}
  return {state,modelId:this.#install?.modelId??null,modelName:this.#install?.modelName??null,loadMs:this.#loadMs};
 }
 #set(state:LocalModelState){this.#state=state;try{this.changed();}catch{}}
 #clearIdle(){if(this.#idle)clearTimeout(this.#idle);this.#idle=null;}
 /** Called by the controller after each request; unloads the model when unused. */
 scheduleIdle(){this.#clearIdle();if(this.#state!=='READY')return;this.#idle=setTimeout(()=>{void this.stop().catch(()=>{});},this.options.idleMs);this.#idle.unref?.();}
 ensure(signal:AbortSignal):Promise<LocalEndpoint>{
  this.#clearIdle();
  if(this.#stopping)return Promise.reject(new Error('Local model is stopping'));
  if(this.#state==='READY'&&this.#endpoint&&this.#child)return Promise.resolve(this.#endpoint);
  if(this.#starting)return this.#starting;
  // Never launch a second server while an earlier one may still be running.
  if(this.#child)return Promise.reject(new Error('Previous local model process has not exited'));
  this.#starting=this.#start(signal).finally(()=>{this.#starting=null;});
  return this.#starting;
 }
 async #start(signal:AbortSignal):Promise<LocalEndpoint>{
  signal.throwIfAborted();
  const install=this.locate();if(!install){this.#set('NOT_INSTALLED');throw new Error('Local model is not installed');}
  this.#install=install;this.#loadMs=null;
  const started=performance.now(),port=await this.port(),key=randomBytes(32).toString('hex');
  signal.throwIfAborted();
  const o=this.options;
  const args=['-m',install.modelPath,'--host','127.0.0.1','--port',String(port),'--api-key',key,
   ...(o.gpuLayers==='auto'?[]:['-ngl',String(o.gpuLayers)]),
   // Launch speed (October 26; only builds known to have these flags, b11715 is installed): with the layer count set,
   // the memory "fit" pass only gives up again (1.3 s per start on Alec's PC), so skip it; and read the model in with
   // plain reads instead of memory-mapping it (2.9 s vs 3.8 s to ready, measured with .runtime/brain-probe.py).
   ...((install.build??0)>=11000?[...(o.gpuLayers==='auto'?[]:['-fit','off']),'--load-mode','none']:[]),'-c',String(o.contextTokens),'-np','1','--jinja','--no-webui',
   // Hidden "thinking" adds seconds before the first spoken word; conversational turns never use it.
   '--reasoning-budget','0',
   // Engine diagnostics (GPU detection, offload, speed) for troubleshooting. Overwritten each launch; prompts are not logged at default verbosity.
   '--log-file',join(install.serverPath,'..','..','server.log')];
  const child=this.spawn(install.serverPath,args,{stdio:['ignore','ignore','ignore'],windowsHide:true,cwd:join(install.serverPath,'..')});
  this.#child=child;this.#set('STARTING');
  let exited=false;
  this.#exited=new Promise<void>(done=>{child.once('exit',()=>{exited=true;done();});child.once('error',()=>{exited=true;done();});});
  void this.#exited.then(()=>{
   if(this.#child!==child)return;
   this.#child=null;this.#endpoint=null;this.#clearIdle();
   if(!this.#stopping)this.#set(this.#state==='READY'||this.#state==='STARTING'?'FAILED':'OFF');
  });
  const model=install.modelId,endpoint={port,key,model};
  try{
   const deadline=started+o.startTimeoutMs;
   while(true){
    signal.throwIfAborted();
    if(exited)throw new Error('Local model exited during startup');
    if(performance.now()>deadline)throw new Error('Local model startup timed out');
    try{
     const response=await this.transport(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.any([signal,AbortSignal.timeout(2000)]),redirect:'error'});
     await response.body?.cancel().catch(()=>{});
     if(response.status===200)break;
    }catch(error){if(signal.aborted)throw error;}
    await new Promise(done=>setTimeout(done,250));
   }
   if(exited||this.#child!==child)throw new Error('Local model exited during startup');
   this.#endpoint=endpoint;this.#loadMs=Math.round(performance.now()-started);this.#set('READY');
   return endpoint;
  }catch(error){
   await this.stop().catch(()=>{});
   if(!signal.aborted)this.#set('FAILED');
   throw error instanceof Error&&/cancel|abort/i.test(error.name+error.message)?new Error('Local model start cancelled'):new Error('Local model could not start');
  }
 }
 /** Truthful shutdown: resolves only after the process has actually exited. */
 stop():Promise<void>{
  this.#clearIdle();
  if(this.#stopping)return this.#stopping;
  const child=this.#child,exited=this.#exited;
  if(!child||!exited){if(this.#state!=='NOT_INSTALLED')this.#set('OFF');return Promise.resolve();}
  this.#set('STOPPING');this.#endpoint=null;
  this.#stopping=(async()=>{
   try{child.kill();}catch{}
   let timer:ReturnType<typeof setTimeout>|undefined;
   const outcome=await Promise.race([exited.then(()=>'exited' as const),new Promise<'timeout'>(done=>{timer=setTimeout(()=>done('timeout'),this.options.stopTimeoutMs);})]);
   clearTimeout(timer);
   if(outcome!=='exited'){this.#set('FAILED');throw new Error('Local model shutdown could not be verified');}
   if(this.#child===child)this.#child=null;
   this.#set('OFF');
  })().finally(()=>{this.#stopping=null;});
  return this.#stopping;
 }
}

/** Installed engine/model root inside HARMONY's ignored runtime directory. */
export const localModelRoot=(appRoot:string)=>join(appRoot,'.runtime','local-model');
