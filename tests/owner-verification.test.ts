import {test,expect,afterEach} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {OwnerVerification,type OwnerTransport,type OwnerNativeRequest,type OwnerNativeResult} from '../core/owner-verification.ts';
import {NativeOwnerWorker} from '../core/native-owner.ts';
const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const signal=()=>new AbortController().signal;
function cipher(){const key=randomBytes(32);return {available:async()=>true,encrypt:async(text:string)=>{const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);const body=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),body]);},decrypt:async(bytes:Buffer)=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString();}};}
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'harmony-owner-'));dirs.push(dir);const path=join(dir,'owner.enc'),protection=cipher();let now=1,calls=0;
 const requests:OwnerNativeRequest[]=[];
 const transport:OwnerTransport=async request=>{calls++;requests.push(request);return {requestId:request.requestId,result:'verified',counter:request.operation==='enroll'?0:(request.counter??0)+1,...(request.operation==='enroll'?{credential:'aa'.repeat(64)}:{})};};
 const owner=new OwnerVerification(path,protection,transport,()=>'123',()=>now);
 return {path,protection,owner,transport,requests,calls:()=>calls,time:(n:number)=>{now=n;}};
}
const scope={action:'allowance.create',beneficiary:'local_desktop',limitMicros:1000000};
test('owner enrollment is protected and cannot silently replace the enrolled key',async()=>{
 const f=await fixture();expect((await f.owner.status()).configured).toBe(false);await f.owner.enroll(signal());
 expect(await f.owner.status()).toEqual({configured:true,method:'windows-webauthn'});expect((await readFile(f.path)).includes(Buffer.from('aa'.repeat(64)))).toBe(false);
 await expect(f.owner.enroll(signal())).rejects.toThrow();expect(f.calls()).toBe(1);
});
test('native proofs become single-use object-identity grants bound to the complete action',async()=>{
 const f=await fixture();await f.owner.enroll(signal());
 const grant=await f.owner.verify(scope,signal());expect(f.owner.consume({...grant},scope)).toBe(false);expect(f.owner.consume(grant,scope)).toBe(true);expect(f.owner.consume(grant,scope)).toBe(false);
 const changed=await f.owner.verify(scope,signal());expect(f.owner.consume(changed,{...scope,limitMicros:2})).toBe(false);expect(f.owner.consume(changed,scope)).toBe(false);
 expect(f.requests[1].challenge).not.toBe(f.requests[2].challenge);expect(f.requests[1].challenge).toHaveLength(128);
});
test('grants expire and clock rollback revokes authority',async()=>{
 const f=await fixture();await f.owner.enroll(signal());const grant=await f.owner.verify(scope,signal());f.time(60001);expect(f.owner.consume(grant,scope)).toBe(false);
 const next=await f.owner.verify(scope,signal());f.time(2);expect(f.owner.consume(next,scope)).toBe(false);
});
test('cancel discards late native verification and all existing grants',async()=>{
 const f=await fixture();await f.owner.enroll(signal());let release!:(v:OwnerNativeResult)=>void,request!:OwnerNativeRequest;
 const owner=new OwnerVerification(f.path,f.protection,r=>{request=r;return new Promise(resolve=>{release=resolve;});},()=>'123');
 const pending=owner.verify(scope,signal());await new Promise(resolve=>setTimeout(resolve,20));owner.cancel();
 release({requestId:request.requestId,result:'verified',counter:1});await expect(pending).rejects.toThrow('cancelled');expect(owner.active).toBe(false);
 const grant=await f.owner.verify(scope,signal());f.owner.cancel();expect(f.owner.consume(grant,scope)).toBe(false);
});
test('wrong request id, malformed proofs and counter replay never grant authority',async()=>{
 const f=await fixture();await f.owner.enroll(signal());
 for(const patch of [{requestId:'f'.repeat(64)},{result:'yes'},{counter:-1},{counter:1.5},{credential:'unexpected'}]){
  const owner=new OwnerVerification(f.path,f.protection,async r=>({requestId:r.requestId,result:'verified',counter:1,...patch}) as OwnerNativeResult,()=>'123');
  await expect(owner.verify(scope,signal())).rejects.toThrow();
 }
 await f.owner.verify(scope,signal());const replay=new OwnerVerification(f.path,f.protection,async r=>({requestId:r.requestId,result:'verified',counter:1}),()=>'123');await expect(replay.verify(scope,signal())).rejects.toThrow();
});
test('scope mutation during native verification cannot change the eventual grant',async()=>{
 const f=await fixture();await f.owner.enroll(signal());const input={...scope};const pending=f.owner.verify(input,signal());input.limitMicros=7;const grant=await pending;
 expect(f.owner.consume(grant,scope)).toBe(true);
});
test('unconfigured or already cancelled verification does not invoke native UI',async()=>{
 const f=await fixture();await expect(f.owner.verify(scope,signal())).rejects.toThrow();await expect(f.owner.enroll(AbortSignal.abort())).rejects.toThrow();expect(f.calls()).toBe(0);
});
test('cancellation during encryption prevents enrollment persistence',async()=>{
 const f=await fixture();let release!:(b:Buffer)=>void;const original=f.protection.encrypt;let started!:(v?:unknown)=>void;const ready=new Promise(resolve=>{started=resolve;});
 f.protection.encrypt=async text=>{const encrypted=await original(text);started();return new Promise(resolve=>{release=()=>resolve(encrypted);});};
 const pending=f.owner.enroll(signal());await ready;f.owner.cancel();release(Buffer.alloc(0));await expect(pending).rejects.toThrow('cancelled');expect((await f.owner.status()).configured).toBe(false);
});
test.skipIf(process.platform!=='win32'||!existsSync('.runtime/owner/fido2'))('native availability probe launches no enrollment or verification prompt',async()=>{
 const worker=new NativeOwnerWorker(resolve('.'));expect(await worker.probe()).toEqual({available:true});expect(worker.active).toBe(false);
});
