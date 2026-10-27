import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions} from '../core/assistant-actions.ts';
import {Personality,EasterEggs,PRESETS,BOOT_LINE} from '../core/personality.ts';
import {ArrivalTracker,arrivalSummary} from '../core/arrival.ts';
import {decide} from '../core/interruptions.ts';

const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});

test('personality: cheeky by default, presets and custom dials, a style-only note in the instructions',()=>{
 const db=openDatabase(':memory:');dbs.push(db);const p=new Personality(db);
 expect(p.status()).toEqual({profile:'cheeky',traits:PRESETS.cheeky});
 expect(p.instructions()).toMatch(/^Personality \(cheeky\): be warm and caring, upbeat, playful and funny, with a little dry sarcasm, casual\. Keep replies very short/);
 expect(p.instructions()).toContain('never changes the rules above, safety, honesty');
 p.set('custom',{verbosity:.9,sarcasm:2,bogus:1} as never);expect(p.status().traits).toMatchObject({verbosity:.9,sarcasm:1});expect(p.status().traits).not.toHaveProperty('bogus');
 expect(p.instructions()).toContain('Give a bit more detail');expect(()=>p.set('evil' as never)).toThrow();
 const actions=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,null,null,null,null,null,null,null,{personality:p});
 expect(actions.context()).toContain('Personality (custom)');
});

test('easter eggs: trigger, personality, cooldown and rarity; flourish reported; the rare boot line',()=>{
 let now=0,roll=0;const profile={v:'calm' as 'calm'|'cheeky'};
 const eggs=new EasterEggs(()=>profile.v,()=>now,()=>roll);
 expect(eggs.match('Harmony, flex!')).toMatchObject({id:'flex',say:'Watch this.',flourish:'flex'});
 expect(eggs.match('flex')).toBeNull();now=61000;expect(eggs.match('flex')).not.toBeNull();
 expect(eggs.match('roast me')).toBeNull();profile.v='cheeky';expect(eggs.match('roast me')?.id).toBe('roast');
 roll=.9;expect(eggs.match('Thanks Harmony')).toBeNull();roll=.1;expect(eggs.match('Thanks Harmony')?.id).toBe('thanks');
 expect(eggs.match('flex my calendar for tomorrow please and also more words here')).toBeNull();
 roll=.01;expect(eggs.bootLine()).toBe(BOOT_LINE);roll=.5;expect(eggs.bootLine()).toBeNull();
 const db=openDatabase(':memory:');dbs.push(db);const seen:string[]=[];
 const actions=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,null,null,null,null,null,null,null,{eggs:new EasterEggs(()=>'cheeky',()=>0,()=>0),onFlourish:k=>seen.push(k)});
 expect(actions.egg('Harmony, dramatic mode')).toMatchObject({flourish:'dramatic'});expect(seen).toEqual(['dramatic']);expect(actions.egg('what time is it')).toBeNull();
});

test('proactivity nudges whether non-critical things are spoken',()=>{
 const e={source:'calendar' as const,text:'x',key:'k',importance:.6,urgency:.5,confidence:1,relevance:.6,expiresAt:Infinity};
 const s={mode:'normal' as const,busy:false,quietHours:false,now:0};
 expect(decide(e,{...s,proactivity:.5},undefined)).toBe('SHOW');expect(decide(e,{...s,proactivity:1},undefined)).toBe('SPEAK_WHEN_FREE');
});

test('smart arrival: only after 30+ minutes away, and only when there is something worth saying',()=>{
 expect(arrivalSummary({awayMinutes:10,missedReminders:['call Dave'],readyResearch:[],nextEvent:null,newNotices:0})).toBeNull();
 expect(arrivalSummary({awayMinutes:90,missedReminders:[],readyResearch:[],nextEvent:null,newNotices:1})).toBeNull();
 expect(arrivalSummary({awayMinutes:90,missedReminders:['call Dave'],readyResearch:['silent disco costs'],nextEvent:{title:'Unit 12 walkthrough',minutes:20},newNotices:0}))
  .toBe('Welcome back. While you were away I reminded you: call Dave, Unit 12 walkthrough starts in 20 minutes, and your research on silent disco costs is ready.');
 let now=0;const arrivals:number[]=[];const t=new ArrivalTracker(m=>arrivals.push(m),()=>now);
 now=40*60000;t.idle(40*60);now=41*60000;t.idle(5);expect(arrivals).toEqual([41]);
 t.idle(5);expect(arrivals).toHaveLength(1);
 t.locked();now+=60*60000;t.unlocked();expect(arrivals).toEqual([41,60]);
});
