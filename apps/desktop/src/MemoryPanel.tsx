import {useState} from 'react';
import type {MemoryStatus,MemorySearchHit} from '../../../packages/contracts/memory.ts';

const saved=(iso:string)=>new Date(iso).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'});
const via={voice:'said aloud',typed:'typed',screen:'added here'} as const;
const kindLabel={memory:'Remembered',episode:'Conversation',note:'Project',idea:'Idea'} as const;

/** Everything HARMONY was asked to remember, plus search and the (opt-in) conversation memory. All on this PC only. */
export function MemoryPanel({status}:{status?:MemoryStatus}){
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[confirmAll,setConfirmAll]=useState(false),[confirmTalk,setConfirmTalk]=useState(false),[note,setNote]=useState('');
 const [query,setQuery]=useState(''),[hits,setHits]=useState<MemorySearchHit[]|null>(null);
 const items=status?.items??[],recall=status?.recall;
 async function run(work:()=>Promise<unknown>,failed:string){setBusy(true);setNote('');try{const ok=await work();if(ok===false)setNote(failed);}catch{setNote(failed);}finally{setBusy(false);}}
 async function search(){const q=query.trim();if(q.length<2)return;setBusy(true);setNote('');try{setHits(await window.harmony!.memorySearch(q));}catch{setNote('Search did not work just now.');}finally{setBusy(false);}}
 return <section className="memory-panel">
  <h3>What HARMONY remembers</h3>
  <p className="panel-intro">Say “Harmony, remember that …” or add one below. Kept on this PC and used to answer you. Pinned items are always in mind; the rest come up when they're relevant.</p>
  <form className="memory-add" onSubmit={e=>{e.preventDefault();const t=text.trim();if(t.length<3)return;void run(async()=>{const ok=await window.harmony?.memoryAdd(t);if(ok)setText('');return ok;},'That could not be saved. Try a shorter note.');}}>
   <input aria-label="Something to remember" maxLength={200} value={text} placeholder="e.g. My mum's birthday is March 3" disabled={busy} onChange={e=>setText(e.target.value)}/>
   <button className="text-button" disabled={busy||text.trim().length<3}>Remember</button>
  </form>
  {recall&&<>
   <form className="memory-add" role="search" onSubmit={e=>{e.preventDefault();void search();}}>
    <input aria-label="Search memory" maxLength={200} value={query} placeholder="Search by meaning, e.g. the guy who fixes pipes" disabled={busy} onChange={e=>{setQuery(e.target.value);if(!e.target.value)setHits(null);}}/>
    <button className="text-button" disabled={busy||query.trim().length<2}>Search</button>
   </form>
   {hits&&(hits.length?<ul className="memory-list" aria-label="Search results">{hits.map(h=><li key={h.kind+h.id}>
    <span>{h.text}<small>{kindLabel[h.kind]} · {saved(h.at)}{h.project?` · ${h.project}`:''}</small></span>
   </li>)}</ul>:<p className="panel-intro">Nothing found for that.</p>)}
   <p className="panel-intro">{recall.engine==='meaning'
    ?`Search by meaning is on (${recall.indexed} of ${recall.total} items indexed).`
    :'Search uses matching words for now. Double-click “Set up memory search” in the HARMONY folder to add search by meaning (about 200 MB, free).'}</p>
  </>}
  {note&&<p className="panel-intro" role="alert">{note}</p>}
  {items.length?<ul className="memory-list" aria-label="Remembered things">{items.map(m=><li key={m.id}>
   <span>{m.text}<small>{saved(m.createdAt)} · {via[m.source]}{m.pinned?' · pinned':''}</small></span>
   <span className="memory-actions">
    <button className="text-button" aria-pressed={!!m.pinned} aria-label={m.pinned?`Unpin ${m.text}`:`Pin ${m.text}`} disabled={busy} onClick={()=>void run(()=>window.harmony!.memoryPin(m.id,!m.pinned),'That could not be changed.')}>{m.pinned?'Unpin':'Pin'}</button>
    <button className="text-button" aria-label={`Forget ${m.text}`} disabled={busy} onClick={()=>void run(()=>window.harmony!.memoryForget(m.id),'That could not be forgotten.')}>Forget</button>
   </span>
  </li>)}</ul>:<p className="panel-intro">Nothing remembered yet.</p>}
  {!!items.length&&<p className="memory-footer">{items.length} of {status?.limit??200} ·{' '}
   {confirmAll?<><button className="text-button danger" disabled={busy} onClick={()=>{setConfirmAll(false);void run(()=>window.harmony!.memoryForgetAll(),'Memory could not be cleared.');}}>Yes, forget all {items.length}</button><button className="text-button" onClick={()=>setConfirmAll(false)}>Keep them</button></>
    :<button className="text-button" disabled={busy} onClick={()=>setConfirmAll(true)}>Forget everything</button>}</p>}
  {recall&&<div className="memory-episodes">
   <label><input type="checkbox" checked={recall.episodes} disabled={busy} onChange={e=>void run(()=>window.harmony!.memoryEpisodes(e.target.checked),'That setting could not be changed.')}/>
    {' '}Remember our conversations</label>
   <p className="panel-intro">{recall.episodes
    ?`On. What you say and what HARMONY answers is kept as text on this PC for ${recall.keepDays} days, so you can ask “what did we talk about …?”. No audio is kept.`
    :'Off. Only the things above are kept. Turn on to let HARMONY recall past conversations (text only, this PC only, deleted after '+recall.keepDays+' days).'}</p>
   {recall.episodeCount>0&&<p className="memory-footer">{recall.episodeCount} saved exchange{recall.episodeCount===1?'':'s'} ·{' '}
    {confirmTalk?<><button className="text-button danger" disabled={busy} onClick={()=>{setConfirmTalk(false);void run(()=>window.harmony!.memoryForgetEpisodes(),'Conversations could not be cleared.');}}>Yes, delete them</button><button className="text-button" onClick={()=>setConfirmTalk(false)}>Keep them</button></>
     :<button className="text-button" disabled={busy} onClick={()=>setConfirmTalk(true)}>Forget conversations</button>}</p>}
  </div>}
 </section>;
}
