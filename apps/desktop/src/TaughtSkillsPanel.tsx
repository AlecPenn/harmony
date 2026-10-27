import type {Routine} from '../../../core/routines.ts';

/** Step 27: skills Alec taught by describing them. Drafts are shown step by step and run only once approved here. */
export function TaughtSkillsPanel({routines}:{routines?:(Routine&{plain:string})[]}){
 if(!routines)return null;
 const drafts=routines.filter(r=>r.status==='draft'),approved=routines.filter(r=>r.status==='approved');
 const card=(r:Routine&{plain:string})=><li key={r.id} className={r.status}>
  <b>“{r.phrase}”</b><span>I’ll {r.plain}.</span>
  <ol>{r.steps.map((s,i)=><li key={i}><small>{s.said}</small></li>)}</ol>
  <small>{r.status==='draft'?`Taught ${new Date(r.createdAt).toLocaleDateString([],{month:'short',day:'numeric'})} · not running until you approve it`:`Approved · ran ${r.runs} time${r.runs===1?'':'s'}${r.lastRun?`, last ${new Date(r.lastRun).toLocaleDateString([],{month:'short',day:'numeric'})}`:''}`}</small>
  <div className="job-buttons">
   {r.status==='draft'&&<button className="primary" onClick={()=>void window.harmony?.routines({op:'approve',id:r.id})}>Approve</button>}
   <button className="text-button" onClick={()=>void window.harmony?.routines({op:'remove',id:r.id})}>{r.status==='draft'?'Discard':'Forget'}</button>
  </div>
 </li>;
 return <section className="taught-panel"><p className="eyebrow">TAUGHT SKILLS</p><h3>Routines you taught her</h3>
  <p className="panel-intro">Say “teach you a skill: when I say start my day, open Quickbase, triage my email, then the weather in Madison.” She saves it here as a draft, and it only runs after you approve it. Each step still goes through the same checks as asking for it yourself.</p>
  {drafts.length>0&&<><h4>Waiting for your review</h4><ul className="taught-list">{drafts.map(card)}</ul></>}
  {approved.length>0&&<><h4>Ready</h4><ul className="taught-list">{approved.map(card)}</ul></>}
  {!routines.length&&<p className="panel-intro">None yet.</p>}
 </section>;
}
