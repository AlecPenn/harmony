import {useState} from 'react';
import type {ModesStatus} from '../../../packages/contracts/index.ts';

const STAGES=['NEW','EXPLORE','ATTACK','TEST','BUILD','ARCHIVE'] as const;
const label=(s:string)=>s[0]+s.slice(1).toLowerCase();

/** Ideas captured with "Harmony, idea: …". Move them through Explore → Attack → Test → Build, or archive them. */
export function IdeasPanel({status}:{status?:ModesStatus}){
 const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState<string|null>(null);
 const ideas=status?.ideas??[];
 async function run(work:()=>Promise<unknown>){setBusy(true);try{await work();}catch{}finally{setBusy(false);}}
 return <section className="ideas-panel">
  <h3>Ideas</h3>
  <p className="panel-intro">Say “Harmony, idea: …” and it's saved at once, no discussion. Move it along when you're ready.</p>
  {ideas.length?<ul className="memory-list" aria-label="Ideas">{ideas.map(i=><li key={i.id}>
   <span>{i.text}<small>{new Date(i.at).toLocaleDateString([],{month:'short',day:'numeric'})}{i.project?` · ${i.project}`:''}</small></span>
   <span className="memory-actions">
    <select aria-label={`Stage for ${i.text}`} value={i.stage} disabled={busy} onChange={e=>void run(()=>window.harmony!.idea({op:'stage',id:i.id,stage:e.target.value}))}>{STAGES.map(s=><option key={s} value={s}>{label(s)}</option>)}</select>
    {confirm===i.id?<button className="text-button danger" disabled={busy} onClick={()=>{setConfirm(null);void run(()=>window.harmony!.idea({op:'remove',id:i.id,confirm:'delete'}));}}>Delete</button>
     :<button className="text-button" aria-label={`Delete ${i.text}`} disabled={busy} onClick={()=>setConfirm(i.id)}>×</button>}
   </span>
  </li>)}</ul>:<p className="panel-intro">No ideas yet.</p>}
 </section>;
}
