import {test,expect} from 'vitest';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {VoiceOutput} from '../core/voice-output.ts';
import {validatePreset,validateVoiceRequest} from '../packages/contracts/voice-output.ts';
const credentials={region:'eastus',key:'fixture_not_a_real_key',voice:'en-AU-NatashaNeural' as const};
function fixture(){
  const events=new EventEmitter();
  const child=Object.assign(events,{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),exitCode:null as number|null,signalCode:null,kill(){this.exitCode=0;this.stdout.destroy();queueMicrotask(()=>events.emit('close',0));return true;}});
  const output=new VoiceOutput('.',()=>{},()=>child as unknown as ChildProcessWithoutNullStreams);
  const send=(value:unknown)=>child.stdout.write(JSON.stringify(value)+'\n');
  const pcm=(seq=0)=>({type:'pcm',seq,rate:24000,pcm:Buffer.from([0,0,255,127,0,128]).toString('base64')});
  return {output,send,pcm};
}
test('voice requests accept only pacing choices and scoped session sequences',()=>{
  for(const value of ['natural','relaxed','brisk'])expect(()=>validatePreset(value)).not.toThrow();
  for(const value of ['en-US',null,{text:'private'},'natural; command'])expect(()=>validatePreset(value)).toThrow();
  for(const [id,sequence] of [['../path',0],['00000000-0000-0000-0000-000000000000',-1],['00000000-0000-0000-0000-000000000000',NaN]])expect(()=>validateVoiceRequest(id,sequence)).toThrow();
});
test('PCM is delivered incrementally with separate first-audio and playback metrics',async()=>{
 const {output,send,pcm}=fixture();const {sessionId}=output.start('natural',credentials);
 try{
  const pending=output.next(sessionId,0);send(pcm());const chunk=await pending;
  expect([...chunk.samples]).toEqual([0,32767,-32768]);expect(output.trace()!.metrics.tts_first_audio_ms.state).toBe('completed');expect(output.trace()!.metrics.ui_reaction_ms.ms).toBeNull();expect(output.snapshot().tts_first_audio_ms).not.toBeNull();expect(output.snapshot().playback_start_ms).toBeNull();
  output.playback(sessionId,false);expect(output.snapshot().state).toBe('PLAYING');
  const final=output.next(sessionId,1);send({type:'done',chunks:1});expect((await final).done).toBe(true);
 }finally{await output.stop();}
});
test('STOP kills pending synthesis and invalidates old audio and playback acknowledgements',async()=>{
 const {output}=fixture();const {sessionId}=output.start('relaxed',credentials);const pending=output.next(sessionId,0);const rejected=expect(pending).rejects.toThrow();await output.stop();await rejected;
 expect(output.active).toBe(false);expect(output.snapshot().state).toBe('CANCELLED');expect(output.trace()!.state).toBe('cancelled');expect(output.trace()!.metrics.full_turn_ms.ms).not.toBeNull();
 await expect(output.next(sessionId,0)).rejects.toThrow();expect(()=>output.playback(sessionId,false)).toThrow();
});
test('malformed audio and out-of-order worker output fail closed',async()=>{
 for(const data of [{type:'pcm',seq:1,rate:24000,pcm:'AAAA'}, {type:'pcm',seq:0,rate:48000,pcm:'AAAA'},{type:'pcm',seq:0,rate:24000,pcm:'!!!!'},{type:'done',chunks:0}]){
  const {output,send}=fixture();const {sessionId}=output.start('natural',credentials);const pending=output.next(sessionId,0);send(data);await expect(pending).rejects.toThrow();expect(output.snapshot().state).toBe('ERROR');expect(output.active).toBe(false);
 }
});
test('parallel reads and duplicate starts cannot create an unbounded voice queue',async()=>{
 const {output}=fixture();const {sessionId}=output.start('natural',credentials);expect(()=>output.start('brisk',credentials)).toThrow();const first=output.next(sessionId,0);const rejection=expect(first).rejects.toThrow();await expect(output.next(sessionId,0)).rejects.toThrow();await output.stop();await rejection;
});

test('resume stays gated until voice shutdown is verified',async()=>{
  const {Runtime}=await import('../core/runtime.ts');
  let release!:()=>void;let active=true;
  const output={get active(){return active;},snapshot:()=>({state:'CANCELLED',preset:'natural',tts_first_audio_ms:null,playback_start_ms:null,error:null}),stop:()=>new Promise<void>(resolve=>{release=()=>{active=false;resolve();};})};
  const runtime=new Runtime(':memory:',{state:'OFF',async check(){},async stop(){}},undefined,undefined,output as unknown as VoiceOutput);runtime.boot();
  const stopping=runtime.stop();await new Promise(resolve=>setImmediate(resolve));
  expect(runtime.snapshot().stopping).toBe(true);expect(()=>runtime.resume()).toThrow();release();await stopping;
  expect(runtime.snapshot().stopping).toBe(false);expect(()=>runtime.resume()).not.toThrow();
  output.stop=async()=>{};await runtime.close();
});

test('synchronous launch failure clears the session and records failed latency',()=>{
 const output=new VoiceOutput('.',()=>{},()=>{throw new Error('fixture launch failure');});
 expect(()=>output.start('natural',credentials)).toThrow();expect(output.active).toBe(false);expect(output.trace()!.state).toBe('failed');expect(output.trace()!.metrics.tts_first_audio_ms.state).toBe('failed');
});
