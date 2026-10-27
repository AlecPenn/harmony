import {test,expect,vi} from 'vitest';
import {PassThrough} from 'node:stream';import {EventEmitter} from 'node:events';import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {LocalVoice} from '../core/local-voice.ts';
function fixture(){const events=new EventEmitter();const child=Object.assign(events,{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),exitCode:null as number|null,signalCode:null,kill(){this.exitCode=0;queueMicrotask(()=>events.emit('close',0));return true;}});const voice=new LocalVoice('.',()=>child as unknown as ChildProcessWithoutNullStreams);const send=(v:unknown)=>child.stdout.write(JSON.stringify(v)+'\n');return {voice,child,send};}
async function ready(f:ReturnType<typeof fixture>){const p=f.voice.start();f.send({type:'ready',rate:24000,warmup_ms:5});return (await p).session;}
test('resident local worker requires warmup and serves multiple isolated requests',async()=>{const f=fixture();try{const session=await ready(f);for(let id=0;id<2;id++){const stream=f.voice.speak(session,'Hello');const next=stream.next();f.send({type:'pcm',id,seq:0,rate:24000,pcm:'AQA='});expect((await next).value).toEqual(new Int16Array([1]));f.send({type:'done',id,chunks:1});expect((await stream.next()).done).toBe(true);expect(f.voice.ready).toBe(true);}}finally{await f.voice.stop();}expect(f.voice.active).toBe(false);});
test('STOP rejects pending audio and invalidates session handles',async()=>{const f=fixture();const session=await ready(f),stream=f.voice.speak(session,'Hello'),pending=stream.next();const rejected=expect(pending).rejects.toThrow();await f.voice.stop();await rejected;expect(f.voice.ready).toBe(false);await expect(f.voice.speak(session,'Late').next()).rejects.toThrow();});
test('bad readiness and malformed PCM fail closed and terminate worker',async()=>{const f=fixture();const pending=f.voice.start();f.send({type:'ready',rate:44100,warmup_ms:1});await expect(pending).rejects.toThrow();expect(f.voice.active).toBe(false);const g=fixture();const session=await ready(g);const next=g.voice.speak(session,'Hi').next();g.send({type:'pcm',id:0,seq:8,rate:24000,pcm:'AQA='});await expect(next).rejects.toThrow();expect(g.voice.active).toBe(false);});
test('consumer abandonment stops the resident worker instead of retaining queued speech',async()=>{const f=fixture(),session=await ready(f),stream=f.voice.speak(session,'Hi'),next=stream.next();f.send({type:'pcm',id:0,seq:0,rate:24000,pcm:'AQA='});await next;await stream.return(undefined);expect(f.voice.active).toBe(false);});

test('abandoning an old iterator cannot stop a restarted voice session',async()=>{
 const a=fixture(),b=fixture();let launches=0;const voice=new LocalVoice('.',()=>[a.child,b.child][launches++] as unknown as ChildProcessWithoutNullStreams);
 const first=voice.start();a.send({type:'ready',rate:24000,warmup_ms:1});const old=voice.speak((await first).session,'Old'),next=old.next();a.send({type:'pcm',id:0,seq:0,rate:24000,pcm:'AQA='});await next;await voice.stop();
 const second=voice.start();b.send({type:'ready',rate:24000,warmup_ms:1});await second;await old.return(undefined);expect(voice.ready).toBe(true);await voice.stop();
});

test('late old-stream reads and child errors cannot consume or cancel new audio',async()=>{
 const a=fixture(),b=fixture();let launches=0;const voice=new LocalVoice('.',()=>[a.child,b.child][launches++] as unknown as ChildProcessWithoutNullStreams);
 const first=voice.start();a.send({type:'ready',rate:24000,warmup_ms:1});const old=voice.speak((await first).session,'Old'),next=old.next();a.send({type:'pcm',id:0,seq:0,rate:24000,pcm:'AQA='});await next;await voice.stop();
 const second=voice.start();b.send({type:'ready',rate:24000,warmup_ms:1});const session=(await second).session;
 a.child.emit('error',new Error('Late old error'));await expect(old.next()).rejects.toThrow();expect(voice.ready).toBe(true);
 const current=voice.speak(session,'New'),audio=current.next();b.send({type:'pcm',id:0,seq:0,rate:24000,pcm:'AgA='});expect((await audio).value).toEqual(new Int16Array([2]));await current.return(undefined);
});


