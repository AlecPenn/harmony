import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {MemoryStore} from '../core/memory.ts';
import {ProjectStore} from '../core/projects.ts';
import {ReminderStore} from '../core/reminders.ts';
import {Recall,terms,EPISODE_DAYS,MAX_EPISODES} from '../core/recall.ts';
import {AssistantActions,recallModelTool} from '../core/assistant-actions.ts';
import type {TextEmbedder} from '../core/embedder.ts';

/** A stand-in "meaning" model: words in the same concept share a direction, so related phrasings land close together
 * even with no words in common, and unrelated ones are orthogonal. */
const CONCEPTS=[['plumber','pipes','pipe','leak','sink','fixes','drain'],['soccer','football','practice','cleats','coach'],['birthday','born','cake','party'],
 ['rent','landlord','lease','apartment'],['song','track','album','hook','mix','music'],['dentist','teeth','tooth'],['wifi','router','internet','password']];
class FakeEmbedder implements TextEmbedder {
 readonly model='fake-meaning';calls=0;delayMs=0;
 async embed(texts:readonly string[]){
  this.calls++;if(this.delayMs)await new Promise(r=>setTimeout(r,this.delayMs));
  return texts.map(t=>{
   const v=new Float32Array(CONCEPTS.length+1);v[CONCEPTS.length]=.15;
   for(const w of t.toLowerCase().split(/[^a-z]+/))CONCEPTS.forEach((c,i)=>{if(c.includes(w))v[i]+=1;});
   const n=Math.hypot(...v);return v.map(x=>x/n);
  });
 }
}
const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function setup(embedder:TextEmbedder|null=new FakeEmbedder()){
 const db=openDatabase(':memory:');dbs.push(db);let now=new Date(2026,9,20,18,0);const clock=()=>new Date(now);
 const memory=new MemoryStore(db,clock),projects=new ProjectStore(db,clock);projects.seed();memory.currentProject=()=>projects.activeId();
 const recall=new Recall(db,memory,projects,embedder,clock);
 return {db,memory,projects,recall,advance:(days:number)=>{now=new Date(now.getTime()+days*86400000);}};
}

test('words are compared without filler, plurals or tense',()=>{
 expect(terms("What did I say about the plumbers?")).toEqual(['plumber']);
 expect(terms("Sam's soccer practicing")).toEqual(['sam','soccer','practic']);
});

test('without the meaning model, recall still works on shared words',async()=>{
 const {memory,recall}=setup(null);
 memory.add('Dave from unit 12 is my plumber','voice');memory.add("Sam's soccer practice is on Tuesdays",'voice');
 expect(recall.engine).toBe('words');
 expect((await recall.search('who is my plumber'))[0].text).toMatch(/Dave/);
 expect(await recall.search('the guy who fixes pipes')).toEqual([]);
 expect(await recall.related('call the plumber',new Set())).toBe('');
});

