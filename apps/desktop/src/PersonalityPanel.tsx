import {useState} from 'react';
import type {PersonalitySnapshot} from '../../../packages/contracts/index.ts';

const PROFILES=[['calm','Calm'],['cheeky','Cheeky'],['coach','Coach'],['roast','Roast'],['custom','Custom']] as const;
const DIALS=['warmth','sarcasm','verbosity','energy','humor','proactivity','formality'] as const;

/** How HARMONY talks. Style only: it never changes what she's allowed to do. */
export function PersonalityPanel({status}:{status?:PersonalitySnapshot}){
 const [busy,setBusy]=useState(false);
 if(!status)return null;
 const set=(value:{profile:string;traits?:Record<string,number>})=>{setBusy(true);void window.harmony!.setPersonality(value).catch(()=>{}).finally(()=>setBusy(false));};
 return <section className="personality-panel">
  <h3>Personality</h3>
  <label className="setting"><span>Style</span>
   <select aria-label="Personality" value={status.profile} disabled={busy} onChange={e=>set({profile:e.target.value})}>{PROFILES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
  {status.profile==='custom'&&<div className="dials">{DIALS.map(d=><label key={d}><span>{d[0].toUpperCase()+d.slice(1)}</span>
   <input type="range" min={0} max={1} step={.05} value={status.traits[d]} disabled={busy} aria-label={d}
    onChange={e=>set({profile:'custom',traits:{[d]:Number(e.target.value)}})}/></label>)}</div>}
  <p className="panel-intro">Takes effect from the next conversation. Proactivity also changes how readily she speaks up on her own. Try “Harmony, flex.”</p>
 </section>;
}
