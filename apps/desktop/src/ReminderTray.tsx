import {useState} from 'react';
import type {RemindersStatus} from '../../../packages/contracts/reminders.ts';

const when=(iso:string)=>{
 const due=new Date(iso),now=new Date(),clock=due.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 const day=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(),diff=Math.round((day(due)-day(now))/86400000);
 return diff===0?clock:diff===1?`tomorrow ${clock}`:diff<7?`${due.toLocaleDateString([],{weekday:'short'})} ${clock}`:`${due.toLocaleDateString([],{month:'short',day:'numeric'})} ${clock}`;
};

/** Fired reminders to dismiss, and what's coming up. Everything here is stored on this PC. */
export function ReminderTray({status}:{status?:RemindersStatus}){
 const [open,setOpen]=useState(false),[pending,setPending]=useState<string|null>(null);
 if(!status||(!status.alerts.length&&!status.upcoming.length))return null;
 async function act(kind:'cancel'|'dismiss',id:string){
  setPending(id);try{await (kind==='cancel'?window.harmony?.reminderCancel(id):window.harmony?.reminderDismiss(id));}catch{}finally{setPending(null);}
 }
 const shown=open?status.upcoming:status.upcoming.slice(0,2);
 return <div className="reminder-tray">
  {status.alerts.map(a=><div className="reminder-alert" role="alert" key={a.id}>
   <span aria-hidden="true">{a.kind==='timer'?'⏱':'⏰'}</span>
   <p><strong>{a.kind==='timer'?"Time's up":'Reminder'}</strong> {a.text}{a.late&&<small> · was due {when(a.dueAt)}</small>}</p>
   <button className="text-button" disabled={pending===a.id} onClick={()=>void act('dismiss',a.id)}>Dismiss</button>
  </div>)}
  {!!status.upcoming.length&&<div className="reminder-upcoming" aria-label="Upcoming reminders and timers">
   <span className="eyebrow">Coming up</span>
   <ul>{shown.map(r=><li key={r.id}><span>{r.kind==='timer'?'⏱':'⏰'} {r.text}</span><time>{when(r.dueAt)}</time>
    <button className="text-button" aria-label={`Cancel ${r.text}`} disabled={pending===r.id} onClick={()=>void act('cancel',r.id)}>Cancel</button></li>)}</ul>
   {status.upcoming.length>2&&<button className="text-button" onClick={()=>setOpen(!open)}>{open?'Show less':`Show all ${status.upcoming.length}`}</button>}
  </div>}
 </div>;
}
