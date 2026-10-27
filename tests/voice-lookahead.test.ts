import {test,expect} from 'vitest';
import {voiceLookahead} from '../core/voice-lookahead.ts';
import type {VoiceChunk} from '../packages/contracts/voice-output.ts';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const frame=(value:number):VoiceChunk=>({samples:new Int16Array([value]),rate:24000,done:false});
test('lookahead advances synthesis while playback pauses and stays bounded',async()=>{
 let produced=0,closed=false;const control=new AbortController();
 async function* source(){try{for(let i=0;i<200;i++){produced++;yield frame(i);}}finally{closed=true;}}
 const stream=voiceLookahead(source(),control.signal);expect((await stream.next()).value?.samples[0]).toBe(0);await tick();
 expect(produced).toBe(61);expect((await stream.next()).value?.samples[0]).toBe(1);await tick();expect(produced).toBe(62);
 control.abort();await expect(stream.next()).rejects.toThrow();await tick();expect(closed).toBe(true);
});
test('abort rejects pending reads and discards late worker frames',async()=>{
 let release!:()=>void;const control=new AbortController();
 async function* source(){await new Promise<void>(r=>{release=r;});yield frame(1);}
 const stream=voiceLookahead(source(),control.signal),pending=stream.next(),rejected=expect(pending).rejects.toThrow();
 control.abort();await rejected;release();await tick();expect((await stream.next()).done).toBe(true);
});
test('producer errors discard queued audio and malformed frames fail closed',async()=>{
 for(const bad of [true,false]){const control=new AbortController();async function* source(){yield frame(1);if(bad)yield {...frame(2),samples:new Int16Array(2401)};else throw new Error('synthesis failed');}
 const stream=voiceLookahead(source(),control.signal);await stream.next();await tick();await expect(stream.next()).rejects.toThrow();}
});
test('terminal chunk remains ordered and consumer return releases the producer',async()=>{
 let closed=false;async function* source(){try{yield frame(1);yield {samples:new Int16Array(),rate:24000 as const,done:true};}finally{closed=true;}}
 const stream=voiceLookahead(source(),new AbortController().signal);expect((await stream.next()).value?.done).toBe(false);expect((await stream.next()).value?.done).toBe(true);expect((await stream.next()).done).toBe(true);expect(closed).toBe(true);
});


test('native Piper lookahead keeps the 100 ms per-frame bound',async()=>{
 async function* source(){yield {samples:new Int16Array(2205),rate:22050 as const,done:false};yield {samples:new Int16Array(2206),rate:22050 as const,done:false};}
 const stream=voiceLookahead(source(),new AbortController().signal);expect((await stream.next()).value?.rate).toBe(22050);await tick();await expect(stream.next()).rejects.toThrow();
});
