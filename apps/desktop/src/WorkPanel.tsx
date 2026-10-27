import {useState} from 'react';
import type {JobView,JobStatus} from '../../../core/worklog.ts';

const GROUPS:[JobStatus,string][]=[['waiting_parts','Waiting on parts'],['in_progress','In progress'],['open','Not started'],['done','Done today']];
const where=(p:string)=>/^\d/.test(p)?`Unit ${p}`:p?p[0].toUpperCase()+p.slice(1):'No place';
const time=(at:string)=>new Date(at).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});

/** Alec's work log: jobs by status, their history, parts waiting and receipts, plus today's summary. Private to him. */
export function WorkPanel({status}:{status?:{jobs:JobView[];summary:string}}){
 const [place,setPlace]=useState(''),[title,setTitle]=useState(''),[note,setNote]=useState<string|null>(null),[open,setOpen]=useState<string|null>(null);
 if(!status)return <p className="panel-intro">The work log is hidden while HARMONY is locked.</p>;
 const run=async(r:Parameters<NonNullable<typeof window.harmony>['work']>[0])=>{setNote(null);try{const x=await window.harmony!.work(r);if(x.message)setNote(x.message);return x.ok;}catch{setNote('That did not work.');return false;}};
 return <section className="work-panel">
  <p className="panel-intro">Your maintenance log. Say things like "new job, unit 214, leaking faucet", "214: replaced the cartridge, 40 minutes", "ordered two Moen 1225 from Ferguson for 214", "parts came for 214", "214 is done", or "end of day summary". Only you see this.</p>
  <form className="work-add" onSubmit={e=>{e.preventDefault();if(title.trim())void run({op:'add',place,title}).then(ok=>{if(ok){setPlace('');setTitle('');}});}}>
   <input value={place} onChange={e=>setPlace(e.target.value)} placeholder="Unit or place" aria-label="Unit or place" maxLength={60}/>
   <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs doing" aria-label="What needs doing" maxLength={160}/>
   <button className="text-button" disabled={!title.trim()}>Add job</button>
  </form>
  <div className="work-summary" role="status"><small>TODAY</small>{status.summary}</div>
  {GROUPS.map(([st,label])=>{const jobs=status.jobs.filter(j=>j.status===st);if(!jobs.length)return null;
   return <div key={st} className={`work-group work-${st}`}><h3>{label} <small>{jobs.length}</small></h3>
    <ul>{jobs.map(j=><li key={j.id}>
     <button className="work-job" aria-expanded={open===j.id} onClick={()=>setOpen(open===j.id?null:j.id)}>
      <b>{where(j.place)}</b><span>{j.title}</span>
      <small>{j.minutes?`${j.minutes} min · `:''}{j.partsWaiting.length?`waiting: ${j.partsWaiting.map(p=>p.part).join(', ')} · `:''}{j.files.length?`${j.files.length} receipt${j.files.length>1?'s':''} · `:''}updated {time(j.updatedAt)}</small>
     </button>
     {open===j.id&&<div className="work-detail">
      <ol>{j.events.slice(-8).map(e=><li key={e.id}><time>{time(e.at)}</time> {e.text}{e.minutes?` (${e.minutes} min)`:''}</li>)}{!j.events.length&&<li>Nothing logged yet.</li>}</ol>
      {!!j.files.length&&<div className="work-files">{j.files.map(f=><button key={f.id} className="text-button" onClick={()=>void run({op:'open-file',file:f.id})}>🧾 {f.name}</button>)}</div>}
      <div className="row-buttons">
       <button className="text-button" onClick={()=>void run({op:'receipt',id:j.id})}>Attach receipt…</button>
       {j.status==='done'?<button className="text-button" onClick={()=>void run({op:'reopen',id:j.id})}>Reopen</button>:<button className="text-button" onClick={()=>void run({op:'done',id:j.id})}>Mark done</button>}
      </div>
     </div>}
    </li>)}</ul></div>;})}
  {!status.jobs.length&&<p className="panel-intro">No open jobs.</p>}
  {note&&<p className="panel-intro" role="alert">{note}</p>}
 </section>;
}
