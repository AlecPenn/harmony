/** Checks memory search by meaning on this PC: speed, and whether related phrasings score clearly above unrelated ones.
 * Uses the installed model only (run "Set up local brain" first). Nothing is stored. Usage: npm run memory:check
 */
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {LocalEmbedder,similarity} from '../core/embedder.ts';
import {MEANING_FLOOR,MEANING_CEIL,RELATED_MEANING} from '../core/recall.ts';

const root=resolve(import.meta.dirname,'..'),e=new LocalEmbedder(root);
if(!e.model){console.log('Memory search is not set up yet. Double-click "Set up memory search" in the HARMONY folder (about 200 MB).');process.exit(1);}
const memories=['Dave from unit 12 is my plumber',"Sam's soccer practice is on Tuesdays",'The wifi password is on the back of the router',
 "My mum's birthday is March 3",'Rent is due on the first of the month','The Eden\'s Gate catalog goes live in November','My dentist is Dr. Ruiz on Monroe Street'];
// [what is said, which memory it should find (index), or null when none should come up]
const cases:[string,number|null][]=[
 ['the kitchen sink is leaking again',0],['who fixes the pipes around here',0],['when does Sam have football',1],['what time is practice this week',1],
 ['the internet is down, how do I get back online',2],['what should I get my mother for her birthday',3],['when do I have to pay the landlord',4],
 ['when is the music archive launching',5],['my tooth really hurts',6],
 ['tell me a joke',null],['what is the capital of Australia',null],['set a timer for ten minutes',null],['how tall is Mount Everest',null]];
const started=performance.now();const m=await e.embed(memories);
if(!m){console.log('The model did not start. Run "Set up memory search" again to re-check the files.');process.exit(1);}
console.log(`Model ${e.model}: loaded and indexed ${memories.length} memories in ${Math.round(performance.now()-started)} ms.\n`);
const right:number[]=[],wrong:number[]=[];let correct=0,times:number[]=[];
for(const [text,want] of cases){
 const t=performance.now();const [q]=(await e.embed([text]))!;times.push(performance.now()-t);
 const scores=m.map(v=>similarity(q,v)),best=scores.indexOf(Math.max(...scores)),top=scores[best];
 if(want!==null){right.push(scores[want]);for(let i=0;i<scores.length;i++)if(i!==want)wrong.push(scores[i]);}else wrong.push(...scores);
 const meaning=(top-MEANING_FLOOR)/(MEANING_CEIL-MEANING_FLOOR),added=meaning>=RELATED_MEANING;
 const ok=want===null?!added:best===want;if(ok)correct++;
 console.log(`${ok?'OK  ':'MISS'} "${text}"\n     best: ${memories[best]} (${top.toFixed(3)})${added?' → would be added to the turn':''}`);
}
await e.stop();
const avg=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length,sorted=[...times].sort((a,b)=>a-b);
console.log(`\n${correct} of ${cases.length} as expected. Query time: median ${Math.round(sorted[sorted.length>>1])} ms.`);
console.log(`Related pairs: min ${Math.min(...right).toFixed(3)}, average ${avg(right).toFixed(3)}. Unrelated: average ${avg(wrong).toFixed(3)}, max ${Math.max(...wrong).toFixed(3)}.`);
console.log(`Current scale: floor ${MEANING_FLOOR}, ceiling ${MEANING_CEIL}; a fact is added to a turn above ${(MEANING_FLOOR+RELATED_MEANING*(MEANING_CEIL-MEANING_FLOOR)).toFixed(3)}.`);