test('unexpected resident exit clears readiness and permits a clean restart',async()=>{
 const a=fixture(),b=fixture();let launches=0,exits=0;const voice=new LocalVoice('.',()=>[a.child,b.child][launches++] as unknown as ChildProcessWithoutNullStreams,()=>{exits++;});
 const first=voice.start();a.send({type:'ready',rate:24000,warmup_ms:1});const old=(await first).session;
 a.child.exitCode=1;a.child.stdout.end();a.child.emit('close',1);expect(voice.ready).toBe(false);expect(voice.active).toBe(false);expect(exits).toBe(1);
 const second=voice.start();b.send({type:'ready',rate:24000,warmup_ms:1});await second;a.child.emit('close',1);expect(voice.ready).toBe(true);await expect(voice.speak(old,'stale').next()).rejects.toThrow();await voice.stop();expect(exits).toBe(1);
});


test('Piper supervisor accepts its pinned native rate and rejects mislabeled PCM',async()=>{
 const f=fixture(),voice=new LocalVoice('.',()=>f.child as unknown as ChildProcessWithoutNullStreams,()=>{},22050);
 const started=voice.start();f.send({type:'ready',rate:22050,warmup_ms:1});const session=(await started).session;
 const stream=voice.speak(session,'Hi'),pending=stream.next();f.send({type:'pcm',id:0,seq:0,rate:24000,pcm:'AQA='});await expect(pending).rejects.toThrow();expect(voice.active).toBe(false);
});


test('startup deadline reports a bounded diagnostic and verifies worker exit',async()=>{
 vi.useFakeTimers();const f=fixture();try{
  const rejected=expect(f.voice.start()).rejects.toThrow('startup exceeded 60 seconds');
  await vi.advanceTimersByTimeAsync(60000);await rejected;expect(f.voice.active).toBe(false);expect(f.voice.ready).toBe(false);
 }finally{await f.voice.stop();vi.useRealTimers();}
});


test('bounded preparation stages precede readiness and cannot extend the deadline',async()=>{
 vi.useFakeTimers();const f=fixture();const stages:unknown[]=[];const voice=new LocalVoice('.',()=>f.child as unknown as ChildProcessWithoutNullStreams,()=>{},24000,p=>stages.push(p),()=>Date.now());
 try{
  const rejected=expect(voice.start()).rejects.toThrow('startup exceeded 60 seconds');
  f.send({type:'preparing',stage:'model',elapsed_ms:0});await vi.advanceTimersByTimeAsync(40000);
  f.send({type:'preparing',stage:'acknowledgements',elapsed_ms:40000});await vi.advanceTimersByTimeAsync(20000);await rejected;
  expect(stages).toEqual([{stage:'model',elapsedMs:0},{stage:'acknowledgements',elapsedMs:40000}]);expect(voice.active).toBe(false);
 }finally{await voice.stop();vi.useRealTimers();}
});
test('invalid or repeated preparation stages fail closed',async()=>{
 for(const frame of [{stage:'unknown',elapsed_ms:1},{stage:'model',elapsed_ms:2},{stage:'warmup',elapsed_ms:-1}]){
  const f=fixture();const rejected=expect(f.voice.start()).rejects.toThrow();f.send({type:'preparing',stage:'model',elapsed_ms:0});f.send({type:'preparing',...frame});await rejected;expect(f.voice.active).toBe(false);
 }
});
test('an unpronounceable phrase returns no audio and the worker stays ready for the next phrase',async()=>{const f=fixture();try{const session=await ready(f);
 const empty=f.voice.speak(session,'~');const done=empty.next();f.send({type:'done',id:0,chunks:0});expect((await done).done).toBe(true);expect(f.voice.ready).toBe(true);expect(f.voice.active).toBe(true);
 const next=f.voice.speak(session,'Hello');const first=next.next();f.send({type:'pcm',id:1,seq:0,rate:24000,pcm:'AQA='});expect((await first).value).toEqual(new Int16Array([1]));f.send({type:'done',id:1,chunks:1});expect((await next.next()).done).toBe(true);
 // A done count that does not match what was sent is still rejected.
 const bad=f.voice.speak(session,'Hi');const b=bad.next();f.send({type:'pcm',id:2,seq:0,rate:24000,pcm:'AQA='});await b;const end=bad.next();f.send({type:'done',id:2,chunks:0});await expect(end).rejects.toThrow();
}finally{await f.voice.stop();}});
