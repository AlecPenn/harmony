import {useState} from 'react';
import type {GuardStatus,GuardSettings} from '../../../core/guardian.ts';
import {recordClip,snapFace} from './guard-capture.ts';

const PHRASES=[
 'Harmony, what is on my calendar tomorrow afternoon?',
 'Remind me to call the studio at three thirty, and keep it short.',
 'Open Spotify and play something with a really good bass line.',
 'What did I decide about the album cover last week?',
 'Lock in. I need two hours of quiet focus, no interruptions.'
];
const LOOKS=['Look straight at the camera.','Same again, with your normal expression.','One more, maybe a little closer.'];
type Guard=NonNullable<typeof window.harmony>['guard'];
const call=(r:Parameters<Guard>[0])=>window.harmony?.guard(r) as Promise<unknown>;

/** Settings → Security: teach HARMONY your voice and face, choose what needs your phone, and see what happened. */
export function SecurityPanel({status,phonePaired}:{status?:GuardStatus;phonePaired:boolean}){
 const [step,setStep]=useState<string|null>(null),[level,setLevel]=useState(0),[note,setNote]=useState(''),[duress,setDuress]=useState('');
 if(!status)return null;
 const s=status.settings,set=(patch:Partial<GuardSettings>)=>{void call({op:'settings',patch}).catch(()=>{});};
 const busy=step!==null;
 async function teachVoice(){
  setNote('');
  for(let i=status!.voice.enrolled>=3?0:status!.voice.enrolled;i<PHRASES.length;i++){
   setStep(`voice:${i}`);
   try{
    await new Promise(r=>setTimeout(r,900));
    const pcm=await recordClip(4.5,setLevel);setLevel(0);
    const r=await call({op:'voice',pcm}) as {ok:boolean;count?:number;reason?:string};
    if(!r.ok){setNote(r.reason??'That one didn’t work. Try again.');i--;if(!confirm('Try that phrase again?'))break;}
   }catch(e){setNote(e instanceof Error?e.message:'The microphone could not start.');break;}
  }
  setStep(null);setLevel(0);
 }
 async function teachFace(){
  setNote('');
  for(let i=0;i<LOOKS.length;i++){
   setStep(`face:${i}`);
   try{
    await new Promise(r=>setTimeout(r,1400));
    const jpeg=await snapFace('enroll');if(!jpeg){setNote('The camera could not open.');break;}
    const r=await call({op:'face',jpeg,purpose:'enroll'}) as {ok:boolean;reason?:string};
    if(!r.ok){setNote(r.reason??'Try again.');i--;await new Promise(r=>setTimeout(r,1200));}
   }catch{setNote('The camera could not open. Check Windows camera privacy settings.');break;}
  }
  setStep(null);
 }
 const [kind,idx]=(step??'').split(':');
 return <section className="security-panel">
  <p className="eyebrow">SECURITY</p><h3>Only you. Only here.</h3>
  <p className="panel-intro">HARMONY learns how your voice sounds and, if you like, your face. Prints are numbers, not recordings or photos; they’re scrambled with a secret key and sealed with Windows encryption on this PC. Nothing is sent anywhere.</p>
  {!status.cipher&&<p className="panel-intro" role="alert">Windows encryption isn’t available, so voice and face checks stay off.</p>}
  <div className={`guard-state ${status.locked?'is-locked':''}`} role="status">
   <span>{status.locked?`${status.locked.strict?'Locked down':'Locked'} · ${status.locked.reason}`:'Unlocked'}</span>
   {status.locked?<button className="text-button" onClick={()=>void call({op:'unlock'})}>Unlock</button>:<button className="text-button" onClick={()=>void call({op:'lock'})}>Lock now</button>}
  </div>

  <h4>Your voice</h4>
  {!status.voice.model&&<p className="panel-intro">Run <b>Set up security</b> in the HARMONY folder first (free, about 110 MB, stays on this PC).</p>}
  <p className="panel-intro">{status.voice.enrolled>=3?`Learned from ${status.voice.enrolled} clips${status.voice.adaptive?` and ${status.voice.adaptive} confirmed conversations`:''}.`:'Read five short sentences in your normal voice. About a minute.'}</p>
  {kind==='voice'?<div className="guard-prompt" aria-live="polite"><small>Say this ({Number(idx)+1} of {PHRASES.length}):</small><q>{PHRASES[Number(idx)]}</q><i className="level" style={{transform:`scaleX(${Math.max(.04,level)})`}}/></div>
   :<button className="primary" disabled={busy||!status.voice.model||!status.cipher} onClick={()=>void teachVoice()}>{status.voice.enrolled>=3?'Teach my voice again':'Teach HARMONY my voice'}</button>}
  <label className="setting"><input type="checkbox" checked={s.voice} onChange={e=>set({voice:e.target.checked})}/><span>Check it’s my voice before anything personal<small>Other voices get guest mode: general questions only</small></span></label>
  <label className="setting stacked"><span>When someone else talks to her</span><select value={s.strangers} onChange={e=>set({strangers:e.target.value as GuardSettings['strangers']})}><option value="guest">Be polite, share nothing personal</option><option value="ignore">Ignore them</option></select></label>

  <h4>Your face <small>(optional)</small></h4>
  <p className="panel-intro">The camera opens for about a second when she needs to check (when you say “Harmony”, now and then while you work, and when you come back), then closes. It also notices a photo or a screen held up to it, and someone looking over your shoulder.</p>
  {kind==='face'?<div className="guard-prompt" aria-live="polite"><small>Look {Number(idx)+1} of {LOOKS.length}</small><q>{LOOKS[Number(idx)]}</q></div>
   :<button className="primary" disabled={busy||!status.face.model||!status.cipher} onClick={()=>void teachFace()}>{status.face.enrolled?`Teach my face again (${status.face.enrolled} looks)`:'Teach HARMONY my face'}</button>}
  <label className="setting"><input type="checkbox" checked={s.face} disabled={!status.face.enrolled} onChange={e=>set({face:e.target.checked})}/><span>Use the camera to confirm it’s me</span></label>
  <label className="setting"><input type="checkbox" checked={s.veil} onChange={e=>set({veil:e.target.checked})}/><span>Privacy veil<small>Blur private panels when someone else is looking at the screen</small></span></label>

  <h4>Phone approval</h4>
  <p className="panel-intro">{phonePaired?'Your phone gets the request; tap the number HARMONY shows or says. Each request works once, for one minute.':'No phone is paired yet, so approvals appear here on screen. Pair your phone in Phone companion below.'}</p>
  <label className="setting stacked"><span>Before she touches the desktop (apps, websites, windows, keys)</span><select value={s.phone} onChange={e=>set({phone:e.target.value as GuardSettings['phone']})}>
   <option value="always">Always ask my phone</option><option value="unless-seen">Ask unless she can see and hear it’s me</option><option value="off">Don’t ask</option></select></label>
  <label className="setting"><input type="checkbox" checked={s.changes} onChange={e=>set({changes:e.target.checked})}/><span>Also ask before other changes when she isn’t sure it was my voice</span></label>

  <h4>Locking</h4>
  <label className="setting"><input type="checkbox" checked={s.autoLock} onChange={e=>set({autoLock:e.target.checked})}/><span>Lock when Windows locks or I’m away
   <small>After <input className="mini" type="number" min={2} max={240} value={s.lockAfterMin} onChange={e=>set({lockAfterMin:Number(e.target.value)})}/> minutes. Unlocks when she sees or hears you.</small></span></label>
  <p className="panel-intro">Say <b>“Harmony, lock down”</b> to lock until your phone unlocks her. Several unknown voices, or a photo of your face, lock her down too.</p>
  <label className="setting stacked"><span>Duress phrase{status.duress?' · set':''}<small>Said to her, it quietly locks everything and alerts your phone, while she just says “Okay.”</small></span>
   <input type="password" value={duress} placeholder={status.duress?'••••••':'e.g. the blue door is open'} onChange={e=>setDuress(e.target.value)} autoComplete="off"/></label>
  <div className="row-buttons"><button className="text-button" disabled={duress.trim().split(/\s+/).length<2} onClick={()=>{void call({op:'duress',phrase:duress}).then(()=>{setDuress('');setNote('Duress phrase saved.');}).catch(e=>setNote(e.message));}}>Save phrase</button>
   {status.duress&&<button className="text-button" onClick={()=>void call({op:'duress',phrase:null})}>Remove phrase</button>}</div>

  {note&&<p className="panel-intro" role="status">{note}</p>}
  <details className="guard-log"><summary>What happened ({status.events.length})</summary><ol>{status.events.map((e,i)=><li key={i}><time>{new Date(e.at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time> {e.detail}</li>)}</ol></details>
  <div className="row-buttons">
   <button className="text-button" onClick={()=>{if(confirm('Erase your voice prints?'))void call({op:'reset',what:'voice'});}}>Erase voice</button>
   <button className="text-button" onClick={()=>{if(confirm('Erase your face prints?'))void call({op:'reset',what:'face'});}}>Erase face</button>
   <button className="text-button" onClick={()=>{if(confirm('Erase every print and make old copies useless?'))void call({op:'reset',what:'all'});}}>Erase everything</button>
  </div>
 </section>;
}
