/** Where a reply's web information came from. Shown, never read aloud; opens in the browser on click. */
export function SourceList({sources}:{sources?:{title:string;url:string;site:string}[]}){
 if(!sources?.length)return null;
 return <p className="source-list" aria-label="Sources">
  <span>Sources:</span>
  {sources.slice(0,6).map((s,i)=><button key={i} className="source-chip" title={s.title} onClick={()=>void window.harmony?.openSource(s.url)}>{s.site||'source'}</button>)}
 </p>;
}
