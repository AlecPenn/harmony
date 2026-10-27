import {useEffect,useState} from 'react';
import type {GodsEyeStatus} from '../../../core/gods-eye.ts';

/** Settings → God's Eye: whether it's set up, open it, and the world data keys imported from v9 (names only). */
export function GodsEyePanel({status}:{status?:GodsEyeStatus}){
 const [keys,setKeys]=useState<string[]|null>(null),[note,setNote]=useState(''),[brief,setBrief]=useState(true);
 const refresh=()=>{void (window.harmony?.godsEye({op:'keys'}) as Promise<{names:string[];brief?:boolean}>|undefined)?.then(r=>{setKeys(r.names);setBrief((r as {brief?:boolean}).brief!==false);}).catch(()=>setKeys([]));};
 useEffect(refresh,[]);
 if(!status)return null;
 return <section className="gods-eye-panel">
  <p className="eyebrow">GOD'S EYE</p><h3>The world, live</h3>
  {status.state==='NOT_INSTALLED'?<p className="panel-intro">Not set up yet. Double-click <b>Set up God's Eye</b> in the HARMONY folder (free, pinned version).</p>
   :<p className="panel-intro">God's Eye View {status.commit?.slice(0,7)} · {status.state==='READY'?'running':status.state==='STARTING'?'starting…':'stopped until you ask'}{status.lastAsk?` · last asked ${new Date(status.lastAsk).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:''}</p>}
  <div className="row-buttons">
   <button className="primary" disabled={status.state==='NOT_INSTALLED'} onClick={()=>void window.harmony?.godsEye({op:'open'})}>Open God's Eye</button>
   <button className="text-button" disabled={status.state==='NOT_INSTALLED'} onClick={()=>void window.harmony?.godsEye({op:'ambient',on:true})} title="The globe turning slowly, full screen on your second monitor. Esc ends it.">Ambient mode</button>
   {status.state==='READY'&&<button className="text-button" onClick={()=>void window.harmony?.godsEye({op:'stop'})}>Stop it</button>}
  </div>
  <label className="setting"><input type="checkbox" checked={status.lite!==false} onChange={e=>void window.harmony?.godsEye({op:'lite',on:e.target.checked})}/><span>Lite mode<small>Lighter rendering for this PC's graphics card: 30 frames a second, 75% resolution, no blur or atmosphere, and no Google 3D city tiles. Turn off for the full look.</small></span></label>
  {status.overlay&&status.overlay!=='applied'&&<p className="panel-intro">HARMONY's God's Eye additions are {status.overlay}</p>}
  <h4>Watching</h4>
  {status.watching?.length?<ul className="memory-list">{status.watching.map(z=><li key={z.id}><span>{z.name}<small>within {z.radiusKm} km</small></span></li>)}</ul>
   :<p className="panel-intro">Say “Harmony, watch Madison” and she'll tell you about new earthquakes, severe weather alerts, disasters and volcano alerts nearby. “Stop watching Madison” ends it.</p>}
  <label className="setting"><input type="checkbox" checked={brief} onChange={e=>{setBrief(e.target.checked);void window.harmony?.godsEye({op:'brief',on:e.target.checked});}}/><span>Morning world brief<small>The first time you're at the PC each morning: what changed overnight, and near your watched places</small></span></label>
  <h4>World data keys</h4>
  <p className="panel-intro">Your God's Eye v9 keys (NASA FIRMS, OpenSky, AIS, NASA and others) unlock live fires, more flights and ships. They're read from <b>God's 3rd Eye\server.py</b> on your Desktop and kept only in an encrypted file. Only their names show here.</p>
  {keys&&keys.length>0?<p className="panel-intro">Imported: {keys.join(', ')}</p>:<p className="panel-intro">None imported yet.</p>}
  <div className="row-buttons">
   <button className="text-button" onClick={()=>{setNote('');void (window.harmony?.godsEye({op:'import-v9'}) as Promise<{names:string[];error:string|null}>|undefined)?.then(r=>{setNote(r.error??`Imported ${r.names.length} key${r.names.length===1?'':'s'}.`);refresh();}).catch(e=>setNote(e instanceof Error?e.message:'That did not work.'));}}>Import keys from v9</button>
   {!!keys?.length&&<button className="text-button" onClick={()=>{if(confirm('Forget the imported world data keys?'))void window.harmony?.godsEye({op:'forget-keys'}).then(refresh).catch(()=>{});}}>Forget keys</button>}
  </div>
  {note&&<p className="panel-intro" role="status">{note}</p>}
 </section>;
}
