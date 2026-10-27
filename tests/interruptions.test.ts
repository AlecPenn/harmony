import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {decide,inQuietHours,InterruptionEngine,CalendarWatcher,REPEAT_MS,type ProactiveEvent,type Situation} from '../core/interruptions.ts';
import {ScreenWatcher} from '../core/observation.ts';
import {Desktop,type DesktopTransport} from '../core/desktop.ts';

const now=Date.UTC(2026,9,21,15,0);
const S=(over:Partial<Situation>={}):Situation=>({mode:'normal',busy:false,quietHours:false,now,...over});
const E=(over:Partial<ProactiveEvent>={}):ProactiveEvent=>({source:'calendar',text:'Heads up',key:'k',importance:.7,urgency:.9,confidence:1,relevance:.8,expiresAt:now+60000,...over});

test('decisions follow importance, urgency, mode, quiet hours, repeats, confidence and expiry',()=>{
 expect(decide(E(),S(),undefined)).toBe('SPEAK_WHEN_FREE');
 expect(decide(E({importance:1,urgency:1}),S(),undefined)).toBe('INTERRUPT');
 expect(decide(E({importance:1,urgency:1}),S({busy:true}),undefined)).toBe('SPEAK_WHEN_FREE');
 expect(decide(E(),S({mode:'focus'}),undefined)).toBe('SHOW');expect(decide(E({importance:1,urgency:1}),S({mode:'focus'}),undefined)).toBe('SPEAK_WHEN_FREE');
 expect(decide(E({importance:1,urgency:1}),S({mode:'ghost'}),undefined)).toBe('SHOW');
 expect(decide(E(),S({quietHours:true}),undefined)).toBe('SHOW');
 expect(decide(E({importance:.1,urgency:.1,relevance:.1}),S(),undefined)).toBe('STORE');
 expect(decide(E({confidence:.3}),S(),undefined)).toBe('STORE');
 expect(decide(E(),S(),now-60000)).toBe('STORE');expect(decide(E(),S(),now-REPEAT_MS-1)).toBe('SPEAK_WHEN_FREE');
 expect(decide(E({expiresAt:now}),S(),undefined)).toBe('IGNORE');
 // Reminders and timers you set are always said, in any mode, even at night.
 for(const mode of ['normal','focus','ghost'] as const)expect(decide(E({source:'timer'}),S({mode,quietHours:true}),undefined)).toBe('CRITICAL');
 expect(inQuietHours(new Date(2026,9,21,23,0))).toBe(true);expect(inQuietHours(new Date(2026,9,21,6,59))).toBe(true);expect(inQuietHours(new Date(2026,9,21,7,0))).toBe(false);
});

test('the engine speaks, shows or keeps, never repeats itself, and the tray can be dismissed',()=>{
 const spoken:string[]=[];let situation=S();
 const engine=new InterruptionEngine(()=>situation,t=>spoken.push(t));
 expect(engine.raise(E({text:'Standup in 10 minutes.'}))).toBe('SPEAK_WHEN_FREE');
 expect(engine.raise(E({text:'Standup in 10 minutes.'}))).toBe('STORE');
 expect(spoken).toEqual(['Standup in 10 minutes.']);
 situation=S({mode:'ghost'});expect(engine.raise(E({key:'b',text:'Lunch with Riley soon.'}))).toBe('SHOW');expect(spoken).toHaveLength(1);
 const shown=engine.notices();expect(shown.map(n=>n.text)).toEqual(['Lunch with Riley soon.','Standup in 10 minutes.']);
 expect(engine.dismiss(shown[0].id)).toBe(true);expect(engine.notices()).toHaveLength(1);
});

test('calendar heads-up about ten minutes before, once per event, skipping all-day events',async()=>{
 const spoken:string[]=[];const clock=()=>new Date(2026,9,21,9,50);
 const engine=new InterruptionEngine(()=>S({now:clock().getTime()}),t=>spoken.push(t));
 let connected=true;
 const w=new CalendarWatcher(async()=>[{id:'a',start:new Date(2026,9,21,10,0),allDay:false,title:'Unit 12 walkthrough',where:'Building C'},{id:'b',start:new Date(2026,9,21,0,0),allDay:true,title:'Payday',where:''}],()=>connected,engine,clock);
 expect(await w.check()).toBe(1);expect(await w.check()).toBe(0);
 expect(spoken).toEqual(['Heads up: Unit 12 walkthrough at Building C starts in 10 minutes.']);
 connected=false;expect(await w.check()).toBe(0);
});

const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
test('watching shows a notice only for errors that are new in that window, and only when chosen',async()=>{
 const db=openDatabase(':memory:');dbs.push(db);
 let text='Build output\nCompiled successfully';const looks:number[]=[];
 const t:DesktopTransport={async request(m){if(m.type==='look'){looks.push(1);return {found:true,app:'Visual Studio Code',title:'main.ts - HARMONY',text,ocr:true,ms:300};}return {};},async stop(){}};
 const desktop=new Desktop(t,db,()=>{},1);
 const engine=new InterruptionEngine(()=>S({now:Date.now()}),()=>{});const w=new ScreenWatcher(desktop,engine);
 expect(await w.check()).toEqual([]);expect(looks).toHaveLength(0);
 desktop.set({screen:'watch'});
 text='Build output\nError: Cannot find module ./old-file';expect(await w.check()).toEqual([]);
 expect(await w.check()).toEqual([]);
 text+='\nTypeError: x is not a function';expect(await w.check()).toEqual(['TypeError: x is not a function']);
 expect(engine.notices()[0]).toMatchObject({source:'screen',decision:'SHOW',text:'New on screen in Visual Studio Code: TypeError: x is not a function'});
 const paused=new ScreenWatcher(desktop,engine,()=>true);expect(await paused.check()).toEqual([]);
});
