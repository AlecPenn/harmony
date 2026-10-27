import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {ProjectStore} from '../core/projects.ts';
import {MemoryStore} from '../core/memory.ts';
import {Recall} from '../core/recall.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {AssistantActions,modeTools,modeModelTool} from '../core/assistant-actions.ts';
import {ModeStore,IdeaStore,MAX_IDEAS} from '../core/modes.ts';

const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function setup(){
 const db=openDatabase(':memory:');dbs.push(db);let now=new Date(2026,9,21,9,0);const clock=()=>new Date(now);
 const projects=new ProjectStore(db,clock);projects.seed();const modes=new ModeStore(db,clock),ideas=new IdeaStore(db,clock),memory=new MemoryStore(db,clock);
 const recall=new Recall(db,memory,projects,null,clock);
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,memory,null,null,projects,recall,null,null,{modes,ideas});
 const say=(name:string,args:Record<string,string>)=>actions.run([{name,arguments:args}],new AbortController().signal);
 return {db,projects,modes,ideas,actions,recall,say,advance:(m:number)=>{now=new Date(now.getTime()+m*60000);}};
}

test('"lock in", ghost and back to normal, with the focus session timed and undo restoring the mode',async()=>{
 const {say,modes,advance,actions,db}=setup();
 expect(actions.tools.map(t=>t.name)).toContain(modeModelTool.name);expect(actions.tools.length).toBeLessThanOrEqual(20);
 expect(modes.status()).toEqual({mode:'normal',since:null});
 expect((await say('set_mode',{mode:'lock in'})).spoken).toBe("Locked in. I'll keep the screen simple and stay quiet until you say back to normal.");
 expect(modes.status().mode).toBe('focus');expect((await say('set_mode',{mode:'focus'})).spoken).toBe("You're already in focus mode.");
 advance(85);
 expect((await say('set_mode',{mode:'back to normal'})).spoken).toBe('Back to normal. You were locked in for 1 hour 25 minutes.');
 expect((await say('set_mode',{mode:'ghost'})).spoken).toMatch(/^Ghost mode/);
 expect((await say('set_mode',{mode:'party'})).spoken).toBe('I can switch to focus, ghost, or back to normal.');
 // Journal rows written in the same millisecond have no fixed order, so check the set.
 expect(new ActionJournal(db).recent().filter(r=>r.tool_id==='mode.set').map(r=>r.rollback_reference).sort()).toEqual(['focus','normal','normal']);
 expect(await modeTools(modes,null)[0].undo!('normal',{signal:new AbortController().signal,actionId:'t'})).toBe(true);expect(modes.status().mode).toBe('normal');
});

test('"idea: …" is saved at once, to the current project if there is one, findable, and undoable',async()=>{
 const {say,ideas,projects,recall}=setup();
 expect((await say('project_note',{kind:'idea',text:'Idea: a sunset listening party with shared headphones.'})).spoken).toBe('Idea saved.');
 projects.switchTo(projects.find("artist's studio")!.id);
 expect((await say('project_note',{kind:'idea',text:'a CC0 sample pack drop'})).spoken).toBe("Idea saved to Artist's Studio.");
 const list=ideas.list();expect(list.map(i=>i.text)).toEqual(['a CC0 sample pack drop','a sunset listening party with shared headphones']);
 expect(list[0].projectId).toBe(projects.activeId());expect(list[1].projectId).toBeNull();
 expect((await recall.search('headphones party'))[0]).toMatchObject({kind:'idea',text:'Idea: a sunset listening party with shared headphones'});
 ideas.setStage(list[1].id,'ARCHIVE');expect(ideas.list()[1].stage).toBe('ARCHIVE');expect(()=>ideas.setStage(list[1].id,'MAYBE' as never)).toThrow();
 expect(await modeTools(null,ideas)[0].undo!(list[0].id,{signal:new AbortController().signal,actionId:'t'})).toBe(true);expect(ideas.list()).toHaveLength(1);
 expect((await say('project_note',{kind:'idea',text:'x'})).spoken).toBe("What's the idea?");
 expect(MAX_IDEAS).toBe(500);
});

test('exact short commands go straight to their function, only when it is offered',()=>{
 const db=openDatabase(':memory:');dbs.push(db);const clock=()=>new Date(2026,9,21,9,0);
 const projects=new ProjectStore(db,clock);projects.seed();
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,null,null,null,projects,null,null,null,{modes:new ModeStore(db,clock)});
 expect(actions.shortcut('Harmony, status.')).toBe('<tool_call>\n<function=status_report>\n<parameter=focus>\n\n</parameter>\n</function>\n</tool_call>');
 expect(actions.shortcut('Hey Harmony, why are you so slow?')).toContain('<parameter=focus>\nspeed\n</parameter>');
 expect(actions.shortcut('lock in')).toContain('<function=set_mode>');expect(actions.shortcut('Where was I?')).toContain('<function=where_was_i>');
 expect(actions.shortcut('Save my place.')).toBeNull();// workspace isn't offered without the desktop helper
 expect(actions.shortcut('status of the order from Amazon')).toBeNull();expect(actions.shortcut('What is the weather?')).toBeNull();
});
