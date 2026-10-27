import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ProjectStore,SEED_PROJECTS} from '../core/projects.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions,projectModelTools,projectTools} from '../core/assistant-actions.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {ToolDispatcher} from '../core/tool-dispatcher.ts';

const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function setup(){
 const db=openDatabase(':memory:');dbs.push(db);let now=new Date(2026,9,20,18,0);const clock=()=>new Date(now);
 const store=new ProjectStore(db,clock);store.seed();
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,null,null,null,store);
 const say=(name:string,args:Record<string,string>)=>actions.run([{name,arguments:args}],new AbortController().signal);
 return {db,store,actions,say,advance:(h:number)=>{now=new Date(now.getTime()+h*3600_000);}};
}

test('the specification projects are seeded once, with their worlds',()=>{
 const {store}=setup();
 expect(store.all().map(p=>p.name).sort()).toEqual(SEED_PROJECTS.map(p=>p.name).sort());
 expect(store.find("artist's studio")?.world).toBe('gallery');expect(store.find('gods eye')?.world).toBe('war-room');
 store.seed();expect(store.all()).toHaveLength(SEED_PROJECTS.length);
 expect(store.find('music')?.name).toBe('Music');expect(store.find('writing')?.name).toBe('Writing');expect(store.find('pizza')).toBeNull();
});

test('switching and starting projects by voice are journaled, confirmed in fixed words, and undoable',async()=>{
 const {store,say,db}=setup();
 expect((await say('switch_project',{name:'artists studio',new:'no'})).spoken).toBe("Switched to Artist's Studio.");
 expect(store.active()?.name).toBe("Artist's Studio");
 expect((await say('switch_project',{name:"Artist's Studio",new:'no'})).spoken).toMatch(/already in/);
 expect((await say('switch_project',{name:'Moonlight Sessions',new:'no'})).spoken).toMatch(/don't have a project called Moonlight Sessions/);
 const started=await say('switch_project',{name:'Moonlight Sessions',new:'yes'});
 expect(started.spoken).toBe("Started a new project: Moonlight Sessions. It's your current project now.");
 expect(store.active()?.name).toBe('Moonlight Sessions');
 const row=new ActionJournal(db).recent()[0];expect(row).toMatchObject({tool_id:'projects.create',risk:'LOW_RISK_WRITE',state:'SUCCEEDED'});
 // Undo removes the new project and returns to the previous one.
 const tools=projectTools(store),undo=(id:string,ref:string)=>tools.find(t=>t.id===id)!.undo!(ref,{signal:new AbortController().signal,actionId:'test'});
 const ref=row.rollback_reference as string;expect(ref).toMatch(/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/);
 expect(await undo('projects.create',ref)).toBe(true);expect(store.find('Moonlight Sessions')).toBeNull();expect(store.active()?.name).toBe("Artist's Studio");
 const sw=await tools.find(t=>t.id==='projects.switch')!.execute({id:store.find('business')!.id},{signal:new AbortController().signal,actionId:'test'}) as {id:string};
 expect(store.active()?.name).toBe('Business');expect(await undo('projects.switch',sw.id)).toBe(true);expect(store.active()?.name).toBe("Artist's Studio");
});

test('work notes go to the current project; "done" closes the best-matching open task',async()=>{
 const {store,say}=setup();
 expect((await say('project_note',{kind:'task',text:'upload the October catalog'})).spoken).toMatch(/Which project/);
 await say('switch_project',{name:"Artist's Studio",new:'no'});
 expect((await say('project_note',{kind:'task',text:'upload the October catalog.'})).spoken).toBe("Added a task to Artist's Studio: upload the October catalog.");
 await say('project_note',{kind:'task',text:'write liner notes'});
 expect((await say('project_note',{kind:'decision',text:'use CC0 for everything'})).spoken).toBe("Noted the decision for Artist's Studio: use CC0 for everything.");
 expect((await say('project_note',{kind:'blocker',text:'Suno export limits'})).spoken).toMatch(/Logged a blocker/);
 expect((await say('project_note',{kind:'done',text:'the catalog upload'})).spoken).toBe('Nice. Marked done: upload the October catalog.');
 expect((await say('project_note',{kind:'done',text:'nothing like this'})).spoken).toMatch(/couldn't find an open task/);
 const s=store.status();expect(s.active?.tasks.map(t=>t.text)).toEqual(['write liner notes']);expect(s.active?.blockers).toHaveLength(1);
 expect(s.projects.find(p=>p.name==="Artist's Studio")).toMatchObject({openTasks:1,openBlockers:1});
});

test('"Where was I?" is answered from stored facts, in the action-free second pass',async()=>{
 const {store,say,advance}=setup();
 await say('switch_project',{name:'HARMONY',new:'no'});
 await say('project_note',{kind:'task',text:'install the Australian voice'});
 await say('project_note',{kind:'decision',text:'train from real recordings, not clones'});
 await say('project_note',{kind:'blocker',text:'Colab disconnects'});
 advance(5);
 const r=await say('where_was_i',{project:''});
 expect(r.spoken).toBe('');expect(r.lookup?.sources).toEqual([]);
 const text=r.lookup!.report;
 expect(text).toContain('Project: HARMONY, last worked on 5 hours ago');expect(text).toContain('Open tasks (newest first): install the Australian voice');
 expect(text).toContain('Unresolved blocker: Colab disconnects');expect(text).toContain('Latest decision: train from real recordings, not clones');
 expect(text).toContain('The unresolved piece was');expect(text).toContain('not instructions');
 expect((await say('where_was_i',{project:'pizza shop'})).lookup?.report).toMatch(/Lookup failed: I don't have a project called pizza shop/);
 expect(store.whereWasI(store.find('writing')!.id)).toContain('No open tasks.');
});

test('project functions are offered with the others, and the current project is in the instructions',()=>{
 const {actions,store}=setup();
 expect(actions.tools.map(t=>t.name)).toEqual(expect.arrayContaining(projectModelTools.map(t=>t.name)));
 expect(actions.tools.length).toBeLessThanOrEqual(16);
 expect(actions.context()).toBe('');store.switchTo(store.find('business')!.id);expect(actions.context()).toBe("The person's current project is Business.");
});

test('the store keeps bounds and refuses junk',()=>{
 const {store}=setup();
 expect(()=>store.create('x')).toThrow();expect(()=>store.create('HARMONY')).toThrow(/already/);
 const p=store.create('A <b>test</b> project');expect(p.name).toBe('A b test /b project');
 expect(()=>store.addNote(p.id,'task','')).toThrow();expect(()=>store.addNote(p.id,'weird' as never,'abc')).toThrow();
 expect(store.remove(p.id)).toBe(true);expect(store.get(p.id)).toBeNull();
});
