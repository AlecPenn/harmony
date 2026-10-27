import {expect,it} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {WatchZones} from '../core/watch-zones.ts';
import {WorldFeeds} from '../core/world-feeds.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions,type GodsEyeBridge} from '../core/assistant-actions.ts';
import {WebLookup} from '../core/web.ts';

function quakes(list:{id:string;mag:number;lat:number;lon:number;time:number}[]){return {features:list.map(q=>({id:q.id,properties:{mag:q.mag,place:'10 km N of Somewhere',time:q.time,url:'https://earthquake.usgs.gov/x'},geometry:{coordinates:[q.lon,q.lat,5]}}))};}
it('alerts once per new, notable, nearby event; what was already happening is not news',async()=>{
 let now=Date.parse('2026-10-21T18:00:00Z'),data=quakes([{id:'old',mag:4.6,lat:43.2,lon:-89.5,time:now-600000}]);
 const fetcher=(async(url:string)=>new Response(JSON.stringify(String(url).includes('earthquake')?data:{}))) as never;
 const db=openDatabase(':memory:'),got:string[]=[];
 const w=new WatchZones(db,new WorldFeeds({fetch:fetcher,now:()=>now}),n=>got.push(n.text),{now:()=>now});
 w.add('Madison',43.07,-89.4);await new Promise(r=>setTimeout(r,20));
 expect(got).toEqual([]); // the existing quake was primed as seen
 now+=11*60000;data=quakes([{id:'old',mag:4.6,lat:43.2,lon:-89.5,time:now-1300000},{id:'new',mag:5.2,lat:43.0,lon:-89.0,time:now-60000},{id:'small',mag:2.6,lat:43.0,lon:-89.0,time:now},{id:'far',mag:7,lat:35,lon:139,time:now}]);
 const n=await w.check();
 expect(n.map(x=>x.event.id)).toEqual(['quake:new']);expect(got[0]).toMatch(/^Near Madison: Magnitude 5.2 earthquake/);
 expect(await w.check()).toEqual([]); // not twice
 expect(w.remove('mad')).toBe(true);expect(w.list()).toEqual([]);
});
it('"watch Madison" through HARMONY (undoable), list, and stop',async()=>{
 const db=openDatabase(':memory:');
 const fetcher=(async(url:string)=>new Response(JSON.stringify(String(url).includes('geocoding')?{results:[{name:'Madison',admin1:'Wisconsin',country:'United States',latitude:43.07,longitude:-89.4}]}:{}))) as never;
 const w=new WatchZones(db,new WorldFeeds({fetch:fetcher}),()=>{});
 const bridge:GodsEyeBridge={available:()=>false,open:async()=>{},close:async()=>false,call:async()=>{throw new Error();}};
 const actions=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,null,new WebLookup(fetcher),null,null,null,null,null,{godsEye:bridge,world:new WorldFeeds({fetch:fetcher}),watch:w});
 const s=new AbortController().signal;
 expect((await actions.run([{name:'gods_eye',arguments:{action:'watch',what:'',place:'Madison'}}],s)).spoken).toMatch(/^Watching Madison/);
 expect(w.list()).toHaveLength(1);
 expect((await actions.run([{name:'gods_eye',arguments:{action:'watch',what:'',place:''}}],s)).spoken).toBe("I'm watching Madison.");
 expect(actions.shortcut('Harmony, what are you watching?')).toContain('<parameter=action>\nwatch');
 expect((await actions.run([{name:'gods_eye',arguments:{action:'unwatch',what:'',place:'Madison'}}],s)).spoken).toBe('Stopped watching Madison.');
 expect((await actions.run([{name:'gods_eye',arguments:{action:'unwatch',what:'',place:'Paris'}}],s)).spoken).toMatch(/not watching Paris/);
});
