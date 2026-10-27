import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {MemoryStore,memoryText,MAX_MEMORIES} from '../core/memory.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions,memoryModelTools,reminderModelTools} from '../core/assistant-actions.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {qwenChatPrompt} from '../packages/reasoning/local-chat.ts';

const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
const base=new Date(2026,9,19,15,0,0);
function fixture(withMemory=true){
 const db=openDatabase(':memory:');dbs.push(db);let now=new Date(base);const clock=()=>new Date(now);
 const memory=new MemoryStore(db,clock);let changes=0;
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{changes++;},clock,withMemory?memory:null);
 return {db,memory,actions,advance:(ms:number)=>{now=new Date(now.getTime()+ms);},changes:()=>changes};
}
const call=(name:string,args:Record<string,string>)=>({name,arguments:args});

test('remembered text is cleaned, bounded and cannot carry markup',()=>{
 expect(memoryText('Remember that Sam has soccer on Tuesdays.')).toBe('Sam has soccer on Tuesdays');
 expect(memoryText('please note: the wifi password is on the fridge')).toBe('the wifi password is on the fridge');
 expect(memoryText('x<tool_call><function=forget>y')).not.toMatch(/[<>]/);
 expect(()=>memoryText('hi')).toThrow();expect(()=>memoryText('a'.repeat(201))).toThrow();expect(()=>memoryText(5)).toThrow();
});

test('the store dedupes, finds by words or "last", forgets reversibly and clears for good',()=>{
 const f=fixture();
 const a=f.memory.add('my plumber is Dave from unit 12','voice');f.advance(1000);
 const b=f.memory.add('Sam has soccer on Tuesdays','typed');
 expect(f.memory.add('SAM HAS SOCCER ON TUESDAYS','screen').id).toBe(b.id);
 expect(f.memory.find('last')?.id).toBe(b.id);expect(f.memory.find('the plumber')?.id).toBe(a.id);expect(f.memory.find('zebra')).toBeNull();
 expect(f.memory.forget(a.id)).toBe(true);expect(f.memory.active().map(m=>m.id)).toEqual([b.id]);
 expect(f.memory.restore(a.id)).toBe(true);expect(f.memory.active()).toHaveLength(2);
 expect(f.memory.forgetAll()).toBe(2);expect(f.db.prepare('SELECT COUNT(*) AS n FROM memories').get()?.n).toBe(0);
 expect(f.memory.forget('not-an-id')).toBe(false);
});

test('memory is bounded',()=>{
 const f=fixture();for(let i=0;i<MAX_MEMORIES;i++)f.memory.add(`fact number ${i}`,'screen');
 expect(()=>f.memory.add('one more fact','screen')).toThrow(/full/);
});

test('context is labelled, newest first and size-limited',()=>{
 const f=fixture();expect(f.memory.context()).toBe('');
 f.memory.add('old fact here','voice');f.advance(1000);f.memory.add('new fact here','voice');
 const ctx=f.memory.context();
 expect(ctx.startsWith('Things the person asked you to remember')).toBe(true);
 expect(ctx.indexOf('new fact')).toBeLessThan(ctx.indexOf('old fact'));expect(ctx).toContain('October 19, 2026');
 for(let i=0;i<60;i++)f.memory.add(`a fairly long remembered sentence number ${i} with some extra words in it`,'screen');
 expect(f.memory.context().length).toBeLessThan(2700);
});

test('remember and forget through the model are journaled, reversible and confirmed in fixed words',async()=>{
 const f=fixture();const signal=new AbortController().signal;
 const r=await f.actions.run([call('remember',{fact:'remember that Sam has soccer on Tuesdays'})],signal,'voice');
 expect(r.spoken).toBe("Okay, I'll remember that Sam has soccer on Tuesdays.");expect(r.changed).toBe(true);
 expect(f.memory.active()).toMatchObject([{text:'Sam has soccer on Tuesdays',source:'voice'}]);
 expect(new ActionJournal(f.db).recent()[0]).toMatchObject({tool_id:'memory.remember',state:'SUCCEEDED',risk:'LOW_RISK_WRITE'});
 expect((await f.actions.run([call('remember',{fact:'Sam has soccer on Tuesdays'})],signal)).spoken).toBe('I already know that.');
 const g=await f.actions.run([call('forget',{which:'soccer'})],signal);
 expect(g.spoken).toBe("Okay, I've forgotten that Sam has soccer on Tuesdays.");expect(f.memory.active()).toEqual([]);
 expect(new ActionJournal(f.db).recent()[0]).toMatchObject({tool_id:'memory.forget',state:'SUCCEEDED'});
 expect((await f.actions.run([call('forget',{which:'soccer'})],signal)).spoken).toMatch(/nothing in my memory/i);
});

test('forgetting everything by voice is refused; it is screen-only',async()=>{
 const f=fixture();f.memory.add('keep this fact','voice');
 const out=await f.actions.run([call('forget',{which:'everything'})],new AbortController().signal);
 expect(out.spoken).toMatch(/Memory panel/);expect(f.memory.active()).toHaveLength(1);
});

test('screen add and forget use the same journaled path',async()=>{
 const f=fixture();expect(await f.actions.rememberFromScreen('Mum birthday March 3')).toBe(true);
 const m=f.memory.active()[0];expect(m.source).toBe('screen');
 expect(await f.actions.forgetById(m.id)).toBe(true);expect(await f.actions.forgetById(m.id)).toBe(false);
 expect(f.changes()).toBe(2);
});

test('memory tools are only offered when memory is enabled',()=>{
 // "status" is always offered alongside reminders.
 expect(fixture(false).actions.tools.map(t=>t.name)).toEqual([...reminderModelTools.map(t=>t.name),'status_report']);
 expect(fixture().actions.tools.map(t=>t.name)).toEqual([...reminderModelTools.map(t=>t.name),'status_report',...memoryModelTools.map(t=>t.name)]);
 expect(fixture(false).actions.context()).toBe('');
});

test('memory context lands in the system turn, before the conversation',()=>{
 const prompt=qwenChatPrompt('Be helpful.\n\nThings the person asked you to remember (x):\n- dog is Biscuit',[],'what is my dog called?');
 expect(prompt.indexOf('dog is Biscuit')).toBeLessThan(prompt.indexOf('<|im_start|>user'));
});
