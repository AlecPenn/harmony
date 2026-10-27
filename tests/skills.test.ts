import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {ProjectStore} from '../core/projects.ts';
import {MemoryStore} from '../core/memory.ts';
import {ModeStore,IdeaStore} from '../core/modes.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {AssistantActions,skillTools} from '../core/assistant-actions.ts';
import {SkillRegistry,SKILLS} from '../core/skills.ts';
import {WebLookup} from '../core/web.ts';

const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function setup(available:(id:string)=>boolean=()=>true){
 const db=openDatabase(':memory:');dbs.push(db);const clock=()=>new Date(2026,9,21,11,0);
 const projects=new ProjectStore(db,clock);projects.seed();const skills=new SkillRegistry(db,available);
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,new MemoryStore(db,clock),new WebLookup(),null,projects,null,null,null,{modes:new ModeStore(db,clock),ideas:new IdeaStore(db,clock),skills});
 const say=(name:string,args:Record<string,string>)=>actions.run([{name,arguments:args}],new AbortController().signal);
 return {db,skills,actions,say};
}

test('every model function belongs to exactly one skill manifest, and manifests are fixed',()=>{
 const tools=SKILLS.flatMap(s=>s.tools);expect(new Set(tools).size).toBe(tools.length);
 const {actions}=setup();for(const t of actions.tools)expect(SKILLS.some(s=>s.tools.includes(t.name)),t.name).toBe(true);
 expect(Object.isFrozen(SKILLS)).toBe(true);
});

test('"disable computer control" style requests, by name or alias; core skills stay on; undo restores',async()=>{
 const {say,skills,actions,db}=setup();
 expect(actions.tools.map(t=>t.name)).toContain('get_weather');
 expect((await say('skills',{action:'disable',name:'web search'})).spoken).toBe('Web lookups is off. Say "enable web lookups" to turn it back on.');
 expect(actions.tools.map(t=>t.name)).not.toContain('get_weather');
 expect(actions.tools.map(t=>t.name)).not.toContain('research');// depends on web
 expect((await say('get_weather',{place:'Madison'})).spoken).toBe('Web lookups is turned off. Say "enable web lookups" to use it.');
 expect((await say('skills',{action:'disable',name:'web'})).spoken).toBe('Web lookups is already off.');
 expect((await say('skills',{action:'disable',name:'status'})).spoken).toBe('Status always stays on.');
 expect((await say('skills',{action:'disable',name:'teleportation'})).spoken).toMatch(/don't have a skill called teleportation/);
 const row=new ActionJournal(db).recent()[0];expect(row).toMatchObject({tool_id:'skills.set',rollback_reference:'web.on'});
 expect(await skillTools(skills,()=>new Date()).find(t=>t.id==='skills.set')!.undo!('web.on',{signal:new AbortController().signal,actionId:'t'})).toBe(true);
 expect(skills.enabled('web')).toBe(true);
 expect((await say('skills',{action:'disable',name:'ideas'})).spoken).toMatch(/Ideas is off/);
 expect((await say('project_note',{kind:'idea',text:'a thing worth keeping'})).spoken).toBe('Ideas is turned off. Say "enable ideas" to use it.');
});

test('"what skills do you have?" lists what is on, off and not set up',async()=>{
 const {say,skills}=setup(id=>id!=='calendar');skills.set('modes',false);
 const r=await say('skills',{action:'list',name:''});
 expect(r.lookup?.report).toContain('- Reminders and timers: on');expect(r.lookup?.report).toContain('- Focus and ghost modes: off');
 expect(r.lookup?.report).toContain('- Google Calendar: not available');
 expect(skills.list().find(s=>s.id==='calendar')?.status).toBe('UNAVAILABLE');expect(skills.list()[0].hash).toMatch(/^[0-9a-f]{16}$/);
 expect(()=>skills.set('status',false)).toThrow();expect(()=>skills.set('nope',true)).toThrow();
});
