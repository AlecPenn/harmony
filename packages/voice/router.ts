/** Pure selection policy. Provider adapters must independently enforce cancellation and consent. */
export type VoiceMode='LOCAL_FIRST'|'FASTEST'|'BEST_QUALITY'|'OFFLINE'|'CLOUD_PREMIUM';
export interface VoiceCandidate {
 id:string; location:'local'|'cloud'; ready:boolean; healthy:boolean;
 /** Monotonic timestamp from the same coordinator clock as request.nowMs. */
 checkedAtMs:number;
 locale:string; gender:'female'|'male'|'unspecified';
 firstAudioMs:number|null; quality:number; costPerMillionCharacters:number;
 memoryMiB:number;
}
export interface VoiceRouteRequest {
 mode:VoiceMode; locale:string; gender:VoiceCandidate['gender']; online:boolean;
 nowMs:number; maxHealthAgeMs:number;
 cloudApproved:boolean; maxCostPerMillionCharacters:number; availableMemoryMiB:number;
}
export type VoiceRoute={providerId:string;reason:string}|{providerId:null;reason:string};
const modes:VoiceMode[]=['LOCAL_FIRST','FASTEST','BEST_QUALITY','OFFLINE','CLOUD_PREMIUM'];
export function routeVoice(request:VoiceRouteRequest,candidates:readonly VoiceCandidate[]):VoiceRoute {
 const finite=(n:number)=>Number.isFinite(n)&&n>=0;
 if(!modes.includes(request.mode)||!finite(request.nowMs)||!finite(request.maxHealthAgeMs)||request.maxHealthAgeMs<=0||request.maxHealthAgeMs>60000||typeof request.online!=='boolean'||typeof request.cloudApproved!=='boolean'||!finite(request.maxCostPerMillionCharacters)||!finite(request.availableMemoryMiB))throw new Error('Invalid voice routing budget');
 if(candidates.length>32||new Set(candidates.map(c=>c.id)).size!==candidates.length)throw new Error('Invalid provider inventory');
 const eligible=candidates.filter(c=>{
  if(typeof c.ready!=='boolean'||typeof c.healthy!=='boolean'||!finite(c.checkedAtMs)||!/^[a-z][a-z0-9_.-]{0,63}$/.test(c.id)||!['local','cloud'].includes(c.location)||!finite(c.quality)||c.quality>1||!finite(c.memoryMiB)||!finite(c.costPerMillionCharacters)||(c.firstAudioMs!==null&&!finite(c.firstAudioMs)))throw new Error('Invalid provider health');
  return c.ready&&c.healthy&&c.checkedAtMs<=request.nowMs&&request.nowMs-c.checkedAtMs<=request.maxHealthAgeMs&&c.locale===request.locale&&c.gender===request.gender&&c.memoryMiB<=request.availableMemoryMiB&&c.costPerMillionCharacters<=request.maxCostPerMillionCharacters
   &&(c.location==='local'||(request.online&&request.cloudApproved&&request.mode!=='OFFLINE'))
   &&(request.mode!=='CLOUD_PREMIUM'||c.location==='cloud');
 });
 if(!eligible.length)return {providerId:null,reason:'No recently verified provider matches the voice, resource and consent requirements.'};
 const latency=(c:VoiceCandidate)=>c.firstAudioMs??Infinity;
 eligible.sort((a,b)=>{
  if(request.mode==='LOCAL_FIRST'&&a.location!==b.location)return a.location==='local'?-1:1;
  if(request.mode==='BEST_QUALITY'||request.mode==='CLOUD_PREMIUM')return b.quality-a.quality||latency(a)-latency(b)||a.id.localeCompare(b.id);
  return latency(a)-latency(b)||b.quality-a.quality||a.id.localeCompare(b.id);
 });
 return {providerId:eligible[0].id,reason:`${request.mode}: matching recently verified provider within explicit resource and spending limits.`};
}
