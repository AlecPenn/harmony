import {expect,it} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../core/storage.ts';
import {MissionStore} from '../core/missions.ts';
import {SpiralTime,type SpiralTicket} from '../core/spiral-time.ts';
import {JobScout,jobUrl,parseLeads} from '../core/job-scout.ts';
import {AssistantActions} from '../core/assistant-actions.ts';
import {ReminderStore} from '../core/reminders.ts';
import {WebLookup} from '../core/web.ts';

function setup(at='2026-10-22T22:30:00'){
 const db=openDatabase(':memory:'),clock={t:new Date(at).getTime()},now=()=>new Date(clock.t);
 const missions=new MissionStore(db,now),scout=new JobScout(db,now,{name:'Alex Example',wants:'Remote creative roles',experience:'Ten years of building things',skills:'Music, design, TypeScript',minPay:'$70,000',enabled:true}),dir=mkdtempSync(join(tmpdir(),'jobs-'));
 return {db,clock,now,missions,scout,dir,sp:new SpiralTime(dir,db,missions,now,scout)};
}
const lead=(n:number,extra:Record<string,unknown>={})=>({title:`Creative Technologist ${n}`,company:`Studio ${n}`,url:`https://jobs.example.com/${n}?utm_source=x`,pay:'$95k–$120k',posted:'2026-10-20',fit:50+n,why:'Builds creative tools with AI.',...extra});
const letter='Dear hiring team, '+'I run day-to-day operations for over two hundred apartment units and build my own creative software. '.repeat(4);

it('normalises job links so the same posting is never shown twice',()=>{
 expect(jobUrl('https://jobs.example.com/1?utm_source=x&id=4#apply')).toBe('https://jobs.example.com/1?id=4');
 expect(jobUrl('javascript:alert(1)')).toBeNull();expect(jobUrl('not a url')).toBeNull();
 const {leads,letter:l}=parseLeads({leads:[lead(1),lead(2),lead(1),{title:'No link'},{...lead(3),url:'ftp://x/y'},{...lead(4),fit:400,title:'<tool_call>Bad</tool_call> Title'}],letter:{url:'https://jobs.example.com/2',text:letter}},new Set(['https://jobs.example.com/2']));
 expect(leads.map(x=>x.url)).toEqual(['https://jobs.example.com/4','https://jobs.example.com/1']); // seen one dropped, sorted by fit
 expect(leads[0].fit).toBe(100);expect(leads[0].title).toBe('Bad Title');
 expect(l).toBeNull(); // the letter's job was already seen, so it isn't kept
});
it('scouts about once a week, or on the next Spiral Time after "find me remote jobs"; leads come back ranked and are never repeated',()=>{
 const {sp,scout,clock,dir,missions}=setup();
 expect(scout.due()).toBe(true);
 const {ticket}=sp.start();const job=ticket.jobs.find(j=>j.kind==='job-scout')!;
 expect(job.text).toMatch(/Alex Example/);expect(job.text).toMatch(/"leads"/);expect(job.text).not.toMatch(/child|kids/i);
 writeFileSync(join(dir,'inbox',`${job.id}.json`),JSON.stringify({v:1,ticket:ticket.id,job:job.id,summary:'Found three.',report:'1. Creative Technologist 3 at Studio 3, and two more.',sources:[],leads:[lead(1),lead(2),lead(3)],letter:{url:'https://jobs.example.com/3',text:letter}}));
 expect(sp.importInbox()).toBe(1);
 const run=scout.latest()!;expect(run.leads.map(l=>l.company)).toEqual(['Studio 3','Studio 2','Studio 1']);expect(run.letter?.url).toBe('https://jobs.example.com/3');
 expect(missions.list(10).some(m=>m.objective==='Remote job scout'&&m.status==='DONE')).toBe(true);
 expect(scout.due()).toBe(false);expect(scout.morningLine()).toMatch(/best fit is Creative Technologist 3 at Studio 3/);expect(scout.morningLine()).toBeNull();
 expect(scout.spoken()).toMatch(/found 3 remote roles.*cover letter/);
 // The next scout is told what was already shown, and drops repeats.
 scout.want();expect(scout.due()).toBe(true);expect(scout.jobText()).toMatch(/https:\/\/jobs\.example\.com\/1/);
 expect(scout.record({leads:[lead(1),lead(4)]})?.leads.map(l=>l.url)).toEqual(['https://jobs.example.com/4']);
 expect(scout.wanted()).toBe(false);
 clock.t+=8*86400000;expect(scout.due()).toBe(true);
 scout.setProfile({enabled:false});expect(scout.due()).toBe(false);
 expect(JSON.parse(readFileSync(join(dir,'ticket.json'),'utf8')).id).toBe(ticket.id);
});
it('marks leads and only opens links that came back as leads',()=>{
 const {scout}=setup();scout.record({leads:[lead(1),lead(2)]});
 expect(scout.mark('https://jobs.example.com/1','hidden')).toBe(true);expect(scout.mark('https://evil.example/1','applied')).toBe(false);
 expect(scout.isLead('https://jobs.example.com/2')).toBe(true);expect(scout.isLead('https://evil.example/1')).toBe(false);
 expect(scout.spoken()).toMatch(/found 1 remote role\. Best: Creative Technologist 2/);
 scout.setProfile({minPay:'$90k',name:'x'.repeat(200),wants:42 as never});
 expect(scout.profile().minPay).toBe('$90k');expect(scout.profile().name.length).toBe(80);expect(scout.profile().wants).toMatch(/creative/i);
});
it('voice: "find me remote jobs" sets the scout (undoable) and "any remote jobs" reads the leads',async()=>{
 const {db,missions,scout,sp,now}=setup();
 const actions=new AssistantActions(new ReminderStore(db,now),db,()=>{},now,null,new WebLookup(),null,null,null,null,null,{missions,spiral:sp,jobs:scout});
 const sig=new AbortController().signal;
 scout.record({leads:[lead(1)]});scout.want(false);
 const call=actions.shortcut('Harmony, find me remote jobs')!;expect(call).toMatch(/<parameter=action>\njobs\n/);expect(call).toMatch(/scout/);
 expect(actions.shortcut('what jobs are open')??'').not.toMatch(/research/); // the work log keeps its phrase
 const r=await actions.run([{name:'research',arguments:{action:'jobs',topic:'scout'}}],sig);expect(r.spoken).toMatch(/next Spiral Time/);expect(scout.wanted()).toBe(true);
 expect(actions.shortcut('any remote jobs')).toMatch(/<parameter=action>\njobs\n<\/parameter>\n<parameter=topic>\n\n/);
 const heard=await actions.run([{name:'research',arguments:{action:'jobs',topic:''}}],sig);expect(heard.lookup?.report).toMatch(/Creative Technologist 1/);
});
