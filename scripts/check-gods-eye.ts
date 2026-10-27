// "npm run godseye:check": checks every live source the way HARMONY uses them, then (if set up) starts God's Eye View
// and asks it a few real questions. Read-only public data; prints what came back. Stops the server at the end.
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GodsEye,routeQuestion} from '../core/gods-eye.ts';
import {readProfile} from '../core/profile.ts';
import {WorldFeeds,FEED_NAMES,type FeedKind} from '../core/world-feeds.ts';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
// Place to check: the argument, else your home from data/profile.json, else a neutral city.
const home=readProfile(root).home;
const place=process.argv[2]??home?.place??'Denver, Colorado';
// Point-based feeds (aurora, river) need coordinates; only used when your profile supplies them.
const near=home?.lat!==undefined&&home.lon!==undefined?{lat:home.lat,lon:home.lon,name:home.place}:null;
console.log('World feeds (from God\'s Eye v9):');
const feeds=new WorldFeeds();let fine=0;
const kinds:FeedKind[]=['volcano','disaster','alert','natural','space','aurora','outage','fireball','asteroid','airport','cyber','quake','hurricane','wildfire','river'];
for(const k of kinds){
 const t=Date.now();const r=await feeds.feed(k,undefined,near&&k==='aurora'?{...near,radiusKm:1}:near&&k==='river'?{...near,radiusKm:250}:undefined);if(r.ok)fine++;
 console.log(`${r.ok?'OK  ':'FAIL'} ${FEED_NAMES[k]}: ${r.events.length} item(s) in ${Date.now()-t} ms${r.events[0]?`\n     e.g. ${r.events[0].title.slice(0,150)}`:''}${r.note?`\n     ${r.note}`:''}`);
}
console.log(`${fine} of ${kinds.length} feeds answered.\n`);
const g=new GodsEye(root);
if(!g.installed){console.log('God\'s Eye View is not set up. Double-click "Set up God\'s Eye" first.');process.exit(0);}
console.log(`Starting God's Eye View (${g.status().commit?.slice(0,7)})...`);
const t0=Date.now();
if(!await g.ensure()){console.log('It did not start:',g.status().error);process.exit(1);}
console.log(`Ready in ${((Date.now()-t0)/1000).toFixed(1)} s; ${(await g.tools()).length} tools.\n`);
let ok=0;const asks=[['flights',place],['earthquakes',''],['when can I see the ISS',place],['hurricanes',''],['rocket launches',''],["what's going on",place]];
for(const [what,where] of asks){
 const r=routeQuestion(what,where);const t=Date.now();
 try{const a=await g.call(r.tool!,r.args);if(a.ok)ok++;console.log(`${a.ok?'OK  ':'FAIL'} ${what}${where?` (${where})`:''} → ${r.tool} in ${Date.now()-t} ms\n     ${a.summary.slice(0,220)}\n`);}
 catch(e){console.log(`FAIL ${what} → ${r.tool}: ${e instanceof Error?e.message:e}\n`);}
}
console.log(`${ok} of ${asks.length} answered.`);
await g.stop();
