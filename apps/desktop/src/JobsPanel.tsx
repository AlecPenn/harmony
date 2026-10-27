import {useEffect,useState} from 'react';
import type {JobProfile,JobsView} from '../../../core/job-scout.ts';

/** Step 24: the remote job scout. Ranked leads from the last Spiral Time scout, the drafted cover letter, and the
 * profile Claude scouts with. HARMONY never applies: you open the posting and send the letter yourself. */
const FIELDS:[keyof JobProfile,string,number][]=[['wants','Roles you want',3],['experience','Experience',4],['skills','Skills',3],['minPay','Pay floor',1],['avoid','Skip',2]];
export function JobsPanel({status}:{status?:JobsView}){
 const [edit,setEdit]=useState(false),[draft,setDraft]=useState<Partial<JobProfile>>({}),[note,setNote]=useState<string|null>(null),[showHidden,setShowHidden]=useState(false);
 useEffect(()=>{if(status&&!edit)setDraft(status.profile);},[status,edit]);
 if(!status)return <section className="jobs-panel"><p className="eyebrow">JOB SCOUT</p><p className="panel-intro">Unlock HARMONY to see job leads.</p></section>;
 const run=status.latest,leads=(run?.leads??[]).filter(l=>showHidden||l.status!=='hidden'),hidden=(run?.leads??[]).filter(l=>l.status==='hidden').length;
 const call=(r:Parameters<NonNullable<typeof window.harmony>['jobs']>[0])=>void window.harmony?.jobs(r).then(x=>setNote(x.message)).catch(()=>setNote('That did not work.'));
 const letterFor=run?.letter?run.leads.find(l=>l.url===run.letter!.url):null;
 return <section className="jobs-panel"><p className="eyebrow">JOB SCOUT</p><h3>Remote roles that fit you</h3>
  <p className="panel-intro">{status.profile.enabled?`About once a week, Spiral Time sends Claude out for well-paid remote roles that match your profile, ranked, with a cover letter for the best. ${status.wanted?'Set for the next Spiral Time.':status.due?'Due on the next Spiral Time.':`Last scout ${status.lastScout?new Date(status.lastScout).toLocaleDateString([],{month:'short',day:'numeric'}):'never'}.`}`:'The job scout is off.'} She never applies for you.</p>
  <div className="jobs-actions">
   {status.profile.enabled&&<button className="text-button" onClick={()=>call({op:'scout',on:!status.wanted})}>{status.wanted?'Cancel the next scout':'Scout on the next Spiral Time'}</button>}
   <button className="text-button" onClick={()=>setEdit(!edit)}>{edit?'Close profile':'Edit profile'}</button>
  </div>
  {note&&<p className="panel-intro" role="status">{note}</p>}
  {edit&&<form className="jobs-profile" onSubmit={e=>{e.preventDefault();call({op:'profile',profile:draft});setEdit(false);}}>
   <p className="panel-intro">This goes to Claude in the Spiral Time ticket, so keep it to what a résumé would say.</p>
   <label>Name on the letter<input value={draft.name??''} maxLength={80} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   {FIELDS.map(([k,label,rows])=><label key={k}>{label}{rows>1?<textarea rows={rows} maxLength={900} value={String(draft[k]??'')} onChange={e=>setDraft({...draft,[k]:e.target.value})}/>:<input maxLength={60} value={String(draft[k]??'')} onChange={e=>setDraft({...draft,[k]:e.target.value})}/>}</label>)}
   <label className="jobs-toggle"><input type="checkbox" checked={draft.enabled!==false} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Scout weekly</label>
   <button type="submit" className="text-button">Save profile</button>
  </form>}
  {run?<>
   <p className="panel-intro">{run.leads.length} lead{run.leads.length>1?'s':''} · {new Date(run.at).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}</p>
   <ol className="job-list">{leads.map(l=><li key={l.url} className={`job ${l.status}`}>
    <div className="job-head"><b>{l.title}</b><span className="job-fit" title="How well it fits your profile">{l.fit}</span></div>
    <small>{l.company}{l.pay?` · ${l.pay}`:''}{l.posted?` · posted ${l.posted}`:''}{l.status!=='new'?` · ${l.status}`:''}</small>
    {l.why&&<p>{l.why}</p>}
    <div className="job-buttons">
     <button className="text-button" onClick={()=>call({op:'open',url:l.url})}>Open posting</button>
     {l.status!=='applied'&&<button className="text-button" onClick={()=>call({op:'mark',url:l.url,status:'applied'})}>I applied</button>}
     {l.status==='new'&&<button className="text-button" onClick={()=>call({op:'mark',url:l.url,status:'saved'})}>Save</button>}
     {l.status!=='hidden'?<button className="text-button" onClick={()=>call({op:'mark',url:l.url,status:'hidden'})}>Hide</button>:<button className="text-button" onClick={()=>call({op:'mark',url:l.url,status:'new'})}>Unhide</button>}
    </div>
   </li>)}</ol>
   {hidden>0&&<button className="text-button" onClick={()=>setShowHidden(!showHidden)}>{showHidden?'Hide the hidden ones':`Show ${hidden} hidden`}</button>}
   {run.letter&&<div className="job-letter"><p className="eyebrow">COVER LETTER{letterFor?` · ${letterFor.title.toUpperCase()}`:''}</p>
    <pre>{run.letter.text}</pre>
    <button className="text-button" onClick={()=>{void navigator.clipboard?.writeText(run.letter!.text).then(()=>setNote('Copied. Read it over before you send it.')).catch(()=>setNote('Copy didn\'t work; select the text instead.'));}}>Copy letter</button>
   </div>}
  </>:<p className="panel-intro">No scout yet. Say “find me remote jobs”, then “Spiral Time” tonight.</p>}
 </section>;
}
