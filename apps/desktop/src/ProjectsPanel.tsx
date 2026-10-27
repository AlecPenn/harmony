import {useState} from 'react';
import type {ProjectsStatus,NoteKind,World} from '../../../core/projects.ts';

const worldNames:Record<World,string>={default:'HARMONY',prismatic:'Prismatic · cosmic lore','war-room':'War room',broadcast:'Broadcast',gallery:'Purple-gold gallery',executive:'Black and gold'};
const kindLabel:Record<NoteKind,string>={task:'Task',decision:'Decision',blocker:'Blocker',note:'Note'};
const ago=(iso:string)=>{const m=Math.round((Date.now()-new Date(iso).getTime())/60000);return m<2?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;};

/** Projects (Phase 25): what you're working on, its open work, and its atmosphere. Everything stays on this PC. */
export function ProjectsPanel({status}:{status?:ProjectsStatus}){
 const [kind,setKind]=useState<NoteKind>('task'),[text,setText]=useState(''),[newName,setNewName]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[confirm,setConfirm]=useState(false);
 const call=async(request:Record<string,unknown>,after?:()=>void)=>{setBusy(true);setNote('');try{const r=await window.harmony?.project(request);if(r&&!r.ok)setNote(r.message??'That did not work.');else after?.();}catch{setNote('That did not work.');}finally{setBusy(false);}};
 const a=status?.active;
 return <section className="projects-panel">
  <p className="panel-intro">Say "switch to Artist's Studio", "add a task…", "we decided…", "the blocker is…", "done with…", or ask <b>"Where was I?"</b></p>
  <ul className="project-list" aria-label="Projects">{(status?.projects??[]).map(p=><li key={p.id} className={p.id===status?.activeId?'current':''}>
   <button className="text-button" disabled={busy||p.id===status?.activeId} onClick={()=>void call({op:'switch',id:p.id})}>
    <b>{p.name}</b><small>{p.id===status?.activeId?'current · ':''}{p.status!=='ACTIVE'?p.status.toLowerCase()+' · ':''}{p.openTasks} open task{p.openTasks===1?'':'s'}{p.openBlockers?` · ${p.openBlockers} blocker${p.openBlockers===1?'':'s'}`:''} · {ago(p.lastActiveAt)}</small>
   </button></li>)}</ul>
  <form className="memory-add" onSubmit={e=>{e.preventDefault();const n=newName.trim();if(n.length<2)return;void call({op:'create',name:n},()=>setNewName(''));}}>
   <input aria-label="New project name" maxLength={60} value={newName} placeholder="New project name" disabled={busy} onChange={e=>setNewName(e.target.value)}/>
   <button className="text-button" disabled={busy||newName.trim().length<2}>Start project</button>
  </form>
  {a&&<div className="project-detail">
   <h4>{a.project.name}</h4>
   {a.project.description&&<p className="panel-intro">{a.project.description}</p>}
   <label className="setting"><span>Atmosphere</span><select value={a.project.world} disabled={busy} onChange={e=>void call({op:'update',id:a.project.id,world:e.target.value})}>
    {(Object.keys(worldNames) as World[]).map(w=><option key={w} value={w}>{worldNames[w]}</option>)}</select></label>
   <form className="memory-add" onSubmit={e=>{e.preventDefault();const t=text.trim();if(t.length<2)return;void call({op:'note',id:a.project.id,kind,text:t},()=>setText(''));}}>
    <select aria-label="Kind" value={kind} disabled={busy} onChange={e=>setKind(e.target.value as NoteKind)}>{(Object.keys(kindLabel) as NoteKind[]).map(k=><option key={k} value={k}>{kindLabel[k]}</option>)}</select>
    <input aria-label="Text" maxLength={240} value={text} placeholder="What happened?" disabled={busy} onChange={e=>setText(e.target.value)}/>
    <button className="text-button" disabled={busy||text.trim().length<2}>Add</button>
   </form>
   {[['Blockers',a.blockers],['Open tasks',a.tasks]].map(([title,items])=>(items as typeof a.tasks).length>0&&<div key={title as string}><p className="eyebrow">{title as string}</p><ul className="memory-list">{(items as typeof a.tasks).map(n=><li key={n.id}><span>{n.text}<small>{ago(n.createdAt)}</small></span>
    <button className="text-button" disabled={busy} onClick={()=>void call({op:'close',id:n.id})}>Done</button></li>)}</ul></div>)}
   {[['Decisions',a.decisions],['Notes',a.notes]].map(([title,items])=>(items as typeof a.tasks).length>0&&<div key={title as string}><p className="eyebrow">{title as string}</p><ul className="memory-list">{(items as typeof a.tasks).slice(0,5).map(n=><li key={n.id}><span>{n.text}<small>{ago(n.createdAt)}</small></span>
    <button className="text-button" aria-label={`Remove ${n.text}`} disabled={busy} onClick={()=>void call({op:'remove-note',id:n.id})}>Remove</button></li>)}</ul></div>)}
   <p className="memory-footer">
    <button className="text-button" disabled={busy} onClick={()=>void call({op:'update',id:a.project.id,status:a.project.status==='DONE'?'ACTIVE':'DONE'})}>{a.project.status==='DONE'?'Reopen project':'Mark project done'}</button>{' · '}
    {confirm?<><button className="text-button danger" disabled={busy} onClick={()=>{setConfirm(false);void call({op:'remove',id:a.project.id,confirm:'delete'});}}>Yes, delete {a.project.name} and its notes</button><button className="text-button" onClick={()=>setConfirm(false)}>Keep it</button></>
     :<button className="text-button" disabled={busy} onClick={()=>setConfirm(true)}>Delete project</button>}
   </p>
  </div>}
  {!a&&<p className="panel-intro">No current project. Pick one above or say "switch to" and its name.</p>}
  {note&&<p className="panel-intro" role="alert">{note}</p>}
 </section>;
}
