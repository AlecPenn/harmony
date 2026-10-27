import type { SpeakerCalibration, SpeakerDecision, SpeakerEvidence, SpeakerProfile } from './contracts.ts';

function vector(value: readonly number[], dimensions: number): boolean {
  if (!Array.isArray(value) || value.length !== dimensions || !Array.from(value).every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e6)) return false;
  return Math.hypot(...value) > 1e-12;
}
function cosine(a: readonly number[], b: readonly number[]): number {
  let dot=0, aa=0, bb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return Math.max(-1,Math.min(1,dot/Math.sqrt(aa*bb)));
}
export function validCalibration(value: SpeakerCalibration, now: number): boolean {
  return Number.isFinite(now) && typeof value.modelId==='string' && value.modelId.length>0 && value.modelId.length<=160 &&
    Number.isInteger(value.dimensions) && value.dimensions>=2 && value.dimensions<=4096 &&
    Number.isFinite(value.rejectBelow) && Number.isFinite(value.acceptAt) && value.rejectBelow>=-1 && value.acceptAt<=1 && value.rejectBelow<value.acceptAt &&
    Number.isFinite(value.minimumMargin) && value.minimumMargin>0 && value.minimumMargin<=2 &&
    Number.isFinite(value.calibratedAt) && Number.isFinite(value.expiresAt) && value.calibratedAt<=now && now<value.expiresAt;
}

/** No default thresholds. Call only with measured, independently validated calibration.
 * A MATCH is evidence, never a permission grant or an authenticated session.
 * Recent samples are intentionally excluded until trusted adaptation is implemented.
 */
export function evaluateSpeaker(evidence: SpeakerEvidence, profiles: readonly SpeakerProfile[], calibration: SpeakerCalibration | null, now: number): SpeakerDecision {
  const reject=(reason:Extract<SpeakerDecision,{profileId:null}>['reason']):SpeakerDecision=>({state:'REJECTED',profileId:null,reason});
  if (!calibration || !validCalibration(calibration,now) || evidence.modelId!==calibration.modelId || !vector(evidence.embedding,calibration.dimensions)) return reject('unavailable');
  if(evidence.antiSpoof!=='passed')return reject('spoof');
  if(evidence.quality!=='sufficient')return {state:'UNCERTAIN',profileId:null,reason:'quality'};
  if(profiles.length===0 || profiles.length>32)return reject('unavailable');
  const ids=new Set<string>();
  const scores: {profileId:string;score:number}[]=[];
  for(const profile of profiles){
    if(!profile.id || ids.has(profile.id) || profile.modelId!==calibration.modelId || !['OWNER','TEEN','CHILD','GUEST'].includes(profile.role) ||
      !Number.isFinite(profile.lastCalibration) || profile.lastCalibration!==calibration.calibratedAt ||
      !Array.isArray(profile.stableEmbeddings) || profile.stableEmbeddings.length<3 || profile.stableEmbeddings.length>20 ||
      !profile.stableEmbeddings.every(sample=>vector(sample,calibration.dimensions)))return reject('unavailable');
    ids.add(profile.id);
    // Median reduces the influence of one contaminated enrollment sample.
    const similarities=profile.stableEmbeddings.map(sample=>cosine(evidence.embedding,sample)).sort((a,b)=>a-b);
    const middle=Math.floor(similarities.length/2);
    const score=similarities.length%2 ? similarities[middle] : (similarities[middle-1]+similarities[middle])/2;
    if(!Number.isFinite(score))return reject('unavailable');
    scores.push({profileId:profile.id,score});
  }
  scores.sort((a,b)=>b.score-a.score);
  const top=scores[0];
  if(top.score<calibration.rejectBelow)return reject('low_match');
  if(top.score<calibration.acceptAt || (scores.length>1 && top.score-scores[1].score<calibration.minimumMargin))return {state:'UNCERTAIN',profileId:null,reason:'ambiguous'};
  return {state:'MATCH',...top};
}
