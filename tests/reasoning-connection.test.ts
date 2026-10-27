import {test,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {ReasoningConnectionStore} from '../core/reasoning-connection-store.ts';
import {validateReasoningConnection} from '../packages/contracts/reasoning-connection.ts';
const fixture={key:'fixture_not_a_real_secret'};
function cipher(){const key=randomBytes(32);return {available:async()=>true,encrypt:async(text:string)=>{const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);const body=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),body]);},decrypt:async(bytes:Buffer)=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString();}};}
test('reasoning credentials stay encrypted and status never claims verified account access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-reasoning-')),path=join(dir,'reasoning.enc'),c=cipher();
 try{
  const store=new ReasoningConnectionStore(path,c);expect((await store.status()).configured).toBe(false);
  await store.save(fixture);expect(await store.status()).toEqual({configured:true,model:'gpt-6-astra',verified:false});
  expect((await readFile(path)).includes(Buffer.from(fixture.key))).toBe(false);expect(await store.read()).toEqual(fixture);
  await store.clear();expect(await store.read()).toBeNull();
 }finally{await unlink(path).catch(()=>{});await rmdir(dir);}
});
test('unavailable protection, corruption and oversized settings fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-reasoning-')),path=join(dir,'reasoning.enc'),c=cipher();
 try{
  const store=new ReasoningConnectionStore(path,c);c.available=async()=>false;await expect(store.save(fixture)).rejects.toThrow('unavailable');
  c.available=async()=>true;await writeFile(path,Buffer.alloc(8193));await expect(store.read()).rejects.toThrow('could not be read');
  await writeFile(path,Buffer.from('corrupt'));await expect(store.status()).rejects.toThrow('could not be read');
  await store.save(fixture);expect((await store.status()).configured).toBe(true);
 }finally{await unlink(path).catch(()=>{});await rmdir(dir);}
});
test('queued save snapshots inputs and deletion cannot race a pending write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-reasoning-')),path=join(dir,'reasoning.enc');
 try{
  const store=new ReasoningConnectionStore(path,cipher()),input={...fixture};const save=store.save(input);input.key='changed_fixture_secret';await save;expect(await store.read()).toEqual(fixture);
  const saved=store.save(fixture),cleared=store.clear();await Promise.all([saved,cleared]);expect(await store.read()).toBeNull();
 }finally{await unlink(path).catch(()=>{});await rmdir(dir);}
});
test('connection settings cannot select hosts, models or supply additional fields',()=>{
 for(const value of [{key:'short'},{...fixture,endpoint:'https://elsewhere.test'},{...fixture,model:'other'},{key:'x'.repeat(513)},{key:'fixture_secret\nheader'}])expect(()=>validateReasoningConnection(value)).toThrow();
});
