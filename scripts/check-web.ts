/** Live check of HARMONY's free web sources from this PC: weather, news and search. Nothing is stored.
 * Usage: npm run web:check [-- "your search"]
 */
import {dirname,join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {readProfile} from '../core/profile.ts';
import {WebLookup} from '../core/web.ts';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const web=new WebLookup(),query=process.argv[2]??'who won the most recent World Series';
// Smoke-test place: your home from data/profile.json if set, else a neutral city. Override with WEATHER_PLACE.
const place=process.env.WEATHER_PLACE??readProfile(root).home?.place??'Denver, Colorado';
const checks:[string,()=>Promise<{text:string;sources:{site:string}[]}>][]=[
 [`Weather (Open-Meteo) · ${place}`,()=>web.weather(place,new AbortController().signal)],
 ['News (Google News)',()=>web.news('',new AbortController().signal)],
 [`Search "${query}"`,()=>web.search(query,new AbortController().signal)],
];
let ok=0;
for(const [name,run] of checks){
 const t=performance.now();
 try{const r=await run();ok++;console.log(`OK   ${name} · ${Math.round(performance.now()-t)} ms · sources: ${r.sources.map(s=>s.site).join(', ')||'none'}\n${r.text.split('\n').slice(0,4).map(l=>'     '+l.slice(0,150)).join('\n')}\n`);}
 catch(e){console.log(`FAIL ${name} · ${e instanceof Error?e.message:e}\n`);}
}
console.log(`${ok} of ${checks.length} sources reachable.`);
