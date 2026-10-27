import {expect,it} from 'vitest';
import {Connectivity,connectivityText} from '../core/connectivity.ts';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {MissionStore,MissionRunner} from '../core/missions.ts';
import {AssistantActions} from '../core/assistant-actions.ts';
import {WebLookup} from '../core/web.ts';

it('needs two failed checks to call it offline, one good one to call it back, and says each change once',async()=>{
 let up=true;const clock={t:0},changes:[boolean,number][]=[];
 const c=new Connectivity(async()=>up,(on,down)=>changes.push([on,down]),()=>clock.t);
 await c.check();expect(c.online).toBe(true);
 up=false;clock.t=1000;await c.check();expect(c.online).toBe(true); // one hiccup isn't an outage
 up=true;await c.check();up=false;await c.check();expect(c.online).toBe(true); // the count resets after a good check
 clock.t=60000;await c.check();expect(c.online).toBe(false);await c.check();expect(changes).toEqual([[false,0]]);
 up=true;clock.t=60000+25*60000;await c.check();expect(c.online).toBe(true);expect(changes[1]).toEqual([true,25*60000]);
 const thrower=new Connectivity(async()=>{throw new Error('dns');},()=>{});await thrower.check();await thrower.check();expect(thrower.online).toBe(false);
});
it('says it plainly',()=>{
 expect(connectivityText(false,0,0)).toMatch(/^The internet just went down\. I'll keep going on this PC/);
 expect(connectivityText(true,25*60000,2)).toBe("The internet is back after 25 minutes. I'm looking up the 2 things you asked while it was down, and I'll tell you when they're ready.");
 expect(connectivityText(true,30000,0)).toBe('The internet is back.');
});
it('offline: web questions are saved for later, other internet things say so, and research waits instead of failing',async()=>{
 const db=openDatabase(':memory:'),now=()=>new Date(2026,9,22,12,0);let online=false,failed=0;
 const missions=new MissionStore(db,now);
 const a=new AssistantActions(new ReminderStore(db,now),db,()=>{},now,null,new WebLookup(),null,null,null,null,null,{missions,offline:{online:()=>online,failed:()=>{failed++;}}});
 const r=await a.run([{name:'web_search',arguments:{query:'best snow tires for a Civic'}}],new AbortController().signal);
 expect(r.spoken).toMatch(/saved that and I'll look it up as soon as it's back/);
 expect(missions.open().map(m=>m.objective)).toEqual(['Look up: best snow tires for a Civic']);
 expect((await a.run([{name:'get_weather',arguments:{place:'Madison'}}],new AbortController().signal)).spoken).toBe("The internet's down, so I can't check the weather right now. Everything on this PC still works.");
 // Local things are untouched.
 expect((await a.run([{name:'set_timer',arguments:{minutes:'5',label:'tea'}}],new AbortController().signal)).spoken).not.toMatch(/internet/i);
 const runner=new MissionRunner(missions,{lookup:async()=>{throw new Error('should not run');},think:async()=>'',idle:()=>true,online:()=>online,announce:()=>{},changed:()=>{}},now);
 expect(await runner.tick()).toBe('offline');expect(missions.open()[0].status).toBe('QUEUED');
 online=true;expect(await runner.tick()).not.toBe('offline');
 expect(failed).toBe(0);
});
