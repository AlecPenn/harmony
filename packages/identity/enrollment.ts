import {randomUUID} from 'node:crypto';
import type {HouseholdRole,SpeakerProfile} from './contracts.ts';
import {ProfileVault} from './vault.ts';

export const enrollmentConditions=['normal','quiet','loud','close','far'] as const;
export type EnrollmentCondition=typeof enrollmentConditions[number];
export interface EnrollmentRequest {displayName:string;role:HouseholdRole;consent:true;}
export interface EnrollmentAuthority {
  /** Supplied by a trusted local admin boundary, never inferred from a voice match. */
  allowed(action:'enroll'|'delete',targetId:string|null):boolean;
}
interface Session {id:string;profileId:string;request:EnrollmentRequest;expiresAt:number;samples:Map<EnrollmentCondition,number[]>;saving:boolean;timer:ReturnType<typeof setTimeout>|null;}
function fail():never{throw new Error('Household enrollment is not available');}
/** Core-only supervisor. No IPC, recording, first-owner bootstrap or permission grants. */
export class HouseholdEnrollment {
  #session:Session|null=null;
  constructor(private vault:ProfileVault,private authority:EnrollmentAuthority,private modelId:string,private dimensions:number,private now:()=>number=Date.now){
    if(!modelId||modelId.length>160||!Number.isInteger(dimensions)||dimensions<2||dimensions>4096)fail();
  }
  #time(){const now=this.now();if(!Number.isSafeInteger(now)||now<=0)fail();return now;}
  #active(id:string){
    const s=this.#session;
    if(!s||s.id!==id)fail();
    if(this.#time()>=s.expiresAt||!this.authority.allowed('enroll',s.profileId)){this.cancel();fail();}
    return s;
  }
  #dispose(s:Session){if(s.timer)clearTimeout(s.timer);for(const sample of s.samples.values())sample.fill(0);s.samples.clear();}
  begin(value:EnrollmentRequest){
    if(this.#session||!this.authority.allowed('enroll',null))fail();
    if(!value||Object.keys(value).sort().join(',')!=='consent,displayName,role'||value.consent!==true||
      typeof value.displayName!=='string'||!value.displayName.trim()||value.displayName.length>80||/[\x00-\x1f]/.test(value.displayName)||!['OWNER','TEEN','CHILD','GUEST'].includes(value.role))fail();
    const s:Session={id:randomUUID(),profileId:randomUUID(),request:{...value,displayName:value.displayName.trim()},expiresAt:this.#time()+10*60*1000,samples:new Map(),saving:false,timer:null};
    this.#session=s;s.timer=setTimeout(()=>{if(this.#session===s)this.cancel();},10*60*1000);s.timer.unref();return {sessionId:s.id,required:[...enrollmentConditions],expiresAt:s.expiresAt};
  }
  progress(id:string){const s=this.#active(id);return {collected:[...s.samples.keys()],required:[...enrollmentConditions],saving:s.saving};}
  add(id:string,condition:EnrollmentCondition,modelId:string,embedding:readonly number[],quality:'sufficient'|'insufficient'){
    const s=this.#active(id);
    if(s.saving||!enrollmentConditions.includes(condition)||s.samples.has(condition)||modelId!==this.modelId||quality!=='sufficient'||
      !Array.isArray(embedding)||embedding.length!==this.dimensions||!Array.from(embedding).every(x=>Number.isFinite(x)&&Math.abs(x)<=1e6))fail();
    const norm=Math.hypot(...embedding);if(norm<1e-12)fail();
    const normalized=embedding.map(x=>x/norm);
    // Identical templates are not varied observations. This is not a liveness check.
    if([...s.samples.values()].some(sample=>sample.every((x,i)=>Math.abs(x-normalized[i])<1e-10)))fail();
    s.samples.set(condition,normalized);
  }
  async finish(id:string){
    const s=this.#active(id);if(s.saving||s.samples.size!==enrollmentConditions.length)fail();s.saving=true;
    const profile:SpeakerProfile={id:s.profileId,displayName:s.request.displayName,role:s.request.role,modelId:this.modelId,
      stableEmbeddings:enrollmentConditions.map(condition=>[...s.samples.get(condition)!]),trustedRecentEmbeddings:[],permissions:[],memoryNamespace:'person_'+s.profileId.replaceAll('-',''),settings:{},enrolledAt:this.#time(),lastCalibration:0};
    try{
      await this.vault.update(current=>{
        if(current.length>=32||current.some(p=>p.displayName.toLocaleLowerCase()===profile.displayName.toLocaleLowerCase()))fail();
        return [...current,profile];
      },()=>this.#session===s&&this.#time()<s.expiresAt&&this.authority.allowed('enroll',s.profileId));
      return {profileId:profile.id,calibrationRequired:true as const};
    }finally{
      this.#dispose(s);for(const sample of profile.stableEmbeddings)(sample as number[]).fill(0);
      if(this.#session===s)this.#session=null;
    }
  }
  cancel(){const s=this.#session;this.#session=null;if(s)this.#dispose(s);}
  async remove(profileId:string){
    if(typeof profileId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId)||!this.authority.allowed('delete',profileId))fail();
    if(this.#session?.profileId===profileId)this.cancel();
    await this.vault.update(current=>current.filter(p=>p.id!==profileId),()=>this.authority.allowed('delete',profileId));
  }
}
