import workletUrl from './capture-worklet.js?url&no-inline';
import type { HarmonyBridge } from '../../../packages/contracts/index.ts';
export class LocalCapture {
  #stream:MediaStream|null=null;#context:AudioContext|null=null;#node:AudioWorkletNode|null=null;
  #generation=0;#queue:Int16Array[]=[];#sending=false;#id:string|null=null;#sequence=0;
  /** When the push in flight started (for diagnosing stalls), and the slowest push so far. */
  #pushStarted=0;#slowestPush=0;
  constructor(private bridge:HarmonyBridge,private onError:(message:string)=>void){}
  get active(){return this.#stream!==null||this.#id!==null;}
  async start(mode:'test'|'wake'|'conversation'|'hands-free'='test'){
    const generation=++this.#generation;
    let stage='local models';
    try{
      const {sessionId}=await (mode==='wake'?this.bridge.wakeStart():mode==='conversation'||mode==='hands-free'?this.bridge.conversationStart(mode==='hands-free'):this.bridge.audioStart());
      if(generation!==this.#generation)return;
      this.#id=sessionId;this.#sequence=0;
      stage='microphone permission';
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,sampleRate:16000,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(generation!==this.#generation){stream.getTracks().forEach(track=>track.stop());return;}
      this.#stream=stream;
      stage='audio processing';
      const context=new AudioContext({sampleRate:16000});this.#context=context;
      if(context.sampleRate!==16000)throw new Error('16 kHz audio is unavailable');
      stage='audio worklet';
      await context.audioWorklet.addModule(workletUrl);
      if(generation!==this.#generation)return;
      const node=new AudioWorkletNode(context,'harmony-capture',{numberOfInputs:1,numberOfOutputs:1,channelCount:1});this.#node=node;
      node.port.onmessage=event=>{
        if(generation!==this.#generation)return;
        // Up to ~3 s of audio can wait (the window can briefly freeze while the GPU is busy); then it gives up and says why.
        if(event.data.overflow||this.#queue.length>=96){
          const stuck=this.#sending&&this.#pushStarted?Math.round(performance.now()-this.#pushStarted):0;
          void this.fail(`Audio could not keep up; microphone stopped. (${stuck?`waited ${(stuck/1000).toFixed(1)} s for HARMONY to take audio`:`this window was busy for ~${(this.#queue.length*32/1000).toFixed(1)} s`}; slowest hand-off ${Math.round(this.#slowestPush)} ms)`);return;
        }
        if(!(event.data.samples instanceof Int16Array)||event.data.samples.length!==512){void this.fail('Invalid audio capture; microphone stopped.');return;}
        this.#queue.push(event.data.samples);void this.drain(generation);
      };
      node.onprocessorerror=()=>{void this.fail('Audio capture failed; microphone stopped.');};
      stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(generation===this.#generation)void this.fail('Microphone disconnected.');},{once:true}));
      context.createMediaStreamSource(stream).connect(node);node.connect(context.destination);await context.resume();
    }catch{if(generation===this.#generation)await this.fail('Local audio could not start at ' + stage + '. Microphone is off.');}
  }
  async drain(generation:number){
    if(this.#sending)return;this.#sending=true;
    try{
      while(this.#queue.length&&this.#id&&generation===this.#generation){
        // Send everything waiting in one trip: if the PC is busy for a moment, HARMONY catches up instead of falling behind.
        const frames=this.#queue.splice(0,32),samples=new Int16Array(frames.length*512);
        frames.forEach((f,i)=>{samples.set(f,i*512);f.fill(0);});
        const sequence=this.#sequence;this.#sequence+=frames.length;
        this.#pushStarted=performance.now();
        try{await this.bridge.audioPush({sessionId:this.#id,sequence,samples});}
        finally{samples.fill(0);this.#slowestPush=Math.max(this.#slowestPush,performance.now()-this.#pushStarted);this.#pushStarted=0;}
        if(generation===this.#generation)for(let i=0;i<frames.length;i++)this.#node?.port.postMessage('ack');
      }
    }catch{if(generation===this.#generation)await this.fail('Local speech processing stopped. Microphone is off.');}
    finally{this.#sending=false;}
  }
  async fail(message:string){this.onError(message);await this.stop();}
  async stop(){
    this.#generation++;this.#id=null;
    this.#node?.port.postMessage('stop');this.#node?.disconnect();this.#node?.port.close();this.#node=null;
    this.#stream?.getTracks().forEach(track=>track.stop());this.#stream=null;
    for(const frame of this.#queue)frame.fill(0);this.#queue=[];
    const context=this.#context;this.#context=null;
    await Promise.allSettled([context?.close(),this.bridge.audioStop()]);
  }
}
