import {test,expect} from 'vitest';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {VoiceConnectionStore} from '../core/voice-connection-store.ts';
import {validateVoiceConnection} from '../packages/contracts/voice-connection.ts';
const fixture={region:'eastus',key:'fixture_not_a_real_secret',voice:'en-AU-NatashaNeural' as const};
test('speech credentials never round-trip through status or plaintext storage',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-speech-')),path=join(dir,'speech.enc'),key=randomBytes(32);
 const cipher={available:async()=>true,encrypt:async(text:string)=>{const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);const body=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),body]);},decrypt:async(bytes:Buffer)=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString();}};
 try{
  const store=new VoiceConnectionStore(path,cipher);expect((await store.status()).configured).toBe(false);await store.save(fixture);
  expect(await store.status()).toEqual({configured:true,region:'eastus',voice:fixture.voice});expect(JSON.stringify(await store.status())).not.toContain(fixture.key);expect((await readFile(path)).includes(Buffer.from(fixture.key))).toBe(false);
  expect(await store.read()).toEqual(fixture);cipher.available=async()=>false;await expect(store.save(fixture)).rejects.toThrow('unavailable');cipher.available=async()=>true;
  await store.clear();expect(await store.read()).toBeNull();
 }finally{await unlink(path).catch(()=>{});await rmdir(dir);}
});
test('speech connection schema refuses arbitrary hosts, extra fields and unreviewed voices',()=>{
 for(const value of [{...fixture,region:'eastus.evil.test'},{...fixture,key:'short'},{...fixture,voice:'male'},{...fixture,endpoint:'https://elsewhere.test'}])expect(()=>validateVoiceConnection(value)).toThrow();
});