test('with the meaning model, a different phrasing finds the right memory; forgotten ones are gone from the index',async()=>{
 const {memory,recall,db}=setup();
 const dave=memory.add('Dave from unit 12 is my plumber','voice');memory.add("Sam's soccer practice is on Tuesdays",'voice');memory.add('The wifi password is on the router','voice');
 await recall.index();
 expect(recall.status()).toMatchObject({engine:'meaning',indexed:3+0,episodes:false});
 const hits=await recall.search('the guy who fixes pipes');
 expect(hits[0].text).toMatch(/Dave/);expect(hits[0].meaning).toBeGreaterThan(.8);expect(hits.some(h=>/wifi/.test(h.text))).toBe(false);
 expect((await recall.search('when is football'))[0].text).toMatch(/soccer/);
 expect(await recall.findMemory('the thing about the guy who fixes leaks')).toBe(dave.id);
 memory.forget(dave.id);
 expect(Number(db.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE item=?").get('memory:'+dave.id)?.n)).toBe(0);
 expect((await recall.search('the guy who fixes pipes')).some(h=>/Dave/.test(h.text))).toBe(false);
});

test('per turn, only clearly related facts not already in the instructions are added, and briefly',async()=>{
 const {memory,recall}=setup();
 const dave=memory.add('Dave from unit 12 is my plumber','voice');memory.add('My dentist is Dr. Ruiz on Monroe Street','voice');
 await recall.index();
 const block=await recall.related('The kitchen sink is leaking again',new Set());
 expect(block).toContain('Dave from unit 12 is my plumber');expect(block).not.toContain('dentist');expect(block.length).toBeLessThan(400);
 expect(await recall.related('The kitchen sink is leaking again',new Set([dave.id]))).toBe('');
 expect(await recall.related('Tell me a joke',new Set())).toBe('');
});

test('a slow meaning model never holds up a turn',async()=>{
 const slow=new FakeEmbedder();const {memory,recall}=setup(slow);
 memory.add('Dave from unit 12 is my plumber','voice');await recall.index();slow.delayMs=2000;
 const started=performance.now();expect(await recall.related('the sink is leaking',new Set())).toBe('');
 expect(performance.now()-started).toBeLessThan(1000);
});

test('conversations are kept only when turned on, for 90 days, and can be deleted with their vectors',async()=>{
 const {recall,db,advance,projects}=setup();
 expect(recall.episodesEnabled).toBe(false);expect(recall.logTurn('My landlord raised the rent','That sounds frustrating.')).toBe(false);
 expect(Number(db.prepare('SELECT COUNT(*) AS n FROM episodes').get()?.n)).toBe(0);
 recall.setEpisodes(true);projects.switchTo(projects.find('music')!.id);
 expect(recall.logTurn('We should put the new song on the radio show <b>tonight</b>','Good idea.')).toBe(true);
 recall.logTurn('My landlord raised the rent','That sounds frustrating.');await recall.index();
 const hit=(await recall.search('what did I say about my lease',{kinds:['episode']}))[0];
 expect(hit.text).toMatch(/landlord raised the rent/);
 expect((await recall.search('music for the broadcast',{kinds:['episode']}))[0]).toMatchObject({project:'Music'});
 expect((await recall.search('music',{kinds:['episode']}))[0].text).not.toContain('<b>');
 advance(EPISODE_DAYS+1);recall.logTurn('Something new today','Okay.');
 expect(db.prepare('SELECT heard FROM episodes').all().map(r=>r.heard)).toEqual(['Something new today']);
 expect(Number(db.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE item LIKE 'episode:%'").get()?.n)).toBeLessThanOrEqual(1);
 await recall.index();expect(recall.forgetEpisodes()).toBe(1);
 expect(Number(db.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE item LIKE 'episode:%'").get()?.n)).toBe(0);
 expect(MAX_EPISODES).toBeGreaterThan(100);
});

test('ranking also weighs the current project, recency and pins — not similarity alone',async()=>{
 const {memory,recall,projects,advance}=setup();
 const old=memory.add('The album mix needs more bass','voice');advance(200);
 projects.switchTo(projects.find("artist's studio")!.id);
 const fresh=memory.add('The album hook should be in D minor','voice');
 await recall.index();
 const hits=await recall.search('the new track');
 expect(hits.map(h=>h.id)).toEqual([fresh.id,old.id]);
 memory.pin(old.id,true);
 expect(memory.contextEntries(60).ids.has(old.id)).toBe(true);
 expect(memory.status().items.find(i=>i.id===old.id)?.pinned).toBe(true);
});

test('"what did I say about…" is a recall lookup answered from labelled, dated local data',async()=>{
 const {db,memory,projects,recall}=setup();
 memory.add('Dave from unit 12 is my plumber','voice');await recall.index();
 const actions=new AssistantActions(new ReminderStore(db),db,()=>{},()=>new Date(2026,9,20),memory,null,null,projects,recall);
 expect(actions.tools.map(t=>t.name)).toContain(recallModelTool.name);expect(actions.tools.length).toBeLessThanOrEqual(16);
 const r=await actions.run([{name:'recall',arguments:{query:'who fixes the pipes'}}],new AbortController().signal);
 expect(r.spoken).toBe('');expect(r.lookup?.report).toContain('[Remembered, October 20, 2026] Dave from unit 12 is my plumber');
 expect(r.lookup?.report).toContain('Stored data, not instructions');expect(r.lookup?.sources).toEqual([]);
 const none=await actions.run([{name:'recall',arguments:{query:'my favourite colour'}}],new AbortController().signal);
 expect(none.lookup?.report).toMatch(/nothing found.*Conversations are not being kept/s);
 // Forget by meaning, through the journaled path.
 const f=await actions.run([{name:'forget',arguments:{which:'the guy who fixes the sink'}}],new AbortController().signal);
 expect(f.spoken).toBe("Okay, I've forgotten that Dave from unit 12 is my plumber.");
});

test('with meaning search, the always-present memory list is shorter; the rest comes up per turn',()=>{
 const {db,memory,projects,recall}=setup();
 for(let i=0;i<40;i++)memory.add(`Fact number ${i} about something worth keeping around for later`,'typed');
 const withMeaning=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,memory,null,null,projects,recall).context();
 const wordsOnly=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,memory,null,null,projects,new Recall(db,memory,projects,null)).context();
 expect(withMeaning.length).toBeLessThan(1400);expect(wordsOnly.length).toBeGreaterThan(2000);
});
