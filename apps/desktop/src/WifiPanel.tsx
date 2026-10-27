import {useState} from 'react';
import type {NetworkView} from '../../../core/network-watch.ts';
import type {ReconnectView} from '../../../core/wifi-reconnect.ts';

/** Step 26: the Wi-Fi watchdog. Who's on the home network, which ones are new, and naming or clearing them. */
export function WifiPanel({status}:{status?:NetworkView&{on:boolean;reconnect?:ReconnectView}}){
 const [naming,setNaming]=useState<string|null>(null),[label,setLabel]=useState(''),[busy,setBusy]=useState(false),[all,setAll]=useState(false);
 if(!status)return null;
 const call=(r:Parameters<NonNullable<typeof window.harmony>['network']>[0])=>void window.harmony?.network(r).catch(()=>{});
 const online=status.devices.filter(d=>d.online),fresh=status.devices.filter(d=>d.status==='new');
 const list=all?status.devices:status.devices.filter(d=>d.online||d.status==='new');
 return <section className="wifi-panel"><p className="eyebrow">WI-FI WATCHDOG</p><h3>{status.network?.ssid?`On “${status.network.ssid}”`:'Your network'}</h3>
  <p className="panel-intro">{!status.on?'Paused.':status.network?`${online.length} device${online.length===1?'':'s'} here now${fresh.length?` · ${fresh.length} you haven’t named or cleared`:''}. She learned this network ${new Date(status.network.learnedAt).toLocaleDateString([],{month:'short',day:'numeric'})}; anything new since gets one alert.`:'She looks every 5 minutes, starting a minute after launch.'}{status.error?` ${status.error}`:''}</p>
  <div className="jobs-actions">
   <button className="text-button" disabled={busy||!status.on} onClick={()=>{setBusy(true);void window.harmony?.network({op:'scan'}).finally(()=>setBusy(false));}}>{busy?'Looking…':'Look now'}</button>
   <button className="text-button" onClick={()=>call({op:'on',on:!status.on})}>{status.on?'Pause watching':'Resume watching'}</button>
   {status.devices.length>list.length||all?<button className="text-button" onClick={()=>setAll(!all)}>{all?'Only here now':`Show all ${status.devices.length}`}</button>:null}
  </div>
  <ul className="wifi-list">{list.map(d=><li key={d.mac} className={`${d.status}${d.online?'':' away'}`}>
   <div><b>{d.label??d.name?.replace(/\.(lan|local|home|localdomain)$/i,'')??(d.private?'Phone or tablet':'Unnamed device')}</b>{d.status==='new'&&<span className="wifi-new">new</span>}
    <small>{d.ip} · {d.mac}{d.private?' · private address':''} · {d.online?'here now':`last seen ${new Date(d.last).toLocaleDateString([],{month:'short',day:'numeric'})}`}</small></div>
   {naming===d.mac?<form onSubmit={e=>{e.preventDefault();call({op:'label',mac:d.mac,label:label.trim()||null});setNaming(null);}}><input autoFocus value={label} maxLength={40} placeholder="Name it" onChange={e=>setLabel(e.target.value)}/><button className="text-button" type="submit">Save</button></form>
    :<div className="job-buttons"><button className="text-button" onClick={()=>{setNaming(d.mac);setLabel(d.label??'');}}>Name</button>
     {d.status==='new'&&<button className="text-button" onClick={()=>call({op:'label',mac:d.mac,label:null})}>It’s fine</button>}
     {!d.online&&<button className="text-button" onClick={()=>call({op:'forget',mac:d.mac})}>Forget</button>}</div>}
  </li>)}</ul>
  {status.reconnect&&<WifiReconnectRow r={status.reconnect}/>}
  <p className="panel-intro">Read-only: she lists what this PC can see and never blocks or changes anything. To remove a device you don’t know, change your Wi-Fi password in the router.</p>
 </section>;
}

/** Reconnect: whether she'll bring this PC's Wi-Fi back when it drops, and what happened last. */
function WifiReconnectRow({r}:{r:ReconnectView}){
 const when=(at:string)=>new Date(at).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});
 const now=r.state==='connected'?`Connected${r.profile?` to “${r.profile}”`:''}.`:r.state==='down'?`Disconnected${r.on&&r.profile?`: reconnecting to “${r.profile}”${r.attempts?` (tried ${r.attempts}×)`:''}`:''}.`:r.state==='no-adapter'?'The Wi-Fi adapter isn’t there (off, disabled or unplugged).':'';
 return <div className="wifi-reconnect">
  <label className="setting"><input type="checkbox" checked={r.on} onChange={e=>void window.harmony?.network({op:'reconnect',on:e.target.checked}).catch(()=>{})}/>
   <span>Reconnect this PC’s Wi-Fi when it drops<small>{now} She only reconnects to the network this PC was already on{r.profile?'':' (she learns it the next time you’re connected)'}, after giving Windows 20 seconds to do it first.{r.last&&r.last.kind!=='dropped'?` Last: ${r.last.text} (${when(r.last.at)})`:''}</small></span></label>
 </div>;
}
