import {test,expect} from 'vitest';
import {SpeechOutputs} from '../core/speech-outputs.ts';
import {LocalVoicePreview} from '../core/local-voice-preview.ts';
function fixture(){
 const created:string[]=[],workers:{active:boolean;ready:boolean;stop():Promise<void>}[]=[];
 const outputs=new SpeechOutputs('.',()=>{},engine=>{
  created.push(engine);const worker={active:false,ready:false,async start(){this.active=true;this.ready=true;return {session:engine,warmupMs:1};},async*speak(){yield new Int16Array([1]);},async stop(){this.active=false;this.ready=false;}};
  workers.push(worker);return new LocalVoicePreview('.',()=>{},worker,engine);
 });return {outputs,created,workers};
}
test('engine switching requires unloading the resident worker and keeps generation increasing',async()=>{
 const f=fixture();try{
  await f.outputs.prepareLocal('kokoro');const before=f.outputs.generation;
  expect(()=>f.outputs.startLocal('piper')).toThrow();expect(f.created).toEqual(['kokoro']);
  await f.outputs.stop();expect(f.workers[0].active).toBe(false);const stopped=f.outputs.generation;expect(stopped).toBeGreaterThan(before);
  await f.outputs.prepareLocal('piper');expect(f.outputs.generation).toBeGreaterThan(stopped);expect(f.outputs.snapshot()).toMatchObject({state:'READY',localEngine:'piper'});expect(f.created).toEqual(['kokoro','piper']);
 }finally{await f.outputs.stop();}
});
test('old engine playback handles cannot consume new native-rate speech',async()=>{
 const f=fixture();try{
  const old=f.outputs.startLocal('kokoro').sessionId;await f.outputs.next(old,0);await f.outputs.stop();
  const current=f.outputs.startLocal('piper').sessionId;await expect(f.outputs.next(old,1)).rejects.toThrow();expect((await f.outputs.next(current,0)).rate).toBe(22050);
 }finally{await f.outputs.stop();}
});
test('unverified worker shutdown cannot be bypassed by selecting another engine',async()=>{
 const f=fixture();await f.outputs.prepareLocal('kokoro');const stop=f.workers[0].stop.bind(f.workers[0]);f.workers[0].stop=async()=>{throw new Error('fixture');};
 await expect(f.outputs.stop()).rejects.toThrow('unverified');expect(()=>f.outputs.startLocal('piper')).toThrow();expect(f.created).toEqual(['kokoro']);f.workers[0].stop=stop;await f.outputs.stop();
});
