import {useState} from 'react';
import type {WakeStats} from '../../../core/wake-learner.ts';
import {recordClip} from './guard-capture.ts';

/** "Harmony" that keeps learning you: teach it 8 times, optionally let it hear the room, then it learns from use. */
export function WakePanel({stats}:{stats?:WakeStats}){
 const [busy,setBusy]=useState<string|null>(null),[note,setNote]=useState<string|null>(null),[level,setLevel]=useState(0);
 if(!stats)return null;
 const teach=async()=>{
  setBusy('teach');setNote('Say "Harmony" after each beep, in your normal voice, from where you usually sit.');
  try{for(let i=0;i<8;i++){
   setNote(`${i+1} of 8: say "Harmony" now.`);
   const pcm=await recordClip(1.8,setLevel);const r=await window.harmony!.wake({op:'teach',pcm});
   if(!r.ok){setNote(r.reason);if(/approve|Unlock/i.test(r.reason??''))return;i--;await new Promise(x=>setTimeout(x,600));}
  }setNote('Got it. From now on it learns from every time you wake her.');}
  catch{setNote('The microphone didn\'t start. Check Windows microphone access.');}finally{setBusy(null);setLevel(0);}
 };
 const room=async()=>{
  setBusy('room');setNote('Listening to the room for 10 seconds. Leave the TV or music on if it\'s usually on. Don\'t say "Harmony".');
  try{for(let i=0;i<6;i++){const pcm=await recordClip(1.7,setLevel);await window.harmony!.wake({op:'teach-not',pcm});}setNote('Thanks. Those sounds won\'t wake her.');}
  catch{setNote('The microphone didn\'t start.');}finally{setBusy(null);setLevel(0);}
 };
 const pct=(x:number|null)=>x===null?'not enough wakes yet':`${Math.round(x*100)}%`;
 return <section className="wake-panel"><p className="eyebrow">YOUR WAKE WORD</p><h3>"Harmony" that keeps learning you</h3>
  <p className="panel-intro">{stats.active?`Active: it decides whether it was you saying "Harmony", from ${stats.positives} examples of you and ${stats.negatives} of other sounds.`
   :`Learning: ${stats.positives} of 8 examples of you and ${stats.negatives} of 3 other sounds so far. Until then it never blocks a wake.`} It learns from every wake: what you ask after, "never mind", and its own misses.</p>
  <dl className="wake-stats"><dt>Misses it caught and learned from</dt><dd>{stats.missesCaught}</dd><dt>False wakes it learned from</dt><dd>{stats.falseWakes}</dd>
   <dt>Recent misses</dt><dd>{pct(stats.recentMissRate)}</dd><dt>Recent false wakes</dt><dd>{pct(stats.recentFalseRate)}</dd></dl>
  {busy&&<div className="level" aria-hidden="true"><span style={{width:`${Math.round(level*100)}%`}}/></div>}
  <div className="row-buttons">
   <button className="primary" disabled={!!busy} onClick={()=>void teach()}>Teach "Harmony" (8 times)</button>
   <button className="text-button" disabled={!!busy} onClick={()=>void room()}>Let it hear the room</button>
   <button className="text-button" disabled={!!busy} onClick={()=>void window.harmony?.wake({op:'reset'}).then(r=>setNote(r.ok?'Forgotten. It\'s back to learning from scratch.':r.reason))}>Start over</button>
  </div>
  {note&&<p className="panel-intro" role="status">{note}</p>}
 </section>;
}
