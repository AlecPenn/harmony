import {test,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadOnlyFiles,relativeParts} from '../packages/files/read-only.ts';
test('relative file inputs reject traversal, alternate streams, hidden credentials and device names',()=>{
 for(const path of ['../secret','a/../b','/absolute','C:\\secret','C:secret','a:stream','\\\\server\\share','a//b','.env','folder/.git/config','credentials/key','CON.txt','nested/LPT1','name.','name ','CREDE~1/key'])expect(()=>relativeParts(path)).toThrow();
 expect(relativeParts('project/notes.txt')).toEqual(['project','notes.txt']);
});
test('text reads require an explicit root and reject oversized, binary and revoked access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-files-'));
 try{
  await writeFile(join(dir,'note.txt'),'fixture content');await writeFile(join(dir,'large.txt'),'a'.repeat(131073));await writeFile(join(dir,'binary.txt'),Buffer.from([255,0]));
  const files=new ReadOnlyFiles(),signal=new AbortController().signal;
  await expect(files.readText('work','note.txt',signal)).rejects.toThrow('approved');await files.addRoot('work',dir);
  expect(await files.readText('work','note.txt',signal)).toEqual({text:'fixture content',bytes:15});
  await expect(files.readText('work','large.txt',signal)).rejects.toThrow('limit');await expect(files.readText('work','binary.txt',signal)).rejects.toThrow();
  files.revokeRoot('work');await expect(files.readText('work','note.txt',signal)).rejects.toThrow('approved');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('junctions cannot lead a read outside the approved directory',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-link-'));
 try{
  const root=join(dir,'root'),outside=join(dir,'outside');await mkdir(root);await mkdir(outside);await writeFile(join(outside,'private.txt'),'outside fixture');
  await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');
  const files=new ReadOnlyFiles();await files.addRoot('work',root);await expect(files.readText('work','linked/private.txt',new AbortController().signal)).rejects.toThrow('Links');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('cancellation and revocation during a pending read do not release text',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-cancel-read-'));
 try{
  await writeFile(join(dir,'note.txt'),'fixture');const files=new ReadOnlyFiles();await files.addRoot('work',dir);
  const controller=new AbortController(),pending=files.readText('work','note.txt',controller.signal),rejected=expect(pending).rejects.toThrow();controller.abort();await rejected;
  const second=files.readText('work','note.txt',new AbortController().signal),revoked=expect(second).rejects.toThrow();files.revokeRoot('work');await revoked;
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('root registration is bounded even when requests arrive concurrently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-root-limit-'));
 try{
  const files=new ReadOnlyFiles();const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>files.addRoot('root_'+i,dir)));
  expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(8);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('simultaneous reads stay bounded without losing completed data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-read-limit-'));
 try{
  await writeFile(join(dir,'note.txt'),'fixture');const files=new ReadOnlyFiles();await files.addRoot('work',dir);
  const pending=Array.from({length:4},()=>files.readText('work','note.txt',new AbortController().signal));
  await expect(files.readText('work','note.txt',new AbortController().signal)).rejects.toThrow('Too many');
  expect((await Promise.all(pending)).every(r=>r.text==='fixture')).toBe(true);
  expect((await files.readText('work','note.txt',new AbortController().signal)).text).toBe('fixture');
 }finally{await rm(dir,{recursive:true,force:true});}
});
