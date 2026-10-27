import {performance} from 'node:perf_hooks';
import type {VoicePreparation} from '../packages/contracts/voice-output.ts';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export type LocalVoiceLauncher=(root:string)=>ChildProcessWithoutNullStreams;
const launch:LocalVoiceLauncher=root=>spawn(join(root,'.venv-kokoro','Scripts','python.exe'),['-I','-u',join(root,'workers','voice','local_worker.py')],{windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
export const launchPiper:LocalVoiceLauncher=root=>spawn(join(root,'.venv-kokoro','Scripts','python.exe'),['-I','-u',join(root,'workers','voice','piper_worker.py')],{windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
export class LocalVoiceStartupTimeout extends Error {constructor(){super('Local voice startup exceeded 60 seconds');}}
class FrameTimeout extends Error {}
/** Private resident worker, started by an explicit fixed-script desktop audition. */
export class LocalVoice {
 #child:ChildProcessWithoutNullStreams|null=null;#frames:AsyncGenerator<any>|null=null;
 #session:string|null=null;#ready=false;#busy=false;#request=0;#stopping:Promise<void>|null=null;
 constructor(private root:string,private launcher:LocalVoiceLauncher=launch,private unexpectedExit:()=>void=()=>{},readonly rate:24000|22050=24000,private preparing:(stage:VoicePreparation)=>void=()=>{},private clock:()=>number=()=>performance.now()){}
 get active(){return this.#child!==null;}
 get ready(){return this.#ready;}
 async *#read(child:ChildProcessWithoutNullStreams){
  let pending='';
  for await(const block of child.stdout){
   pending+=block.toString('utf8');if(pending.length>131072)throw new Error('Voice frame buffer limit');
   let end:number;
   while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(line.length>8192)throw new Error('Voice frame limit');const value=JSON.parse(line);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid voice frame');yield value;}
  }
  throw new Error('Local voice closed');
 }
 async #next(timeout:number){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([this.#frames!.next().then(v=>{if(v.done)throw new Error('Local voice ended');return v.value;}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new FrameTimeout('Local voice timeout')),timeout);})]);}
  finally{if(timer)clearTimeout(timer);}
 }
 async start():Promise<{session:string;warmupMs:number}>{
  if(this.#child||this.#stopping)throw new Error('Local voice already active');
  const session=randomUUID();this.#session=session;this.#request=0;this.#busy=false;
  try{
   const child=this.launcher(this.root);this.#child=child;this.#frames=this.#read(child);
   child.once('close',()=>{
    if(this.#child!==child)return;
    const unexpected=this.#session!==null;
    this.#child=null;this.#frames=null;this.#session=null;this.#ready=false;this.#busy=false;
    if(unexpected)try{this.unexpectedExit();}catch{}
   });
   child.stderr.on('data',()=>{});child.stdin.on('error',()=>{if(this.#child===child)void this.stop().catch(()=>{});});child.on('error',()=>{if(this.#child===child)void this.stop().catch(()=>{});});
   const deadline=this.clock()+60000;let frame:any,lastStage=-1,lastElapsed=0;
   while(true){
    const remaining=deadline-this.clock();if(remaining<=0)throw new FrameTimeout();
    frame=await this.#next(remaining);
    if(this.#session!==session)throw new Error('Local voice cancelled');
    if(frame.type!=='preparing')break;
    const index=['model','acknowledgements','warmup'].indexOf(frame.stage);
    if(index<=lastStage||!Number.isSafeInteger(frame.elapsed_ms)||frame.elapsed_ms<lastElapsed||frame.elapsed_ms>60000)throw new Error('Invalid preparation progress');
    lastStage=index;lastElapsed=frame.elapsed_ms;
    try{this.preparing({stage:frame.stage,elapsedMs:frame.elapsed_ms});}catch{}
   }
   if(this.#session!==session||frame.type!=='ready'||frame.rate!==this.rate||!Number.isFinite(frame.warmup_ms)||frame.warmup_ms<lastElapsed)throw new Error('Local voice unavailable');
   this.#ready=true;try{this.preparing({stage:'ready',elapsedMs:frame.warmup_ms});}catch{}return {session,warmupMs:frame.warmup_ms};
  }catch(error){if(this.#session===session)await this.stop();if(error instanceof FrameTimeout)throw new LocalVoiceStartupTimeout();throw new Error('Local voice unavailable');}
 }
 async *speak(session:string,text:string):AsyncGenerator<Int16Array>{
  if(!this.#ready||this.#busy||session!==this.#session||typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Local voice request denied');
  this.#busy=true;const id=this.#request++;let finished=false,sequence=0,total=0;
  const watchdog=setTimeout(()=>{if(this.#session===session)void this.stop().catch(()=>{});},60000);
  try{
   this.#child!.stdin.write(JSON.stringify({id,text})+'\n');
   while(true){
    if(this.#session!==session)throw new Error('Local voice cancelled');
    const frame=await this.#next(20000);
    if(this.#session!==session)throw new Error('Local voice cancelled');
    // chunks 0 with no audio sent: the phrase had nothing pronounceable; the worker stays ready.
    if(frame.type==='done'&&frame.id===id&&frame.chunks===sequence){finished=true;return;}
    if(frame.type!=='pcm'||frame.id!==id||frame.seq!==sequence||frame.rate!==this.rate||typeof frame.pcm!=='string'||!frame.pcm.length||frame.pcm.length>6400||!/^[A-Za-z0-9+/]+={0,2}$/.test(frame.pcm))throw new Error('Invalid local audio');
    const bytes=Buffer.from(frame.pcm,'base64');if(!bytes.length||bytes.length%2||bytes.length>(this.rate/10)*2||bytes.toString('base64')!==frame.pcm)throw new Error('Invalid local PCM');
    total+=bytes.length;if(total>this.rate*2*30)throw new Error('Local audio limit');
    const samples=new Int16Array(bytes.length/2);for(let i=0;i<samples.length;i++)samples[i]=bytes.readInt16LE(i*2);
    sequence++;yield samples;
   }
  }finally{clearTimeout(watchdog);if(this.#session===session){this.#busy=false;if(!finished)await this.stop();}}
 }
 stop():Promise<void>{
  this.#session=null;this.#ready=false;
  if(this.#stopping)return this.#stopping;
  const child=this.#child;if(!child)return Promise.resolve();
  if(child.exitCode!==null||child.signalCode!==null){this.#child=null;this.#frames=null;return Promise.resolve();}
  this.#stopping=new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Local voice shutdown unverified')),4000);
   child.once('close',()=>{clearTimeout(timer);if(this.#child===child){this.#child=null;this.#frames=null;}resolve();});
   child.kill();child.stdout.destroy();
  }).finally(()=>{this.#stopping=null;});return this.#stopping;
 }
}
