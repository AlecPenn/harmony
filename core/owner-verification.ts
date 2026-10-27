import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ProtectedSettings} from './protected-settings.ts';
import {actionInputHash} from '../packages/permissions/policy.ts';
import type {ProfileCipher} from '../packages/identity/vault.ts';
export interface OwnerRecord {version:1;personId:'local_desktop';credential:string;counter:number;}
export type OwnerNativeRequest={operation:'enroll'|'verify';requestId:string;challenge:string;window:string;credential?:string;counter?:number;};
export interface OwnerNativeResult {requestId:string;result:'verified';credential?:string;counter:number;}
export type OwnerTransport=(request:OwnerNativeRequest,signal:AbortSignal)=>Promise<OwnerNativeResult>;
export interface OwnerGrant {readonly kind:'owner-verification';}
function record(value:unknown):OwnerRecord{
 actionInputHash(value);const v=value as OwnerRecord;
 if(!v||Object.keys(v).sort().join(',')!=='counter,credential,personId,version'||v.version!==1||v.personId!=='local_desktop'
  ||typeof v.credential!=='string'||!/^(?:[a-f0-9]{2}){1,1536}$/.test(v.credential)
  ||!Number.isSafeInteger(v.counter)||v.counter<0||v.counter>0xffffffff)throw new Error('Invalid protected owner');
 return {...v};
}
/** Local passkey possession, not voice identity or proof of a named household person.
 * Only the trusted main process receives grants. No grant can survive serialization.
 */
export class OwnerVerification {
 #task:Promise<unknown>|null=null;
 #store:ProtectedSettings<OwnerRecord>;#controller:AbortController|null=null;#generation=0;#last=0;
 #grants=new Map<OwnerGrant,{hash:string;expires:number;generation:number}>();
 constructor(path:string,cipher:ProfileCipher,private transport:OwnerTransport,private window:()=>string,private now:()=>number=()=>performance.now()){
  this.#store=new ProtectedSettings(path,cipher,record);
 }
 get active(){return this.#controller!==null;}
 async status(){return {configured:!!await this.#store.read(),method:'windows-webauthn' as const};}
 #time(){const now=this.now();if(!Number.isFinite(now)||now<0||now<this.#last){this.cancel();throw new Error('Owner verification clock unavailable');}this.#last=now;return now;}
 cancel(){this.#generation++;this.#grants.clear();this.#controller?.abort();}
 async stop(){this.cancel();await this.#task?.catch(()=>{});}
 #operation<T>(signal:AbortSignal,work:(signal:AbortSignal,current:()=>boolean)=>Promise<T>):Promise<T>{
  if(this.active||signal.aborted)return Promise.reject(new Error('Owner verification unavailable'));
  const controller=new AbortController();this.#controller=controller;const generation=this.#generation;
  const combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(75000)]);
  const current=()=>!combined.aborted&&generation===this.#generation;
  const task=(async()=>{try{return await work(combined,current);}catch{throw new Error(current()?'Owner verification unavailable':'Owner verification cancelled');}
   finally{controller.abort();if(this.#controller===controller)this.#controller=null;}})();
  this.#task=task;void task.finally(()=>{if(this.#task===task)this.#task=null;}).catch(()=>{});return task;
 }
 #request(operation:'enroll'|'verify',scope:unknown,stored?:OwnerRecord):OwnerNativeRequest{
  const nonce=randomBytes(32).toString('hex'),hash=actionInputHash({operation,scope});
  const window=this.window();if(!/^[1-9][0-9]{0,19}$/.test(window))throw new Error('Owner window unavailable');
  return {operation,requestId:nonce,challenge:nonce+hash,window,...(stored?{credential:stored.credential,counter:stored.counter}:{})};
 }
 #result(request:OwnerNativeRequest,result:OwnerNativeResult){
  actionInputHash(result);
  if(!result||result.requestId!==request.requestId||result.result!=='verified'||!Number.isSafeInteger(result.counter)||result.counter<0||result.counter>0xffffffff
   ||Object.keys(result).sort().join(',')!==(request.operation==='enroll'?'counter,credential,requestId,result':'counter,requestId,result'))throw new Error('Owner verification unavailable');
 }
 enroll(signal:AbortSignal):Promise<void>{
  return this.#operation(signal,async(signal,current)=>{
   if(await this.#store.read()||!current())throw new Error('Owner already configured');
   const request=this.#request('enroll',{personId:'local_desktop',version:1});
   const result=await this.transport(request,signal);this.#result(request,result);
   if(!current())throw new Error();
   await this.#store.save({version:1,personId:'local_desktop',credential:result.credential,counter:result.counter},current);
   if(!current())throw new Error();
  });
 }
 verify(scope:unknown,signal:AbortSignal):Promise<OwnerGrant>{
  const hash=actionInputHash(scope),snapshot=structuredClone(scope);
  return this.#operation(signal,async(signal,current)=>{
   const stored=await this.#store.read();if(!stored||!current())throw new Error();
   const request=this.#request('verify',snapshot,stored),result=await this.transport(request,signal);this.#result(request,result);
   if(!current()||((stored.counter!==0||result.counter!==0)&&result.counter<=stored.counter))throw new Error();
   await this.#store.save({...stored,counter:result.counter},current);
   if(!current())throw new Error();
   const now=this.#time();for(const [grant,state] of this.#grants)if(now>=state.expires)this.#grants.delete(grant);
   if(this.#grants.size>=32)throw new Error();
   const grant=Object.freeze({kind:'owner-verification' as const});this.#grants.set(grant,{hash,expires:now+60000,generation:this.#generation});return grant;
  });
 }
 consume(grant:OwnerGrant,scope:unknown):boolean{
  const value=this.#grants.get(grant);this.#grants.delete(grant);
  try{return !!value&&value.generation===this.#generation&&this.#time()<value.expires&&actionInputHash(scope)===value.hash;}catch{return false;}
 }
}
