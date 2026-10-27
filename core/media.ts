import type {DatabaseSync} from 'node:sqlite';

/** Phase 35, the Media Chamber: what HARMONY produced or fetched, as objects you can open, not a dump of paths. Read-only
 * views over data already kept locally (research reports, web lookups with their sources, saved workspaces). */
export interface MediaSource {title:string;url:string;site:string;}
export interface MediaItem {
 id:string;kind:'document'|'webpages'|'snapshot';at:string;title:string;subtitle:string;
 /** Text body (a research write-up), or the list of windows for a snapshot. */
 body:string;sources:MediaSource[];
}
const safe=(u:unknown)=>typeof u==='string'&&/^https?:\/\//.test(u)&&u.length<=2000;
const src=(v:unknown):MediaSource[]=>Array.isArray(v)?v.filter(s=>s&&safe(s.url)).slice(0,8).map(s=>({title:String(s.title??s.url).slice(0,200),url:String(s.url),site:String(s.site??'').slice(0,80)})):[];

export function mediaItems(db:DatabaseSync,limit=30):MediaItem[]{
 const out:MediaItem[]=[];
 for(const r of db.prepare("SELECT id,updated_at,objective,report,state,status FROM missions WHERE status='DONE' OR (status='FAILED' AND report IS NOT NULL) ORDER BY updated_at DESC LIMIT 15").all()){
  let evidence:unknown=[];try{evidence=JSON.parse(String(r.state)).evidence;}catch{}
  out.push({id:`m:${r.id}`,kind:'document',at:String(r.updated_at),title:String(r.objective),subtitle:r.status==='DONE'?'Research report':'Research (incomplete)',
   body:String(r.report??'').replace(/\n\nSources:[\s\S]*$/,''),sources:src(evidence)});
 }
 for(const r of db.prepare('SELECT id,at,kind,query,sources FROM web_lookups ORDER BY at DESC LIMIT 15').all()){
  let s:unknown=[];try{s=JSON.parse(String(r.sources));}catch{}
  const sources=src(s);if(!sources.length)continue;
  out.push({id:`w:${r.id}`,kind:'webpages',at:String(r.at),title:String(r.query),subtitle:r.kind==='news'?'News':r.kind==='weather'?'Weather':'Web search',body:'',sources});
 }
 for(const r of db.prepare('SELECT id,at,label,data FROM workspace_snapshots ORDER BY at DESC LIMIT 8').all()){
  let d:{project?:string|null;windows?:{app:string;title:string}[]}={};try{d=JSON.parse(String(r.data));}catch{}
  const w=Array.isArray(d.windows)?d.windows:[];
  out.push({id:`s:${r.id}`,kind:'snapshot',at:String(r.at),title:`Saved place: ${String(r.label)}`,subtitle:`${w.length} window${w.length===1?'':'s'}${d.project?` · ${d.project}`:''}`,
   body:w.slice(0,12).map(x=>`${x.app} — ${x.title}`).join('\n'),sources:[]});
 }
 return out.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,limit);
}
