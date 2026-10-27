import type {DatabaseSync} from 'node:sqlite';
import {WorldFeeds,nearby,type WorldEvent} from './world-feeds.ts';
import type {WatchZones} from './watch-zones.ts';

/** Morning world brief: the first time you're at the PC between 5 and 11:59 in the morning, HARMONY says what changed
 * overnight. That covers the biggest world events, anything near your watched places, and space weather if it's
 * notable. It's calm and hope-forward: facts plainly, nothing invented. Once a day; off in Settings → God's Eye. It's spoken through the
 * interruption engine, so focus, ghost mode and quiet hours win. */
export function composeBrief(events:readonly WorldEvent[],zones:readonly {name:string;lat:number;lon:number;radiusKm:number}[],now:Date):string{
 const since=now.getTime()-14*3600000,recent=events.filter(e=>!e.at||Date.parse(e.at)>=since);
 const big=recent.filter(e=>e.kind!=='space'&&e.severity>=.7).sort((a,b)=>b.severity-a.severity);
 const seen=new Set<string>(),top:WorldEvent[]=[];
 for(const e of big){const k=e.title.toLowerCase().replace(/[^a-z]+/g,' ').split(' ').slice(0,4).join(' ');if(seen.has(k))continue;seen.add(k);top.push(e);if(top.length===3)break;}
 const parts=['Good morning.'];
 parts.push(top.length?`Overnight: ${top.map(e=>e.title.replace(/\s*\(.*?\)\s*$/,'')).join('; ')}.`:'Overnight was quiet around the world: nothing major.');
 for(const z of zones.slice(0,3)){const n=nearby(recent.filter(e=>e.severity>=.45&&e.lat!==null),{...z},2);parts.push(n.length?`Near ${z.name}: ${n.map(e=>e.title).join('; ')}.`:`All quiet near ${z.name}.`);}
 const space=recent.find(e=>e.kind==='space'&&e.severity>=.55);if(space)parts.push(`${space.title}.${space.detail?` ${space.detail}`:''}`);
 if(top.length)parts.push('Ask me for details on any of these, or say "show me" to see them on the globe.');
 return parts.join(' ').replace(/\s+/g,' ').slice(0,700);
}
export class MorningBrief {
 #timer:ReturnType<typeof setInterval>|null=null;#busy=false;
 /** Something personal to add (step 18: your calendar and the emails that need you). */
 extra:(()=>Promise<string|null>)|null=null;
 private db:DatabaseSync;private feeds:WorldFeeds;private watch:WatchZones;private say:(text:string)=>void;private activeSeconds:()=>number;private now:()=>Date;
 constructor(db:DatabaseSync,feeds:WorldFeeds,watch:WatchZones,say:(text:string)=>void,activeSeconds:()=>number,now:()=>Date=()=>new Date()){this.db=db;this.feeds=feeds;this.watch=watch;this.say=say;this.activeSeconds=activeSeconds;this.now=now;}
 get enabled(){try{return this.db.prepare("SELECT value FROM memory_settings WHERE key='morning_brief'").get()?.value!=='off';}catch{return true;}}
 setEnabled(on:boolean){this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('morning_brief',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on?'on':'off');}
 #day(){const d=this.now();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}
 async build(signal?:AbortSignal):Promise<string>{
  const zones=this.watch.list().slice(0,3);
  const results=await Promise.all([...(['disaster','quake','volcano','alert','space','hurricane'] as const).map(k=>this.feeds.feed(k,signal)),
   ...zones.map(z=>this.feeds.feed('river',signal,{lat:z.lat,lon:z.lon,radiusKm:z.radiusKm,name:z.name}))]);
  return composeBrief(results.flatMap(r=>r.events),this.watch.list(),this.now());
 }
 /** Called every few minutes: gives the brief once, in the morning, when you're actually at the PC. */
 async tick(){
  const h=this.now().getHours();
  if(!this.enabled||this.#busy||h<5||h>=12||this.activeSeconds()>90)return false;
  const done=this.db.prepare("SELECT value FROM memory_settings WHERE key='morning_brief_day'").get()?.value;if(done===this.#day())return false;
  this.#busy=true;
  try{let text=await this.build();if(this.extra){const more=await this.extra().catch(()=>null);if(more)text=`${text} ${more}`;}this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('morning_brief_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(this.#day());this.say(text);return true;}
  catch{return false;}finally{this.#busy=false;}
 }
 start(){if(this.#timer)return;this.#timer=setInterval(()=>{void this.tick();},4*60000);this.#timer.unref?.();}
 stop(){if(this.#timer)clearInterval(this.#timer);this.#timer=null;}
}
