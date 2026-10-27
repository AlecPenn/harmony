import {LocalVoiceStartupTimeout} from '../core/local-voice.ts';
import {test,expect} from 'vitest';
import {LocalVoicePreview} from '../core/local-voice-preview.ts';
function fixture(){let starts=0,stops=0;const texts:string[]=[];const worker={active:false,ready:false,async start(){starts++;this.active=true;this.ready=true;return {session:'worker-session',warmupMs:1};},async *speak(_id:string,text:string){texts.push(text);yield new Int16Array([1,2]);},async stop(){stops++;this.active=false;this.ready=false;}};const output=new LocalVoicePreview('.',()=>{},worker);return {worker,output,texts,starts:()=>starts,stops:()=>stops};}
async function consume(output:LocalVoicePreview,id:string){let sequence=0;while(!(await output.next(id,sequence++)).done){}output.playback(id,true);}
test('fixed British audition is local, retains warm worker and records real timing',async()=>{const f=fixture();try{let id=f.output.start().sessionId;await consume(f.output,id);expect(f.output.snapshot()).toMatchObject({provider:'local',state:'FINISHED'});expect(f.output.trace()?.metrics.tts_first_audio_ms.state).toBe('completed');expect(f.texts).toHaveLength(5);expect(f.texts[0]).toBe("Hi, I'm Harmony.");expect(f.texts.join(' ')).toContain('British female voice for local testing.');id=f.output.start().sessionId;await consume(f.output,id);expect(f.starts()).toBe(1);}finally{await f.output.stop();}expect(f.worker.active).toBe(false);});
test('unapproved text cannot be submitted and early playback completion is rejected',async()=>{const f=fixture();try{const id=f.output.start().sessionId;expect(()=>f.output.start()).toThrow();expect(()=>f.output.playback(id,true)).toThrow();await expect(f.output.next(id,99)).rejects.toThrow();expect(f.texts).toEqual([]);}finally{await f.output.stop();}});
test('STOP invalidates pending warmup and prevents stale preview audio',async()=>{const f=fixture();let release!:()=>void;f.worker.start=async()=>{f.worker.active=true;await new Promise<void>(r=>{release=r;});return {session:'old',warmupMs:1};};const id=f.output.start().sessionId,pending=f.output.next(id,0),rejected=expect(pending).rejects.toThrow();await f.output.stop();release();await rejected;expect(f.texts).toEqual([]);expect(f.output.snapshot().state).toBe('CANCELLED');});


test('silent preparation warms once without generating the audition or reporting first audio',async()=>{
 const f=fixture();try{expect(await f.output.prepare()).toBe(true);expect(f.output.snapshot()).toMatchObject({state:'READY',tts_first_audio_ms:null});expect(f.texts).toEqual([]);expect(await f.output.prepare()).toBe(true);expect(f.starts()).toBe(1);await consume(f.output,f.output.start().sessionId);expect(f.starts()).toBe(1);}finally{await f.output.stop();}
});
test('STOP cancels preparation, rejects overlaps and cannot leave a stale ready state',async()=>{
 const f=fixture();let release!:()=>void;f.worker.start=async()=>{f.worker.active=true;await new Promise<void>(r=>{release=r;});return {session:'old',warmupMs:1};};
 const pending=f.output.prepare();await Promise.resolve();expect(()=>f.output.start()).toThrow();await expect(f.output.prepare()).rejects.toThrow();await f.output.stop();release();expect(await pending).toBe(false);expect(f.output.snapshot().state).toBe('CANCELLED');expect(f.texts).toEqual([]);
});
test('preparation failure is recoverable and stays silent',async()=>{
 const f=fixture(),start=f.worker.start.bind(f.worker);f.worker.start=async()=>{throw new Error('fixture failure');};await expect(f.output.prepare()).rejects.toThrow();expect(f.output.snapshot().state).toBe('ERROR');f.worker.start=start;try{expect(await f.output.prepare()).toBe(true);expect(f.texts).toEqual([]);}finally{await f.output.stop();}
});


test('Piper preview keeps native sample rate and exposes the actual engine',async()=>{
 const f=fixture(),output=new LocalVoicePreview('.',()=>{},f.worker,'piper');try{const id=output.start().sessionId;expect((await output.next(id,0)).rate).toBe(22050);expect(output.snapshot().localEngine).toBe('piper');}finally{await output.stop();}
});


test('preparation timeout is readable without exposing private worker errors',async()=>{
 const f=fixture();f.worker.start=async()=>{throw new LocalVoiceStartupTimeout();};await expect(f.output.prepare()).rejects.toThrow();
 expect(f.output.snapshot()).toMatchObject({state:'ERROR',error:'Local voice preparation exceeded 60 seconds and was stopped. Try again or select Piper.'});
});
