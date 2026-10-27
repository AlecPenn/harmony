import {test,expect} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {ProfileVault,type ProfileCipher} from '../packages/identity/vault.ts';
import {HouseholdEnrollment,enrollmentConditions} from '../packages/identity/enrollment.ts';
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'harmony-enroll-')),key=randomBytes(32),path=join(dir,'profiles.enc');
  const cipher:ProfileCipher={available:async()=>true,encrypt:async text=>{const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);const bytes=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),bytes]);},decrypt:async bytes=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString('utf8');}};
  let allowed=true,now=1000;const vault=new ProfileVault(path,cipher),authority={allowed:()=>allowed};
  const enrollment=new HouseholdEnrollment(vault,authority,'fixture-model',2,()=>now);
  return {dir,path,cipher,vault,enrollment,authority,setAllowed:(v:boolean)=>{allowed=v;},setTime:(v:number)=>{now=v;},cleanup:()=>rm(dir,{recursive:true,force:true})};
}
const request={displayName:'Fixture Person',role:'GUEST' as const,consent:true as const};
function samples(e:HouseholdEnrollment,id:string){enrollmentConditions.forEach((condition,index)=>e.add(id,condition,'fixture-model',[1,index/10],'sufficient'));}
test('enrollment requires consent, trusted admin approval and an expiring session',async()=>{
 const f=await fixture();try{
  f.setAllowed(false);expect(()=>f.enrollment.begin(request)).toThrow();f.setAllowed(true);
  expect(()=>f.enrollment.begin({...request,consent:false} as any)).toThrow();
  const s=f.enrollment.begin(request);expect(()=>f.enrollment.begin(request)).toThrow();
  f.setTime(s.expiresAt);expect(()=>f.enrollment.progress(s.sessionId)).toThrow();
  expect(await f.vault.read()).toEqual([]);
 }finally{await f.cleanup();}
});
test('varied enrollment persists only encrypted templates with no permissions or calibration',async()=>{
 const f=await fixture();try{
  const s=f.enrollment.begin(request);samples(f.enrollment,s.sessionId);
  const saved=await f.enrollment.finish(s.sessionId),profiles=await f.vault.read();
  expect(saved.calibrationRequired).toBe(true);expect(profiles).toHaveLength(1);
  expect(profiles[0]).toMatchObject({permissions:[],lastCalibration:0,trustedRecentEmbeddings:[],role:'GUEST'});
  expect(profiles[0].stableEmbeddings).toHaveLength(5);
  expect((await readFile(f.path)).includes(Buffer.from(request.displayName))).toBe(false);
  expect(await readdir(f.dir)).toEqual(['profiles.enc']);
  expect(()=>f.enrollment.progress(s.sessionId)).toThrow();
  f.setAllowed(false);await expect(f.enrollment.remove(saved.profileId)).rejects.toThrow();
  f.setAllowed(true);await f.enrollment.remove(saved.profileId);expect(await f.vault.read()).toEqual([]);
 }finally{await f.cleanup();}
});
test('bad quality, wrong model, repeated observations and incomplete collections are rejected',async()=>{
 const f=await fixture();try{
  const {sessionId:id}=f.enrollment.begin(request);
  expect(()=>f.enrollment.add(id,'normal','other',[1,0],'sufficient')).toThrow();
  expect(()=>f.enrollment.add(id,'normal','fixture-model',[1,0],'insufficient')).toThrow();
  expect(()=>f.enrollment.add(id,'normal','fixture-model',[NaN,0],'sufficient')).toThrow();
  f.enrollment.add(id,'normal','fixture-model',[1,0],'sufficient');
  expect(()=>f.enrollment.add(id,'quiet','fixture-model',[2,0],'sufficient')).toThrow();
  await expect(f.enrollment.finish(id)).rejects.toThrow();
  f.enrollment.cancel();expect(()=>f.enrollment.add(id,'far','fixture-model',[1,.1],'sufficient')).toThrow();
  expect(await f.vault.read()).toEqual([]);
 }finally{await f.cleanup();}
});
test('STOP during encryption prevents commit and cleans the encrypted temporary',async()=>{
 const f=await fixture();try{
  let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;}),encrypt=f.cipher.encrypt;
  f.cipher.encrypt=async text=>{entered();await gate;return encrypt(text);};
  const {sessionId}=f.enrollment.begin(request);samples(f.enrollment,sessionId);
  const pending=f.enrollment.finish(sessionId),rejected=expect(pending).rejects.toThrow('cancelled');
  await ready;f.enrollment.cancel();release();await rejected;
  expect(await f.vault.read()).toEqual([]);expect(await readdir(f.dir)).toEqual([]);
 }finally{await f.cleanup();}
});
test('simultaneous enrollment writers preserve both people with distinct memory namespaces',async()=>{
 const f=await fixture();try{
  const second=new HouseholdEnrollment(f.vault,f.authority,'fixture-model',2,()=>1000);
  const a=f.enrollment.begin(request),b=second.begin({...request,displayName:'Second fixture'});
  samples(f.enrollment,a.sessionId);samples(second,b.sessionId);
  await Promise.all([f.enrollment.finish(a.sessionId),second.finish(b.sessionId)]);
  const profiles=await f.vault.read();expect(profiles).toHaveLength(2);expect(new Set(profiles.map(p=>p.memoryNamespace)).size).toBe(2);
 }finally{await f.cleanup();}
});

test('revoking admin approval during encryption prevents a pending enrollment commit',async()=>{
 const f=await fixture();try{
  let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;}),encrypt=f.cipher.encrypt;
  f.cipher.encrypt=async text=>{entered();await gate;return encrypt(text);};
  const {sessionId}=f.enrollment.begin(request);samples(f.enrollment,sessionId);
  const pending=f.enrollment.finish(sessionId),rejected=expect(pending).rejects.toThrow('cancelled');
  await ready;f.setAllowed(false);release();await rejected;
  expect(await f.vault.read()).toEqual([]);expect(await readdir(f.dir)).toEqual([]);
 }finally{await f.cleanup();}
});

test('duplicate person names cannot silently overwrite stable enrollment',async()=>{
 const f=await fixture();try{
  const first=f.enrollment.begin(request);samples(f.enrollment,first.sessionId);await f.enrollment.finish(first.sessionId);
  const before=await readFile(f.path);
  const second=f.enrollment.begin({...request,displayName:'FIXTURE PERSON'});samples(f.enrollment,second.sessionId);
  await expect(f.enrollment.finish(second.sessionId)).rejects.toThrow();expect(await readFile(f.path)).toEqual(before);
 }finally{await f.cleanup();}
});
