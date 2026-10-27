import {createHash} from 'node:crypto';
import type {TurnContext} from '../contracts/events.ts';
import type {SpeakerCalibration,SpeakerEvidence,SpeakerProfile} from './contracts.ts';
import {evaluateSpeaker} from './policy.ts';
import {validateProfiles} from './validate.ts';

export interface IdentityDirectory {read():Promise<{profiles:SpeakerProfile[];calibration:SpeakerCalibration|null}>;}
export interface IdentityTurnAuthority {isCurrent(turn:TurnContext):boolean;}
/** Object-identity capability, core-only. Serialized copies are deliberately invalid. */
export interface IdentityHandle {readonly kind:'household-identity';}
export interface IdentityContext {profileId:string;memoryNamespace:string;role:SpeakerProfile['role'];expiresAt:number;}
interface BoundIdentity {turn:TurnContext;deviceId:string;profileId:string;fingerprint:string;expiresAt:number;}
const token=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const fingerprint=(profile:SpeakerProfile,calibration:SpeakerCalibration)=>createHash('sha256').update(JSON.stringify({profile,calibration})).digest('hex');
/** Speaker evidence binding, NOT an action permission or admin authentication service.
 * No production directory/anti-spoof adapter is wired yet. Unknown speakers get no handle.
 */
export class HouseholdSessions {
  #sessions=new Map<IdentityHandle,BoundIdentity>();#requests=new WeakMap<TurnContext,Map<string,object>>();#generation=0;#pending=0;#lastTime=0;
  constructor(private directory:IdentityDirectory,private turns:IdentityTurnAuthority,private now:()=>number=Date.now){}
  #time(){const value=this.now();if(!Number.isSafeInteger(value)||value<=0||value<this.#lastTime){this.revokeAll();return null;}this.#lastTime=value;return value;}
  #prune(now:number){for(const [handle,session] of this.#sessions)if(now>=session.expiresAt||!this.turns.isCurrent(session.turn))this.#sessions.delete(handle);}
  async bind(turn:TurnContext,deviceId:string,evidence:SpeakerEvidence):Promise<IdentityHandle|null>{
    const started=this.#time();if(started===null||!token(deviceId)||!this.turns.isCurrent(turn))return null;
    this.#prune(started);
    // Every new observation revokes the previous speaker, even when the new match fails.
    for(const [handle,session] of this.#sessions)if(session.turn===turn&&session.deviceId===deviceId)this.#sessions.delete(handle);
    const requests=this.#requests.get(turn)??new Map<string,object>(),request={};this.#requests.set(turn,requests);requests.set(deviceId,request);
    if(this.#sessions.size>=32||this.#pending>=16){requests.delete(deviceId);return null;}
    const generation=this.#generation;let safeEvidence:SpeakerEvidence;
    try{
      if(!evidence||!Array.isArray(evidence.embedding)||evidence.embedding.length<2||evidence.embedding.length>4096||
        typeof evidence.modelId!=='string'||evidence.modelId.length>160||!['sufficient','insufficient'].includes(evidence.quality)||!['passed','failed','unavailable'].includes(evidence.antiSpoof))throw new Error('Invalid evidence');
      safeEvidence={embedding:[...evidence.embedding],modelId:evidence.modelId,quality:evidence.quality,antiSpoof:evidence.antiSpoof};
    }catch{requests.delete(deviceId);return null;}
    this.#pending++;
    try{
      const loaded=await this.directory.read(),time=this.#time();
      if(time===null||time-started>10000||generation!==this.#generation||requests.get(deviceId)!==request||!this.turns.isCurrent(turn))return null;
      const profiles=validateProfiles(loaded.profiles),calibration=loaded.calibration;
      if(!calibration)return null;
      const decision=evaluateSpeaker(safeEvidence,profiles,calibration,time);if(decision.state!=='MATCH')return null;
      const profile=profiles.find(p=>p.id===decision.profileId)!;
      this.#prune(time);if(this.#sessions.size>=32)return null;
      // Replace only this turn/device binding, never allow an old speaker to linger there.
      for(const [handle,s] of this.#sessions)if(s.turn===turn&&s.deviceId===deviceId)this.#sessions.delete(handle);
      const handle=Object.freeze({kind:'household-identity' as const});
      this.#sessions.set(handle,{turn,deviceId,profileId:profile.id,fingerprint:fingerprint(profile,calibration),expiresAt:Math.min(time+60000,calibration.expiresAt)});
      return handle;
    }catch{return null;}finally{this.#pending--;if(requests.get(deviceId)===request)requests.delete(deviceId);}
  }
  async resolve(handle:IdentityHandle,turn:TurnContext,deviceId:string):Promise<IdentityContext|null>{
    const session=this.#sessions.get(handle),time=this.#time();
    if(time===null||!session||session.turn!==turn||session.deviceId!==deviceId||time>=session.expiresAt||!this.turns.isCurrent(turn)){if(session)this.#sessions.delete(handle);return null;}
    if(this.#pending>=16)return null;
    const generation=this.#generation;this.#pending++;
    try{
      const loaded=await this.directory.read(),currentTime=this.#time();
      if(currentTime===null||currentTime>=session.expiresAt||generation!==this.#generation||this.#sessions.get(handle)!==session||!this.turns.isCurrent(turn)){this.#sessions.delete(handle);return null;}
      const profile=validateProfiles(loaded.profiles).find(p=>p.id===session.profileId);
      if(!profile||!loaded.calibration||fingerprint(profile,loaded.calibration)!==session.fingerprint){this.#sessions.delete(handle);return null;}
      return {profileId:profile.id,memoryNamespace:profile.memoryNamespace,role:profile.role,expiresAt:session.expiresAt};
    }catch{this.#sessions.delete(handle);return null;}finally{this.#pending--;}
  }
  revokeProfile(profileId:string){this.#generation++;for(const [handle,session] of this.#sessions)if(session.profileId===profileId)this.#sessions.delete(handle);}
  revokeAll(){this.#generation++;this.#sessions.clear();}
}
