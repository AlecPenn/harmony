import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {ProjectStore} from '../core/projects.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {AssistantActions,researchModelTool,missionTools} from '../core/assistant-actions.ts';
import {MissionStore,MissionRunner,parseQueries,verifyCitations,type MissionDeps} from '../core/missions.ts';
import {WebLookup,type WebResult} from '../core/web.ts';

const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function setup(){
 const db=openDatabase(':memory:');dbs.push(db);let now=new Date(2026,9,21,10,0);const clock=()=>new Date(now);
 const store=new MissionStore(db,clock),projects=new ProjectStore(db,clock);projects.seed();
 return {db,store,projects,clock,advance:(m:number)=>{now=new Date(now.getTime()+m*60000);}};
}
const search=(q:string):WebResult=>({kind:'search',query:q,retrievedAt:'',text:`Web results for "${q}":\n[1] Wikipedia, "Shared listening": Silent discos use wireless headphones.\n[2] How to host a silent disco (partyplanner.com): Rent 20 headsets for about $150.`,
 sources:[{title:'Shared listening',url:'https://en.wikipedia.org/wiki/Silent_disco',site:'wikipedia.org'},{title:'How to host a silent disco',url:'https://partyplanner.com/silent-disco',site:'partyplanner.com'}]});
function deps(over:Partial<MissionDeps>={}){
 const log:string[]=[];let idle=true;
 const d:MissionDeps&{log:string[];setIdle:(v:boolean)=>void}={log,setIdle:v=>{idle=v;},
  lookup:async(id,value)=>{log.push(`${id} ${value}`);return id==='web.search'?search(value):{kind:'search',query:value,retrievedAt:'',text:'Full page: a silent disco kit rents for $150 to $300 a night, transmitters included.',sources:[]};},
  think:async(prompt)=>{log.push(`think ${prompt.slice(0,30)}`);return prompt.startsWith('Break')?'1. silent disco headphone rental cost\n2. "outdoor sunset listening party"\nsilent disco headphone rental cost':
   'Renting about 20 wireless headsets costs roughly $150 to $300 a night [2]. Silent discos are the usual format [1]. A made-up claim [7].\nNext step: get two rental quotes.';},
  idle:()=>idle,announce:t=>log.push(`announce ${t}`),changed:()=>{},...over};
 return d;
}

test('the planner reads a few clean queries, and verification removes citations to sources that do not exist',()=>{
 expect(parseQueries('Sure! Here are some:\n1. silent disco cost\n- "outdoor listening party"\n* silent disco cost\n<b>x</b>','goal')).toEqual(['silent disco cost','outdoor listening party']);
 expect(parseQueries('','Find the best headphones')).toEqual(['Find the best headphones']);
 const v=verifyCitations('Cheap [2]. Fake [9]. Also [1].',[{n:1,title:'a',url:'u1',site:'s',excerpt:'',query:''},{n:2,title:'b',url:'u2',site:'s',excerpt:'',query:''}]);
 expect(v.text).toBe('Cheap [2]. Fake. Also [1].');expect(v.cited).toEqual([1,2]);expect(v.problems[0]).toMatch(/\[9\]/);
 expect(verifyCitations('No sources at all.',[]).problems[0]).toMatch(/does not cite/);
});

test('a mission plans, searches, reads, writes, verifies and announces, one checkpointed step at a time',async()=>{
 const {store,clock}=setup();const d=deps(),r=new MissionRunner(store,d,clock);
 const m=store.create('Plan a sunset shared-headphone listening party',null);
 const steps:string[]=[];for(let i=0;i<8;i++){const s=await r.tick();steps.push(s);if(s==='done'||s==='nothing')break;}
 expect(steps).toEqual(['planned','searched','searched','written','done']);
 const done=store.get(m.id)!;
 expect(done.status).toBe('DONE');expect(done.state.queries).toEqual(['silent disco headphone rental cost','outdoor sunset listening party']);
 expect(done.report).toMatch(/^Renting about 20 wireless headsets costs roughly \$150 to \$300 a night \[2\]\. Silent discos are the usual format \[1\]\. A made-up claim\./);
 expect(done.report).toContain('Sources:\n[1] Shared listening — https://en.wikipedia.org/wiki/Silent_disco\n[2] How to host a silent disco — https://partyplanner.com/silent-disco');
 expect(done.state.evidence.find(e=>e.n===2)?.excerpt).toMatch(/^Full page/);
 expect(done.used).toBe(4);expect(done.state.problems[0]).toMatch(/\[7\]/);
 expect(MissionRunner.result(done)).toMatchObject({status:'PARTIAL',recommendation:'get two rental quotes.'});
 expect(d.log.at(-1)).toBe('announce Your research on Plan a sunset shared-headphone listening party is ready. Say "read me the research" to hear it.');
 expect(await r.tick()).toBe('nothing');
});

