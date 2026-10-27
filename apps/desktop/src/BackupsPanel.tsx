import {useState} from 'react';
import type {BackupInfo} from '../../../core/backup.ts';

/** Daily backups of HARMONY's database and settings (never the credentials), and a two-click restore on next start. */
export function BackupsPanel({status}:{status?:{list:BackupInfo[];restorePending:boolean;restored:boolean}}){
 const [confirm,setConfirm]=useState<string|null>(null),[busy,setBusy]=useState(false);
 if(!status)return null;
 const run=(r:Parameters<NonNullable<typeof window.harmony>['backup']>[0])=>{setBusy(true);void window.harmony!.backup(r).catch(()=>{}).finally(()=>setBusy(false));};
 return <section className="backups-panel">
  <h3>Backups</h3>
  <p className="panel-intro">Memory, projects, reminders, ideas, research and settings, saved once a day on this PC (newest 7 kept). Passwords and sign-ins are never copied.</p>
  {status.restored&&<p className="panel-intro" role="status">Restored from a backup at this start. The previous database is kept as harmony-before-restore.</p>}
  {status.restorePending&&<p className="panel-intro" role="status">A restore will happen the next time HARMONY starts. <button className="text-button" disabled={busy} onClick={()=>run({op:'cancel-restore'})}>Cancel restore</button></p>}
  <button className="text-button" disabled={busy} onClick={()=>run({op:'create'})}>Back up now</button>
  {!!status.list.length&&<ul className="memory-list" aria-label="Backups">{status.list.map(b=><li key={b.name}>
   <span>{new Date(b.at).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}<small>{Math.max(1,Math.round(b.bytes/1024))} KB</small></span>
   {confirm===b.name?<button className="text-button danger" disabled={busy} onClick={()=>{setConfirm(null);run({op:'restore',name:b.name,confirm:'restore'});}}>Restore on next start</button>
    :<button className="text-button" disabled={busy} onClick={()=>setConfirm(b.name)}>Restore…</button>}
  </li>)}</ul>}
 </section>;
}
