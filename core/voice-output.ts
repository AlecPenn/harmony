import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {validateVoiceConnection,type VoiceConnection} from '../packages/contracts/voice-connection.ts';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {emptyVoiceOutput,validatePreset,type VoiceOutputStatus,type VoicePreset,type VoiceChunk} from '../packages/contracts/voice-output.ts';

type Launcher=(root:string,preset:VoicePreset)=>ChildProcessWithoutNullStreams;
const launchVoice:Launcher=(root,preset)=>spawn(join(root,'.venv','Scripts','python.exe'),['-I','-u',join(root,'workers','voice','preview.py'),preset],{windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
// Pull-based PCM delivery: renderer demand applies backpressure through the OS pipe.
export class VoiceOutput {
  #launch:Launcher;#generation=0;
  #profiler=new LatencyProfiler();#ttsSpan:ReturnType<LatencyProfiler['start']>=null;
  trace(){return this.#profiler.snapshot();}
  #root:string;#changed:()=>void;#child:ChildProcessWithoutNullStreams|null=null;
  #reader:AsyncGenerator<VoiceChunk>|null=null;#id:string|null=null;#sequence=0;#pending=false;
  #status={...emptyVoiceOutput};#started=0;#timer:ReturnType<typeof setTimeout>|null=null;#stopping:Promise<void>|null=null;
  constructor(root:string,changed:()=>void,launch:Launcher=launchVoice){this.#root=root;this.#changed=changed;this.#launch=launch;}
  get generation(){return this.#generation;}
  get active(){return !!(this.#child||this.#id||this.#stopping);}
  snapshot():VoiceOutputStatus{return {...this.#status};}
  #update(value:Partial<VoiceOutputStatus>){Object.assign(this.#status,value);this.#changed();}
  #watchdog(){if(this.#timer)clearTimeout(this.#timer);this.#timer=setTimeout(()=>{void this.stop('ERROR').catch(()=>{});},20000);}
  start(preset:VoicePreset,connection:VoiceConnection):{sessionId:string}{
    const credentials=validateVoiceConnection(connection);
    validatePreset(preset);if(this.#child||this.#id||this.#stopping)throw new Error('Voice preview already active');
    this.#started=performance.now();this.#sequence=0;this.#id=randomUUID();this.#pending=false;
    this.#status={...emptyVoiceOutput,preset,state:'STARTING'};
    this.#profiler.begin('voice_preview');
    for(const field of ['wake_ms','speaker_id_ms','speech_end_ms','stt_ms','intent_ms','model_router_ms','llm_first_token_ms','tool_start_ms','tool_complete_ms'] as const)this.#profiler.notApplicable(field);
    this.#ttsSpan=this.#profiler.start('tts_first_audio_ms');
    let child:ChildProcessWithoutNullStreams;
    try{child=this.#launch(this.#root,preset);}catch{this.#id=null;this.#profiler.finish('failed');this.#update({state:'ERROR',error:'Voice worker could not start.'});throw new Error('Voice worker could not start');}
    this.#child=child;child.stdin.on('error',()=>{void this.stop('ERROR').catch(()=>{});});child.stdin.end(JSON.stringify(credentials)+'\n');child.stderr.on('data',()=>{});
    child.on('error',()=>{if(this.#child===child)void this.stop('ERROR').catch(()=>{});});
    this.#reader=this.#read(child);this.#watchdog();this.#changed();return {sessionId:this.#id};
  }
  async *#read(child:ChildProcessWithoutNullStreams):AsyncGenerator<VoiceChunk>{
    let text='',sequence=0,total=0;
    for await(const block of child.stdout){
      text+=block.toString('utf8');if(text.length>131072)throw new Error('Voice response too large');
      let end:number;
      while((end=text.indexOf('\n'))>=0){
        const line=text.slice(0,end);text=text.slice(end+1);if(line.length>8192)throw new Error('Invalid voice frame');
        const value=JSON.parse(line);
        if(value.type==='done'&&value.chunks===sequence&&sequence>0){yield {done:true,rate:24000,samples:new Int16Array()};return;}
        if(value.type!=='pcm'||value.seq!==sequence||value.rate!==24000||typeof value.pcm!=='string'||value.pcm.length>6400||!value.pcm.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.pcm))throw new Error('Invalid voice response');
        const bytes=Buffer.from(value.pcm,'base64');if(bytes.length%2||bytes.length>4800||!bytes.length)throw new Error('Invalid voice PCM');
        total+=bytes.length;if(total>24000*2*60)throw new Error('Voice duration exceeds limit');
        const samples=new Int16Array(bytes.length/2);for(let i=0;i<samples.length;i++)samples[i]=bytes.readInt16LE(i*2);
        sequence++;yield {done:false,rate:24000,samples};
      }
    }
    throw new Error('Voice stream ended early');
  }
  async next(id:string,sequence:number):Promise<VoiceChunk>{
    if(id!==this.#id||sequence!==this.#sequence||this.#pending||!this.#reader||this.#stopping)throw new Error('Voice session is not active');
    this.#pending=true;this.#watchdog();
    try{
      const item=await this.#reader.next();
      if(id!==this.#id||this.#stopping)throw new Error('Voice preview cancelled');
      if(item.done)throw new Error('Voice stream ended early');
      this.#sequence++;
      if(this.#status.tts_first_audio_ms===null&&!item.value.done){this.#profiler.end(this.#ttsSpan);this.#update({state:'STREAMING',tts_first_audio_ms:Math.round(performance.now()-this.#started)});}
      return item.value;
    }catch{if(id===this.#id)await this.stop('ERROR');throw new Error('Online voice preview unavailable');}
    finally{if(id===this.#id)this.#pending=false;}
  }
  playback(id:string,finished:boolean){
    if(id!==this.#id||this.#stopping)throw new Error('Stale voice playback');
    if(finished){void this.stop('FINISHED').catch(()=>{});return;}
    if(this.#status.tts_first_audio_ms===null)throw new Error('No playable audio');
    if(this.#status.playback_start_ms===null)this.#update({state:'PLAYING',playback_start_ms:Math.round(performance.now()-this.#started)});
  }
  stop(state:'CANCELLED'|'FINISHED'|'ERROR'='CANCELLED'):Promise<void>{
    this.#generation++;
    if(this.#stopping)return this.#stopping;
    if(this.#timer){clearTimeout(this.#timer);this.#timer=null;}
    const active=!!this.#id;this.#id=null;this.#reader=null;
    if(active)this.#update({state,error:state==='ERROR'?'Online voice unavailable. Check your connection and try again.':null});
    const finishTrace=()=>{this.#profiler.finish(state==='FINISHED'?'completed':state==='ERROR'?'failed':'cancelled');if(active)this.#changed();};
    const child=this.#child;if(!child){finishTrace();return Promise.resolve();}
    if(child.exitCode!==null||child.signalCode!==null){this.#child=null;finishTrace();return Promise.resolve();}
    this.#stopping=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Voice shutdown unverified')),4000);
      child.once('close',()=>{clearTimeout(timer);if(this.#child===child)this.#child=null;resolve();});child.kill();child.stdout.destroy();
    }).then(finishTrace,error=>{this.#profiler.finish('failed');this.#changed();throw error;}).finally(()=>{this.#stopping=null;});
    return this.#stopping;
  }
}
