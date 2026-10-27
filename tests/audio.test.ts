import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAudioFrame, audioPermission } from '../packages/contracts/audio.ts';
import { SpeechWorker } from '../core/speech-worker.ts';

test('audio boundary rejects malformed or unbounded frames and media requests outside the exact audio grant',()=>{
  validateAudioFrame({sessionId:'test',sequence:0,samples:new Int16Array(512)});
  // Batches of whole frames (up to 32) let a busy PC catch up in one trip; partial or oversized batches are refused.
  validateAudioFrame({sessionId:'test',sequence:5,samples:new Int16Array(512*32)});
  for(const n of [0,512*33,512*3+1,256])assert.throws(()=>validateAudioFrame({sessionId:'x',sequence:0,samples:new Int16Array(n)}));
  for(const value of [null,{}, {sessionId:'x',sequence:0,samples:new Float32Array(512)}, {sessionId:'x',sequence:-1,samples:new Int16Array(512)}, {sessionId:'x',sequence:0,samples:new Int16Array(513)}])assert.throws(()=>validateAudioFrame(value));
  assert.equal(audioPermission(true,true,true,true,['audio']),true);
  for(const args of [[false,true,true,true,['audio']],[true,false,true,true,['audio']],[true,true,false,true,['audio']],[true,true,true,false,['audio']],[true,true,true,true,['audio','video']],[true,true,true,true,['video']]] as const)assert.equal(audioPermission(args[0],args[1],args[2],args[3],args[4]),false);
});

test.skipIf(!existsSync(resolve('data/models/whisper-base.en/model.bin')))('actual local speech worker starts, acknowledges bounded PCM, rejects stale sessions and releases on STOP',async()=>{
  const worker=new SpeechWorker(resolve('.'));
  try{
    const {sessionId}=await worker.start();
    assert.equal(worker.snapshot().state,'READY');
    for(let sequence=0;sequence<12;sequence++)await worker.push({sessionId,sequence,samples:new Int16Array(512)});
    assert.equal(worker.snapshot().receivedFrames,12);
    assert.ok(worker.snapshot().vadMs!==null);
    assert.equal(worker.snapshot().transcript,'');
    await assert.rejects(worker.push({sessionId,sequence:0,samples:new Int16Array(512)}));
    await worker.stop();assert.equal(worker.snapshot().state,'OFF');
    await assert.rejects(worker.push({sessionId,sequence:12,samples:new Int16Array(512)}));
  }finally{await worker.stop();}
},45000);


test('AudioWorklet refuses unbounded delivery when the consumer stops acknowledging', async()=>{
  const { readFileSync }=await import('node:fs');const { runInNewContext }=await import('node:vm');
  const messages:any[]=[];let Processor:any;
  class Base {port={onmessage:null as any,postMessage:(message:any)=>messages.push(message)};}
  runInNewContext(readFileSync(resolve('apps/desktop/src/capture-worklet.js'),'utf8'),{AudioWorkletProcessor:Base,registerProcessor:(_name:string,ctor:any)=>{Processor=ctor;},Int16Array,Math,Number});
  const capture=new Processor();
  for(let i=0;i<96;i++)assert.equal(capture.process([[new Float32Array(512)]]),true);
  assert.equal(messages.length,96);
  assert.equal(capture.process([[new Float32Array(512)]]),false);
  assert.equal(messages.at(-1).overflow,true);
});


test.skipIf(!existsSync(resolve('data/models/vosk-model-small-en-us-0.15/am/final.mdl')))('wake-only worker processes silence without identity or transcripts and unloads',async()=>{
  const worker=new SpeechWorker(resolve('.'));
  try{
    const {sessionId}=await worker.start('wake');
    for(let sequence=0;sequence<12;sequence++)await worker.push({sessionId,sequence,samples:new Int16Array(512)});
    assert.equal(worker.snapshot().mode,'wake');assert.equal(worker.snapshot().wakeCount,0);
    assert.equal(worker.snapshot().transcript,'');
    await worker.stop();assert.equal(worker.snapshot().mode,null);
  }finally{await worker.stop();}
},45000);
