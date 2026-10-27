import {expect,it} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {WorkLog,normalPlace,WorkInputError} from '../core/worklog.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions,workModelTool} from '../core/assistant-actions.ts';
import {ActionJournal} from '../core/action-journal.ts';

const setup=()=>{const db=openDatabase(':memory:'),clock={t:new Date(2026,9,22,8,0).getTime()},now=()=>new Date(clock.t);return {db,clock,now,w:new WorkLog(db,now)};};

it('places are normalised the way people say them',()=>{
 for(const p of ['unit 214','Apt. 214','#214','apartment 214','214'])expect(normalPlace(p)).toBe('214');
 expect(normalPlace('Unit 3b')).toBe('3B');expect(normalPlace('The Boiler Room')).toBe('boiler room');
});
it('a day of work: jobs, progress, parts ordered and arriving, done, receipts, and the end-of-day summary',()=>{
 const {w,clock}=setup();
 expect(w.add('unit 214','Leaking kitchen faucet').existing).toBe(false);
 w.add('boiler room','Check pressure relief valve');w.add('Apt 118','Bedroom door sticks');
 expect(w.add('214','leaking kitchen faucet').existing).toBe(true); // said twice: one job
 clock.t+=3600000;w.progress('214','Replaced the cartridge, still dripping at the base',40);
 w.ordered('214','Moen 1225 cartridge',2,'Ferguson');
 expect(w.find('214')?.status).toBe('waiting_parts');
 w.progress('boiler room','Pressure fine, valve tested',15);
 clock.t+=3600000;w.done('118','planed the door',30);
 const r=w.arrived('214','');expect(r.parts).toEqual(['Moen 1225 cartridge']);expect(r.job.status).toBe('in_progress');
 const v=w.view(w.find('214')!.id)!;expect(v.minutes).toBe(40);expect(v.partsWaiting).toEqual([]);
 expect(()=>w.progress('999','x',null)).toThrow(WorkInputError);
 w.attach(v.id,'ferguson-receipt.jpg','image/jpeg',new Uint8Array([0xff,0xd8,0xff,1,2,3]));
 expect(()=>w.attach(v.id,'x.exe','application/x-msdownload',new Uint8Array([1]))).toThrow(/photos/);
 expect(w.view(v.id)!.files).toMatchObject([{name:'ferguson-receipt.jpg',mime:'image/jpeg',bytes:6}]);
 expect(w.file(w.view(v.id)!.files[0].id)!.bytes.length).toBe(6);
 const s=w.summary();
 expect(s).toMatch(/^Done today \(1\): unit 118: Bedroom door sticks\./);
 expect(s).toMatch(/Moved forward: .*unit 214: Leaking kitchen faucet.*boiler room: Check pressure relief valve/);
 expect(s).toMatch(/2 jobs still open, 3 new today\. Time logged: 1 h 25 min\./);
 w.ordered('boiler room','relief valve',1,null);
 expect(w.listText(true)).toBe('1 waiting on parts: boiler room, Check pressure relief valve (waiting on parts).');
 expect(w.snapshot().jobs.map(j=>j.place).sort()).toEqual(['118','214','boiler room']); // done today still shows
});
it('every change can be undone exactly',()=>{
 const {w}=setup();w.add('214','Faucet');const add=w.lastRef;
 w.progress('214','swapped cartridge',20);const prog=w.lastRef;w.ordered('214','washer',1,null);const ord=w.lastRef;
 expect(w.revert(ord)).toBe(true);expect(w.find('214')!.status).toBe('in_progress');expect(w.view(w.find('214')!.id)!.partsWaiting).toEqual([]);
 expect(w.revert(prog)).toBe(true);expect(w.find('214')!.status).toBe('open');expect(w.view(w.find('214')!.id)!.events).toEqual([]);
 expect(w.revert(add)).toBe(true);expect(w.find('214')).toBeNull();
});
it('by voice: journaled, private, and the shortcuts work',async()=>{
 const {db,now}=setup(),w=new WorkLog(db,now);
 const actions=new AssistantActions(new ReminderStore(db,now),db,()=>{},now,null,null,null,null,null,null,null,{work:w});
 expect(actions.tools.map(t=>t.name)).toContain(workModelTool.name);
 const say=(a:Record<string,string>)=>actions.run([{name:'work_log',arguments:{action:'',place:'',text:'',minutes:'',qty:'',vendor:'',...a}}],new AbortController().signal);
 expect((await say({action:'new',place:'unit 214',text:'leaking kitchen faucet'})).spoken).toBe('Got it. New job at unit 214: leaking kitchen faucet.');
 expect((await say({action:'update',place:'214',text:'replaced cartridge',minutes:'40 minutes'})).spoken).toBe('Logged on unit 214, 40 minutes.');
 expect((await say({action:'ordered',place:'214',text:'Moen 1225',qty:'2',vendor:'Ferguson'})).spoken).toBe('Noted: unit 214 is waiting on Moen 1225.');
 expect((await say({action:'arrived',place:'214'})).spoken).toBe('Moen 1225 arrived for unit 214.');
 expect((await say({action:'done',place:'214'})).spoken).toBe('Nice. unit 214 is done.');
 expect((await say({action:'update',place:'555',text:'x'})).spoken).toMatch(/don't have a job at unit 555/);
 expect(new ActionJournal(db).recent().map(r=>r.tool_id)).toEqual(expect.arrayContaining(['work.add','work.update','work.order','work.arrive','work.done']));
 for(const [phrase,action] of [['end of day summary','summary'],["what's open",'list'],['what did I get done today','summary'],["what's waiting on parts",'waiting']] as const)
  expect(actions.shortcut(phrase)).toContain(`<parameter=action>\n${action}\n</parameter>`);
 expect((await say({action:'summary'})).lookup?.report).toMatch(/Done today \(1\): unit 214/);
});
