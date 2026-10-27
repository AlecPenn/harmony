import type {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {WorldFeeds,nearby,type FeedKind,type WorldEvent} from './world-feeds.ts';

/** Watch zones: "Harmony, watch Madison" — HARMONY checks the world feeds for that area every 10 minutes and tells you
 * (through the interruption engine, so quiet hours and focus are respected) when something new and notable happens:
 * earthquakes, severe weather alerts, disasters, volcano alerts, natural events. Up to 5 zones; nothing leaves the PC
 * except the public feed requests themselves. */
export interface WatchZone {id:string;name:string;lat:number;lon:number;radiusKm:number;createdAt:string;}
export const WATCH_KINDS:FeedKind[]=['quake','alert','disaster','volcano','natural','hurricane'];
/** Checked around each watched place (these feeds need a place). */
export const NEAR_KINDS:FeedKind[]=['river','wildfire'];
const MAX_ZONES=5,MAX_SEEN=800,MIN_SEVERITY=.45;
export interface WatchNotice {key:string;text:string;severity:number;event:WorldEvent;zone:WatchZone;}

export class WatchZones {
 #timer:ReturnType<typeof setInterval>|null=null;#running=false;
 private db:DatabaseSync;private feeds:WorldFeeds;private notify:(n:WatchNotice)=>void;private now:()=>number;private changed:()=>void;
 constructor(db:DatabaseSync,feeds:WorldFeeds,notify:(n:WatchNotice)=>void,options:{now?:()=>number;changed?:()=>void}={}){this.db=db;this.feeds=feeds;this.notify=notify;this.now=options.now??Date.now;this.changed=options.changed??(()=>{});}
 #get<T>(key:string,fallback:T):T{try{const r=this.db.prepare('SELECT value FROM memory_settings WHERE key=?').get(key);return r?JSON.parse(String(r.value)) as T:fallback;}catch{return fallback;}}
 #put(key:string,value:unknown){this.db.prepare('INSERT INTO memory_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 list():WatchZone[]{const v=this.#get<WatchZone[]>('watch_zones',[]);return Array.isArray(v)?v.slice(0,MAX_ZONES):[];}
 add(name:string,lat:number,lon:number,radiusKm=150):WatchZone{
  const list=this.list(),clean=name.replace(/[^\p{L}\p{N} ,.'-]+/gu,'').trim().slice(0,60)||'That place';
  const existing=list.find(z=>z.name.toLowerCase()===clean.toLowerCase());if(existing)return existing;
  const zone:WatchZone={id:randomBytes(6).toString('hex'),name:clean,lat,lon,radiusKm:Math.min(1000,Math.max(10,Math.round(radiusKm))),createdAt:new Date(this.now()).toISOString()};
  if(list.length>=MAX_ZONES)list.shift();list.push(zone);this.#put('watch_zones',list);
  // Whatever is already happening there counts as seen: only new events alert.
  void this.check(true).catch(()=>{});
  this.changed();return zone;
 }
 remove(idOrName:string):boolean{
  const list=this.list(),q=idOrName.toLowerCase().trim(),next=list.filter(z=>z.id!==idOrName&&z.name.toLowerCase()!==q&&!(q.length>=3&&z.name.toLowerCase().startsWith(q)));
  if(next.length===list.length)return false;this.#put('watch_zones',next);this.changed();return true;
 }
 /** One pass. With `prime`, current events are only marked as seen (no alerts). Returns the notices raised. */
 async check(prime=false,signal?:AbortSignal):Promise<WatchNotice[]>{
  const zones=this.list();if(!zones.length||this.#running)return [];
  this.#running=true;
  try{
   const results=await Promise.all([...WATCH_KINDS.map(k=>this.feeds.feed(k,signal)),
    ...zones.flatMap(z=>NEAR_KINDS.map(k=>this.feeds.feed(k,signal,{lat:z.lat,lon:z.lon,radiusKm:z.radiusKm,name:z.name})))]);
   const all=results.flatMap(r=>r.events);
   const seen=new Set(this.#get<string[]>('watch_seen',[])),out:WatchNotice[]=[];
   const fresh=this.now()-6*3600000;
   for(const zone of zones)for(const e of nearby(all,{lat:zone.lat,lon:zone.lon,radiusKm:zone.radiusKm,name:zone.name},20)){
    const key=`${zone.id}:${e.id}`;if(seen.has(key))continue;seen.add(key);
    if(prime||e.severity<MIN_SEVERITY||(e.at&&Date.parse(e.at)<fresh))continue;
    const n:WatchNotice={key,text:`Near ${zone.name}: ${e.title}${e.detail?`. ${e.detail}`:''} (${e.source}).`.replace(/\s+/g,' ').slice(0,300),severity:e.severity,event:e,zone};
    out.push(n);try{this.notify(n);}catch{}
   }
   this.#put('watch_seen',[...seen].slice(-MAX_SEEN));
   return out;
  }finally{this.#running=false;}
 }
 start(everyMs=10*60000){if(this.#timer)return;this.#timer=setInterval(()=>{void this.check().catch(()=>{});},everyMs);this.#timer.unref?.();setTimeout(()=>{void this.check().catch(()=>{});},60000).unref?.();}
 stop(){if(this.#timer)clearInterval(this.#timer);this.#timer=null;}
}
