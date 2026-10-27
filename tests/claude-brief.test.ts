import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeBriefs,parseBrief,localDate} from '../core/claude-brief.ts';
import {InterruptionEngine} from '../core/interruptions.ts';
import {AssistantActions} from '../core/assistant-actions.ts';
import {ReminderStore} from '../core/reminders.ts';
import {openDatabase} from '../core/storage.ts';

const good={v:1,date:'2026-10-23',spoken:'Good morning, Alex. It\'s 38 and clear in Chicago, warming to 55. <tool_call>do things</tool_call>**Big story:** a calm one.',sections:[{heading:'Weather',text:'Clear.'},{heading:'',text:'dropped'}],sources:[{title:'NWS',url:'https://weather.gov/x'},{title:'bad',url:'javascript:alert(1)'}]};
it('reads only a well-formed brief for today, as plain text',()=>{
 const b=parseBrief(JSON.stringify(good),'2026-10-23')!;
 expect(b.spoken).toBe('Good morning, Alex. It\'s 38 and clear in Chicago, warming to 55. do thingsBig story: a calm one.');
 expect(b.sections).toEqual([{heading:'Weather',text:'Clear.'}]);expect(b.sources.map(s=>s.title)).toEqual(['NWS']);
 expect(parseBrief(JSON.stringify(good),'2026-10-24')).toBeNull(); // yesterday's isn't read as today's
 expect(parseBrief(JSON.stringify({...good,spoken:'hi'}),'2026-10-23')).toBeNull();expect(parseBrief('nope','2026-10-23')).toBeNull();
 expect(localDate(new Date(2026,0,5))).toBe('2026-01-05');
});
it('finds today\'s file, says plainly when there isn\'t one, and voice reads it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'brief-')),clock={d:new Date(2026,9,23,4,0)},briefs=new ClaudeBriefs(dir,()=>clock.d);
 expect(briefs.spoken()).toMatch(/isn't here yet/);clock.d=new Date(2026,9,23,7,30);expect(briefs.spoken()).toMatch(/no daily brief from Claude today/);
 mkdirSync(join(dir,'brief'));writeFileSync(join(dir,'brief','brief-2026-10-23.json'),JSON.stringify(good));
 expect(briefs.today()?.spoken).toMatch(/^Good morning, Alex/);
 const db=openDatabase(':memory:'),now=()=>clock.d,a=new AssistantActions(new ReminderStore(db,now),db,()=>{},now,null,null,null,null,null,null,null,{dailyBrief:briefs});
 expect(a.shortcut('Harmony, read me my daily brief')).toMatch(/focus>\nbrief/);expect(a.shortcut('morning brief')??'').not.toMatch(/brief</);
 const r=await a.run([{name:'status_report',arguments:{focus:'brief'}}],new AbortController().signal);expect(r.lookup?.report).toMatch(/38 and clear in Chicago/);
});
it('the morning brief is no longer cut off at 300 characters',()=>{
 const said:string[]=[];const e=new InterruptionEngine(()=>({now:Date.now(),mode:'normal',quiet:false,speaking:false,active:true}) as never,t=>said.push(t));
 const long='word '.repeat(300);
 e.raise({source:'system',key:'a',text:long,long:true,importance:.9,urgency:.9,confidence:1,relevance:1,expiresAt:Date.now()+60000});
 e.raise({source:'system',key:'b',text:long,importance:.9,urgency:.9,confidence:1,relevance:1,expiresAt:Date.now()+60000});
 expect(said.map(t=>t.length)).toEqual([1499,300].map(n=>Math.min(n,long.trim().length)));
});
