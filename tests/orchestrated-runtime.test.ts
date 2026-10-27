import {test,expect} from 'vitest';
import {Runtime} from '../core/runtime.ts';
import type {ReadOnlyFiles} from '../packages/files/read-only.ts';
function runtime(){const r=new Runtime(':memory:',{state:'OFF',async check(){},async stop(){}});r.boot();return r;}
test('runtime returns a selected-file result only after independent verification',async()=>{
 const r=runtime();let reads=0;const files={readText:async()=>{reads++;return {text:'fixture',bytes:7};}} as unknown as ReadOnlyFiles;
 try{expect(await r.previewFile(files,'note.txt')).toEqual({text:'fixture',bytes:7});expect(reads).toBe(2);expect(r.snapshot().actions?.[0]).toMatchObject({tool:'files.preview',state:'SUCCEEDED'});expect(r.snapshot().system).toBe('PASSIVE');}finally{await r.close();}
});
test('runtime withholds a file whose verification disagrees and reports failed action',async()=>{
 const r=runtime();let reads=0;const files={readText:async()=>({text:++reads===1?'first':'other',bytes:5})} as unknown as ReadOnlyFiles;
 try{await expect(r.previewFile(files,'note.txt')).rejects.toThrow();expect(reads).toBe(2);expect(r.snapshot().actions?.[0].state).toBe('FAILED');}finally{await r.close();}
});
test('runtime STOP awaits an uncooperative read and prevents resume or late result delivery',async()=>{
 const r=runtime();let release!:(result:{text:string;bytes:number})=>void;const files={readText:()=>new Promise(resolve=>{release=resolve;})} as unknown as ReadOnlyFiles;
 try{
  const task=r.previewFile(files,'note.txt'),rejected=expect(task).rejects.toThrow();await new Promise(resolve=>setImmediate(resolve));
  const stopping=r.stop();expect(()=>r.resume()).toThrow();expect(()=>r.inspectComputer()).toThrow();release({text:'late',bytes:4});await rejected;await stopping;
  expect(r.snapshot()).toMatchObject({system:'STOPPED',stopping:false,shutdownFailed:false});expect(r.snapshot().actions?.[0].state).toBe('CANCELLED');r.resume();expect(r.snapshot().system).toBe('PASSIVE');
 }finally{await r.close();}
});
