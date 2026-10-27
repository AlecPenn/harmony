import type {Notice} from '../../../core/interruptions.ts';

const when=(iso:string)=>new Date(iso).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const said=(d:Notice['decision'])=>d==='SHOW'?'shown':d==='SPEAK_WHEN_FREE'?'said when free':d==='INTERRUPT'?'said':d==='CRITICAL'?'said':'';

/** Things HARMONY noticed on her own (calendar heads-ups, new errors on screen) plus reminders, newest first. */
export function NoticeTray({notices}:{notices?:Notice[]}){
 const list=(notices??[]).slice(0,4);if(!list.length)return null;
 return <ul className="notice-tray" aria-label="Notices">{list.map(n=><li key={n.id}>
  <span>{n.text}<small>{when(n.at)} · {said(n.decision)}</small></span>
  <button className="text-button" aria-label={`Dismiss ${n.text}`} onClick={()=>{void window.harmony?.dismissNotice(n.id).catch(()=>{});}}>×</button>
 </li>)}</ul>;
}
