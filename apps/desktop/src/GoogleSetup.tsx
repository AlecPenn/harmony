import {useState} from 'react';
import type {GoogleStatus} from '../../../core/google.ts';

/** Read-only Google Calendar and Gmail. Alec's own Google client; the sign-in is protected by Windows on this PC. */
export function GoogleSetup({status,disabled}:{status?:GoogleStatus;disabled:boolean}){
 const [want,setWant]=useState<{calendar:boolean;gmail:boolean}>({calendar:true,gmail:true}),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 const s=status;
 async function run(work:()=>Promise<{ok:boolean;message:string|null}|undefined>,ok:string){
  setBusy(true);setNote('');
  try{const r=await work();setNote(r?.ok?ok:r?.message??'');}catch{setNote('That did not work. Try again.');}finally{setBusy(false);}
 }
 const caps=(Object.keys(want) as ('calendar'|'gmail')[]).filter(k=>want[k]);
 return <section className="voice-setup google-setup">
  <p className="eyebrow">READ ONLY</p><h3>Google Calendar and Gmail</h3>
  <p className="panel-intro">Lets HARMONY answer "what's on tomorrow?" and "any new email?". She can read, never send, delete or change anything. Uses your own Google client, and the sign-in is locked to this PC by Windows.</p>
  {!s?.clientImported&&<details className="audition-script" open><summary>One-time setup (about 10 minutes)</summary><ol className="setup-steps">
   <li>Open <button className="text-button inline" onClick={()=>void window.harmony?.openSource('https://console.cloud.google.com/projectcreate')}>Google Cloud Console</button> and create a project called HARMONY.</li>
   <li>In APIs &amp; Services, enable <b>Google Calendar API</b> and <b>Gmail API</b>.</li>
   <li>In Google Auth Platform: fill in Branding (app name HARMONY, your email), set Audience to External and add yourself as a test user.</li>
   <li>Clients → Create client → <b>Desktop app</b> → Download JSON.</li>
   <li>Come back here and choose that file.</li>
  </ol></details>}
  <p role="status">{s?.connected?`Connected${s.email?` as ${s.email}`:''} · ${s.capabilities.map(c=>c==='gmail'?'Gmail':'Calendar').join(' and ')||'nothing'} (read only)`:s?.clientImported?'Client file saved · not signed in':'Not set up'}</p>
  {s?.needsReconnect&&<p className="panel-intro" role="alert">Google ended the sign-in (projects in Testing mode expire every 7 days). Connect again below, or publish your Google project to stop this.</p>}
  <button className="text-button" disabled={disabled||busy} onClick={()=>void run(()=>window.harmony!.googleImport(),'Client file saved and protected on this PC.')}>{s?.clientImported?'Replace client file':'Choose client file'}</button>
  {s?.clientImported&&<div className="google-connect">
   <label className="voice-consent"><input type="checkbox" checked={want.calendar} disabled={busy} onChange={e=>setWant({...want,calendar:e.target.checked})}/>Calendar (read events)</label>
   <label className="voice-consent"><input type="checkbox" checked={want.gmail} disabled={busy} onChange={e=>setWant({...want,gmail:e.target.checked})}/>Gmail (read sender, subject, preview)</label>
   <button className="primary" disabled={disabled||busy||!caps.length} onClick={()=>{setNote('Finish signing in in your browser…');void run(()=>window.harmony!.googleConnect(caps),'Connected. Try: "What\'s on my calendar tomorrow?"');}}>{s.connected?'Reconnect with these':'Connect Google'}</button>
   <p className="panel-intro">Google will show exactly these permissions. If it says "Google hasn't verified this app", that's your own app: choose Advanced, then continue.</p>
  </div>}
  {s?.connected&&<button className="text-button" disabled={busy} onClick={()=>void run(()=>window.harmony!.googleDisconnect('disconnect'),'Disconnected and access revoked at Google.')}>Disconnect</button>}
  {s?.clientImported&&<button className="text-button danger" disabled={busy} onClick={()=>void run(()=>window.harmony!.googleDisconnect('forget'),'Google client and sign-in removed from this PC.')}>Remove Google from this PC</button>}
  {note&&<p className="panel-intro" role="status">{note}</p>}
 </section>;
}
