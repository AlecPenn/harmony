import {useEffect} from 'react';
import type {GestureView} from '../../../core/gestures.ts';

/** Step 25: the camera loop for hand signs. Runs only while HARMONY says a sign could mean something; the camera is
 * closed the rest of the time (so its light is honest). Small frames, a few a second, each looked at once. */
export function GestureCamera({status}:{status?:GestureView}){
 const watching=!!status?.watching;
 useEffect(()=>{
  if(!watching)return;
  let stopped=false,stream:MediaStream|null=null;const video=document.createElement('video');video.muted=true;video.playsInline=true;
  void (async()=>{
   try{
    stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:480},height:{ideal:360},frameRate:{ideal:10},facingMode:'user'},audio:false});
    if(stopped)return;video.srcObject=stream;await video.play();
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
    while(!stopped){
     const began=performance.now();
     canvas.width=video.videoWidth||480;canvas.height=video.videoHeight||360;ctx.drawImage(video,0,0,canvas.width,canvas.height);
     const url=canvas.toDataURL('image/jpeg',.72);
     const r=await window.harmony?.gesture({op:'frame',jpeg:url.slice(url.indexOf(',')+1)}).catch(()=>null);
     if(!r?.watching)break;
     await new Promise(done=>setTimeout(done,Math.max(40,160-(performance.now()-began))));
    }
    canvas.width=canvas.height=0;
   }catch{/* camera unavailable or refused: nothing to do */}
   finally{stream?.getTracks().forEach(t=>t.stop());video.srcObject=null;}
  })();
  return()=>{stopped=true;stream?.getTracks().forEach(t=>t.stop());};
 },[watching]);
 if(!watching||!status?.why)return null;
 return <div className="gesture-chip" role="status"><span aria-hidden="true">✋</span>{status.why}</div>;
}

const SIGN={stop:'Palm',wave:'Wave',yes:'Thumbs up',no:'Thumbs down'} as const;
/** Settings: which signs she watches for. */
export function GesturePanel({status}:{status?:GestureView}){
 if(!status)return null;
 const s=status.settings,set=(patch:Partial<typeof s>)=>void window.harmony?.gesture({op:'settings',patch});
 return <section className="gesture-panel"><p className="eyebrow">HAND SIGNS</p><h3>Wave to control her</h3>
  <p className="panel-intro">She reads hand signs through your camera, on this PC. The camera only opens while a sign could mean something, and the light shows it. Frames are looked at once and thrown away.</p>
  {!status.available&&<p className="panel-intro">Run “Set up security.cmd” once to install the hand-sign models (8 MB).</p>}
  <label className="setting"><input type="checkbox" checked={s.pause} onChange={e=>set({pause:e.target.checked})}/><span>Hold up a palm to stop her talking</span></label>
  <label className="setting"><input type="checkbox" checked={s.approve} onChange={e=>set({approve:e.target.checked})}/><span>Thumbs up or down to answer an approval on the screen<small>Only when the camera also sees your face. Never for phone approvals or unlocking.</small></span></label>
  <label className="setting"><input type="checkbox" checked={s.wave} onChange={e=>set({wave:e.target.checked})}/><span>Wave to wake her when she’s waiting for “Harmony”<small>The camera stays on while she waits.</small></span></label>
  {status.last&&<p className="panel-intro">Last sign: {SIGN[status.last.sign]}, {new Date(status.last.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} · {status.last.result}</p>}
 </section>;
}
