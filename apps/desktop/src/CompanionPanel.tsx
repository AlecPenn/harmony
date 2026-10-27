import type {CompanionStatus} from '../../../core/companion.ts';

/** Phone companion settings: on/off, the address to open on your phone, a pairing code, and paired phones. */
export function CompanionPanel({status}:{status?:CompanionStatus}){
 if(!status)return null;
 const call=(r:Parameters<NonNullable<typeof window.harmony>['companion']>[0])=>{void window.harmony?.companion(r).catch(()=>{});};
 return <section className="companion-panel">
  <h3>Phone companion</h3>
  <label className="setting"><input type="checkbox" checked={status.enabled} onChange={e=>call({op:'enable',on:e.target.checked})}/><span>Let my phone reach HARMONY on my home Wi-Fi</span></label>
  {status.enabled?<>
   {status.error&&<p className="panel-intro" role="alert">{status.error}</p>}
   <p className="panel-intro">On your phone (same Wi-Fi), open {status.addresses.length?status.addresses.map(a=><b key={a}> http://{a}:{status.port} </b>):' this PC’s address'}, then pair it with a code. If Windows asks about the firewall, allow private networks only.</p>
   {status.code?<p className="pair-code" aria-live="polite">{status.code}<small>valid until {new Date(status.codeExpires!).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></p>
    :<button className="text-button" onClick={()=>call({op:'code'})}>Show pairing code</button>}
   {!!status.devices.length&&<ul className="memory-list" aria-label="Paired phones">{status.devices.map(d=><li key={d.id}>
    <span>{d.name}<small>paired {new Date(d.createdAt).toLocaleDateString()}{d.lastSeen?` · last used ${new Date(d.lastSeen).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`:''}</small></span>
    <button className="text-button" onClick={()=>call({op:'forget',id:d.id})}>Forget</button></li>)}</ul>}
  </>:<p className="panel-intro">Off. When on, a paired phone can type to HARMONY, capture ideas, see notices, reminders and research, and press STOP. Only your home network can reach it.</p>}
 </section>;
}
