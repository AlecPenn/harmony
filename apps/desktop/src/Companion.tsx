import { lazy, Suspense, useEffect, useState } from 'react';
import { useChamber } from './chamber-store.ts';
import { presenceMode, processingVisualBudget } from './presence-model.ts';
const Presence = lazy(() => import('./Presence.tsx'));

// This surface observes the shared core. Only the chamber owns microphone capture.
export function Companion() {
  const {snapshot, ingest}=useChamber();
  const [error,setError]=useState('');
  const [reduced,setReduced]=useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    const bridge=window.harmony; if(!bridge)return;
    let active=true; const update=(value:Parameters<typeof ingest>[0])=>{if(active)ingest(value);};
    const unsubscribe=bridge.subscribe(update);
    bridge.snapshot().then(update).catch(()=>setError('Core unavailable. Open chamber.'));
    return ()=>{active=false;unsubscribe();};
  },[ingest]);
  useEffect(()=>{
    const query=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setReduced(query.matches);
    query.addEventListener('change',change);return ()=>query.removeEventListener('change',change);
  },[]);
  async function action(name:'stop'|'resume'|'showChamber') {
    setError('');try{await window.harmony?.[name]();}catch{setError('Could not complete. Open chamber.');}
  }
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();void action('stop');}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
  const stopped=snapshot?.system==='STOPPED';
  const audio=snapshot?.audio.state;
  const mic=audio==='CAPTURING'?'Microphone on':audio==='OFF'?'Microphone off':audio==='ERROR'?'Microphone error':audio?'Microphone changing…':'Microphone unknown';
  return <main className="desktop-companion" aria-label="HARMONY desktop companion">
    <div className="companion-handle" title="Drag to move HARMONY">HARMONY <span>⋮⋮</span></div>
    <div className="companion-orb"><Suspense fallback={null}><Presence mode={presenceMode(snapshot,false)} reducedMotion={false} resourceConstrained={processingVisualBudget(snapshot)} transparent/></Suspense></div>
    <section className="companion-controls">
      <p role="status">{stopped?'Work stopped':snapshot?.speechOutput?.state==='PLAYING'?'Voice preview':snapshot?.system==='PASSIVE'?'Standing by':snapshot?.system??'Connecting…'}</p>
      <small className={audio==='CAPTURING'?'mic-live':''}>{mic}</small>
      <div>{snapshot?.shutdownFailed&&<span role="alert">Shutdown unverified. Retry STOP.</span>}<button onClick={()=>void action('showChamber')}>Open chamber</button>{stopped&&!snapshot?.shutdownFailed?<button disabled={snapshot?.stopping} onClick={()=>void action('resume')}>Resume</button>:<button className="companion-stop" onClick={()=>void action('stop')} disabled={!snapshot||snapshot.stopping}>■ STOP</button>}</div>
      {error&&<small role="alert">{error}</small>}
    </section>
  </main>;
}
