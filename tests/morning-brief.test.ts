import {expect,it} from 'vitest';
import {composeBrief,MorningBrief} from '../core/morning-brief.ts';
import {openDatabase} from '../core/storage.ts';
import {WorldFeeds,type WorldEvent} from '../core/world-feeds.ts';
import {WatchZones} from '../core/watch-zones.ts';
const ev=(p:Partial<WorldEvent>):WorldEvent=>({id:Math.random().toString(),kind:'disaster',title:'x',detail:'',lat:0,lon:0,at:'2026-10-21T08:00:00Z',severity:.8,source:'GDACS',url:null,...p});
it('says the biggest overnight events, nearby news, notable space weather, and stays calm',()=>{
 const now=new Date('2026-10-21T13:00:00Z');
 const t=composeBrief([ev({title:'Red earthquake alert in Japan',severity:1,lat:38,lon:142}),ev({title:'Red earthquake alert in Japan (update)',severity:1,lat:38,lon:142}),ev({title:'Orange flood alert in Bangladesh',severity:.7}),
  ev({title:'Tornado Warning: Dane, WI',kind:'alert',lat:43.1,lon:-89.4,severity:1}),ev({kind:'space',title:'Geomagnetic activity Kp 6.0 (G2 storm)',detail:'Auroras may reach farther south.',severity:.67,lat:null,lon:null}),ev({title:'Old thing',at:'2026-10-19T00:00:00Z'})],
  [{name:'Madison',lat:43.07,lon:-89.4,radiusKm:150},{name:'Chicago',lat:41.88,lon:-87.63,radiusKm:50}],now);
 expect(t).toMatch(/^Good morning\. Overnight: Red earthquake alert in Japan; Tornado Warning: Dane, WI; Orange flood alert in Bangladesh\./);
 expect(t).not.toMatch(/update|Old thing/);expect(t).toMatch(/Near Madison: Tornado Warning/);expect(t).toMatch(/All quiet near Chicago/);expect(t).toMatch(/G2 storm/);
 expect(composeBrief([],[],now)).toMatch(/quiet around the world/);
});
it('once a day, in the morning, only when you are at the PC; can be turned off',async()=>{
 const db=openDatabase(':memory:');let hour=8,idle=10;const said:string[]=[];
 const feeds=new WorldFeeds({fetch:(async()=>new Response('{}')) as never});
 const b=new MorningBrief(db,feeds,new WatchZones(db,feeds,()=>{}),t=>said.push(t),()=>idle,()=>new Date(2026,9,21,hour,0));
 idle=600;expect(await b.tick()).toBe(false);idle=10;
 hour=13;expect(await b.tick()).toBe(false);hour=8;
 expect(await b.tick()).toBe(true);expect(await b.tick()).toBe(false);expect(said).toHaveLength(1);
 b.setEnabled(false);expect(b.enabled).toBe(false);
});
