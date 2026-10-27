import {useEffect,useState} from 'react';
import type {Draft,TriageResult,Triaged} from '../../../core/inbox-triage.ts';

/** Today's calendar and the email that needs Alec, sorted on this PC. Drafts come from the local brain on request and
 * open in Gmail for him to check and send; HARMONY can't send. */
export function InboxPanel({status}:{status?:TriageResult&{drafts:Record<string,Draft>}}){
 const [note,setNote]=useState<string|null>(null),[busy,setBusy]=useState<string|null>(null),[edit,setEdit]=useState<Record<string,string>>({});
 const run=async(r:Parameters<NonNullable<typeof window.harmony>['inbox']>[0],key:string)=>{setBusy(key);setNote(null);try{const x=await window.harmony!.inbox(r);if(x.message)setNote(x.message);}catch{setNote('That did not work.');}finally{setBusy(null);}};
 useEffect(()=>{if(!status)void run({op:'refresh'},'refresh');},[]);
 if(!status)return <p className="panel-intro">{busy?'Checking your inbox and calendar…':'Connect Google in Settings to see your inbox and calendar here. It\'s hidden while HARMONY is locked.'}</p>;
 const item=(m:Triaged)=>{const d=status.drafts[m.id],text=edit[m.id]??d?.body??'';
  return <li key={m.id} className="inbox-item">
   <div className="inbox-head"><b>{m.from}</b><small>{new Date(m.date).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div>
   <span className="inbox-subject">{m.subject}</span><small className="inbox-snippet">{m.snippet}</small><small className="inbox-why">{m.why}</small>
   {d&&<textarea value={text} rows={5} aria-label={`Draft reply to ${m.from}`} onChange={e=>setEdit({...edit,[m.id]:e.target.value})} onBlur={()=>{if(edit[m.id]!==undefined)void run({op:'edit',id:m.id,body:edit[m.id]},'edit');}}/>}
   <div className="row-buttons">
    <button className="text-button" disabled={!!busy} onClick={()=>void run({op:'draft',id:m.id},m.id)}>{busy===m.id?'Drafting on this PC…':d?'Redraft':'Draft a reply'}</button>
    {d&&<button className="primary" disabled={!!busy} onClick={()=>void run({op:'compose',id:m.id},'compose')}>Open in Gmail to send</button>}
    <button className="text-button" onClick={()=>void run({op:'open',id:m.id},'open')}>Open email</button>
   </div>
  </li>;};
 return <section className="inbox-panel">
  <div className="row-buttons"><small className="panel-intro">Checked {new Date(status.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}. Read-only; HARMONY never sends email.</small>
   <button className="text-button" disabled={!!busy} onClick={()=>void run({op:'refresh'},'refresh')}>{busy==='refresh'?'Checking…':'Refresh'}</button></div>
  {status.error&&<p className="panel-intro" role="alert">{status.error}</p>}
  <h3>Today</h3>
  {status.today.length?<ul className="inbox-today">{status.today.map((e,i)=><li key={i}><b>{e.time}</b> {e.title}{e.where?<small> · {e.where}</small>:null}</li>)}</ul>:<p className="panel-intro">Nothing on your calendar today.</p>}
  <h3>Needs you <small>{status.needsYou.length}</small></h3>
  {status.needsYou.length?<ul className="inbox-list">{status.needsYou.map(item)}</ul>:<p className="panel-intro">Nothing unread needs you.</p>}
  {!!status.fyi.length&&<details><summary>For your information ({status.fyi.length})</summary><ul className="inbox-list">{status.fyi.map(item)}</ul></details>}
  {!!status.skipped&&<p className="panel-intro">{status.skipped} promotional or automated email{status.skipped>1?'s':''} skipped.</p>}
  {note&&<p className="panel-intro" role="status">{note}</p>}
 </section>;
}