test('the brain is only used when idle; a step cut off by talking keeps its checkpoint and is retried',async()=>{
 const {store,clock:setupClock}=setup();let release:()=>void=()=>{};
 const d=deps({think:(prompt,_m,signal)=>new Promise((resolve,reject)=>{release=()=>resolve('query one');signal.addEventListener('abort',()=>reject(new Error('cut off')));})});
 const r=new MissionRunner(store,d,setupClock);store.create('Something worth researching',null);
 d.setIdle(false);expect(await r.tick()).toBe('retry');
 d.setIdle(true);const pending=r.tick();await new Promise(x=>setTimeout(x,20));d.setIdle(false);
 expect(await pending).toBe('retry');expect(store.next()!.state.queries).toEqual([]);
 d.setIdle(true);const again=r.tick();await new Promise(x=>setTimeout(x,20));release();expect(await again).toBe('planned');
 expect(store.next()!.state.queries).toEqual(['query one']);
});

test('budget and deadline are enforced; a failed mission keeps what it found',async()=>{
 const {store,advance,clock}=setup();const d=deps(),r=new MissionRunner(store,d,clock);
 const m=store.create('A goal with a tiny budget',null,1);
 await r.tick();await r.tick();expect(store.get(m.id)!.used).toBe(1);
 const m2=store.create('A goal that runs out of time',null);store.cancel(m.id);
 await r.tick();advance(3*60);expect(await r.tick()).toBe('failed');
 expect(store.get(m2.id)!.status).toBe('FAILED');expect(store.get(m2.id)!.report).toBeNull();
 expect(()=>{store.create('x',null);}).toThrow();
});

test('by voice: start, check, read back, cancel and undo — all journaled; three at a time at most',async()=>{
 const {db,store,projects,clock}=setup();
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,null,new WebLookup(),null,projects,null,null,null,{missions:store});
 const say=(action:string,topic='')=>actions.run([{name:'research',arguments:{action,topic}}],new AbortController().signal);
 expect(actions.tools.map(t=>t.name)).toContain(researchModelTool.name);
 expect((await say('report')).lookup?.report).toMatch(/no research yet/);
 expect((await say('start','best budget wireless headphones for a party')).spoken).toBe("On it. I'll research that in the background and tell you when it's ready.");
 expect(new ActionJournal(db).recent()[0]).toMatchObject({tool_id:'missions.start',state:'SUCCEEDED'});
 expect((await say('report','headphones')).lookup?.report).toMatch(/still in progress: Waiting to start; 0 of 12 lookups used/);
 await say('start','second topic here');await say('start','third topic here');
 expect((await say('start','a fourth one')).spoken).toMatch(/already have three/);
 expect((await say('cancel','headphones')).spoken).toBe('Okay, I stopped the research on best budget wireless headphones for a party.');
 const id=store.list().find(m=>m.objective.startsWith('best'))!.id;
 expect(await missionTools(store,projects,clock).find(t=>t.id==='missions.cancel')!.undo!(id,{signal:new AbortController().signal,actionId:'t'})).toBe(true);
 expect(store.get(id)!.status).toBe('QUEUED');
});

test('reading a finished mission marks it heard and gives sources; agents may only use SAFE web lookups',async()=>{
 const {db,store,projects,clock}=setup();
 const r=new MissionRunner(store,deps(),clock);store.create('Plan a sunset listening party',null);for(let i=0;i<6;i++)await r.tick();
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,null,new WebLookup(),null,projects,null,null,null,{missions:store});
 const out=await actions.run([{name:'research',arguments:{action:'report',topic:''}}],new AbortController().signal);
 expect(out.lookup?.report).toMatch(/research on "Plan a sunset listening party" \(finished\)/);expect(out.lookup?.report).not.toContain('Sources:');
 expect(out.lookup?.sources.map(s=>s.site)).toEqual(['wikipedia.org','partyplanner.com']);expect(store.list()[0].heard).toBe(true);
 await expect(actions.agentLookup('gmail.search' as never,'x',new AbortController().signal)).rejects.toThrow('Not allowed');
});

test('Spiral Time by voice: the phrase hands off, "save X for Spiral Time" queues it, and neither counts against three local missions',async()=>{
 const {db,store,projects,clock}=setup();
 const {SpiralTime}=await import('../core/spiral-time.ts'),{mkdtempSync,existsSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'spiral-voice-')),spiral=new SpiralTime(dir,db,store,clock);
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,null,new WebLookup(),null,projects,null,null,null,{missions:store,spiral});
 const run=async(text:string)=>{const call=actions.shortcut(text);expect(call).not.toBeNull();const name=call!.match(/function=(\w+)/)![1],args=Object.fromEntries([...call!.matchAll(/<parameter=(\w+)>\n([^]*?)\n<\/parameter>/g)].map(m=>[m[1],m[2]]));return actions.run([{name,arguments:args}],new AbortController().signal);};
 expect((await run('Harmony, save the best NAS for a music archive for Spiral Time.')).spoken).toBe('Saved for Spiral Time: the best NAS for a music archive.');
 for(const t of ['one local topic','two local topic','three local topic'])await actions.run([{name:'research',arguments:{action:'start',topic:t}}],new AbortController().signal);
 expect((await run('Spiral Time.')).spoken).toBe("Spiral Time. Handing off 4 research jobs, the security news check and the model scan. Claude picks it up within the hour and works until your limit; anything left waits for next time.");
 expect(existsSync(join(dir,'ticket.json'))).toBe(true);
 expect((await run('sprial time')).spoken).toMatch(/^Spiral Time is already handed off/);
 expect(new ActionJournal(db).recent().map(r=>r.tool_id)).toContain('spiral.start');
});
