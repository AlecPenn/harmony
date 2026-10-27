import {test,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,readdir,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {ProfileVault,type ProfileCipher} from '../packages/identity/vault.ts';
import {validateProfiles} from '../packages/identity/validate.ts';
const fixture=()=>({id:'owner_fixture',displayName:'Private fixture',role:'OWNER',modelId:'fixture-model',stableEmbeddings:[[1,0],[1,.1],[1,-.1]],trustedRecentEmbeddings:[],permissions:[],memoryNamespace:'owner_memory',settings:{},enrolledAt:1,lastCalibration:0});
function cipher():ProfileCipher{
  const key=randomBytes(32);
  return {available:async()=>true,encrypt:async text=>{const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);const data=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),data]);},decrypt:async bytes=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString('utf8');}};
}
test('vault persists encrypted profiles, clones queued values and leaves no plaintext temporary',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-vault-'));try{
  const path=join(dir,'profiles.enc'),vault=new ProfileVault(path,cipher());const p=fixture();const writing=vault.replace([p]);p.displayName='Changed after write queued';await writing;
  expect((await vault.read())[0].displayName).toBe('Private fixture');
  expect((await readFile(path)).includes(Buffer.from('Private fixture'))).toBe(false);
  expect(await readdir(dir)).toEqual(['profiles.enc']);
  await vault.replace([]);expect(await vault.read()).toEqual([]);
 }finally{await unlink(join(dir,'profiles.enc')).catch(()=>{});await rmdir(dir);}
});
test('corruption and unavailable encryption preserve the prior vault',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'harmony-vault-'));try{
  const path=join(dir,'profiles.enc'),crypt=cipher(),vault=new ProfileVault(path,crypt);await vault.replace([fixture()]);
  crypt.available=async()=>false;const original=await readFile(path);await expect(vault.replace([])).rejects.toThrow('unavailable');expect(await readFile(path)).toEqual(original);
  crypt.available=async()=>true;await writeFile(path,'corrupted');await expect(vault.replace([])).rejects.toThrow('preserved');expect((await readFile(path)).toString()).toBe('corrupted');
 }finally{await unlink(join(dir,'profiles.enc')).catch(()=>{});await rmdir(dir);}
});
test('profile validation rejects role escalation fields, duplicate memory namespaces and bad templates',()=>{
 const p=fixture();for(const value of [[{...p,role:'ADMIN'}],[{...p,rawAudio:'secret'}],[p,{...p,id:'other'}],[{...p,stableEmbeddings:[[0,0],[0,0],[0,0]]}]])expect(()=>validateProfiles(value)).toThrow();
});
