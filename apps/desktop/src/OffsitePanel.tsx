import {useEffect,useState} from 'react';
type Reply=Awaited<ReturnType<NonNullable<typeof window.harmony>['offsite']>>;

/** Off-PC copies: pick places, save the recovery key once, see that copies are landing, restore with the key. */
export function OffsitePanel(){
 const [r,setR]=useState<Reply|null>(null),[picked,setPicked]=useState<string[]>([]),[key,setKey]=useState<string|null>(null);
 const [last,setLast]=useState(''),[typed,setTyped]=useState(''),[note,setNote]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const call=async(req:Parameters<NonNullable<typeof window.harmony>['offsite']>[0])=>{
  setBusy(true);setNote(null);
  try{const x=await window.harmony!.offsite(req);setR(x);if(x.recovery)setKey(x.recovery);if(x.error)setNote(x.error);else if(x.message)setNote(x.message);return x;}
  catch{setNote('That did not work.');return null;}finally{setBusy(false);}
 };
 useEffect(()=>{void call({op:'get'}).then(x=>{if(x)setPicked(x.status.targets.length?x.status.targets.map(t=>t.path):x.places.filter(p=>p.label.startsWith('OneDrive')).map(p=>p.path));});},[]);
 if(!r)return null;
 const s=r.status,when=(at:string|null)=>at?new Date(at).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'never';
 return <section className="offsite-panel"><p className="eyebrow">OFF-PC COPIES</p><h3>Backups that survive a dead PC</h3>
  <p className="panel-intro">An encrypted copy of the daily backup goes to your OneDrive folder (which syncs it to the cloud) or another drive. Only your recovery key can open it. Voice and face prints, passwords and keys are never included.</p>
  {key&&!s.confirmed&&<div className="recovery-key" role="alert">
   <b>Your recovery key. Save it now: password manager, a photo on your phone, or paper.</b>
   <code>{key}</code>
   <small>HARMONY won't show it again. Without it, the off-PC copies can't be opened on a new PC.</small>
   <label className="confirm-last">Type its last 4 characters to confirm you saved it<input type="text" value={last} maxLength={4} onChange={e=>setLast(e.target.value)} aria-label="Last 4 characters of the recovery key" autoComplete="off" spellCheck={false}/></label>
   <button className="primary" disabled={busy||last.length!==4} onClick={()=>void call({op:'confirm',last}).then(x=>{if(x?.confirmed){setKey(null);setNote('Saved. The first off-PC copy is being made now.');}else if(x)setNote('That doesn\'t match the end of the key. Check what you saved.');})}>I saved it</button>
  </div>}
  {(!s.on||!s.confirmed)&&!key&&<>
   {r.places.length?r.places.map(p=><label key={p.path} className="setting"><span>{p.label}</span><input type="checkbox" checked={picked.includes(p.path)} onChange={e=>setPicked(e.target.checked?[...picked,p.path]:picked.filter(x=>x!==p.path))}/></label>)
    :<p className="panel-intro">No OneDrive folder or other drive found. Plug in a USB drive and reopen Settings.</p>}
   <button className="primary" disabled={busy||!picked.length} onClick={()=>void call({op:'enable',targets:picked})}>{s.set?'Turn on off-PC copies':'Turn on and make my recovery key'}</button>
  </>}
  {s.on&&s.confirmed&&<>
   <ul className="memory-list" aria-label="Off-PC backup places">{s.targets.map(t=><li key={t.path}><span>{t.path}<small>{t.reachable?`${t.count} cop${t.count===1?'y':'ies'}, newest ${when(t.newest)}`:'Not reachable right now (unplugged?)'}</small></span></li>)}</ul>
   <button className="text-button" disabled={busy} onClick={()=>void call({op:'now'})}>Back up off-PC now</button>
   <button className="text-button" disabled={busy} onClick={()=>void call({op:'disable'})}>Turn off</button>
  </>}
  {s.set&&<details className="offsite-restore"><summary>Restore from an off-PC copy</summary>
   <p className="panel-intro">On this PC the key is remembered; on a new PC, type the recovery key. The restore happens on the next start, and the current database is kept beside it.</p>
   <input value={typed} onChange={e=>setTyped(e.target.value)} placeholder="Recovery key (only needed on a new PC)" aria-label="Recovery key" autoComplete="off" spellCheck={false}/>
   <button className="text-button" disabled={busy} onClick={()=>void call({op:'restore',recovery:typed}).then(()=>setTyped(''))}>Choose a copy…</button>
  </details>}
  {note&&<p className="panel-intro" role="status">{note}</p>}
 </section>;
}
