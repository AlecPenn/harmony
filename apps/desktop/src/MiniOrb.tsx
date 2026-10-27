import { useEffect, useState } from 'react';
import { useChamber } from './chamber-store.ts';
import { presenceMode } from './presence-model.ts';
import { LiteOrb } from './LiteOrb.tsx';
import type { Corner, OrbSettings } from '../../../core/orb-display.ts';

/** The mini orb on the second screen: HARMONY's live presence, nothing else. A click opens the chamber. */
export function MiniOrb() {
  const {snapshot, ingest}=useChamber();
  useEffect(()=>{
    const bridge=window.harmony; if(!bridge)return;
    let active=true;const update=(v:Parameters<typeof ingest>[0])=>{if(active)ingest(v);};
    const off=bridge.subscribe(update);bridge.snapshot().then(update).catch(()=>{});
    return ()=>{active=false;off();};
  },[ingest]);
  const listening=snapshot?.voiceConversation?.state==='LISTENING'||snapshot?.audio.state==='CAPTURING';
  return <main className="mini-orb" title="HARMONY · click to open" onClick={()=>void window.harmony?.showChamber().catch(()=>{})}>
    <LiteOrb mode={presenceMode(snapshot,false)}/>
    {listening&&<span className="mini-orb-mic" aria-label="Listening"/>}
  </main>;
}

/** Settings: which screen the orb lives on, and which corner. */
export function OrbPanel() {
  const [state,setState]=useState<{settings:OrbSettings;displays:{id:number;label:string;primary:boolean}[];showingOn:string|null}|null>(null);
  useEffect(()=>{void window.harmony?.orb({op:'get'}).then(setState).catch(()=>{});},[]);
  if(!state)return null;
  const set=(patch:{on?:boolean;display?:number|null;corner?:Corner;drift?:boolean})=>void window.harmony?.orb({op:'set',...patch}).then(setState).catch(()=>{});
  return <section className="orb-panel"><p className="eyebrow">MINI ORB</p><h3>HARMONY on your second screen</h3>
    <p className="panel-intro">{state.settings.on?state.showingOn?`Showing on ${state.showingOn}. It hides while the main window is on that screen.`:'No second screen found, so the orb is hidden.':'The mini orb is off.'}</p>
    <label className="setting"><span>Floating HARMONY moves on her own<small>Out of the way of your pointer and window, nearer while you talk, hidden for full-screen video. Works on every screen; dragging her pauses it for a moment.</small></span><input type="checkbox" checked={state.settings.drift} onChange={e=>set({drift:e.target.checked})}/></label>
    <label className="setting"><span>Mini orb</span><input type="checkbox" checked={state.settings.on} onChange={e=>set({on:e.target.checked})}/></label>
    <label className="setting"><span>Screen</span><select value={state.settings.display??''} onChange={e=>set({display:e.target.value===''?null:Number(e.target.value)})}>
      <option value="">Automatic (a Dell, else the second screen)</option>
      {state.displays.map(d=><option key={d.id} value={d.id}>{d.label}{d.primary?' (main)':''}</option>)}
    </select></label>
    <label className="setting"><span>Corner</span><select value={state.settings.corner} onChange={e=>set({corner:e.target.value as Corner})}>
      <option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="top-right">Top right</option><option value="top-left">Top left</option>
    </select></label>
  </section>;
}
