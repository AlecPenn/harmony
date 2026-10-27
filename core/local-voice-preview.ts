import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {VoicePhrases} from '../packages/voice/phrases.ts';
import {voiceLookahead} from './voice-lookahead.ts';
import {LocalVoice,launchPiper,LocalVoiceStartupTimeout} from './local-voice.ts';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {emptyVoiceOutput,type VoiceChunk,type VoiceOutputStatus,type LocalVoiceEngine} from '../packages/contracts/voice-output.ts';
const SCRIPT=["Hi, I'm Harmony. This is a British female voice for local testing.","Your Australian voice preference has not changed.","One thing at a time. We've got this."];
type Worker=Pick<LocalVoice,'active'|'ready'|'start'|'speak'|'stop'>;
export class LocalVoicePreview {
 #worker:Worker;#workerSession:string|null=null;#id:string|null=null;#sequence=0;#pending=false;#complete=false;#generation=0;
 #status:VoiceOutputStatus={...emptyVoiceOutput,provider:'local'};#reader:AsyncGenerator<VoiceChunk>|null=null;
 #profiler=new LatencyProfiler();#span:ReturnType<LatencyProfiler['start']>=null;#started=0;
 #preparing:Promise<boolean>|null=null;
 #lookahead:AbortController|null=null;
 #timer:ReturnType<typeof setTimeout>|null=null;#stopping:Promise<void>|null=null;
 constructor(root:string,private changed:()=>void,worker?:Worker,private engine:LocalVoiceEngine='kokoro'){this.#worker=worker??new LocalVoice(root,engine==='piper'?launchPiper:undefined,()=>{
  this.#workerSession=null;
  if(this.#status.state==='READY')this.#update({state:'ERROR',error:'Local voice stopped. Prepare it again.'});
 },engine==='piper'?22050:24000,stage=>{if(['PREPARING','STARTING'].includes(this.#status.state))this.#update({preparation:[...(this.#status.preparation??[]).slice(-3),stage]});});}
 get generation(){return this.#generation;}
 get active(){return this.#worker.active||!!this.#id||!!this.#stopping||!!this.#preparing;}
 get busy(){return !!this.#id||!!this.#stopping||!!this.#preparing;}
 snapshot(){return structuredClone(this.#status);}trace(){return this.#profiler.snapshot();}
 #update(patch:Partial<VoiceOutputStatus>){Object.assign(this.#status,patch);this.changed();}
 prepare():Promise<boolean>{
  if(this.busy)return Promise.reject(new Error('Local voice already busy'));
  if(this.#worker.ready)return Promise.resolve(true);
  const generation=++this.#generation;
  this.#profiler=new LatencyProfiler();
  const task=Promise.resolve().then(async()=>{
   if(generation!==this.#generation)return false;
   try{
    const result=await this.#worker.start();if(generation!==this.#generation)return false;
    this.#workerSession=result.session;this.#update({state:'READY'});return true;
   }catch(error){
    if(generation!==this.#generation)return false;
    await this.stop('ERROR',error instanceof LocalVoiceStartupTimeout);throw new Error('Local voice preparation failed');
   }
  }).finally(()=>{if(this.#preparing===task){this.#preparing=null;this.changed();}});
  this.#preparing=task;this.#update({...emptyVoiceOutput,provider:'local',localEngine:this.engine,state:'PREPARING',preparation:[]});return task;
 }
 start(){
  if(this.busy)throw new Error('Local preview already active');
  const id=randomUUID();this.#id=id;this.#sequence=0;this.#pending=false;this.#complete=false;this.#started=performance.now();
  this.#profiler.begin('voice_preview');for(const field of ['wake_ms','speaker_id_ms','speech_end_ms','stt_ms','intent_ms','model_router_ms','llm_first_token_ms','tool_start_ms','tool_complete_ms'] as const)this.#profiler.notApplicable(field);
  this.#span=this.#profiler.start('tts_first_audio_ms');this.#lookahead=new AbortController();this.#reader=voiceLookahead(this.#read(id),this.#lookahead.signal);
  this.#timer=setTimeout(()=>{if(this.#id===id)void this.stop('ERROR').catch(()=>{});},120000);
  this.#update({...emptyVoiceOutput,provider:'local',localEngine:this.engine,state:'STARTING',preparation:this.#worker.ready?this.#status.preparation:[]});return {sessionId:id};
 }
 async *#read(id:string):AsyncGenerator<VoiceChunk>{
  if(!this.#worker.ready){const result=await this.#worker.start();if(this.#id!==id)throw new Error('Preview cancelled');this.#workerSession=result.session;}
  if(!this.#workerSession)throw new Error('Local worker session missing');
  const phrases=new VoicePhrases();
  for(const text of [...phrases.push(SCRIPT.join(' ')),...phrases.finish()]){
   if(this.#id!==id)throw new Error('Preview cancelled');
   for await(const samples of this.#worker.speak(this.#workerSession,text)){
    if(this.#id!==id)throw new Error('Preview cancelled');yield {samples,rate:this.engine==='piper'?22050:24000,done:false};
   }
  }
  yield {samples:new Int16Array(),rate:this.engine==='piper'?22050:24000,done:true};
 }
 async next(id:string,sequence:number):Promise<VoiceChunk>{
  if(id!==this.#id||sequence!==this.#sequence||this.#pending||!this.#reader||this.#stopping)throw new Error('Local preview session unavailable');
  this.#pending=true;
  try{const value=await this.#reader.next();if(id!==this.#id||value.done)throw new Error('Local preview cancelled');this.#sequence++;if(value.value.done)this.#complete=true;
   if(!value.value.done&&this.#status.tts_first_audio_ms===null){this.#profiler.end(this.#span);this.#update({state:'STREAMING',tts_first_audio_ms:Math.round(performance.now()-this.#started)});}return value.value;
  }catch{if(this.#id===id)await this.stop('ERROR');throw new Error('Local voice preview unavailable');}
  finally{if(this.#id===id)this.#pending=false;}
 }
 playback(id:string,finished:boolean){
  if(id!==this.#id)throw new Error('Stale local playback');
  if(finished&&!this.#complete)throw new Error('Preview audio incomplete');
  if(finished){void this.stop('FINISHED').catch(()=>{});return;}
  if(this.#status.tts_first_audio_ms===null)throw new Error('No local audio ready');
  if(this.#status.playback_start_ms===null)this.#update({state:'PLAYING',playback_start_ms:Math.round(performance.now()-this.#started)});
 }
 stop(state:'CANCELLED'|'FINISHED'|'ERROR'='CANCELLED',startupTimeout=false):Promise<void>{
  this.#generation++;if(this.#stopping)return this.#stopping;
  if(this.#timer){clearTimeout(this.#timer);this.#timer=null;}
  const active=!!this.#id||!!this.#preparing||this.#worker.active;this.#id=null;this.#lookahead?.abort();this.#lookahead=null;const reader=this.#reader;this.#reader=null;void reader?.return(undefined).catch(()=>{});
  if(active)this.#update({state,error:state==='ERROR'?(startupTimeout?'Local voice preparation exceeded 60 seconds and was stopped. Try again or select Piper.':'Local voice unavailable. Check the local model setup.'):null});
  this.#profiler.finish(state==='FINISHED'?'completed':state==='ERROR'?'failed':'cancelled');
  if(state==='FINISHED'){this.changed();return Promise.resolve();}
  this.#workerSession=null;
  this.#stopping=this.#worker.stop().finally(()=>{this.#stopping=null;this.changed();});return this.#stopping;
 }
}
