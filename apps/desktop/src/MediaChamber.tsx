import {useState} from 'react';
import type {MediaItem} from '../../../core/media.ts';

const icon={document:'▤',webpages:'◎',snapshot:'▣'} as const;
const when=(iso:string)=>new Date(iso).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

/** Results as objects: research write-ups, the pages behind lookups, saved workspaces. Open one to see it in full. */
export function MediaChamber({items}:{items?:MediaItem[]}){
 const [open,setOpen]=useState<string|null>(null);
 const list=items??[];
 if(!list.length)return <p className="panel-intro">Nothing yet. Research reports, web lookups and saved places will appear here as cards.</p>;
 return <div className="media-grid">{list.map(m=>{const isOpen=open===m.id;return <article key={m.id} className={`media-card media-${m.kind}${isOpen?' open':''}`}>
  <button className="media-head" aria-expanded={isOpen} onClick={()=>setOpen(isOpen?null:m.id)}>
   <span className="media-icon" aria-hidden="true">{icon[m.kind]}</span>
   <span><strong>{m.title}</strong><small>{m.subtitle} · {when(m.at)}</small></span>
  </button>
  {isOpen&&<div className="media-body">
   {m.body&&<p>{m.body}</p>}
   {!!m.sources.length&&<ul>{m.sources.map((s,i)=><li key={i}><button className="text-button" onClick={()=>{void window.harmony?.openSource(s.url).catch(()=>{});}}>{s.title}</button><small>{s.site}</small></li>)}</ul>}
  </div>}
 </article>;})}</div>;
}
