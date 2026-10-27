import workletUrl from './capture-worklet.js?url&no-inline';

/** Records one short clip for voice setup, with the same microphone settings HARMONY uses in conversation (so your
 * voice print matches how she normally hears you). Returns 16 kHz 16-bit PCM as base64. Nothing is saved here. */
export async function recordClip(seconds:number,onLevel:(level:number)=>void=()=>{}):Promise<string>{
 const armed=await window.harmony?.guard({op:'arm-mic'});if(!armed)throw new Error('Microphone unavailable');
 const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,sampleRate:16000,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
 const context=new AudioContext({sampleRate:16000});
 try{
  if(context.sampleRate!==16000)throw new Error('16 kHz audio is unavailable');
  await context.audioWorklet.addModule(workletUrl);
  const node=new AudioWorkletNode(context,'harmony-capture',{numberOfInputs:1,numberOfOutputs:1,channelCount:1});
  const want=Math.round(seconds*16000/512),frames:Int16Array[]=[];
  const done=new Promise<void>((resolve,reject)=>{
   node.port.onmessage=e=>{
    if(e.data.overflow){reject(new Error('Audio could not keep up'));return;}
    const f=e.data.samples as Int16Array;if(!(f instanceof Int16Array))return;
    frames.push(f);node.port.postMessage('ack');
    let peak=0;for(let i=0;i<f.length;i+=8)peak=Math.max(peak,Math.abs(f[i]));onLevel(Math.min(1,peak/12000));
    if(frames.length>=want)resolve();
   };
   setTimeout(()=>reject(new Error('Recording timed out')),(seconds+5)*1000);
  });
  context.createMediaStreamSource(stream).connect(node);node.connect(context.destination);await context.resume();
  await done;node.port.postMessage('stop');
  const pcm=new Int16Array(frames.length*512);frames.forEach((f,i)=>{pcm.set(f,i*512);f.fill(0);});
  let s='';const bytes=new Uint8Array(pcm.buffer);for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  pcm.fill(0);return btoa(s);
 }finally{stream.getTracks().forEach(t=>t.stop());void context.close().catch(()=>{});}
}

/** One look through the camera: opens it for about a second, takes a still, closes it. Returns JPEG base64. */
export async function snapFace(purpose:'enroll'|'check'):Promise<string|null>{
 const armed=await window.harmony?.guard({op:'arm-camera',purpose});if(!armed)return null;
 const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
 try{
  await video.play();
  // Give auto-exposure a moment so the face isn't dark.
  await new Promise(r=>setTimeout(r,700));
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
  canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height);
  const url=canvas.toDataURL('image/jpeg',.88);canvas.width=canvas.height=0;
  return url.slice(url.indexOf(',')+1);
 }finally{stream.getTracks().forEach(t=>t.stop());video.srcObject=null;}
}
