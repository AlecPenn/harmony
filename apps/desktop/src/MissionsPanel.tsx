import {useState} from 'react';
import type {MissionSummary} from '../../../core/missions.ts';

const label={QUEUED:'Waiting',RUNNING:'Working',DONE:'Ready',FAILED:'Stopped',CANCELLED:'Cancelled'} as const;

/** Background research missions: what each is doing, and the finished write-up with its sources. */
export function MissionsPanel({missions}:{missions?:MissionSummary[]}){
 const [open,setOpen]=useState<string|null>(null);
 const list=missions??[];
 return <section className="missions-panel">
  <h3>Research</h3>
  <p className="panel-intro">Say “Harmony, research …” and she works on it in the background, only while you're not talking to her, and tells you when it's ready.</p>
  {list.length?<ul className="memory-list" aria-label="Research missions">{list.map(m=><li key={m.id} className="mission">
   <span>
    <button className="text-button mission-title" aria-expanded={open===m.id} onClick={()=>setOpen(open===m.id?null:m.id)}>{m.objective}</button>
    <small>{label[m.status]} · {m.stage} · {m.used} of {m.budget} lookups</small>
    {open===m.id&&m.report&&<>
     <p className="mission-report">{m.report.replace(/\n\nSources:[\s\S]*$/,'')}</p>
     {!!m.sources.length&&<ol className="mission-sources">{m.sources.map(s=><li key={s.n}>[{s.n}] {s.title} <small>{s.site}</small></li>)}</ol>}
    </>}
   </span>
   {(m.status==='QUEUED'||m.status==='RUNNING')&&<button className="text-button" aria-label={`Cancel research on ${m.objective}`} onClick={()=>{void window.harmony?.cancelMission(m.id).catch(()=>{});}}>Cancel</button>}
  </li>)}</ul>:<p className="panel-intro">No research yet.</p>}
 </section>;
}
