// Runs on Chromium's audio rendering thread. Fixed-size output; bounded outstanding frames.
class HarmonyCapture extends AudioWorkletProcessor {
  constructor(){super();this.frame=new Int16Array(512);this.used=0;this.pending=0;this.stopped=false;this.port.onmessage=event=>{if(event.data==='ack')this.pending=Math.max(0,this.pending-1);if(event.data==='stop'){this.stopped=true;this.frame.fill(0);}};}
  process(inputs){
    if(this.stopped)return false;
    const input=inputs[0]?.[0];if(!input)return true;
    for(let i=0;i<input.length;i++){
      const sample=Number.isFinite(input[i])?Math.max(-1,Math.min(1,input[i])):0;
      this.frame[this.used++]=Math.round(sample*(sample<0?32768:32767));
      if(this.used===512){
        if(this.pending>=96){this.frame.fill(0);this.port.postMessage({overflow:true});return false;}
        this.pending++;this.port.postMessage({samples:this.frame},[this.frame.buffer]);
        this.frame=new Int16Array(512);this.used=0;
      }
    }
    return true;
  }
}
registerProcessor('harmony-capture',HarmonyCapture);
