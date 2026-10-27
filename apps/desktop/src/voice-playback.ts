import type {HarmonyBridge} from '../../../packages/contracts/index.ts';
import type {VoicePreset,LocalVoiceEngine} from '../../../packages/contracts/voice-output.ts';
export class VoicePlayback {
  #bridge:HarmonyBridge;#context:AudioContext|null=null;#generation=0;#sources=new Set<AudioBufferSourceNode>();#error:(text:string)=>void;
  constructor(bridge:HarmonyBridge,error:(text:string)=>void){this.#bridge=bridge;this.#error=error;}
  async start(preset:VoicePreset,approved:boolean,local=false,engine:LocalVoiceEngine='kokoro'){
    if(!local&&!approved){this.#error('Approve the fixed online preview first.');return;}
    const generation=++this.#generation;
    this.#clear();const context=new AudioContext({sampleRate:24000});this.#context=context;
    try{
      await context.resume();if(!local)await this.#bridge.voiceStop();
      if(generation!==this.#generation)return;
      const {sessionId}=await (local?this.#bridge.localVoicePreview(engine):this.#bridge.voicePreview(preset,approved));
      if(generation!==this.#generation){await this.#bridge.voiceStop();return;}
      let sequence=0,cursor=context.currentTime+.06,first=true;
      while(generation===this.#generation){
        while(cursor-context.currentTime>.4&&generation===this.#generation)await new Promise(resolve=>setTimeout(resolve,20));
        if(generation!==this.#generation)return;
        const chunk=await this.#bridge.voiceNext(sessionId,sequence++);
        if(generation!==this.#generation)return;
        if(chunk.done)break;
        if(!(chunk.samples instanceof Int16Array)||chunk.samples.length===0||chunk.samples.length>chunk.rate/10||![22050,24000].includes(chunk.rate))throw new Error('Bad audio');
        const buffer=context.createBuffer(1,chunk.samples.length,chunk.rate);const channel=buffer.getChannelData(0);
        for(let i=0;i<channel.length;i++)channel[i]=chunk.samples[i]/32768;
        const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);this.#sources.add(source);
        source.onended=()=>{this.#sources.delete(source);source.disconnect();};
        cursor=Math.max(cursor,context.currentTime+.02);source.start(cursor);const firstStart=cursor;cursor+=buffer.duration;
        if(first){first=false;while(context.currentTime<firstStart&&generation===this.#generation)await new Promise(resolve=>setTimeout(resolve,10));if(generation===this.#generation)await this.#bridge.voicePlayback(sessionId,false);}
      }
      while(context.currentTime<cursor&&generation===this.#generation)await new Promise(resolve=>setTimeout(resolve,20));
      if(generation===this.#generation){await this.#bridge.voicePlayback(sessionId,true);this.#clear();}
    }catch{if(generation===this.#generation){await this.stop().catch(()=>{});this.#error('Voice preview could not play. Check your connection and audio output, then try again.');}}
  }
  /** Plays a spoken reply the core has already started (local conversation). Same validation and pacing as previews. */
  async attach(sessionId:string){
    const generation=++this.#generation;
    this.#clear();const context=new AudioContext({sampleRate:24000});this.#context=context;
    try{
      await context.resume();
      let sequence=0,cursor=context.currentTime+.04,first=true;
      while(generation===this.#generation){
        while(cursor-context.currentTime>.4&&generation===this.#generation)await new Promise(resolve=>setTimeout(resolve,20));
        if(generation!==this.#generation)return;
        const chunk=await this.#bridge.voiceNext(sessionId,sequence++);
        if(generation!==this.#generation)return;
        if(chunk.done)break;
        if(!(chunk.samples instanceof Int16Array)||chunk.samples.length===0||chunk.samples.length>chunk.rate/10||![22050,24000].includes(chunk.rate))throw new Error('Bad audio');
        const buffer=context.createBuffer(1,chunk.samples.length,chunk.rate);const channel=buffer.getChannelData(0);
        for(let i=0;i<channel.length;i++)channel[i]=chunk.samples[i]/32768;
        const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);this.#sources.add(source);
        source.onended=()=>{this.#sources.delete(source);source.disconnect();};
        cursor=Math.max(cursor,context.currentTime+.02);source.start(cursor);const firstStart=cursor;cursor+=buffer.duration;
        if(first){first=false;while(context.currentTime<firstStart&&generation===this.#generation)await new Promise(resolve=>setTimeout(resolve,10));if(generation===this.#generation)await this.#bridge.voicePlayback(sessionId,false);}
      }
      while(context.currentTime<cursor&&generation===this.#generation)await new Promise(resolve=>setTimeout(resolve,20));
      if(generation===this.#generation){await this.#bridge.voicePlayback(sessionId,true);this.#clear();}
    // A reply that stops early (cut off, cancelled or failed) is reported by the core in the conversation status, not here.
    }catch{if(generation===this.#generation)this.#clear();}
  }
  /** Silence local playback without stopping other voice work (the core owns the conversation lifecycle). */
  silence(){this.#generation++;this.#clear();}
  #clear(){for(const source of this.#sources){source.onended=null;try{source.stop();source.disconnect();}catch{}}this.#sources.clear();const context=this.#context;this.#context=null;if(context)void context.close().catch(()=>{});}
  async stop(){this.#generation++;this.#clear();await this.#bridge.voiceStop();}
}
