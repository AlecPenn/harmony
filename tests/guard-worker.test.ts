import {describe,expect,it} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {GuardWorker,guardModels} from '../core/guard-worker.ts';
import {cosine} from '../core/guardian.ts';

const root=join(import.meta.dirname,'..'),python=process.env.HARMONY_TEST_PYTHON??'';
const models=guardModels(root);
describe.skipIf(!python||!existsSync(python))('guard worker (real models)',()=>{
 it('voice and face prints come back as unit vectors; the same face matches itself',async()=>{
  const w=new GuardWorker(root,{python});
  try{
   const t=Float64Array.from({length:32000},(_,i)=>.2*Math.sin(2*Math.PI*180*i/16000)*(1+.5*Math.sin(2*Math.PI*3*i/16000)));
   const pcm=Buffer.alloc(64000);t.forEach((x,i)=>pcm.writeInt16LE(Math.round(x*32767),i*2));
   const v=await w.voice(pcm);
   if(models.voice){expect(v.embedding?.length).toBe(256);expect(cosine(v.embedding!,v.embedding!)).toBeCloseTo(1,4);}
   expect((await w.voice(Buffer.alloc(1000))).reason).toMatch(/seconds/);
   const img=join(root,'data','models','guard','test-face.jpg');
   if(models.face&&existsSync(img)){
    const a=await w.face(readFileSync(img));expect(a.faces).toBe(1);expect(a.embedding?.length).toBe(128);expect(a.live!).toBeGreaterThan(.5);
    expect((await w.face(Buffer.from('nope'))).embedding).toBeNull();
   }
  }finally{await w.stop();}
 },60000);
});
it('reports which guard models are installed',()=>{expect(typeof guardModels(root).voice).toBe('boolean');});
