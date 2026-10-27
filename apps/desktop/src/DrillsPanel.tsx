import {useState} from 'react';
import type {DrillReport} from '../../../core/security-drills.ts';

/** Monthly security drills: HARMONY attacks herself on a sandbox and shows what held. */
export function DrillsPanel({report}:{report?:DrillReport|null}){
 const [busy,setBusy]=useState(false);
 return <section className="drills-panel"><p className="eyebrow">SECURITY DRILLS</p><h3>She tests her own defenses</h3>
  <p className="panel-intro">Once a month (or now), HARMONY tries to break in: replayed phone approvals, a stranger’s voice, a photo of your face, a stranger’s thumbs up, the duress phrase, hostile web and email text, forged Spiral Time results, a lookalike window, a distrusted certificate and a tampered backup. It all runs on a sandbox; nothing real is touched.</p>
  {report?<><p className="panel-intro" role="status">{report.failed?`${report.failed} of ${report.results.length} did not hold`:`All ${report.results.length} held`} · {new Date(report.at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</p>
   <ul className="drill-list">{report.results.map(r=><li key={r.id} className={r.passed?'held':'broke'}><b aria-label={r.passed?'Held':'Did not hold'}>{r.passed?'✓':'✗'}</b><span>{r.name}<small>{r.detail}</small></span></li>)}</ul></>
   :<p className="panel-intro">Not run yet.</p>}
  <button className="text-button" disabled={busy} onClick={()=>{setBusy(true);void window.harmony?.drills({op:'run'}).finally(()=>setBusy(false));}}>{busy?'Running drills…':'Run the drills now'}</button>
 </section>;
}
