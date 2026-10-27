import {useEffect,useRef,useState} from 'react';
import type {GuardStatus} from '../../../core/guardian.ts';
import {snapFace} from './guard-capture.ts';

/** Always-on security surface: the lock banner, approval cards, the privacy veil, and quick camera looks on request. */
export function GuardLayer({status}:{status?:GuardStatus}){
 const seen=useRef<number|null>(null),[trust,setTrust]=useState(false),[,tick]=useState(0);
 // A camera look when the guardian asks (wake word, coming back, now and then). The camera is open for about a second.
 useEffect(()=>{
  if(!status)return;
  if(seen.current===null){seen.current=status.faceRequest;return;}
  if(status.faceRequest===seen.current)return;seen.current=status.faceRequest;
  void (async()=>{try{const jpeg=await snapFace('check');if(jpeg)await window.harmony?.guard({op:'face',jpeg,purpose:'check'});}catch{}})();
 },[status?.faceRequest]);
 useEffect(()=>{
  const root=document.documentElement;
  root.classList.toggle('guard-locked',!!status?.locked);root.classList.toggle('guard-veil',!!status?.veil);
 },[status?.locked,status?.veil]);
 useEffect(()=>{if(!status?.approvals.length)return;const t=setInterval(()=>tick(x=>x+1),1000);return()=>clearInterval(t);},[status?.approvals.length]);
 if(!status)return null;
 const left=(at:string)=>Math.max(0,Math.round((new Date(at).getTime()-Date.now())/1000));
 return <>
  {status.locked&&<div className="guard-banner" role="alert"><b>{status.locked.strict?'Locked down':'Locked'}</b><span>{status.locked.reason}. Private things are hidden until it’s you.</span>
   <button className="text-button" onClick={()=>void window.harmony?.guard({op:'unlock'})}>Unlock</button></div>}
  {status.veil&&<div className="guard-banner veil" role="status"><b>Privacy veil</b><span>Someone else is looking at the screen, so private panels are blurred.</span></div>}
  {status.paused&&<div className="guard-banner" role="alert"><b>Approvals paused</b><span>Several requests were refused or missed. They resume at {new Date(status.paused).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.</span></div>}
  {status.approvals.map(a=><div key={a.id} className="guard-approval" role="alertdialog" aria-label={a.title}>
   <div><small>HARMONY WANTS TO</small><b>{a.title}</b>{a.detail&&<span>{a.detail}</span>}</div>
   {a.via==='phone'?<div className="guard-code"><small>Tap on your phone</small><strong>{a.code}</strong><small>{left(a.expiresAt)} s</small></div>
    :<div className="guard-actions">
     {a.words&&<div className="guard-words"><small>Or say</small><strong>{a.words.join(' · ')}</strong></div>}
     {a.group!=='unlock'&&<label><input type="checkbox" checked={trust} onChange={e=>setTrust(e.target.checked)}/> Trust this for 10 minutes</label>}
     <button className="primary" onClick={()=>void window.harmony?.guard({op:'answer',id:a.id,approve:true,trust})}>Approve</button>
     <button className="text-button" onClick={()=>void window.harmony?.guard({op:'answer',id:a.id,approve:false})}>Refuse</button><small>{left(a.expiresAt)} s</small></div>}
  </div>)}
 </>;
}
