import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { emptyAudio, validateAudioFrame, type AudioFrame, type AudioStatus } from '../packages/contracts/audio.ts';
/** Endpoint: the voice detector decided speech ended (conversation mode). Transcript: Whisper text for a segment. */
export type SpeechEvent={kind:'speech_start'|'endpoint';segment:number}|{kind:'wake';confidence:number}|{kind:'wake_candidate'}|{kind:'interrupt';word:string;confidence:number}|{kind?:'transcript';text:string;final:boolean;sttMs:number;segment:number|null};
export class SpeechWorker {
  #child:ChildProcessWithoutNullStreams|null=null;
  #status:AudioStatus={...emptyAudio}; #id:string|null=null; #sequence=0;
  #pending:{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;last:number}|null=null;
  #readyReject:((error:Error)=>void)|null=null; #stopping:Promise<void>|null=null;
  #idleTimer:ReturnType<typeof setTimeout>|null=null;
  #transcripts:((event:SpeechEvent)=>void)|null=null;
  /** Trusted core consumer (the local conversation) for transcripts; diagnostics remain in snapshot(). */
  setTranscriptListener(listener:((event:SpeechEvent)=>void)|null){this.#transcripts=listener;}
  /** Step 19: the learning wake word. It sees each wake with the last 1.6 s of audio and may say "not him". */
  wakeLearner:{judge(pcm:Int16Array,conf:number):{id:number;accept:boolean;reason:string};outcome(id:number,what:'used'|'unused'|'denied'):Promise<void>}|null=null;
  #ring:Int16Array[]=[];#lastWake:number|null=null;
  /** The conversation reports what followed the last accepted wake (it is how the wake word keeps learning). */
  wakeOutcome(what:'used'|'unused'|'denied'){const id=this.#lastWake;this.#lastWake=null;if(id!==null&&this.wakeLearner)void this.wakeLearner.outcome(id,what).catch(()=>{});}
  #recent(samples=25600):Int16Array{const all=new Int16Array(Math.min(samples,this.#ring.reduce((a,f)=>a+f.length,0)));let o=all.length;
    for(let i=this.#ring.length-1;i>=0&&o>0;i--){const f=this.#ring[i],take=Math.min(f.length,o);all.set(f.subarray(f.length-take),o-take);o-=take;}return all;}
  #mode:'test'|'wake'|'conversation'|null=null;#handsFree=false;
  /** Conversation mode only: pause segmentation and drop queued transcription while the assistant thinks or speaks. */
  /** Hands-free only: wait for "Harmony" (true). The worker itself resumes listening when it hears the wake word. */
  setWakeWait(enabled:boolean){
    if(typeof enabled!=='boolean'||!this.#handsFree||!this.#child||!this.#id||this.#stopping)return;
    this.#child.stdin.write(JSON.stringify({type:'wake_wait',enabled})+'\n',error=>{if(error)this.#fail('Audio transport failed');});
  }
  /** Conversation only: while HARMONY thinks or talks, watch for "Harmony"/"stop", ignoring words it is saying itself. */
  setInterruptWatch(enabled:boolean,ignore:readonly string[]=[]){
    if(typeof enabled!=='boolean'||this.#mode!=='conversation'||!this.#child||!this.#id||this.#stopping)return;
    const words=[...new Set(ignore)].filter(w=>typeof w==='string'&&/^[a-z]{1,20}$/.test(w)).slice(0,4);
    this.#child.stdin.write(JSON.stringify({type:'interrupt_watch',enabled,ignore:words})+'\n',error=>{if(error)this.#fail('Audio transport failed');});
  }
  setListening(enabled:boolean){
    if(typeof enabled!=='boolean'||this.#mode!=='conversation'||!this.#child||!this.#id||this.#stopping)return;
    this.#child.stdin.write(JSON.stringify({type:'listen',enabled})+'\n',error=>{if(error)this.#fail('Audio transport failed');});
  }
  private root:string;private onUpdate:()=>void;
  /** Guardian hook: whether to compute a voice print of each request, and where to send it (segment, base64 print). */
  voiceprint:{enabled():boolean;heard(segment:number,embedding:string|null):void}|null=null;
  constructor(root:string,onUpdate:()=>void=()=>{}){this.root=root;this.onUpdate=onUpdate;}
  snapshot():AudioStatus{return {...this.#status};}
  #update(patch:Partial<AudioStatus>){Object.assign(this.#status,patch);this.onUpdate();}
  /** Talk-start speed: a speech worker loaded ahead of time (its models take ~35 s to load on this PC), waiting with no
   * microphone attached. start() adopts it, so a conversation begins as soon as the microphone opens. */
  #spare:{child:ChildProcessWithoutNullStreams;mode:'test'|'wake'|'conversation';handsFree:boolean;vp:boolean;ready:Promise<string|null>;expires:ReturnType<typeof setTimeout>}|null=null;
  #engines=new WeakMap<ChildProcessWithoutNullStreams,'whisper'|'parakeet'>();
  #spawnChild(mode:'test'|'wake'|'conversation',handsFree:boolean,vp:boolean):{child:ChildProcessWithoutNullStreams;ready:Promise<string|null>}{
    const child=spawn(join(this.root,'.venv','Scripts','python.exe'),['-I','-u',join(this.root,'workers','speech','worker.py'),...(mode==='wake'?['--wake']:handsFree?['--conversation','--hands-free']:mode==='conversation'?['--conversation']:[])],{windowsHide:true,stdio:'pipe',env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',...(vp?{HARMONY_VOICEPRINT:'1'}:{})}});
    let readyOk!:(engine:string|null)=>void,readyFail!:(e:Error)=>void,isReady=false;
    const ready=new Promise<string|null>((a,b)=>{readyOk=a;readyFail=b;});ready.catch(()=>{});
    let buffer='';
    child.stderr.on('data',()=>{});
    child.stdin.on('error',()=>{if(this.#child===child)this.#fail('Audio transport failed');});
    child.on('error',()=>{readyFail(new Error('Speech worker could not start'));if(this.#child===child)this.#fail('Speech worker could not start');});
    child.on('close',()=>{
      readyFail(new Error('Speech worker exited'));
      if(this.#spare?.child===child){clearTimeout(this.#spare.expires);this.#spare=null;}
      if(this.#child!==child)return;
      this.#child=null;this.#id=null;
      this.#readyReject?.(new Error('Speech worker exited'));this.#readyReject=null;
      if(this.#pending){clearTimeout(this.#pending.timer);this.#pending.reject(new Error('Speech worker exited'));this.#pending=null;}
      if(!this.#stopping)this.#update({state:'ERROR',transcript:'',error:'Speech worker exited'});
    });
    child.stdout.on('data',(data:Buffer)=>{
      buffer+=data.toString('utf8');
      if(buffer.length>65536){if(this.#child===child)this.#fail('Invalid speech response');else child.kill();return;}
      let newline:number;
      while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        let message:Record<string,unknown>;try{message=JSON.parse(line);}catch{if(this.#child===child)this.#fail('Invalid speech response');continue;}
        if(!isReady){
          if(message.type==='ready'&&message.version===1&&message.rate===16000&&message.frame===512){isReady=true;readyOk(['whisper','parakeet','vad'].includes(String(message.engine))?String(message.engine):null);}
          continue;
        }
        // Launch speed: a conversation worker starts on Whisper and says when Parakeet has taken over.
        if(message.type==='engine'&&(message.engine==='parakeet'||message.engine==='whisper')){this.#engines.set(child,message.engine);if(this.#child===child)this.#update({engine:message.engine});continue;}
        if(this.#child!==child)continue; // a standby worker has no session yet
        this.#handle(message,mode);
      }
    });
    return {child,ready};
  }
  /** Loads a worker ahead of time for the next conversation (kept up to 45 minutes). Does nothing if one is running. */
  standby(requested:'conversation'|'hands-free'='conversation'):Promise<void>{
    if(this.#spare)return this.#spare.ready.then(()=>{},()=>{});
    if(this.#child||this.#stopping)return Promise.resolve();
    const mode='conversation',handsFree=requested==='hands-free',vp=!!this.voiceprint?.enabled();
    const {child,ready}=this.#spawnChild(mode,handsFree,vp);
    const expires=setTimeout(()=>this.dropStandby(),45*60000);expires.unref?.();
    this.#spare={child,mode,handsFree,vp,ready,expires};
    ready.catch(()=>this.dropStandby());
    return ready.then(()=>{},()=>{});
  }
  /** Ends the standby worker (on STOP, or when it no longer matches). */
  dropStandby(){const s=this.#spare;this.#spare=null;if(!s)return;clearTimeout(s.expires);try{s.child.stdin.end(JSON.stringify({type:'stop'})+'\n');}catch{}setTimeout(()=>{try{if(s.child.exitCode===null)s.child.kill();}catch{}},1500).unref?.();}
  get warm(){return !!this.#spare;}
  /** Lets the worker (standby or active) load its Parakeet upgrade now: the voice and the brain have loaded. */
  upgrade(){for(const child of [this.#spare?.child,this.#child]){if(!child||child.exitCode!==null)continue;try{child.stdin.write(JSON.stringify({type:'upgrade'})+'\n');}catch{}}}
  async start(requested:'test'|'wake'|'conversation'|'hands-free'='test'):Promise<{sessionId:string}>{
    // Hands-free is a conversation that also runs the offline wake-word detector.
    const mode=requested==='hands-free'?'conversation':requested,handsFree=requested==='hands-free';
    if(this.#child||this.#stopping)throw new Error('Audio worker is already active');
    this.#handsFree=handsFree;this.#sequence=0;this.#mode=mode;this.#status={...emptyAudio,state:'STARTING',mode};this.onUpdate();
    const vp=mode==='conversation'&&!!this.voiceprint?.enabled();
    const spare=this.#spare;let entry:{child:ChildProcessWithoutNullStreams;ready:Promise<string|null>}|null=null;
    if(spare&&spare.mode===mode&&spare.handsFree===handsFree&&spare.vp===vp&&spare.child.exitCode===null){clearTimeout(spare.expires);this.#spare=null;entry=spare;}
    else this.dropStandby();
    entry??=this.#spawnChild(mode,handsFree,vp);
    this.#child=entry.child;
    try{
      // Conversation mode verifies and loads the larger Parakeet model when installed, so it gets more time.
      const engine=await new Promise<string|null>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Speech startup timed out')),mode==='conversation'?60000:30000);
        this.#readyReject=error=>{clearTimeout(timer);reject(error);};
        entry!.ready.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});
      });
      this.#readyReject=null;this.#status.engine=(this.#engines.get(entry.child)??engine) as AudioStatus['engine'];
      if(this.#child!==entry.child||this.#stopping)throw new Error('Audio start cancelled');
      // Conversations wait for the brain and voice to load before audio flows, so allow that long before the idle stop.
      this.#id=randomUUID();this.#watchdog(mode==='conversation'?90000:15000);this.#update({state:'READY'});return {sessionId:this.#id};
    }catch{await this.stop();throw new Error('Local speech models or worker unavailable');}
  }
  #handle(message:Record<string,unknown>&{[k:string]:any},mode:'test'|'wake'|'conversation'){
            try{
              if(false){
              }else if(message.type==='ack'&&this.#pending&&message.seq===this.#sequence&&Number.isFinite(message.vad_ms)&&message.vad_ms>=0){
                this.#sequence++;Object.assign(this.#status,{state:'CAPTURING',receivedFrames:this.#sequence,vadMs:message.vad_ms});
                if(this.#sequence===1||this.#sequence%8===0)this.onUpdate();
                if(this.#sequence>this.#pending.last){const pending=this.#pending;this.#pending=null;clearTimeout(pending.timer);pending.resolve();}
              }else if(message.type==='interrupt'&&mode==='conversation'&&this.#id&&typeof message.word==='string'&&['harmony','stop'].includes(message.word)&&Number.isFinite(message.confidence)&&message.confidence>=.8&&message.confidence<=1){
                try{this.#transcripts?.({kind:'interrupt',word:message.word,confidence:message.confidence});}catch{}
              }else if(message.type==='wake_candidate'&&(mode==='wake'||this.#handsFree)&&this.#id){
                this.#update({wakeCandidateCount:this.#status.wakeCandidateCount+1});
                if(this.#handsFree)try{this.#transcripts?.({kind:'wake_candidate'});}catch{}
              }else if(message.type==='wake'&&(mode==='wake'||this.#handsFree)&&this.#id&&Number.isFinite(message.confidence)&&message.confidence>=.8&&message.confidence<=1&&Number.isFinite(message.detector_ms)&&message.detector_ms>=0){
                this.#update({wakeCount:this.#status.wakeCount+1,wakeConfidence:message.confidence,wakeDetectorMs:message.detector_ms});
                if(this.#handsFree){
                  const d=this.wakeLearner?(()=>{try{return this.wakeLearner!.judge(this.#recent(),message.confidence);}catch{return null;}})():null;
                  if(d&&!d.accept){this.#update({wakeCount:this.#status.wakeCount});this.setWakeWait(true);} // it learned this isn't the owner: back to waiting
                  else{this.#lastWake=d?.id??null;try{this.#transcripts?.({kind:'wake',confidence:message.confidence});}catch{}}
                }
              }else if((message.type==='endpoint'||message.type==='speech_start')&&mode==='conversation'&&this.#id&&Number.isSafeInteger(message.segment)&&message.segment>=0){
                try{this.#transcripts?.({kind:message.type,segment:message.segment});}catch{}
              }else if(message.type==='transcript'&&(mode==='test'||mode==='conversation')&&typeof message.text==='string'&&message.text.length<=4096&&typeof message.final==='boolean'&&Number.isFinite(message.stt_ms)&&this.#id){
                this.#update({transcript:message.text,transcriptFinal:message.final,sttMs:message.stt_ms});
                try{this.#transcripts?.({kind:'transcript',text:message.text,final:message.final,sttMs:message.stt_ms,segment:Number.isSafeInteger(message.segment)&&message.segment>=0?message.segment:null});}catch{}
              }else if(message.type==='voice'&&mode==='conversation'&&this.#id&&Number.isSafeInteger(message.segment)&&message.segment>=0&&(message.embedding===null||typeof message.embedding==='string'&&message.embedding.length<=2048)){
                try{this.voiceprint?.heard(message.segment,message.embedding);}catch{}
              }else if(message.type==='error'){this.#fail('Local speech processing failed');}
              else if(!this.#stopping)this.#fail('Invalid speech response');
            }catch{this.#fail('Invalid speech response');}
  }
  #watchdog(ms:number){
    if(this.#idleTimer)clearTimeout(this.#idleTimer);
    this.#idleTimer=setTimeout(()=>{void this.stop().catch(()=>this.#update({state:'ERROR',error:'Speech shutdown unverified'}));},ms);
  }
  #fail(reason:string){this.#readyReject?.(new Error(reason));this.#readyReject=null;this.#id=null;
    if(this.#pending){clearTimeout(this.#pending.timer);this.#pending.reject(new Error(reason));this.#pending=null;}
    this.#update({state:'ERROR',error:reason,transcript:''});this.#child?.kill();
  }
  async push(value:unknown):Promise<void>{
    validateAudioFrame(value);const frame:AudioFrame=value;
    if(!this.#id||frame.sessionId!==this.#id||frame.sequence!==this.#sequence||this.#pending||!this.#child||this.#stopping)throw new Error('Audio session is not accepting this frame');
    this.#watchdog(5000);
    const child=this.#child;
    if(this.#handsFree&&this.wakeLearner){this.#ring.push(frame.samples.slice());if(this.#ring.length>64)this.#ring.splice(0,this.#ring.length-64);}
    // A batch is written in one go as consecutive frame lines and resolves when the worker has acknowledged the last.
    const count=frame.samples.length/512;
    return new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>this.#fail('Audio processing timed out'),3000);
      this.#pending={resolve,reject,timer,last:frame.sequence+count-1};
      let lines='';
      for(let i=0;i<count;i++){
        const part=frame.samples.subarray(i*512,(i+1)*512);
        lines+=JSON.stringify({type:'frame',seq:frame.sequence+i,pcm:Buffer.from(part.buffer,part.byteOffset,part.byteLength).toString('base64')})+'\n';
      }
      child.stdin.write(lines,error=>{if(error)this.#fail('Audio transport failed');});
    });
  }
  stop():Promise<void>{
    if(this.#stopping)return this.#stopping;
    if(this.#idleTimer){clearTimeout(this.#idleTimer);this.#idleTimer=null;}
    this.#id=null;this.#readyReject?.(new Error('Audio stopped'));this.#readyReject=null;
    if(this.#pending){clearTimeout(this.#pending.timer);this.#pending.reject(new Error('Audio stopped'));this.#pending=null;}
    const child=this.#child;
    if(!child){this.#status={...emptyAudio};this.onUpdate();return Promise.resolve();}
    this.#update({state:'STOPPING',transcript:''});
    this.#stopping=new Promise<void>((resolve,reject)=>{
      const kill=setTimeout(()=>child.kill(),300);
      const deadline=setTimeout(()=>{clearTimeout(kill);reject(new Error('Speech shutdown unverified'));},4000);
      child.once('close',()=>{clearTimeout(kill);clearTimeout(deadline);this.#child=null;this.#status={...emptyAudio};this.onUpdate();resolve();});
      if(!child.killed)child.stdin.end(JSON.stringify({type:'stop'})+'\n');
    }).finally(()=>{this.#stopping=null;});
    return this.#stopping;
  }
}
