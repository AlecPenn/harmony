import {useState} from 'react';
import type {UpdateStatus} from '../../../core/updater.ts';

/** One click to update: shows what's new, builds beside the running version, then HARMONY restarts into it. */
export function UpdateBanner({status}:{status?:UpdateStatus}){
 const [said,setSaid]=useState<string|null>(null),[busy,setBusy]=useState(false);
 if(!status)return null;
 const run=async(op:'apply'|'undo')=>{setBusy(true);try{const r=await window.harmony?.update({op});setSaid(r?.message??null);}catch{setSaid('That didn\'t work.');}finally{setBusy(false);}};
 if(status.state==='building')return <div className="guard-banner update-banner" role="status"><b>Updating</b><span>Building the new version while this one keeps running. HARMONY restarts when it's ready.</span></div>;
 if(status.state==='failed')return <div className="guard-banner update-banner" role="alert"><b>Update didn't build</b><span>Nothing changed. {status.error}</span>
  <button className="text-button" disabled={busy} onClick={()=>void run('apply')}>Try again</button></div>;
 if(!status.available&&status.state!=='ready')return null;
 const what=status.commits.slice(0,3).map(c=>c.subject).join(' · ');
 return <div className="guard-banner update-banner" role="status"><b>Update ready</b>
  <span>{said??(what||'A newer version of HARMONY is in her folder.')}{status.commits.length>3?` · +${status.commits.length-3} more`:''}</span>
  <button className="primary" disabled={busy} onClick={()=>void run('apply')}>Update</button>
  {status.canUndo&&<button className="text-button" disabled={busy} onClick={()=>void run('undo')}>Undo last update</button>}
 </div>;
}
